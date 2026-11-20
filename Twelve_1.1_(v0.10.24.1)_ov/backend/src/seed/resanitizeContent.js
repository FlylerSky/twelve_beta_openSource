require("dotenv").config();

/**
 * ==== v0.9.6 [MEDIUM] — Migration: re-sanitize dữ liệu contentHtml cũ ====
 *
 * Kiểm thử thực tế (xem TWELVE_SECURITY_AUDIT_REPORT.md, mục V-10A) phát
 * hiện bài viết tạo TRƯỚC khi ALLOWED_IFRAME_SRC/DOMPurify hook hiện tại
 * được áp dụng vẫn còn chứa iframe trỏ ngoài whitelist (ví dụ Cloudinary)
 * lưu nguyên trong Firestore — vì sanitizeHtml() chỉ chạy lúc TẠO/SỬA bài,
 * không tự động chạy lại cho dữ liệu đã lưu trước đó.
 *
 * CSP `frameSrc` hiện tại đã chặn trình duyệt hiện đại tải các iframe này
 * (giảm thiểu rủi ro), nhưng dữ liệu "bẩn" vẫn tồn tại trong Firestore và
 * sẽ tiếp tục được SSR render ra HTML — nên vẫn cần dọn tận gốc.
 *
 * Script này ĐỌC LẠI toàn bộ document `posts` và `blogs`, chạy lại
 * `sanitizeHtml()` (bản DOMPurify hiện tại) trên `contentHtml`, và chỉ GHI
 * LẠI nếu kết quả sau sanitize khác với dữ liệu đang lưu (tránh ghi thừa
 * nếu không đổi gì). `excerpt` cũng được tính lại từ `contentHtml` đã sạch
 * để nhất quán.
 *
 * Cách chạy (1 lần, thủ công — KHÔNG tự động chạy khi khởi động server):
 *   cd backend && node src/seed/resanitizeContent.js            # DRY-RUN (mặc định): chỉ liệt kê, KHÔNG ghi
 *   cd backend && node src/seed/resanitizeContent.js --apply    # ghi thật
 *
 * An toàn khi chạy lại nhiều lần (idempotent) — lần 2 trở đi sẽ không tìm
 * thấy gì cần sửa vì dữ liệu đã sạch từ lần chạy trước.
 *
 * ==== v2.5.3 [TW-06] — MẶC ĐỊNH ĐỔI SANG DRY-RUN + báo cáo "lớp class/thuộc tính bị bỏ" ====
 * Từ 2.5.3 sanitizer lọc `class` theo allowlist và tắt `data-*`/`aria-*`, nên các bài đã lưu trước đó cần được làm sạch lại. Việc này THAY ĐỔI dữ liệu thật, nên:
 *   1. Chạy DRY-RUN trước (mặc định) — script in số bài sẽ đổi và bảng "token class bị bỏ / số lần" để bạn kiểm tra: lớp hợp lệ của trình soạn thảo mà bị liệt kê
 *      ở đây nghĩa là allowlist (`ALLOWED_CLASS_PATTERNS` trong services/sanitize.service.js) còn thiếu — thêm vào TRƯỚC khi `--apply`.
 *   2. SAO LƯU Firestore (export) trước khi `--apply`.
 * Đổi mặc định từ "ghi thẳng" sang "dry-run" cùng quy ước với mọi script khác trong scripts/ (xem scripts/README.md).
 */

const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");
const { sanitizeHtml, htmlToExcerpt } = require("../services/sanitize.service");

const APPLY = process.argv.includes("--apply");

// v2.5.3: thống kê token class / tên thuộc tính data-/aria- bị bỏ (đếm theo từng lần xuất hiện) để người vận hành đánh giá allowlist trước khi --apply.
const droppedClasses = new Map();
const droppedAttrs = new Map();
const tokensOf = (html) => [...String(html).matchAll(/\sclass\s*=\s*"([^"]*)"/gi)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
const attrNamesOf = (html) => [...String(html).matchAll(/\s((?:data|aria)-[a-z0-9_-]+)\s*=/gi)].map((m) => m[1].toLowerCase());
function countDropped(before, after) {
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const left = tokensOf(after);
  for (const t of tokensOf(before)) {
    const i = left.indexOf(t);
    if (i === -1) bump(droppedClasses, t);
    else left.splice(i, 1);
  }
  const leftAttrs = attrNamesOf(after);
  for (const a of attrNamesOf(before)) {
    const i = leftAttrs.indexOf(a);
    if (i === -1) bump(droppedAttrs, a);
    else leftAttrs.splice(i, 1);
  }
}

async function resanitizeCollection(collectionName) {
  const snap = await db.collection(collectionName).get();
  let checked = 0;
  let updated = 0;
  let failed = 0;

  // Ghi từng document riêng (không gộp batch) — số lượng bài viết/blog thực
  // tế không lớn tới mức cần tối ưu batch, và ghi riêng giúp 1 document lỗi
  // (ví dụ contentHtml bị thiếu/dị dạng) không làm hỏng cả lô.
  for (const doc of snap.docs) {
    checked += 1;
    const data = doc.data();
    if (!data.contentHtml || typeof data.contentHtml !== "string") continue;

    try {
      const cleaned = sanitizeHtml(data.contentHtml);
      if (cleaned === data.contentHtml) continue; // đã sạch, không cần ghi lại

      countDropped(data.contentHtml, cleaned);
      if (APPLY) {
        await doc.ref.update({
          contentHtml: cleaned,
          excerpt: htmlToExcerpt(cleaned),
        });
      }
      updated += 1;
      console.log(`  ✏️  ${collectionName}/${doc.id} — ${APPLY ? "đã re-sanitize" : "SẼ đổi (dry-run)"} (nội dung có thay đổi).`);
    } catch (err) {
      failed += 1;
      console.error(`  ❌ ${collectionName}/${doc.id} — lỗi khi re-sanitize:`, err.message);
    }
  }

  return { checked, updated, failed };
}

function printDropped(title, map) {
  if (!map.size) return;
  console.log(`\n${title}`);
  for (const [k, n] of [...map.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)} × ${k}`);
}

async function run() {
  console.log(`🧹 Bắt đầu re-sanitize contentHtml (posts + blogs) bằng DOMPurify hiện tại... ${APPLY ? "(--apply: GHI THẬT)" : "(DRY-RUN: không ghi — thêm --apply để ghi thật)"}\n`);

  const posts = await resanitizeCollection(COLLECTIONS.POSTS);
  console.log(`\nposts: đã kiểm tra ${posts.checked}, cập nhật ${posts.updated}, lỗi ${posts.failed}.`);

  const blogs = await resanitizeCollection(COLLECTIONS.BLOGS);
  console.log(`blogs: đã kiểm tra ${blogs.checked}, cập nhật ${blogs.updated}, lỗi ${blogs.failed}.`);

  printDropped("Token `class` bị bỏ (đếm theo lần xuất hiện) — lớp hợp lệ của trình soạn thảo mà có ở đây = allowlist còn thiếu:", droppedClasses);
  printDropped("Thuộc tính data-/aria- bị bỏ:", droppedAttrs);

  const totalFailed = posts.failed + blogs.failed;
  console.log(`\n✅ Hoàn tất. Tổng cộng ${APPLY ? "đã cập nhật" : "sẽ cập nhật (dry-run)"} ${posts.updated + blogs.updated} document.`);
  if (totalFailed > 0) {
    console.warn(`⚠️  Có ${totalFailed} document lỗi khi xử lý — xem log phía trên, kiểm tra thủ công.`);
  }
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Re-sanitize content thất bại:", err);
  process.exit(1);
});
