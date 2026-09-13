const express = require("express");
const router = express.Router();

const blogCtrl = require("../controllers/blog.controller");
const commentsCtrl = require("../controllers/comments.controller");
const { react } = require("../controllers/reactions.controller");
const { createShareLink } = require("../controllers/share.controller");
const { requireAuth, requireActive, optionalAuth } = require("../middleware/auth");
const { requireSA } = require("../middleware/roles");
const { COLLECTIONS } = require("../utils/constants");

// ==== Bài Blog: chỉ SA (Admin/Dev/Kiểm duyệt) mới được đăng/sửa/xóa ====
// requireActive đặt trước requireSA để phòng trường hợp tài khoản SA cũng
// đang ở trạng thái PENDING (chưa xác minh email) vẫn có thể thao tác.
router.get("/", blogCtrl.listBlogs);
router.post("/", requireAuth, requireActive, requireSA, blogCtrl.createBlog);
router.get("/:id", optionalAuth, blogCtrl.getBlog);
router.patch("/:id", requireAuth, requireActive, requireSA, blogCtrl.updateBlog);
router.delete("/:id", requireAuth, requireActive, requireSA, blogCtrl.deleteBlog);

// ==== Like / Dislike (ai cũng dùng được, giống bài viết thường) ====
router.post("/:id/react", requireAuth, requireActive, react(COLLECTIONS.BLOGS));

// ==== Share (v0.7.0) — xem giải thích ở posts.routes.js ====
router.post("/:id/share", optionalAuth, createShareLink(COLLECTIONS.BLOGS, "/blog"));

// ==== Comment ====
router.get("/:id/comments", commentsCtrl.listComments(COLLECTIONS.BLOGS));
router.post("/:id/comments", requireAuth, requireActive, commentsCtrl.addComment(COLLECTIONS.BLOGS));
router.patch("/:id/comments/:commentId", requireAuth, requireActive, commentsCtrl.editComment(COLLECTIONS.BLOGS));
router.delete("/:id/comments/:commentId", requireAuth, requireActive, commentsCtrl.deleteComment(COLLECTIONS.BLOGS));

module.exports = router;
