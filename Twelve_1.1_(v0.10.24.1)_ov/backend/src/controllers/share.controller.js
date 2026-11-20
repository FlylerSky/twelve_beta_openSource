const { db } = require("../config/firebase");
const { signShareParams } = require("../utils/helpers");
const { isHiddenDraft } = require("../utils/visibility");

/**
 * Factory: createShareLink(collectionName, pathPrefix) -> Express handler
 * POST /api/posts/:id/share  hoặc  POST /api/blogs/:id/share
 *
 * CHỈ tạo và trả về share URL — KHÔNG ghi Firestore, KHÔNG tính shareCount.
 * Share thực sự chỉ được tính khi có người MỞ link đó ra (xem
 * utils/helpers.js#registerShare, gọi từ posts.controller.js#getPost,
 * blog.controller.js#getBlog, và routes/ssr.routes.js cho Bot A.I).
 *
 * Dùng optionalAuth ở route: chia sẻ không đòi hỏi phải đăng nhập/kích hoạt —
 * ai xem được bài công khai thì cũng chia sẻ được. Nếu đã đăng nhập, uid được
 * gắn vào link (`?idu=`) để sau này ghi công người chia sẻ; nếu chưa đăng
 * nhập, link vẫn hoạt động bình thường (`?shared=1`) nhưng không ghi công ai.
 */
function createShareLink(collectionName, pathPrefix) {
  return async (req, res) => {
    try {
      const snap = await db.collection(collectionName).doc(req.params.id).get();
      // v1.1 [BẢO MẬT — vá từ 2.0.4]: blog NHÁP không tạo được link chia sẻ (404 như không tồn tại).
      if (!snap.exists || isHiddenDraft(collectionName, snap.data())) {
        return res.status(404).json({ error: "Không tìm thấy nội dung để chia sẻ." });
      }

      const baseUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const path = `${pathPrefix}/${req.params.id}`;
      // uid lấy từ token đã xác thực (req.authUid) — KHÔNG tin uid do client tự
      // gửi lên trong body, tránh giả mạo "ghi công" share cho người khác.
      // v0.8.20 [BẢO MẬT]: kèm thêm chữ ký HMAC (`&s=`) ràng buộc CHẶT uid
      // này với ĐÚNG bài viết (collectionName + id) — nếu không có bước này,
      // ai cũng có thể tự chế `?idu=<uid nhặt được từ trang Profile>` gắn
      // vào BẤT KỲ bài nào để giả mạo "cấy" positiveScore cho uid đó. Xem
      // đầy đủ giải thích ở utils/helpers.js#signShareParams.
      const shareUrl = req.authUid
        ? `${baseUrl}${path}?idu=${encodeURIComponent(req.authUid)}&s=${encodeURIComponent(
            signShareParams(req.authUid, collectionName, req.params.id)
          )}`
        : `${baseUrl}${path}?shared=1`;

      return res.json({
        shareUrl,
        note: "Lượt share sẽ được tính khi có người thực sự mở link này.",
      });
    } catch (err) {
      console.error("createShareLink error:", err);
      return res.status(500).json({ error: "Không tạo được link chia sẻ." });
    }
  };
}

module.exports = { createShareLink };
