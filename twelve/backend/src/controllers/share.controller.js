const { db } = require("../config/firebase");

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
      if (!snap.exists) {
        return res.status(404).json({ error: "Không tìm thấy nội dung để chia sẻ." });
      }

      const baseUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const path = `${pathPrefix}/${req.params.id}`;
      // uid lấy từ token đã xác thực (req.authUid) — KHÔNG tin uid do client tự
      // gửi lên trong body, tránh giả mạo "ghi công" share cho người khác.
      const shareUrl = req.authUid
        ? `${baseUrl}${path}?idu=${encodeURIComponent(req.authUid)}`
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
