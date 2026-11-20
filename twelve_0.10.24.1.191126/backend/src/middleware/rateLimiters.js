const rateLimit = require("express-rate-limit");
// Twelve 1.1 — BACKPORT TW-01 (2.5.3): khoá IP lấy qua getClientKey (chỉ tin
// CF-Connecting-IP khi req.ip thuộc dải Cloudflare; IPv6 rút /64). Ở 0.10.24
// dùng thẳng req.ip → sau Cloudflare+Render là IP nội bộ, nhiều người dùng
// chung bucket limiter và kẻ tấn công đổi header XFF lách limiter.
const { getClientKey } = require("../utils/clientIp");

function authOrIpKeyGenerator(req) {
  return req.authUid ? `uid:${req.authUid}` : getClientKey(req);
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
const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
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
  shareLimiter,
  viewLimiter,
  trendingLimiter,
  profileWriteLimiter,
  avatarUploadLimiter,
  profileReadLimiter,
};
