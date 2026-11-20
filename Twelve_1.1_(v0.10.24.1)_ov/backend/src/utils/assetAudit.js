const { ASSET_KIND, ASSET_ROOT_FOLDER } = require("./constants");
const { parseCloudinaryUrl, assetDocId } = require("./cloudinaryUrl");

/**
 * v0.10.20 — Bộ lập kế hoạch dọn tài nguyên (HÀM THUẦN, không I/O) cho
 * scripts/cleanup-orphan-assets.js. Nhận dữ liệu đã đọc sẵn từ Cloudinary +
 * Firestore, trả về kế hoạch: giữ gì, xoá gì, vì sao. Tách riêng để test kỹ —
 * xoá nhầm ảnh là thao tác không hoàn tác được.
 *
 * Đối soát 3 chiều:  Cloudinary  <->  user.avatarUrl  <->  sổ `assets`.
 *
 * Quy tắc AN TOÀN (không bao giờ xoá):
 *  - asset user đang dùng làm avatar (avatarUrl trỏ tới)
 *  - asset có URL xuất hiện trong nội dung bài viết/blog (người dùng đã dán)
 *  - asset mới upload trong `graceHours` (upload xong, Firestore chưa kịp ghi)
 *  - asset không xác định được chủ sở hữu (chỉ báo cáo, trừ khi includeUnattributed)
 *  - mọi asset NGOÀI phạm vi `scope` (mặc định "twelve/avatars/"): media SA tự
 *    upload cho bài viết nằm ngoài phạm vi này nên không bao giờ bị đụng tới.
 */
function planAssetCleanup({
  resources = [],
  users = [],
  contentPublicIds = new Set(),
  registry = [],
  cloudName,
  now = Date.now(),
  graceHours = 24,
  scope = `${ASSET_ROOT_FOLDER}/avatars/`,
  includeUnattributed = false,
} = {}) {
  const scopeFolder = scope.replace(/\/$/, "");
  const graceMs = graceHours * 3600 * 1000;
  const userIds = new Set(users.map((u) => u.uid));

  const inScope = (r) =>
    (r.public_id || "").startsWith(scope) ||
    (r.asset_folder || "") === scopeFolder ||
    (r.asset_folder || "").startsWith(scope);

  // Chủ sở hữu suy ra từ đường dẫn: <scope><uid>/... (public_id hoặc asset_folder ở dynamic folder mode)
  const ownerOf = (r) => {
    for (const p of [r.public_id || "", r.asset_folder ? `${r.asset_folder}/` : ""]) {
      if (p.startsWith(scope)) {
        const seg = p.slice(scope.length).split("/");
        if (seg.length >= 2 && seg[0]) return seg[0];
      }
    }
    return null;
  };

  // publicId -> uid, từ avatarUrl hiện tại của mọi user (chỉ tính URL thuộc đúng cloud này)
  const referenced = new Map();
  let usersWithAvatar = 0;
  let foreignCloudAvatars = 0;
  for (const u of users) {
    if (!u.avatarUrl) continue;
    usersWithAvatar++;
    const parsed = parseCloudinaryUrl(u.avatarUrl);
    if (!parsed) continue;
    if (cloudName && parsed.cloudName !== cloudName) {
      foreignCloudAvatars++;
      continue;
    }
    referenced.set(parsed.publicId, u.uid);
  }

  const registryById = new Map(registry.map((r) => [r.publicId, r]));
  const scoped = resources.filter(inScope);

  const plan = { keep: [], delete: [], skipped: [], unattributed: [], registryToCreate: [], registryToRemove: [] };
  const reasonOf = {};

  for (const r of scoped) {
    const pid = r.public_id;
    const owner = ownerOf(r);
    const createdMs = r.created_at ? Date.parse(r.created_at) : NaN;
    const base = { publicId: pid, ownerUid: owner, bytes: r.bytes || 0, url: r.secure_url || null, createdAt: r.created_at || null };

    if (referenced.has(pid)) {
      plan.keep.push({ ...base, reason: "AVATAR_IN_USE" });
      reasonOf[pid] = "keep";
      if (!registryById.has(pid)) {
        plan.registryToCreate.push({
          publicId: pid,
          kind: ASSET_KIND.AVATAR,
          ownerUid: referenced.get(pid),
          url: r.secure_url || null,
          bytes: r.bytes || 0,
          format: r.format || null,
          width: r.width || null,
          height: r.height || null,
          version: r.version || null,
        });
      }
      continue;
    }
    if (contentPublicIds.has(pid)) {
      plan.keep.push({ ...base, reason: "REFERENCED_IN_CONTENT" });
      reasonOf[pid] = "keep";
      continue;
    }
    if (Number.isFinite(createdMs) && now - createdMs < graceMs) {
      plan.skipped.push({ ...base, reason: "WITHIN_GRACE_PERIOD" });
      reasonOf[pid] = "skip";
      continue;
    }
    if (!owner) {
      const entry = { ...base, reason: "UNATTRIBUTED" };
      plan.unattributed.push(entry);
      if (includeUnattributed) {
        plan.delete.push(entry);
        reasonOf[pid] = "delete";
      } else reasonOf[pid] = "skip";
      continue;
    }
    plan.delete.push({ ...base, reason: userIds.has(owner) ? "SUPERSEDED_AVATAR" : "ACCOUNT_GONE" });
    reasonOf[pid] = "delete";
  }

  // Dòng sổ `assets` (trong phạm vi) mà asset thật không còn hoặc sắp bị xoá -> dọn dòng sổ
  const existingIds = new Set(scoped.map((r) => r.public_id));
  for (const reg of registry) {
    if (!(reg.publicId || "").startsWith(scope)) continue;
    if (!existingIds.has(reg.publicId) || reasonOf[reg.publicId] === "delete") {
      plan.registryToRemove.push({ publicId: reg.publicId, docId: assetDocId(reg.publicId) });
    }
  }

  // ---- "Phanh an toàn": các dấu hiệu dữ liệu đầu vào có vấn đề -> KHÔNG được --apply ----
  const blockers = [];
  if (users.length === 0) {
    blockers.push("NO_USERS: không đọc được user nào từ Firestore — có thể sai project; nếu tiếp tục, MỌI avatar sẽ bị coi là rác.");
  }
  if (usersWithAvatar > 0 && foreignCloudAvatars === usersWithAvatar) {
    blockers.push("CLOUD_MISMATCH: mọi avatarUrl trỏ tới cloud khác với CLOUDINARY_CLOUD_NAME hiện tại — sai biến môi trường?");
  }
  const keptAvatars = plan.keep.filter((k) => k.reason === "AVATAR_IN_USE").length;
  if (scoped.length > 0 && usersWithAvatar - foreignCloudAvatars > 0 && keptAvatars === 0) {
    blockers.push("NO_REFERENCE_MATCH: có user dùng avatar nhưng không asset nào khớp — nhiều khả năng cách ánh xạ URL↔public_id không đúng với tài khoản này.");
  }

  const sum = (arr) => arr.reduce((n, x) => n + (x.bytes || 0), 0);
  const count = (reason) => plan.delete.filter((d) => d.reason === reason).length;
  plan.summary = {
    listedTotal: resources.length,
    inScope: scoped.length,
    usersTotal: users.length,
    usersWithAvatar,
    keep: plan.keep.length,
    delete: plan.delete.length,
    deleteBytes: sum(plan.delete),
    deleteByReason: {
      SUPERSEDED_AVATAR: count("SUPERSEDED_AVATAR"),
      ACCOUNT_GONE: count("ACCOUNT_GONE"),
      UNATTRIBUTED: count("UNATTRIBUTED"),
    },
    skippedWithinGrace: plan.skipped.length,
    unattributedReportedOnly: includeUnattributed ? 0 : plan.unattributed.length,
    registryToCreate: plan.registryToCreate.length,
    registryToRemove: plan.registryToRemove.length,
  };
  plan.blockers = blockers;
  return plan;
}

module.exports = { planAssetCleanup };
