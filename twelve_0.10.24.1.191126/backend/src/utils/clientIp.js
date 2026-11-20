/**
 * ==== Twelve 1.1 (0.10.24.1.191126) — BACKPORT từ 2.5.3 (TW-01) ====
 * Nhận diện IP client một cách AN TOÀN, không đoán topology.
 *
 * Nguyên tắc (đọc kỹ trước khi sửa): backend đứng sau Cloudflare → Render.
 * `req.ip` (Express, trust proxy=1) là IP của hop kế cuối — trên Render thật
 * đó là proxy nội bộ, KHÔNG phải IP client thật. `CF-Connecting-IP` do
 * Cloudflare đặt nhưng GIẢ ĐƯỢC nếu kẻ tấn công gọi thẳng origin (Render).
 * Vì vậy CHỈ tin `CF-Connecting-IP` khi `req.ip` thuộc dải Cloudflare chính
 * thức (gọi thẳng origin → req.ip không thuộc dải → bỏ qua header giả).
 *
 * Mặc định an toàn ("auto"): không tệ hơn hành vi cũ (dùng req.ip) khi không
 * đứng sau Cloudflare, và đúng IP client thật khi đứng sau Cloudflare.
 * Không tự đổi `trust proxy` (giữ nguyên "1" của 0.10.24).
 *
 * Mọi nơi cần IP cho rate-limit / khoá dedup KHÔNG được đọc `req.ip`,
 * `X-Forwarded-For` hay `CF-Connecting-IP` trực tiếp — chỉ dùng `getClientKey`.
 * `getRawClientIp` chỉ cho nơi cần địa chỉ thật (Turnstile remoteip, log chẩn đoán).
 */

const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

function ipToInt(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  return ((+m[1] << 24) >>> 0) + ((+m[2] << 16) >>> 0) + ((+m[3] << 8) >>> 0) + +m[4];
}

function inCidrV4(ip, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt == null || rangeInt == null) return false;
  const bits = +bitsStr;
  if (bits <= 0) return true;
  if (bits >= 32) return ipInt === rangeInt;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function normalizeV6(ip) {
  // Bỏ ::ffff: (IPv4-mapped), rút về /64 cho rate-limit (nhiều IPv6 của 1 người).
  let s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) s = s.slice(7);
  if (!s.includes(":")) return s; // đã thành IPv4
  const groups = s.split(":");
  // Rút /64 = 4 nhóm 16-bit đầu. Mở rộng "::" bằng cách đếm nhóm thiếu.
  const emptyIdx = groups.indexOf("");
  if (emptyIdx !== -1) {
    const missing = 8 - (groups.length - 1);
    groups.splice(emptyIdx, 1, ...Array(Math.max(missing, 0)).fill("0"));
  }
  const first4 = groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":");
  return `${first4}::/64`;
}

function isCloudflareIp(ip) {
  if (!ip) return false;
  if (ip.includes(":")) {
    const norm = normalizeV6(ip).split("::")[0];
    return CLOUDFLARE_V6.some((cidr) => {
      const prefix = cidr.split("/")[0].split(":").slice(0, 2).join(":");
      return norm.startsWith(prefix);
    });
  }
  return CLOUDFLARE_V4.some((cidr) => inCidrV4(ip, cidr));
}

/**
 * Địa chỉ IP client THẬT (không phải key rate-limit). Chỉ dùng cho Turnstile
 * remoteip / log chẩn đoán. Không dùng để khoá limiter (dùng getClientKey).
 */
function getRawClientIp(req) {
  const reqIp = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  const cfIp = (req.headers["cf-connecting-ip"] || "").split(",")[0]?.trim().replace(/^::ffff:/, "");
  if (cfIp && isCloudflareIp(reqIp)) return cfIp;
  return reqIp || null;
}

/**
 * Khoá chuẩn cho rate-limiter / dedup view-share. IPv6 rút về /64, IPv4 giữ nguyên.
 * Luôn trả về chuỗi không rỗng (fallback = "unknown").
 */
function getClientKey(req) {
  const raw = getRawClientIp(req);
  if (!raw) return "ip:unknown";
  const key = raw.includes(":") ? normalizeV6(raw) : raw;
  return `ip:${key}`;
}

module.exports = { getClientKey, getRawClientIp, isCloudflareIp };
