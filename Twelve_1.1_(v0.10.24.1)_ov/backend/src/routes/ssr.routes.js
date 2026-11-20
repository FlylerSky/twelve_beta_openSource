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
const { canCountSsrView, isTrustedSsrProxy } = require("../utils/clientIp");
const { isHiddenDraft } = require("../utils/visibility");
const { isSafeDocId } = require("../utils/input");
const { sanitizeAgainForSsr } = require("../utils/ssrContent");

/** Header chẩn đoán: cho biết backend có nhận ra secret từ middleware Vercel không (không lộ secret). */
function ssrTrustHeader(req, res, next) {
  if (process.env.SSR_PROXY_SECRET) {
    res.set("X-Twelve-Ssr-Trusted", isTrustedSsrProxy(req) ? "1" : "0");
  }
  next();
}
router.use(ssrTrustHeader);

function sendNotFound(res, message) {
  res.set("X-Robots-Tag", "noindex");
  res.set("Cache-Control", "public, max-age=60, s-maxage=60");
  return res.status(404).type("text/plain; charset=utf-8").send(message);
}

// v1.1 [A-01 — vá từ 2.2.1]: id có "/" (%2F) hoặc lạ không bao giờ tới Firestore — 404 như không tồn tại.
router.param("id", (req, res, next, value) => (isSafeDocId(value) ? next() : sendNotFound(res, "Không tìm thấy nội dung.")));

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
    // v1.1 [TW-20 — vá từ 2.5.3]: lớp sanitize thứ hai (chỉ chạy khi HTML đã lưu có dấu hiệu nguy hiểm) — post.ejs in HTML thô (`<%- post.contentHtml %>`).
    post.contentHtml = await sanitizeAgainForSsr(post.contentHtml, { id: post.id });
    const canonicalUrl = buildCanonical(`/post/${post.id}`);

    // Chống bơm view ảo (vá báo cáo bảo mật #5): dùng chung cơ chế dedupe
    // theo viewerKey (ở đây chủ yếu là IP vì bot/crawler không có uid/sid)
    // với cửa sổ 30 phút/bài — xem utils/helpers.js#registerView.
    //
    // v1.1 [BẢO MẬT — vá từ 2.0.4]: CHỈ cộng view/AI-view khi request ĐÃ XÁC THỰC là từ middleware Vercel của dự án (header bí mật `x-twelve-ssr-secret`,
    // xem utils/clientIp.js) — hoặc môi trường dev. Trước đây MỌI request tới `/post/:id` (kể cả gọi thẳng host Render, UA tuỳ ý) đều cộng `aiViewCount`
    // + `viewCount` + `postScore` — dedup theo IP bị né bằng cách đổi X-Forwarded-For (đã vá ở viewerKeyFromRequest) hoặc đổi IP.
    const countView = canCountSsrView(req);
    const viewCounted = countView
      ? await registerView(db, admin, COLLECTIONS.POSTS, req.params.id, {
          viewerKey: viewerKeyFromRequest(req),
          isAi: true,
        })
      : false;
    post.viewCount = (postData.viewCount || 0) + (viewCounted ? 1 : 0);
    post.aiViewCount = (postData.aiViewCount || 0) + (viewCounted ? 1 : 0);

    post.shareCount = postData.shareCount || 0;
    // postScore tính SAU khi đã cập nhật viewCount ở trên (xem
    // posts.controller.js#getPost để biết lý do thứ tự này quan trọng).
    post.postScore = computePostScore(post);
    // Đồng bộ cache trong Firestore (song song, không chặn response).
    if (countView) syncPostScore(db, admin, COLLECTIONS.POSTS, req.params.id, post.postScore, postData.postScore, postData.authorUid);

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
    // v1.1 [BẢO MẬT — vá từ 2.0.4]: blog NHÁP (isPublished !== true) => 404 y hệt không tồn tại. Trước đây trang SSR render cả bản nháp cho bất kỳ ai biết id.
    if (!snap.exists || isHiddenDraft(COLLECTIONS.BLOGS, snap.data())) return res.status(404).send("Không tìm thấy bài blog.");

    const blogData = snap.data();
    const [full] = await attachAuthors([blogData]);
    const post = formatFullPost(full);
    // v1.1 [TW-20]: lớp sanitize thứ hai — xem /post/:id.
    post.contentHtml = await sanitizeAgainForSsr(post.contentHtml, { id: post.id });
    const canonicalUrl = buildCanonical(`/blog/${post.id}`);

    // v1.1 [BẢO MẬT — vá từ 2.0.4]: chỉ cộng view khi request đã xác thực là từ middleware Vercel — xem /post/:id.
    const countView = canCountSsrView(req);
    const viewCounted = countView
      ? await registerView(db, admin, COLLECTIONS.BLOGS, req.params.id, {
          viewerKey: viewerKeyFromRequest(req),
          isAi: true,
        })
      : false;
    post.viewCount = (blogData.viewCount || 0) + (viewCounted ? 1 : 0);
    post.aiViewCount = (blogData.aiViewCount || 0) + (viewCounted ? 1 : 0);

    post.shareCount = blogData.shareCount || 0;
    post.postScore = computePostScore(post);
    if (countView) syncPostScore(db, admin, COLLECTIONS.BLOGS, req.params.id, post.postScore, blogData.postScore, blogData.authorUid);

    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.render("blog", { post, canonicalUrl, hashtagBaseUrl: buildHashtagBaseUrl(), safeJsonForScript, cspNonce: res.locals.cspNonce });
  } catch (err) {
    console.error("SSR /blog/:id error:", err);
    res.status(500).send("Đã có lỗi xảy ra.");
  }
});

module.exports = router;
