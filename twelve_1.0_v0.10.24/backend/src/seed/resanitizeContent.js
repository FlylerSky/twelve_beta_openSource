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
 *   cd backend && node src/seed/resanitizeContent.js
 *
 * An toàn khi chạy lại nhiều lần (idempotent) — lần 2 trở đi sẽ không tìm
 * thấy gì cần sửa vì dữ liệu đã sạch từ lần chạy trước.
 */

const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");
const { sanitizeHtml, htmlToExcerpt } = require("../services/sanitize.service");

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

      await doc.ref.update({
        contentHtml: cleaned,
        excerpt: htmlToExcerpt(cleaned),
      });
      updated += 1;
      console.log(`  ✏️  ${collectionName}/${doc.id} — đã re-sanitize (nội dung có thay đổi).`);
    } catch (err) {
      failed += 1;
      console.error(`  ❌ ${collectionName}/${doc.id} — lỗi khi re-sanitize:`, err.message);
    }
  }

  return { checked, updated, failed };
}

async function run() {
  console.log("🧹 Bắt đầu re-sanitize contentHtml (posts + blogs) bằng DOMPurify hiện tại...\n");

  const posts = await resanitizeCollection(COLLECTIONS.POSTS);
  console.log(`\nposts: đã kiểm tra ${posts.checked}, cập nhật ${posts.updated}, lỗi ${posts.failed}.`);

  const blogs = await resanitizeCollection(COLLECTIONS.BLOGS);
  console.log(`blogs: đã kiểm tra ${blogs.checked}, cập nhật ${blogs.updated}, lỗi ${blogs.failed}.`);

  const totalFailed = posts.failed + blogs.failed;
  console.log(`\n✅ Hoàn tất. Tổng cộng cập nhật ${posts.updated + blogs.updated} document.`);
  if (totalFailed > 0) {
    console.warn(`⚠️  Có ${totalFailed} document lỗi khi xử lý — xem log phía trên, kiểm tra thủ công.`);
  }
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Re-sanitize content thất bại:", err);
  process.exit(1);
});
