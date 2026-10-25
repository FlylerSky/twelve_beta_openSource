const express = require("express");
const router = express.Router();
const { db, admin } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");
const { attachAuthors, formatFullPost } = require("../controllers/posts.controller");
const { registerView, viewerKeyFromRequest, computePostScore, syncPostScore, safeJsonForScript } = require("../utils/helpers");
// v0.10.11 [HIGH]: 2 route dưới đây nằm NGOÀI "/api" nên KHÔNG được
// globalLimiter (server.js, chỉ áp cho "/api") bảo vệ — trước bản vá này,
// hoàn toàn không có rate limit nào. Cùng dùng viewLimiter với
// posts.routes.js/blog.routes.js (xem middleware/rateLimiters.js) để chặn
// flood tự động, ngưỡng vẫn đủ rộng cho crawler thật (Googlebot... tự giới
// hạn tốc độ thấp hơn nhiều so với ngưỡng này).
const { viewLimiter } = require("../middleware/rateLimiters");

/**
 * Canonical URL phải trỏ về frontend (Vercel), không phải host backend (Render).
 * Khi middleware Vercel rewrite bot → backend, req.get("host") sẽ là host
 * Render → canonical sai. Dùng FRONTEND_URL từ env.
 */
function buildCanonical(path) {
  const base = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  if (base) return `${base}${path}`;
  // Fallback (dev / chưa cấu hình): dùng host hiện tại
  return path;
}

// v0.10.8 — click hashtag (kể cả trên trang SSR) phải dẫn về tab Hashtag của
// trang Xu hướng, giống hệt SPA (xem components/PostCard.jsx,
// pages/PostDetailPage.jsx). Trả về PHẦN GỐC của link — EJS tự nối thêm
// encodeURIComponent(tag) cho từng hashtag khi render.
function buildHashtagBaseUrl() {
  return `${buildCanonical("/trending")}?tab=hashtag&hashtag=`;
}

/**
 * GET /post/:id  (SSR, phục vụ SEO + AI agent đọc nội dung)
 * Toàn bộ nội dung được render sẵn ra HTML trừ phần bình luận.
 *
 * VIEW: route này (xem frontend/middleware.js) CHỈ được phục vụ cho
 * bot/crawler/AI agent — không phải người dùng thật điều hướng (SPA lo phần
 * đó, xem controllers/posts.controller.js getPost). Vì vậy mỗi lần render ở
 * đây vừa cộng vào tổng viewCount, vừa cộng riêng vào aiViewCount ("View Bot A.I").
 *
 * SHARE: không đếm trên SSR. Link-preview (OS/chat) thường hit SSR và gây
 * đếm ảo khi người dùng chỉ bấm nút Share. Share chỉ đếm qua getPost/getBlog
 * (SPA, source "web") — xem helpers.js#registerShare.
 */
router.get("/post/:id", viewLimiter, async (req, res) => {
  try {
    const snap = await db.collection(COLLECTIONS.POSTS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).send("Không tìm thấy bài viết.");

    const postData = snap.data();
    const [full] = await attachAuthors([postData]);
    const post = formatFullPost(full);
    const canonicalUrl = buildCanonical(`/post/${post.id}`);

    // Chống bơm view ảo (vá báo cáo bảo mật #5): dùng chung cơ chế dedupe
    // theo viewerKey (ở đây chủ yếu là IP vì bot/crawler không có uid/sid)
    // với cửa sổ 30 phút/bài — xem utils/helpers.js#registerView.
    const viewCounted = await registerView(db, admin, COLLECTIONS.POSTS, req.params.id, {
      viewerKey: viewerKeyFromRequest(req),
      isAi: true,
    });
    post.viewCount = (postData.viewCount || 0) + (viewCounted ? 1 : 0);
    post.aiViewCount = (postData.aiViewCount || 0) + (viewCounted ? 1 : 0);

    post.shareCount = postData.shareCount || 0;
    // postScore tính SAU khi đã cập nhật viewCount ở trên (xem
    // posts.controller.js#getPost để biết lý do thứ tự này quan trọng).
    post.postScore = computePostScore(post);
    // Đồng bộ cache trong Firestore (song song, không chặn response).
    syncPostScore(db, admin, COLLECTIONS.POSTS, req.params.id, post.postScore, postData.postScore, postData.authorUid);

    // Không cache lâu phía CDN để bài mới sửa vẫn được index đúng
    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.render("post", { post, canonicalUrl, hashtagBaseUrl: buildHashtagBaseUrl(), safeJsonForScript, cspNonce: res.locals.cspNonce });
  } catch (err) {
    console.error("SSR /post/:id error:", err);
    res.status(500).send("Đã có lỗi xảy ra.");
  }
});

/**
 * GET /blog/:id (SSR, phục vụ SEO cho trang Blog chi tiết)
 * VIEW: tương tự /post/:id — mỗi lần render đều tính là 1 View Bot A.I.
 * SHARE: không đếm trên SSR (cùng lý do /post/:id).
 */
router.get("/blog/:id", viewLimiter, async (req, res) => {
  try {
    const snap = await db.collection(COLLECTIONS.BLOGS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).send("Không tìm thấy bài blog.");

    const blogData = snap.data();
    const [full] = await attachAuthors([blogData]);
    const post = formatFullPost(full);
    const canonicalUrl = buildCanonical(`/blog/${post.id}`);

    const viewCounted = await registerView(db, admin, COLLECTIONS.BLOGS, req.params.id, {
      viewerKey: viewerKeyFromRequest(req),
      isAi: true,
    });
    post.viewCount = (blogData.viewCount || 0) + (viewCounted ? 1 : 0);
    post.aiViewCount = (blogData.aiViewCount || 0) + (viewCounted ? 1 : 0);

    post.shareCount = blogData.shareCount || 0;
    post.postScore = computePostScore(post);
    syncPostScore(db, admin, COLLECTIONS.BLOGS, req.params.id, post.postScore, blogData.postScore, blogData.authorUid);

    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.render("blog", { post, canonicalUrl, hashtagBaseUrl: buildHashtagBaseUrl(), safeJsonForScript, cspNonce: res.locals.cspNonce });
  } catch (err) {
    console.error("SSR /blog/:id error:", err);
    res.status(500).send("Đã có lỗi xảy ra.");
  }
});

module.exports = router;
