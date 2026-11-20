const rateLimit = require("express-rate-limit");
const { getClientKey, isTrustedSsrProxy } = require("../utils/clientIp");

/**
 * ==== v0.9.6 [HIGH] — Rate limiting riêng cho endpoint nghiệp vụ ====
 *
 * Trước đây các hành vi nghiệp vụ nhạy cảm (like/dislike, comment, share,
 * cập nhật hồ sơ) CHỈ được bảo vệ bởi `globalLimiter` dùng chung cho toàn
 * bộ `/api` (300 req/15 phút/IP — xem server.js). Không có giới hạn RIÊNG
 * cho từng hành vi, và limiter dùng chung chỉ tính theo IP, nên:
 *   - 1 IP có thể "đốt" gần hết 300 req/15 phút chỉ bằng riêng 1 hành vi
 *     (ví dụ spam like), ảnh hưởng luôn các request khác của chính họ.
 *   - Không phân biệt được nhiều tài khoản khác nhau NHƯNG cùng đứng sau
 *     1 IP (NAT, mạng công ty, 4G...) — giới hạn theo IP làm oan người
 *     dùng thật, trong khi kẻ tấn công dùng nhiều IP/proxy lại dễ bypass
 *     giới hạn IP mà không hề bị giới hạn theo TÀI KHOẢN (authUid).
 *
 * Cách vá: thêm limiter riêng cho từng nhóm hành vi, khoá theo `authUid`
 * (khi đã đăng nhập — tức đặt limiter SAU `requireAuth`/`optionalAuth` trong
 * route để `req.authUid` đã sẵn sàng) thay vì chỉ theo IP. Khách chưa đăng
 * nhập (route dùng `optionalAuth`, ví dụ tạo link share) vẫn bị giới hạn
 * theo IP như cũ — không có nhóm nào bị bỏ ngỏ hoàn toàn.
 *
 * Ngưỡng chọn RỘNG RÃI có chủ đích: mục tiêu là chặn spam/farm tự động,
 * KHÔNG phải giới hạn người dùng thật dùng bình thường (rủi ro xung đột
 * thấp — xem CHANGELOG-v0.9.6.md).
 */
// v1.1 [TW-01]: nhánh khách dùng `getClientKey(req)` (IP đúng sau Cloudflare, IPv6 về /64) thay vì `req.ip` thô.
function authOrIpKeyGenerator(req) {
  return req.authUid ? `uid:${req.authUid}` : `ip:${getClientKey(req)}`;
}

const reactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90, // ~1 lượt like/dislike mỗi 10 giây trung bình
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang thao tác quá nhanh, vui lòng thử lại sau ít phút." },
});

const commentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang bình luận quá nhanh, vui lòng thử lại sau ít phút." },
});

const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang tạo link chia sẻ quá nhanh, vui lòng thử lại sau ít phút." },
});

/**
 * ==== v1.1 [vá từ 2.0.5] — Giới hạn RIÊNG cho tạo / sửa bài viết và tải danh sách bình luận ====
 * Trước đây POST/PATCH /api/posts chỉ chịu `globalLimiter` (300 req/15 phút/IP, dùng chung cả /api).
 * Mỗi bài tạo ra cộng +1 positiveScore cho tác giả và sinh sanitize HTML tốn CPU. Khoá theo tài khoản.
 * Danh sách bình luận mỗi trang đọc thêm N hồ sơ tác giả; trước đây cũng chỉ chịu globalLimiter.
 */
const commentListLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn tải bình luận quá nhanh, vui lòng thử lại sau ít phút." },
});

const postCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20, // 20 bài/giờ/tài khoản — thoải mái cho người dùng thật
  keyGenerator: authOrIpKeyGenerator,
  skipFailedRequests: true, // request bị từ chối (thiếu tiêu đề, quá dài…) không tốn lượt
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đăng bài quá nhanh, vui lòng thử lại sau ít phút." },
});
const postEditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: authOrIpKeyGenerator,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn sửa bài quá nhanh, vui lòng thử lại sau ít phút." },
});

/**
 * ==== v0.10.11 [HIGH] — trần tuyệt đối cho GET /:id (nơi view + share được
 * ĐẾM, không phải nơi tạo link share) ====
 *
 * Dedup 30 phút/viewerKey (registerView/registerShare, utils/helpers.js) +
 * việc không còn tin `sid` client tự chọn (vá cùng đợt, xem
 * viewerKeyFromRequest()) đã chặn phần lớn farm — nhưng dedup theo khoá vẫn
 * có thể bị lách nếu kẻ tấn công đổi IP (proxy/VPN). Limiter này là lớp
 * phòng thủ ĐỘC LẬP với khoá dedup: giới hạn CỨNG số lần gọi GET /:id theo
 * IP/uid, bất kể viewerKey tính ra là gì.
 * Ngưỡng RỘNG RÃI có chủ đích (đọc nhiều bài khác nhau liên tục vẫn thoải
 * mái — ~10 request/phút trung bình) — mục tiêu chỉ chặn flood tự động.
 */
// v1.1 [vá từ 2.0.4] — Crawler CHỈ được NỚI hạn mức (không bao giờ được miễn trừ) khi request đã chứng minh đi qua middleware Vercel của dự án
// (header bí mật `x-twelve-ssr-secret` khớp SSR_PROXY_SECRET) — User-Agent do client tự khai nên không thể là căn cứ duy nhất. Khoá theo IP thật mà
// middleware chuyển tiếp (xem utils/clientIp.js), nên một IP vẫn bị chặn trần. Không có secret ⇒ mọi request dùng ngưỡng mặc định.
const SEARCH_ENGINE_UA =
  /googlebot|google-inspectiontool|googleother|google-extended|google-cloudvertexbot|bingbot|duckduckbot|baiduspider|yandex|applebot/i;
function isSearchEngineCrawler(req) {
  return SEARCH_ENGINE_UA.test(req.headers["user-agent"] || "");
}
const VIEW_LIMIT_DEFAULT = 150;
const VIEW_LIMIT_VERIFIED_CRAWLER = 1500; // crawl dày đặc vẫn thoải mái, nhưng có trần
const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) =>
    isTrustedSsrProxy(req) && isSearchEngineCrawler(req) ? VIEW_LIMIT_VERIFIED_CRAWLER : VIEW_LIMIT_DEFAULT,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang xem quá nhanh, vui lòng thử lại sau ít phút." },
});

/**
 * ==== v0.10.11 [MEDIUM] — /api/trending/* trước đây chỉ có globalLimiter
 * dùng chung (300 req/15 phút cho TOÀN BỘ /api) ====
 *
 * Phía sau các route này (đặc biệt cache miss của tab Tìm kiếm/Khám phá) là
 * quét TOÀN BỘ collection posts + blogs (xem trending.controller.js#
 * scanContentDocs) — tốn kém hơn nhiều so với 1 request /api thông thường.
 * Ngưỡng thấp hơn global nhưng vẫn đủ rộng cho việc gõ tìm kiếm thật (có
 * debounce 400ms ở frontend).
 */
const trendingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang thao tác quá nhanh, vui lòng thử lại sau ít phút." },
});

const profileWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang cập nhật hồ sơ quá nhanh, vui lòng thử lại sau ít phút." },
});

/**
 * ==== v0.10.20 — Giới hạn RIÊNG cho upload avatar ====
 * Trước đây upload avatar chỉ dùng chung `profileWriteLimiter` (30 lần/15 phút,
 * ~2.880 lần/ngày/tài khoản) — quá thoáng cho thao tác tốn tài nguyên Cloudinary.
 * Nay: 6 lần/giờ/tài khoản. `skipFailedRequests`: request bị từ chối (sai định
 * dạng, quá lớn...) KHÔNG tốn lượt của người dùng thật vì chưa chạm Cloudinary
 * (spam request lỗi vẫn bị profileWriteLimiter + globalLimiter chặn).
 */
const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  keyGenerator: authOrIpKeyGenerator,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đổi ảnh đại diện quá nhiều lần, vui lòng thử lại sau ít phút." },
});

/**
 * ==== v0.10.12 [LOW] — GET /api/users/:uid (xem hồ sơ công khai) trước đây
 * chỉ có globalLimiter dùng chung ====
 * Rủi ro vốn thấp (uid khó đoán, `toPublicUser()` đã lọc sạch field nhạy
 * cảm — xem báo cáo bảo mật v0.10.11, mục V-003) nhưng thêm 1 lớp riêng
 * không tốn gì, nhất quán với các route đọc khác đã có limiter riêng.
 */
const profileReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: authOrIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đang xem hồ sơ quá nhanh, vui lòng thử lại sau ít phút." },
});

module.exports = {
  reactLimiter,
  commentLimiter,
  commentListLimiter,
  postCreateLimiter,
  postEditLimiter,
  shareLimiter,
  viewLimiter,
  trendingLimiter,
  profileWriteLimiter,
  avatarUploadLimiter,
  profileReadLimiter,
};
