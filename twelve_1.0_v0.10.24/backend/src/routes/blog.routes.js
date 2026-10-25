const express = require("express");
const router = express.Router();

const blogCtrl = require("../controllers/blog.controller");
const commentsCtrl = require("../controllers/comments.controller");
const { react } = require("../controllers/reactions.controller");
const { createShareLink } = require("../controllers/share.controller");
const { requireAuth, requireActive, optionalAuth } = require("../middleware/auth");
const { requireSA } = require("../middleware/roles");
const { reactLimiter, commentLimiter, shareLimiter, viewLimiter } = require("../middleware/rateLimiters");
const { COLLECTIONS } = require("../utils/constants");

// ==== Bài Blog: chỉ SA (Admin/Dev/Kiểm duyệt) mới được đăng/sửa/xóa ====
// requireActive đặt trước requireSA để phòng trường hợp tài khoản SA cũng
// đang ở trạng thái PENDING (chưa xác minh email) vẫn có thể thao tác.
// v0.8.18: thêm optionalAuth — xem posts.routes.js.
router.get("/", optionalAuth, blogCtrl.listBlogs);
router.post("/", requireAuth, requireActive, requireSA, blogCtrl.createBlog);
router.get("/:id", optionalAuth, viewLimiter, blogCtrl.getBlog);
router.patch("/:id", requireAuth, requireActive, requireSA, blogCtrl.updateBlog);
router.delete("/:id", requireAuth, requireActive, requireSA, blogCtrl.deleteBlog);

// ==== Like / Dislike (ai cũng dùng được, giống bài viết thường) ====
// v0.9.6 [HIGH]: xem giải thích rateLimiters ở posts.routes.js.
router.post("/:id/react", requireAuth, requireActive, reactLimiter, react(COLLECTIONS.BLOGS));

// ==== Share (v0.7.0) — xem giải thích ở posts.routes.js ====
router.post("/:id/share", optionalAuth, shareLimiter, createShareLink(COLLECTIONS.BLOGS, "/blog"));

// ==== Comment ====
router.get("/:id/comments", commentsCtrl.listComments(COLLECTIONS.BLOGS));
router.post("/:id/comments", requireAuth, requireActive, commentLimiter, commentsCtrl.addComment(COLLECTIONS.BLOGS));
router.patch("/:id/comments/:commentId", requireAuth, requireActive, commentLimiter, commentsCtrl.editComment(COLLECTIONS.BLOGS));
router.delete("/:id/comments/:commentId", requireAuth, requireActive, commentLimiter, commentsCtrl.deleteComment(COLLECTIONS.BLOGS));

module.exports = router;
