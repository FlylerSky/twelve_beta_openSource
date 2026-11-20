import { rewrite, next } from "@vercel/functions";

// Chỉ can thiệp vào 2 route cần SEO / đọc được bởi bot & AI agent:
// chi tiết bài viết & blog. Backend đã có bản SSR EJS sẵn
// (src/routes/ssr.routes.js) — middleware chỉ "định tuyến" request phù hợp
// sang bản HTML tĩnh đó.
//
// ==== VÁ v0.10.19 [SỬA LỖI — báo cáo bảo mật, mục "lỗi chức năng/SEO"] ====
// `:path*` (KHÔNG dấu +) khớp "0 HOẶC NHIỀU" segment — tức cũng khớp luôn
// URL TRANG DANH SÁCH trần trụi `/blog` (và `/post`, dù ít route thẳng tới
// path này hơn). Backend SSR (ssr.routes.js) CHỈ có route
// `/blog/:id`/`/post/:id` (trang CHI TIẾT) — không có route nào xử lý
// `/blog`/`/post` trần. Hệ quả: bot/crawler (Googlebot, GPTBot...) ghé
// TRANG DANH SÁCH blog bị rewrite sang backend rồi nhận thẳng JSON
// `{"error":"Endpoint not found."}` (404 chung ở server.js) thay vì HTML —
// hỏng index hoá trang danh sách. Đổi sang `:path+` ("1 HOẶC NHIỀU") để chỉ
// khớp URL CHI TIẾT có id (`/blog/xyz`, `/post/xyz`), URL trần
// `/blog`/`/post` rơi vào `next()` ở dưới -> SPA React bình thường (không
// SSR được nội dung danh sách cho bot, nhưng ít nhất không còn là lỗi 404
// trần trụi). Xây trang SSR riêng cho danh sách là việc làm thêm tính năng,
// không thuộc phạm vi vá lỗi này.
export const config = {
  matcher: ["/post/:path+", "/blog/:path+"],
};

// Nhận diện crawler / bot / AI agent phổ biến (Googlebot, GPTBot, Claude,
// Perplexity, Gemini, Google-Agent, GeminiiOS, NotebookLM, …).
// Danh sách không thể đầy đủ tuyệt đối — bổ sung thêm từ khóa khi phát hiện
// agent mới không được nhận diện.
const BOT_UA_REGEX =
  /bot|spider|crawl|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|pinterest|embedly|quora link preview|outbrain|vkshare|redditbot|w3c_validator|baiduspider|yandex|applebot|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|ccbot|diffbot|scrapy|python-requests|curl\/|wget\/|node-fetch|axios\/|headlesschrome|phantomjs|ia_archiver|mediapartners|adsbot|perplexitybot|claudebot|claude-web|anthropic-ai|gptbot|oai-searchbot|chatgpt-user|google-extended|google-inspectiontool|googleother|google-cloudvertexbot|google-agent|google-gemininotebook|google-notebooklm|geminiios|gemini|bard|bingbot|duckduckbot|meta-externalagent|iframely|skypeuripreview|nuzzel|flipboard|tumblr|bitlybot|pocket|sogou|exabot|facebot|archive\.org_bot|wayback|lighthouse|pagespeed|chrome-lighthouse|preview|fetch|googleproducer|google-pagerenderer|googleassistant|googlewv|compatible;\s*google/i;

// URL gốc backend (twelve-backend). Khai báo BACKEND_ORIGIN trên Vercel
// (Project Settings > Environment Variables), ví dụ:
// https://twelveta.onrender.com — KHÔNG trailing slash.
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || "").replace(/\/$/, "");

// ==== v1.1 [BẢO MẬT — vá từ 2.0.4] — middleware chứng minh với backend rằng request ĐẾN TỪ MÌNH ====
// Trước 1.1: backend không có cách nào phân biệt request SSR do middleware này chuyển tiếp với request do BẤT KỲ AI gọi thẳng host Render (`/post/:id`, UA tuỳ ý) — nên cả hai đều cộng
// `aiViewCount`/`viewCount`/`postScore` (bơm view không giới hạn bằng cách đổi IP/X-Forwarded-For). Nay mọi request rewrite sang backend mang 2 header do middleware tự gắn:
//   x-twelve-ssr-secret : bí mật dùng chung (env SSR_PROXY_SECRET — ĐẶT CÙNG GIÁ TRỊ ở Vercel VÀ Render)
//   x-twelve-client-ip  : IP thật của client (do Vercel cung cấp, client không giả được)
// Backend CHỈ cộng view/AI-view và nới hạn mức cho crawler khi secret khớp. Mọi header `x-twelve-*` do client gửi lên đều bị xoá trước khi chuyển tiếp (không thể giả secret/IP).
// Thiếu SSR_PROXY_SECRET ở Vercel ⇒ backend coi request là không tin cậy ⇒ trang SSR vẫn hiển thị bình thường nhưng KHÔNG cộng view (an toàn, chỉ mất số liệu AI-view).
const SSR_PROXY_SECRET = process.env.SSR_PROXY_SECRET || "";

/** Header chuyển tiếp sang backend: xoá mọi x-twelve-* của client, rồi gắn secret + IP thật. */
function buildBackendHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-twelve-")) headers.delete(name);
  }
  const clientIp =
    request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (SSR_PROXY_SECRET) headers.set("x-twelve-ssr-secret", SSR_PROXY_SECRET);
  if (clientIp) headers.set("x-twelve-client-ip", clientIp);
  return headers;
}

/**
 * Quyết định có phục vụ SSR hay không.
 *
 * Lý do không chỉ dựa UA: Gemini (và nhiều AI agent 2025–2026) fetch URL
 * bằng User-Agent giống Chrome thông thường, không chứa "bot"/"gemini".
 * Khi đó bot-only regex sẽ bỏ sót → AI chỉ thấy SPA trống.
 *
 * Chiến lược v0.4.3:
 * 1. UA khớp BOT_UA_REGEX → SSR
 * 2. Request KHÔNG có dấu hiệu "người dùng thật đang navigate":
 *    - Thiếu Sec-Fetch-User: ?1 (header chỉ trình duyệt gửi khi user kích hoạt)
 *    - HOẶC Sec-Fetch-Mode không phải "navigate"
 *    → SSR (AI fetch, curl, preview, headless…)
 * 3. Còn lại (Chrome/Safari thật với Sec-Fetch-User) → SPA React
 */
// Bot "cứng" — chắc chắn không phải người dùng mobile/Chrome thường
const STRONG_BOT_UA =
  /googlebot|bingbot|duckduckbot|baiduspider|yandex|applebot|gptbot|chatgpt|claudebot|claude-web|anthropic|perplexitybot|bytespider|petalbot|ahrefsbot|semrushbot|mj12bot|dotbot|ccbot|diffbot|scrapy|python-requests|curl\/|wget\/|node-fetch|axios\/|headlesschrome|phantomjs|facebookexternalhit|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|embedly|iframely|preview|google-inspectiontool|google-extended|google-cloudvertexbot|google-agent|google-notebooklm|geminiios|\bgemini\b|\bbard\b/i;

const BROWSER_LIKE_UA =
  /Mozilla\/|Chrome\/|CriOS\/|Safari\/|Firefox\/|Edg\/|OPR\/|Android|iPhone|iPad|Mobile/i;

function shouldServeSsr(request) {
  const userAgent = request.headers.get("user-agent") || "";
  const isBotUa = BOT_UA_REGEX.test(userAgent);
  const isStrongBot = STRONG_BOT_UA.test(userAgent);
  const isBrowserLike = BROWSER_LIKE_UA.test(userAgent);

  const secFetchUser = request.headers.get("sec-fetch-user");
  const secFetchMode = request.headers.get("sec-fetch-mode");
  const looksLikeRealUserNavigation =
    secFetchUser === "?1" && (secFetchMode === "navigate" || secFetchMode === "nested-navigate");

  // Link share (?idu= / ?shared=1)
  // Ưu tiên trải nghiệm người dùng + đếm share (SPA):
  // - Mobile/Chrome thường dán link hoặc mở từ app chat thường KHÔNG gửi
  //   Sec-Fetch-User → nếu chỉ dựa header này sẽ bị đẩy SSR (bug báo lại 0.8.x).
  // - Bot/AI rõ ràng (STRONG_BOT) → SSR, đọc được; share vẫn không đếm trên SSR.
  // - AI giả Chrome + mở link share có thể ra SPA (CSR): dùng URL sạch /post/:id
  //   (không ?idu) để SSR đọc nội dung.
  try {
    const url = new URL(request.url);
    const isShareLink =
      url.searchParams.has("idu") ||
      url.searchParams.get("shared") === "1" ||
      url.searchParams.get("shared") === "true";
    if (isShareLink) {
      if (isStrongBot) return true; // SSR cho bot/AI rõ
      if (looksLikeRealUserNavigation) return false; // SPA
      if (isBrowserLike && !isStrongBot) return false; // SPA — user mobile thiếu Sec-Fetch-User
      return true; // curl / fetch thuần → SSR, không đếm share
    }
  } catch (_) {
    /* ignore */
  }

  if (isBotUa) return true;

  return !looksLikeRealUserNavigation;
}

export default function middleware(request) {
  if (!BACKEND_ORIGIN) {
    // Chưa cấu hình BACKEND_ORIGIN → không rewrite được, trả SPA như cũ.
    return next();
  }

  if (shouldServeSsr(request)) {
    const url = new URL(request.url);
    const destination = new URL(url.pathname + url.search, BACKEND_ORIGIN);
    return rewrite(destination, { request: { headers: buildBackendHeaders(request) } });
  }

  return next();
}
