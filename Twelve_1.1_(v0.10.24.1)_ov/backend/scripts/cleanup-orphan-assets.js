#!/usr/bin/env node
/**
 * cleanup-orphan-assets.js  (v0.10.20)
 * ============================================================================
 * Dọn các ảnh avatar "mồ côi" mà người dùng đã để lại trên Cloudinary suốt các
 * bản Beta (mỗi lần đổi avatar cũ đều sinh 1 asset mới và bỏ lại asset trước),
 * đồng thời đối soát/khởi tạo sổ `assets` trong Firestore.
 *
 * MẶC ĐỊNH LÀ DRY-RUN: chỉ đọc, in báo cáo, ghi file báo cáo JSON. Phải truyền
 * `--apply` mới thực sự xoá trên Cloudinary và ghi Firestore.
 *
 * CÁCH DÙNG (chạy trong thư mục backend, cùng file .env với server):
 *   npm run assets:cleanup                      # dry-run
 *   node scripts/cleanup-orphan-assets.js --apply --limit=20    # thử xoá 20 asset đầu
 *   npm run assets:cleanup:apply                # xoá thật
 *
 * CỜ:
 *   --apply                 xoá thật + ghi sổ `assets`
 *   --limit=N               chỉ xoá tối đa N asset trong lần chạy này (thử nhỏ trước)
 *   --grace-hours=H         bỏ qua asset mới hơn H giờ (mặc định 24) — tránh xoá ảnh
 *                           vừa upload mà Firestore chưa kịp ghi
 *   --include-unattributed  cho phép xoá cả asset trong phạm vi nhưng không suy ra được
 *                           chủ sở hữu (mặc định chỉ báo cáo, không xoá)
 *
 * AN TOÀN:
 *   - Chỉ động tới asset trong `twelve/avatars/` — media SA tự upload cho bài viết
 *     (thư mục khác) không bao giờ bị liệt kê để xoá.
 *   - Không xoá: avatar đang dùng, asset có URL nằm trong nội dung bài viết/blog,
 *     asset mới trong thời gian ân hạn.
 *   - "Phanh an toàn": nếu dữ liệu đầu vào có dấu hiệu sai (không đọc được user nào,
 *     sai cloud, không khớp avatar nào...) script từ chối --apply.
 *   - Danh sách sẽ xoá được ghi ra `scripts/reports/` TRƯỚC khi xoá.
 *   - XOÁ TRÊN CLOUDINARY KHÔNG HOÀN TÁC (trừ khi tài khoản bật Backup). Luôn chạy
 *     dry-run, đọc báo cáo, rồi thử --limit nhỏ trước.
 *   - Admin API của Cloudinary có hạn mức theo giờ (gói free ~500 lệnh/giờ). Gặp lỗi
 *     hạn mức script dừng gọn và báo tiến độ — chạy lại sau, an toàn chạy lại nhiều lần.
 * ============================================================================
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const cloudinary = require(path.join(__dirname, "..", "src", "config", "cloudinary"));
const { db } = require(path.join(__dirname, "..", "src", "config", "firebase"));
const { COLLECTIONS } = require(path.join(__dirname, "..", "src", "utils", "constants"));
const { planAssetCleanup } = require(path.join(__dirname, "..", "src", "utils", "assetAudit"));
const { extractCloudinaryUrls, publicIdFromUrl, assetDocId } = require(path.join(
  __dirname,
  "..",
  "src",
  "utils",
  "cloudinaryUrl"
));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const INCLUDE_UNATTRIBUTED = args.includes("--include-unattributed");
const argNum = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.split("=")[1]) : def;
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const LIMIT = argNum("limit", Infinity);
const GRACE_HOURS = argNum("grace-hours", 24);

const log = (...a) => console.log(...a);
const fmtBytes = (n) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;

async function listAllImages() {
  const out = [];
  let cursor;
  let calls = 0;
  do {
    const res = await cloudinary.api.resources({
      resource_type: "image",
      type: "upload",
      max_results: 500,
      next_cursor: cursor,
    });
    calls++;
    out.push(...(res.resources || []));
    cursor = res.next_cursor;
    process.stdout.write(`\r  Cloudinary: đã liệt kê ${out.length} asset (${calls} lệnh API)...`);
  } while (cursor);
  process.stdout.write("\n");
  return out;
}

async function loadUsers() {
  const snap = await db.collection(COLLECTIONS.USERS).select("avatarUrl").get();
  return snap.docs.map((d) => ({ uid: d.id, avatarUrl: d.data().avatarUrl || null }));
}

async function loadContentPublicIds() {
  const ids = new Set();
  for (const col of [COLLECTIONS.POSTS, COLLECTIONS.BLOGS]) {
    const snap = await db.collection(col).get();
    snap.docs.forEach((d) => {
      // Tìm URL Cloudinary ở MỌI field của bài (nội dung HTML, ảnh bìa...)
      extractCloudinaryUrls(JSON.stringify(d.data())).forEach((u) => {
        const pid = publicIdFromUrl(u);
        if (pid) ids.add(pid);
      });
    });
  }
  return ids;
}

async function loadRegistry() {
  const snap = await db.collection(COLLECTIONS.ASSETS).get();
  return snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
}

async function main() {
  const { cloud_name, api_key, api_secret } = cloudinary.config();
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error("Thiếu CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET trong .env");
  }

  log(`\n=== Dọn tài nguyên Cloudinary — cloud "${cloud_name}" — ${APPLY ? "APPLY (SẼ XOÁ THẬT)" : "DRY-RUN (chỉ xem trước)"} ===`);
  log(`    ân hạn: ${GRACE_HOURS}h | giới hạn xoá: ${Number.isFinite(LIMIT) ? LIMIT : "không"}\n`);

  log("1/4 Đọc Firestore (users, posts, blogs, assets)...");
  const [users, contentPublicIds, registry] = await Promise.all([loadUsers(), loadContentPublicIds(), loadRegistry()]);
  log(`  users: ${users.length} | public_id nằm trong nội dung bài: ${contentPublicIds.size} | dòng sổ assets: ${registry.length}`);

  log("2/4 Liệt kê ảnh trên Cloudinary...");
  const resources = await listAllImages();

  log("3/4 Lập kế hoạch...");
  const plan = planAssetCleanup({
    resources,
    users,
    contentPublicIds,
    registry,
    cloudName: cloud_name,
    graceHours: GRACE_HOURS,
    includeUnattributed: INCLUDE_UNATTRIBUTED,
  });
  const s = plan.summary;

  const reportDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `asset-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ apply: APPLY, cloud: cloud_name, summary: s, blockers: plan.blockers, plan }, null, 2));

  log("\n----- KẾT QUẢ -----");
  log(`  Tổng ảnh trên Cloudinary        : ${s.listedTotal}  (trong phạm vi avatar: ${s.inScope})`);
  log(`  Giữ lại                          : ${s.keep}`);
  log(`  SẼ XOÁ                           : ${s.delete}  (~${fmtBytes(s.deleteBytes)})`);
  log(`     - avatar cũ đã bị thay        : ${s.deleteByReason.SUPERSEDED_AVATAR}`);
  log(`     - chủ tài khoản không còn     : ${s.deleteByReason.ACCOUNT_GONE}`);
  log(`     - không rõ chủ (--include-...): ${s.deleteByReason.UNATTRIBUTED}`);
  log(`  Bỏ qua (mới, trong ân hạn)       : ${s.skippedWithinGrace}`);
  log(`  Không rõ chủ, CHỈ báo cáo        : ${s.unattributedReportedOnly}`);
  log(`  Sổ assets: sẽ tạo ${s.registryToCreate} dòng, sẽ dọn ${s.registryToRemove} dòng`);
  log(`  Báo cáo chi tiết                 : ${reportPath}\n`);

  if (plan.blockers.length) {
    log("!!! PHANH AN TOÀN — phát hiện bất thường ở dữ liệu đầu vào:");
    plan.blockers.forEach((b) => log(`   - ${b}`));
    if (APPLY) {
      log("\nTừ chối --apply. Kiểm tra lại .env / project Firebase / cloud Cloudinary rồi chạy lại.\n");
      process.exit(2);
    }
    log("");
  }

  if (!APPLY) {
    log(">>> Đọc kỹ báo cáo. Nếu ổn, thử xoá số lượng nhỏ trước:");
    log("    node scripts/cleanup-orphan-assets.js --apply --limit=20");
    log(">>> rồi chạy toàn bộ:  npm run assets:cleanup:apply\n");
    return;
  }

  log("4/4 Thực thi...");

  // (a) Xoá asset rác trên Cloudinary, mỗi lệnh tối đa 100 public_id
  const toDelete = plan.delete.slice(0, LIMIT);
  const deletedIds = new Set();
  let stoppedEarly = null;
  for (let i = 0; i < toDelete.length; i += 100) {
    const chunk = toDelete.slice(i, i + 100).map((d) => d.publicId);
    try {
      const res = await cloudinary.api.delete_resources(chunk, { type: "upload", resource_type: "image", invalidate: true });
      Object.entries(res.deleted || {}).forEach(([pid, st]) => {
        if (st === "deleted" || st === "not_found") deletedIds.add(pid);
      });
      process.stdout.write(`\r  Đã xử lý ${Math.min(i + 100, toDelete.length)}/${toDelete.length}...`);
    } catch (err) {
      stoppedEarly = err?.error?.message || err?.message || String(err);
      break;
    }
  }
  process.stdout.write("\n");
  log(`  Cloudinary: đã xoá ${deletedIds.size}/${toDelete.length}${plan.delete.length > toDelete.length ? ` (còn ${plan.delete.length - toDelete.length} do --limit)` : ""}`);
  if (stoppedEarly) log(`  ⚠ Dừng sớm do lỗi (có thể chạm hạn mức Admin API): ${stoppedEarly}\n    Chạy lại sau — script an toàn chạy lại nhiều lần.`);

  // (b) Ghi sổ `assets`: tạo dòng cho avatar đang dùng, dọn dòng của asset đã xoá/không còn
  const now = new Date().toISOString();
  const ops = [];
  plan.registryToCreate.forEach((r) =>
    ops.push((b) =>
      b.set(db.collection(COLLECTIONS.ASSETS).doc(assetDocId(r.publicId)), {
        ...r,
        uploadCount: 0, // không biết lịch sử đổi avatar trước v0.10.20
        createdAt: now,
        updatedAt: now,
        backfilled: true,
      })
    )
  );
  plan.registryToRemove
    .filter((r) => deletedIds.has(r.publicId) || !resources.some((x) => x.public_id === r.publicId))
    .forEach((r) => ops.push((b) => b.delete(db.collection(COLLECTIONS.ASSETS).doc(r.docId))));

  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
  log(`  Firestore: đã ghi ${ops.length} thay đổi vào sổ assets.`);
  log(stoppedEarly ? "\nHoàn tất MỘT PHẦN (xem cảnh báo phía trên).\n" : "\nHoàn tất.\n");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\nCleanup thất bại:", err?.error?.message || err);
      process.exit(1);
    });
}

module.exports = { main };
