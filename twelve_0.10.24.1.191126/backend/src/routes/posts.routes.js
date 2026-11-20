const express = require("express");
const router = express.Router();

const postsCtrl = require("../controllers/posts.controller");
const commentsCtrl = require("../controllers/comments.controller");
const { react } = require("../controllers/reactions.controller");
const { createShareLink } = require("../controllers/share.controller");
const { requireAuth, requireActive, optionalAuth } = require("../middleware/auth");
const { reactLimiter, commentLimiter, shareLimiter, viewLimiter } = require("../middleware/rateLimiters");
const { COLLECTIONS } = require("../utils/constants");
const { attachIdGuards } = require("../middleware/idParams");

// Twelve 1.1 — BACKPORT A-01 (2.2.1, HIGH): id lạ → 404, không tới Firestore.
attachIdGuards(router, ["id", "commentId"]);

// ==== Bài viết (trang INDEX / POST) ====
// requireActive: chặn tài khoản chưa kích hoạt (PENDING) tạo/sửa/xoá nội dung,
// kể cả khi request đến trực tiếp từ Twelve Mobile App (bỏ qua UI web).
// v0.8.18: thêm optionalAuth — cần req.authUid để gắn myReaction đúng cho
// từng bài trong danh sách (xem posts.controller.js#listPosts). Route vẫn
// hoạt động bình thường cho khách chưa đăng nhập (myReaction luôn null).
router.get("/", optionalAuth, postsCtrl.listPosts);
router.post("/", requireAuth, requireActive, postsCtrl.createPost);
router.get("/:id", optionalAuth, viewLimiter, postsCtrl.getPost);
router.patch("/:id", requireAuth, requireActive, postsCtrl.updatePost);
router.delete("/:id", requireAuth, requireActive, postsCtrl.deletePost);

// ==== Like / Dislike ====
// v0.9.6 [HIGH]: thêm reactLimiter riêng (xem middleware/rateLimiters.js) —
// đặt SAU requireAuth để limiter khoá theo authUid, không chỉ theo IP.
router.post("/:id/react", requireAuth, requireActive, reactLimiter, react(COLLECTIONS.POSTS));

// ==== Share (v0.7.0): chỉ TẠO link, không cần đăng nhập/kích hoạt để chia sẻ.
// Lượt share thực sự được tính ở GET /:id (xem posts.controller.js#getPost)
// khi có người mở link ra — không tính ở đây.
// v0.9.6 [HIGH]: thêm shareLimiter — route này dùng optionalAuth nên khách
// ẩn danh vẫn bị giới hạn theo IP, người đã đăng nhập bị giới hạn theo uid.
router.post("/:id/share", optionalAuth, shareLimiter, createShareLink(COLLECTIONS.POSTS, "/post"));

// ==== Comment (modal comment) ====
// v0.9.6 [HIGH]: thêm commentLimiter cho cả 3 thao tác ghi (tạo/sửa/xoá) —
// tránh spam bình luận lẫn spam sửa/xoá liên tục.
router.get("/:id/comments", commentsCtrl.listComments(COLLECTIONS.POSTS));
router.post("/:id/comments", requireAuth, requireActive, commentLimiter, commentsCtrl.addComment(COLLECTIONS.POSTS));
router.patch("/:id/comments/:commentId", requireAuth, requireActive, commentLimiter, commentsCtrl.editComment(COLLECTIONS.POSTS));
router.delete("/:id/comments/:commentId", requireAuth, requireActive, commentLimiter, commentsCtrl.deleteComment(COLLECTIONS.POSTS));

module.exports = router;
