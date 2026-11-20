const cloudinary = require("../config/cloudinary");
const { db } = require("../config/firebase");
const { AggregateField } = require("firebase-admin/firestore");
const { COLLECTIONS, ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");
const {
  avatarPublicId,
  avatarFolderPrefix,
  assetDocId,
  parseCloudinaryUrl,
} = require("../utils/cloudinaryUrl");

/**
 * ==== v0.10.20 — Quản lý vòng đời tài nguyên Cloudinary ====
 *
 * VẤN ĐỀ TRƯỚC ĐÂY: mỗi lần đổi avatar, `upload_stream` tạo 1 asset MỚI (public_id
 * ngẫu nhiên) còn asset cũ bị bỏ lại — không ai tham chiếu, không ai xoá. Thêm
 * nữa: upload xong mà ghi Firestore lỗi cũng để lại rác, và chưa có đường nào
 * dọn khi xoá tài khoản.
 *
 * NGUYÊN TẮC MỚI:
 *  1. public_id CỐ ĐỊNH theo (loại asset, uid) + `overwrite: true` → mỗi user
 *     luôn chỉ có ĐÚNG 1 avatar trên Cloudinary. Upload lại không sinh asset mới;
 *     ghi Firestore lỗi cũng không tạo rác mới (lần sau ghi đè chính nó).
 *  2. Mọi asset đều có 1 dòng trong collection `assets` (sổ đăng ký): biết ai sở
 *     hữu, bao lớn, đổi bao nhiêu lần → đo đếm/giám sát được, dọn theo chủ sở hữu.
 *  3. Asset kiểu cũ (public_id ngẫu nhiên) được dọn "lười" ngay lần user đổi
 *     avatar kế tiếp, phần còn lại do scripts/cleanup-orphan-assets.js xử lý.
 *  4. Mọi thao tác XOÁ chỉ chạm public_id nằm trong thư mục của CHÍNH chủ sở hữu.
 */

const ASSETS = () => db.collection(COLLECTIONS.ASSETS);

/**
 * Upload avatar (buffer đã được kiểm tra magic bytes ở controller) lên Cloudinary.
 * Trả về kết quả gốc của Cloudinary (secure_url, public_id, bytes, version...).
 */
function putAvatar(uid, buffer) {
  const publicId = avatarPublicId(uid);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true, // upload lại = ghi đè, KHÔNG tạo asset mới
        invalidate: true, // xoá cache CDN của bản cũ
        resource_type: "image",
        type: "upload",
        // Luôn ép JPEG: GIF động/PNG lớn bị chuyển thành ảnh tĩnh nhẹ, và URL nhất quán.
        format: "jpg",
        // Incoming transformation: Cloudinary CHỈ LƯU bản đã xử lý (512x512), không giữ ảnh gốc.
        transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }, { quality: "auto" }],
        // Thẻ + context giúp truy vấn/kiểm toán phía Cloudinary không phụ thuộc chế độ thư mục.
        tags: ["twelve", ASSET_KIND.AVATAR],
        context: { owner_uid: uid, kind: ASSET_KIND.AVATAR },
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload_stream error:", error);
          return reject(error);
        }
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Chuẩn bị (KHÔNG commit) các thao tác ghi Firestore cho 1 avatar vừa upload:
 * cập nhật user.avatarUrl + upsert sổ `assets`, cùng 1 batch (atomic).
 */
async function commitAvatarRecord(uid, result) {
  const assetRef = ASSETS().doc(assetDocId(result.public_id));
  const existing = await assetRef.get();
  const prev = existing.exists ? existing.data() : null;
  const now = new Date().toISOString();

  const batch = db.batch();
  batch.update(db.collection(COLLECTIONS.USERS).doc(uid), { avatarUrl: result.secure_url });
  batch.set(assetRef, {
    publicId: result.public_id,
    kind: ASSET_KIND.AVATAR,
    ownerUid: uid,
    url: result.secure_url,
    bytes: result.bytes || 0,
    format: result.format || null,
    width: result.width || null,
    height: result.height || null,
    version: result.version || null,
    uploadCount: (prev?.uploadCount || 0) + 1,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  });
  await batch.commit();
}

/**
 * Dọn "lười" asset avatar KIỂU CŨ (public_id ngẫu nhiên) của chính user này,
 * sau khi avatar mới đã ghi thành công. Best-effort: lỗi chỉ log, script dọn rác
 * sẽ xử lý sau. AN TOÀN: chỉ xoá nếu public_id nằm trong thư mục avatar của
 * đúng `uid` và khác public_id hiện tại.
 */
async function releaseSupersededAvatar(uid, previousUrl, currentPublicId) {
  try {
    const parsed = parseCloudinaryUrl(previousUrl);
    if (!parsed || parsed.resourceType !== "image" || parsed.deliveryType !== "upload") return false;
    if (parsed.cloudName !== cloudinary.config().cloud_name) return false;
    if (parsed.publicId === currentPublicId) return false;
    if (!parsed.publicId.startsWith(avatarFolderPrefix(uid))) return false;

    await cloudinary.uploader.destroy(parsed.publicId, { resource_type: "image", invalidate: true });
    return true;
  } catch (err) {
    console.error("releaseSupersededAvatar (bỏ qua, script dọn rác sẽ xử lý):", err?.message || err);
    return false;
  }
}

/**
 * Xoá TOÀN BỘ asset của 1 user (dùng khi xoá tài khoản — hiện Twelve chưa có
 * tính năng này, hàm đã sẵn để gắn vào). Gồm: asset đã đăng ký + asset kiểu cũ
 * còn nằm trong thư mục avatar của user + các dòng trong sổ `assets`.
 */
async function deleteAllAssetsOfUser(uid) {
  const snap = await ASSETS().where("ownerUid", "==", uid).get();
  const publicIds = new Set(snap.docs.map((d) => d.data().publicId).filter(Boolean));
  // Chú ý: xoá theo prefix chỉ khớp public_id (asset kiểu cũ trong chế độ fixed folder);
  // asset kiểu cũ ở dynamic folder mode do scripts/cleanup-orphan-assets.js xử lý.
  await cloudinary.api.delete_resources_by_prefix(avatarFolderPrefix(uid), {
    resource_type: "image",
    invalidate: true,
  });
  if (publicIds.size > 0) {
    await cloudinary.api.delete_resources([...publicIds], { resource_type: "image", invalidate: true });
  }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { removed: publicIds.size };
}

// ---- Giám sát ----
let statsCache = { at: 0, data: null };
const STATS_TTL_MS = 60 * 1000; // bảo vệ hạn mức Admin API của Cloudinary

async function getAssetStats({ force = false } = {}) {
  if (!force && statsCache.data && Date.now() - statsCache.at < STATS_TTL_MS) {
    return { ...statsCache.data, cached: true };
  }

  const col = ASSETS();
  const kinds = Object.values(ASSET_KIND);

  const [totalAgg, ...perKind] = await Promise.all([
    col.aggregate({ count: AggregateField.count(), totalBytes: AggregateField.sum("bytes") }).get(),
    ...kinds.map((k) =>
      col
        .where("kind", "==", k)
        .aggregate({ count: AggregateField.count(), totalBytes: AggregateField.sum("bytes") })
        .get()
    ),
  ]);

  const topSnap = await col.orderBy("uploadCount", "desc").limit(10).get();

  // Gắn tên hiển thị để SA nhìn ra ai (trang quản trị chỉ có uid thì khó dùng). Endpoint chỉ dành cho SA.
  const topUids = [...new Set(topSnap.docs.map((d) => d.data().ownerUid).filter(Boolean))];
  const topUserSnaps = topUids.length
    ? await db.getAll(...topUids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)))
    : [];
  const topUserInfo = new Map(
    topUserSnaps.map((snap) => {
      const u = snap.exists ? snap.data() : null;
      return [snap.id, u ? { displayName: u.displayName || null, tagName: u.tagName ? `@${u.tagName}` : null } : null];
    })
  );

  let cloudinaryUsage = null;
  try {
    const u = await cloudinary.api.usage();
    cloudinaryUsage = {
      plan: u.plan || null,
      storageBytes: u.storage?.usage ?? null,
      storageLimitBytes: u.storage?.limit ?? null,
      storageUsedPercent: u.storage?.used_percent ?? null,
      resources: u.resources ?? null,
      derivedResources: u.derived_resources ?? null,
      lastUpdated: u.last_updated || null,
    };
  } catch (err) {
    console.error("getAssetStats: không lấy được cloudinary.api.usage():", err?.message || err);
  }

  const data = {
    generatedAt: new Date().toISOString(),
    registry: {
      total: totalAgg.data().count,
      totalBytes: totalAgg.data().totalBytes || 0,
      byKind: Object.fromEntries(
        kinds.map((k, i) => [k, { count: perKind[i].data().count, totalBytes: perKind[i].data().totalBytes || 0 }])
      ),
      limits: ASSET_LIMITS,
    },
    // Ai đổi/upload nhiều nhất — phát hiện tài khoản lạm dụng sớm.
    topUploaders: topSnap.docs.map((d) => {
      const a = d.data();
      const info = topUserInfo.get(a.ownerUid);
      return {
        ownerUid: a.ownerUid,
        displayName: info?.displayName || null,
        tagName: info?.tagName || null,
        accountExists: !!info, // false = tài khoản đã bị xoá nhưng asset còn trong sổ
        kind: a.kind,
        uploadCount: a.uploadCount || 0,
        updatedAt: a.updatedAt,
      };
    }),
    // Dung lượng thật trên Cloudinary (gồm cả media khác ngoài registry, vd. ảnh/video SA tự up cho bài viết).
    cloudinary: cloudinaryUsage,
  };
  statsCache = { at: Date.now(), data };
  return { ...data, cached: false };
}

module.exports = {
  putAvatar,
  commitAvatarRecord,
  releaseSupersededAvatar,
  deleteAllAssetsOfUser,
  getAssetStats,
};
