const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/trending.controller");
const { optionalAuth } = require("../middleware/auth");
const { trendingLimiter } = require("../middleware/rateLimiters");

// v0.10.11 [MEDIUM]: trước bản vá này, /api/trending/* chỉ có globalLimiter
// dùng chung (300 req/15 phút cho TOÀN BỘ /api) — trong khi phía sau nhiều
// route ở đây (đặc biệt khi cache 90s miss) là quét TOÀN BỘ collection
// posts + blogs (xem trending.controller.js#scanContentDocs), tốn kém hơn
// hẳn 1 request /api thông thường. Áp router.use() ở đây để phủ MỌI route
// bên dưới, kể cả route thêm sau này mà quên gắn limiter riêng.
router.use(trendingLimiter);

// Bảng xếp hạng là nội dung công khai (giống danh sách bài viết) — không
// bắt buộc đăng nhập để xem, dùng optionalAuth cho nhất quán với các route
// public khác (dù hiện tại chưa cần req.authUid, để sẵn cho việc sau này
// hiển thị "thứ hạng của chính bạn" nếu cần).
router.get("/users/weekly", optionalAuth, ctrl.getWeeklyRanking);
router.get("/users/alltime", optionalAuth, ctrl.getAllTimeRanking);

// v0.10.8 — tab Hashtag ("/hashtags/weekly" và "/hashtags/:tag/posts" khác số
// đoạn URL nên không đụng route nhau, thứ tự khai báo không quan trọng ở đây).
router.get("/hashtags/weekly", optionalAuth, ctrl.getHashtagWeeklyRanking);
router.get("/hashtags/alltime", optionalAuth, ctrl.getHashtagAllTimeRanking);
router.get("/hashtags/:tag/posts", optionalAuth, ctrl.getHashtagPosts);
router.get("/search", optionalAuth, ctrl.searchTrending);

module.exports = router;
