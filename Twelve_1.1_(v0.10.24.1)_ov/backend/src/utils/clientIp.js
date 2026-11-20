const crypto = require("crypto");
const net = require("net");

/**
 * ==== v2.0.4 [BẢO MẬT — vá bơm view / bỏ qua rate-limit] ====
 *
 * Trước đây `viewerKeyFromRequest()` lấy phần tử ĐẦU của `X-Forwarded-For`
 * (client tự đặt được khi gọi thẳng host Render) và `viewLimiter` bỏ qua
 * hoàn toàn rate-limit khi User-Agent chứa "googlebot" (ai cũng giả được).
 * Gộp hai điểm yếu → bơm view/AI-view/postScore vô hạn.
 *
 * Cách vá: chỉ tin thông tin "client thật" khi request đến từ middleware
 * Vercel của chính dự án, chứng minh bằng header bí mật dùng chung
 * `x-twelve-ssr-secret` (biến môi trường SSR_PROXY_SECRET ở CẢ backend lẫn
 * Vercel). Mọi trường hợp khác dùng `req.ip` do Express tính theo
 * `trust proxy` — không thể giả bằng header của client.
 */

/**
 * ==== v2.5.3 [TW-01, HIGH] — nhận diện IP client ĐÚNG và DUY NHẤT một chỗ ====
 *
 * Vấn đề (báo cáo bảo mật 2.5.2, TW-01): backend chạy sau Cloudflare → proxy của Render nhưng chỉ khai báo tin 1 hop (`trust proxy = 1`),
 * nên `req.ip` là IP của edge Cloudflare — đổi theo đường đi và dùng chung giữa nhiều người. Hệ quả: limiter theo IP bị né, nhiều người
 * dùng chung một bộ đếm, và khoá chống đếm trùng view/share của khách ẩn danh (lưu ở Firestore) đổi liên tục.
 *
 * Vì sao KHÔNG đổi cứng `trust proxy` sang 2 hay đọc thẳng `CF-Connecting-IP`: báo cáo nêu rõ chưa ai đo topology thật (Render có thể thêm/bớt
 * một hop), và `CF-Connecting-IP` chỉ đáng tin nếu request chắc chắn đi qua Cloudflare — nếu ai đó gọi thẳng origin thì header này giả được.
 * Nên bản này làm theo hướng "tự kiểm chứng + cấu hình được, mặc định không đổi hành vi nếu không chắc":
 *
 *   1. Chế độ `auto` (mặc định, `CLIENT_IP_MODE=auto`): chỉ đọc `CF-Connecting-IP` khi địa chỉ mà Express coi là "hop tin cậy gần nhất" (`req.ip`)
 *      nằm trong DẢI IP CỦA CLOUDFLARE (danh sách chính thức https://www.cloudflare.com/ips-v4 và /ips-v6). Khi đó chính Cloudflare vừa
 *      nối kết với ta, mà Cloudflare luôn ghi đè `CF-Connecting-IP`, nên client không giả được. Nếu `req.ip` KHÔNG thuộc dải Cloudflare (gọi thẳng
 *      origin, hoặc topology khác dự kiến) → bỏ qua header, dùng `req.ip` đúng như 2.5.2 — không tệ hơn trước, không thể bị giả.
 *   2. `CLIENT_IP_MODE=proxy`: tắt hẳn nhánh `CF-Connecting-IP`, chỉ dùng `req.ip` (hành vi 2.5.2).
 *   3. `TRUST_PROXY_HOPS` (mặc định 1 = như 2.5.2): số hop proxy phía trước app. Đặt sau khi ĐO bằng `DEBUG_IP_TOPOLOGY=on` (xem `ipTopologyProbe`).
 *      Nếu đo ra `X-Forwarded-For = "client, edge"` thì đặt 2 và `req.ip` chính là client (chế độ `auto` vẫn an toàn vì không còn cần header CF).
 *
 * Các nơi cần "IP client" đều gọi MỘT hàm: `getClientKey(req)` (đã chuẩn hoá: bỏ `::ffff:`, IPv6 về /64 — A-07). `getRawClientIp(req)` chỉ dành
 * cho nơi cần địa chỉ thật (Turnstile `remoteip`, log chẩn đoán).
 */

const SECRET_HEADER = "x-twelve-ssr-secret";
const CLIENT_IP_HEADER = "x-twelve-client-ip";
const CF_CLIENT_IP_HEADER = "cf-connecting-ip";

// Dải IP của Cloudflare — chép từ https://www.cloudflare.com/ips-v4 và https://www.cloudflare.com/ips-v6 (đối chiếu 07/11/2026).
// Dải này hiếm khi đổi; nếu Cloudflare thêm dải mới mà chưa cập nhật ở đây thì hậu quả chỉ là nhánh `auto` không kích hoạt cho dải đó
// (rơi về `req.ip`, an toàn) — có thể bổ sung nóng bằng env CLOUDFLARE_EXTRA_RANGES="1.2.3.0/24,2001:db8::/32".
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

function buildBlockList(ranges) {
  const list = new net.BlockList();
  for (const cidr of ranges) {
    const [addr, prefixStr] = String(cidr).trim().split("/");
    const prefix = Number(prefixStr);
    const family = net.isIPv4(addr) ? "ipv4" : net.isIPv6(addr) ? "ipv6" : null;
    if (!family || !Number.isInteger(prefix)) continue; // dòng hỏng thì bỏ qua, không làm sập tiến trình
    try {
      list.addSubnet(addr, prefix, family);
    } catch {
      /* prefix ngoài khoảng cho phép — bỏ qua */
    }
  }
  return list;
}

let cloudflareList = buildBlockList(CLOUDFLARE_RANGES);
let cloudflareExtraRaw = "";
function getCloudflareList() {
  const extra = process.env.CLOUDFLARE_EXTRA_RANGES || "";
  if (extra !== cloudflareExtraRaw) {
    cloudflareExtraRaw = extra;
    cloudflareList = buildBlockList([...CLOUDFLARE_RANGES, ...extra.split(",").filter(Boolean)]);
  }
  return cloudflareList;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

/** Bỏ zone-id (`fe80::1%eth0`) và dạng IPv4-mapped `::ffff:1.2.3.4`. */
function stripAddress(ip) {
  let s = String(ip).trim();
  const pct = s.indexOf("%");
  if (pct !== -1) s = s.slice(0, pct);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped && net.isIPv4(mapped[1])) s = mapped[1];
  return s;
}

/** Mở rộng IPv6 hợp lệ (đã qua net.isIPv6) thành 8 nhóm số nguyên. */
function expandIPv6(address) {
  let s = address;
  if (s.includes(".")) {
    const cut = s.lastIndexOf(":");
    const v4 = s.slice(cut + 1);
    if (!net.isIPv4(v4)) return null;
    const p = v4.split(".").map(Number);
    s = `${s.slice(0, cut + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array(missing).fill("0"), ...tail];
  }
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n)) ? nums : null;
}

/**
 * Chuẩn hoá địa chỉ thành khoá dùng cho limiter / dedupe (A-07):
 *   - IPv4 → giữ nguyên; `::ffff:1.2.3.4` (và dạng hex tương đương) → IPv4.
 *   - IPv6 → CHỈ giữ tiền tố /64 (`2001:0db8:0000:0001::/64`): một người dùng IPv6 thường có cả khối /64 nên có thể xoay vòng 2^64 địa chỉ để
 *     né limiter nếu khoá theo từng địa chỉ.
 *   - Không phải địa chỉ hợp lệ → "unknown" (một bucket chung, như trước).
 */
function normalizeIp(ip) {
  if (typeof ip !== "string" || !ip) return "unknown";
  const s = stripAddress(ip);
  if (net.isIPv4(s)) return s;
  if (net.isIPv6(s)) {
    const g = expandIPv6(s);
    if (!g) return "unknown";
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`; // ::ffff:a.b.c.d dạng hex
    }
    return `${g.slice(0, 4).map((n) => n.toString(16).padStart(4, "0")).join(":")}::/64`;
  }
  return "unknown";
}

/** Địa chỉ này có thuộc dải IP chính thức của Cloudflare không? */
function isCloudflareAddress(ip) {
  if (typeof ip !== "string" || !ip) return false;
  const s = stripAddress(ip);
  try {
    if (net.isIPv4(s)) return getCloudflareList().check(s, "ipv4");
    if (net.isIPv6(s)) return getCloudflareList().check(s, "ipv6");
  } catch {
    /* địa chỉ hỏng */
  }
  return false;
}

/** Số hop proxy tin cậy (env TRUST_PROXY_HOPS, mặc định 1 — đúng như 2.5.2). Dùng cho `app.set("trust proxy", …)`. */
function trustProxyHops() {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

function clientIpMode() {
  return String(process.env.CLIENT_IP_MODE || "auto").toLowerCase() === "proxy" ? "proxy" : "auto";
}

/**
 * ==== v1.1 [TW-01 — chế độ tin proxy theo DẢI IP] ====
 *
 * `TRUST_PROXY_MODE=cloudflare` (MẶC ĐỊNH, xem `trustProxyMode` bên dưới): thay vì tin "N hop", Express tin MỌI địa chỉ thuộc dải Cloudflare + dải nội bộ (loopback/link-local/
 * private) + `TRUST_PROXY_EXTRA`, rồi lấy địa chỉ KHÔNG tin cậy đầu tiên tính từ bên phải của `X-Forwarded-For` làm IP client. Cách này không phụ thuộc số hop (Render thêm/bớt một hop
 * nội bộ cũng không sao) và vẫn không giả được: các mục bên trái là do client tự đặt, chỉ mục do Cloudflare nối vào (IP kết nối thật của client) mới được chọn.
 *
 * Lưu ý khi chuyển bản 1.1: Twelve 2.5.3.x có thêm panel "Nhận diện IP" (Cài đặt › Quản trị) và endpoint `GET /api/admin/ip-topology` để ĐO topology. Đó là TÍNH NĂNG MỚI của bản Beta nên
 * KHÔNG được đưa vào 1.1. Muốn đo lại (đổi nền tảng, đổi proxy): đặt tạm `DEBUG_IP_TOPOLOGY=on` rồi gọi `/api/version` vài lần — `ipTopologyProbe` ở dưới in 20 dòng `[IP-TOPO]`
 * vào log (peer, chuỗi X-Forwarded-For, CF-Connecting-IP, khoá được chọn); tắt biến sau khi đo.
 */
const PRIVATE_PROXY_RANGES_EXPRESS = ["loopback", "linklocal", "uniquelocal"]; // từ khoá của proxy-addr: 127/8 + ::1, 169.254/16 + fe80::/10, 10/8 + 172.16/12 + 192.168/16 + fc00::/7

/**
 * ==== v2.5.3.3 [TW-01 — `cloudflare` là MẶC ĐỊNH TRONG MÃ] ====
 *
 * Vì sao đổi mặc định: ở 2.5.3.2 mặc định là `hops` (`TRUST_PROXY_HOPS=1`) vì chưa ai đo topology thật. Đã đo ngày 13/11/2026 trên Render thật:
 *   peer ::1 → proxy nội bộ Render 10.x (xoay vòng) → edge Cloudflare 172.71.x (xoay vòng) → client, tức `X-Forwarded-For = "client, CFedge, 10.x"`.
 * Với `hops=1`, `req.ip` = IP nội bộ Render xoay vòng ⇒ nhánh `auto` (chỉ tin `CF-Connecting-IP` khi `req.ip` thuộc dải Cloudflare) KHÔNG BAO GIỜ kích hoạt ⇒ khoá limiter/khoá chống đếm trùng
 * view không theo người dùng (V-01/V-02 là THẬT). Đặt `TRUST_PROXY_MODE=cloudflare` trên Render đã sửa: panel "Nhận diện IP" báo đúng, 30 request tuần tự cho `x-ratelimit-remaining`
 * giảm đều 1 (289 → 260), 20 request tới một bài cùng MỘT bucket.
 * Nhưng biến đó chỉ nằm trên Render — môi trường mới/khôi phục/đổi service sẽ quay về `hops=1` và lỗi trở lại mà không ai hay. Nên mặc định trong MÃ nay là `cloudflare`;
 * `TRUST_PROXY_MODE=hops` giữ lại như lựa chọn tắt (quay về đúng hành vi ≤ 2.5.3.2: số hop cố định theo `TRUST_PROXY_HOPS`).
 *
 * Giá trị lạ (gõ sai) ⇒ dùng mặc định `cloudflare` và cảnh báo MỘT lần ở log — không im lặng đổi sang chế độ khác với ý người đặt. Chỉ `hops` (không phân biệt hoa/thường) mới tắt.
 *
 * !! Cảnh báo (đã cân nhắc): chế độ `cloudflare` tin MỌI địa chỉ nội bộ (loopback/link-local/private) và dải Cloudflare. Nếu backend bị lộ TRỰC TIẾP ra internet mà không qua proxy nào
 *    (chạy cục bộ để dev, hoặc dời sang chỗ không có proxy) thì một kết nối từ loopback/mạng nội bộ sẽ được tin `X-Forwarded-For` — client tự giả được IP của mình. Trên Render việc đó không
 *    xảy ra (kết nối tới app luôn do proxy của Render đứng giữa), còn khi dev cục bộ thì "client" chính là bạn. Nếu dời sang nền tảng khác: ĐO LẠI bằng panel "Nhận diện IP" rồi đặt
 *    `TRUST_PROXY_MODE=hops` + `TRUST_PROXY_HOPS` đúng, hoặc `TRUST_PROXY_EXTRA` cho dải proxy của nền tảng đó.
 */
let warnedBadTrustProxyMode = false;
function trustProxyMode() {
  const raw = String(process.env.TRUST_PROXY_MODE || "").trim().toLowerCase();
  if (raw === "hops") return "hops";
  if (raw && raw !== "cloudflare" && !warnedBadTrustProxyMode) {
    warnedBadTrustProxyMode = true;
    console.warn(`[clientIp] TRUST_PROXY_MODE="${raw.slice(0, 40)}" không hợp lệ (chỉ nhận "cloudflare" hoặc "hops") — dùng mặc định "cloudflare".`);
  }
  return "cloudflare";
}

/** Danh sách "IP hoặc CIDR" hợp lệ trong một biến môi trường phân cách bằng dấu phẩy; mục hỏng bị bỏ (không làm sập tiến trình). */
function parseRangeList(raw) {
  const out = [];
  for (const part of String(raw || "").split(",")) {
    const item = part.trim();
    if (!item) continue;
    const [addr, prefixStr, ...rest] = item.split("/");
    const family = net.isIPv4(addr) ? 4 : net.isIPv6(addr) ? 6 : 0;
    if (!family || rest.length) continue;
    if (prefixStr !== undefined) {
      const prefix = Number(prefixStr);
      if (!/^\d{1,3}$/.test(prefixStr) || !Number.isInteger(prefix) || prefix > (family === 4 ? 32 : 128)) continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Giá trị cho `app.set("trust proxy", …)`. Mặc định (2.5.3.3) là chế độ `cloudflare` → mảng dải IP; `TRUST_PROXY_MODE=hops` trả SỐ hop (`TRUST_PROXY_HOPS`, mặc định 1) như ≤ 2.5.3.2.
 * Đọc env lúc khởi động (Express biên dịch một lần) — đổi biến thì phải khởi động lại.
 */
function trustProxySetting() {
  if (trustProxyMode() !== "cloudflare") return trustProxyHops();
  return [
    ...PRIVATE_PROXY_RANGES_EXPRESS,
    ...CLOUDFLARE_RANGES,
    ...parseRangeList(process.env.CLOUDFLARE_EXTRA_RANGES),
    ...parseRangeList(process.env.TRUST_PROXY_EXTRA),
  ];
}

/** Request này có đi qua middleware Vercel của dự án không (secret khớp)? */
function isTrustedSsrProxy(req) {
  if (req.__twelveTrustedProxy !== undefined) return req.__twelveTrustedProxy;
  const secret = process.env.SSR_PROXY_SECRET;
  const provided = req.headers[SECRET_HEADER];
  let ok = false;
  if (secret && typeof provided === "string" && provided) {
    ok = crypto.timingSafeEqual(sha256(provided), sha256(secret));
  }
  req.__twelveTrustedProxy = ok;
  return ok;
}

function readSingleIpHeader(req, name) {
  const raw = req.headers && req.headers[name];
  if (typeof raw !== "string") return null;
  const ip = raw.split(",")[0].trim();
  return ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) && (net.isIPv4(ip) || net.isIPv6(ip)) ? ip : null;
}

/**
 * Địa chỉ IP thật (chưa chuẩn hoá) của client — thứ tự ưu tiên:
 *   1. Request đã xác thực là từ middleware Vercel: `x-twelve-client-ip` (Vercel tự ghi đè, client không giả được).
 *   2. Chế độ `auto` và `req.ip` thuộc dải Cloudflare: `CF-Connecting-IP` (Cloudflare luôn ghi đè header này).
 *   3. `req.ip` (Express, theo `trust proxy`).
 * Dùng cho nơi cần địa chỉ thật (Turnstile `remoteip`). Khoá limiter/dedupe phải dùng `getClientKey`.
 */
function getRawClientIp(req) {
  if (isTrustedSsrProxy(req)) {
    const ip = readSingleIpHeader(req, CLIENT_IP_HEADER);
    if (ip) return ip;
  }
  const hop = req.ip || (req.socket && req.socket.remoteAddress) || "";
  if (clientIpMode() === "auto" && hop && isCloudflareAddress(hop)) {
    const cf = readSingleIpHeader(req, CF_CLIENT_IP_HEADER);
    if (cf) return cf;
  }
  return hop || "unknown";
}

/**
 * KHOÁ client dùng cho MỌI limiter theo IP và khoá chống đếm trùng view/share của khách (TW-01).
 * Luôn đã chuẩn hoá (IPv4 nguyên dạng, IPv6 về /64, không hợp lệ → "unknown"). Không có `ip:` đứng trước — nơi gọi tự thêm tiền tố.
 */
function getClientKey(req) {
  return normalizeIp(getRawClientIp(req));
}

/**
 * Tên cũ (≤ 2.5.2). Giữ để không gãy nơi gọi/test cũ; từ 2.5.3 trả về khoá đã chuẩn hoá giống `getClientKey`
 * (với IPv4 kết quả không đổi so với trước).
 */
function getClientIp(req) {
  return getClientKey(req);
}

/**
 * Middleware CHẨN ĐOÁN topology IP (TW-01, bước 1 "Đo"). Bật bằng `DEBUG_IP_TOPOLOGY=on`; tự ngừng sau 20 request kể từ lúc khởi động (không ghi
 * nhiều, không giữ trạng thái). Dùng: gọi `/api/version` vài lần từ máy bạn (biết IP công khai của mình) rồi đối chiếu log `[IP-TOPO]` trên Render:
 *   - `xff` = "IP-của-bạn, IP-edge"  → đặt TRUST_PROXY_HOPS=2.
 *   - `req.ip` đã là IP của bạn      → không cần đổi gì.
 *   - `cf` = IP của bạn và `hopIsCloudflare:true` → chế độ `auto` đã tự dùng đúng IP.
 * Log chứa IP của chính người gọi → chỉ bật tạm, rồi tắt biến sau khi đo.
 */
let topoLogged = 0;
function ipTopologyProbe(req, res, next) {
  if (process.env.DEBUG_IP_TOPOLOGY === "on" && topoLogged < 20) {
    topoLogged++;
    const clip = (v) => (typeof v === "string" ? v.slice(0, 300) : v);
    console.warn(
      "[IP-TOPO]",
      JSON.stringify({
        n: topoLogged,
        reqIp: req.ip,
        reqIps: req.ips,
        xff: clip(req.headers["x-forwarded-for"]),
        cf: clip(req.headers[CF_CLIENT_IP_HEADER]),
        peer: req.socket && req.socket.remoteAddress,
        hopIsCloudflare: isCloudflareAddress(req.ip || ""),
        mode: clientIpMode(),
        trustMode: trustProxyMode(), // v2.5.3.2
        hops: trustProxyHops(),
        chosen: getRawClientIp(req),
        key: getClientKey(req),
      })
    );
  }
  next();
}

/**
 * SSR có được phép CỘNG view / AI-view không?
 * Production: chỉ khi request đến từ middleware Vercel đã xác thực. Dev/test
 * (NODE_ENV != production): luôn cho, để chạy local không cần secret.
 */
function canCountSsrView(req) {
  return isTrustedSsrProxy(req) || process.env.NODE_ENV !== "production";
}

function assertSsrProxyConfigured() {
  if (process.env.NODE_ENV === "production" && !process.env.SSR_PROXY_SECRET) {
    console.warn(
      "[SSR] SSR_PROXY_SECRET chưa cấu hình ở production: lượt xem từ trang SSR (bot/AI) " +
        "sẽ KHÔNG được cộng và crawler không được nới hạn mức. Đặt cùng một giá trị bí mật " +
        "ở backend (Render) và frontend (Vercel) rồi redeploy."
    );
  }
}

module.exports = {
  SECRET_HEADER,
  CLIENT_IP_HEADER,
  CF_CLIENT_IP_HEADER,
  CLOUDFLARE_RANGES,
  isTrustedSsrProxy,
  getClientKey,
  getRawClientIp,
  getClientIp,
  normalizeIp,
  isCloudflareAddress,
  trustProxyHops,
  trustProxyMode,
  trustProxySetting,
  parseRangeList,
  clientIpMode,
  ipTopologyProbe,
  canCountSsrView,
  assertSsrProxyConfigured,
};
