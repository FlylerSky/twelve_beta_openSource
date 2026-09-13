const express = require("express");
const router = express.Router();

const postsCtrl = require("../controllers/posts.controller");
const commentsCtrl = require("../controllers/comments.controller");
const { react } = require("../controllers/reactions.controller");
const { createShareLink } = require("../controllers/share.controller");
const { requireAuth, requireActive, optionalAuth } = require("../middleware/auth");
const { COLLECTIONS } = require("../utils/constants");

// ==== Bài viết (trang INDEX / POST) ====
// requireActive: chặn tài khoản chưa kích hoạt (PENDING) tạo/sửa/xoá nội dung,
// kể cả khi request đến trực tiếp từ Twelve Mobile App (bỏ qua UI web).
router.get("/", postsCtrl.listPosts);
router.post("/", requireAuth, requireActive, postsCtrl.createPost);
router.get("/:id", optionalAuth, postsCtrl.getPost);
router.patch("/:id", requireAuth, requireActive, postsCtrl.updatePost);
router.delete("/:id", requireAuth, requireActive, postsCtrl.deletePost);

// ==== Like / Dislike ====
router.post("/:id/react", requireAuth, requireActive, react(COLLECTIONS.POSTS));

// ==== Share (v0.7.0): chỉ TẠO link, không cần đăng nhập/kích hoạt để chia sẻ.
// Lượt share thực sự được tính ở GET /:id (xem posts.controller.js#getPost)
// khi có người mở link ra — không tính ở đây.
router.post("/:id/share", optionalAuth, createShareLink(COLLECTIONS.POSTS, "/post"));

// ==== Comment (modal comment) ====
router.get("/:id/comments", commentsCtrl.listComments(COLLECTIONS.POSTS));
router.post("/:id/comments", requireAuth, requireActive, commentsCtrl.addComment(COLLECTIONS.POSTS));
router.patch("/:id/comments/:commentId", requireAuth, requireActive, commentsCtrl.editComment(COLLECTIONS.POSTS));
router.delete("/:id/comments/:commentId", requireAuth, requireActive, commentsCtrl.deleteComment(COLLECTIONS.POSTS));

module.exports = router;
