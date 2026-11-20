/**
 * ==== VÁ #4 [MEDIUM] — Không giới hạn tốc độ đăng ký / dò tagname (v0.8.3) ====
 * ==== VÁ #4 [MEDIUM] — bổ sung fail-fast ở production (v0.8.5) ====
 *
 * `authLimiter` (20 request/15 phút/IP, xem server.js) chống được brute-force
 * cơ bản nhưng bị bypass dễ dàng bằng cách đổi IP (proxy/VPN xoay vòng,
 * botnet) — không đủ để chặn tạo hàng loạt tài khoản rác.
 *
 * Middleware này verify CAPTCHA (Cloudflare Turnstile) ở endpoint đăng ký.
 *
 * BÀI HỌC TỪ ĐỢT KIỂM THỬ v0.8.4: thiết kế ban đầu (v0.8.3) là "tắt mặc
 * định, bật khi có cấu hình" — nếu chưa set `TURNSTILE_SECRET_KEY`, middleware
 * bỏ qua HOÀN TOÀN, kể cả ở production. Trên thực tế server production
 * (twelveta.onrender.com) chưa từng được cấu hình biến này, nên toàn bộ lớp
 * CAPTCHA vừa build xong (backend + frontend `TurnstileWidget.jsx`) tồn tại
 * dưới dạng CODE CHẾT ngoài thực tế — kiểm thử v0.8.4 xác nhận 5 request đăng
 * ký liên tiếp không kèm `captchaToken` vẫn được `201` bình thường.
 *
 * -> Đây chính là bài học đã áp dụng cho #8 (CORS_ORIGIN, xem server.js):
 * một control bảo mật mà mặc định "im lặng tắt" khi thiếu cấu hình sẽ luôn có
 * nguy cơ bị quên cấu hình rồi chạy hở ở production mà không ai biết. Giờ áp
 * dụng đúng nguyên tắc đó cho CAPTCHA: BẮT BUỘC phải có `TURNSTILE_SECRET_KEY`
 * khi `NODE_ENV=production` — thiếu là server từ chối khởi động (xem
 * `assertCaptchaConfigured()`, gọi từ server.js), thay vì âm thầm mất lớp
 * phòng thủ. Ở development (không set NODE_ENV=production) vẫn cho phép bỏ
 * qua để tiện chạy thử cục bộ khi chưa có site key/secret key Turnstile.
 *
 * Vì sao chọn Cloudflare Turnstile: miễn phí, không cần hiển thị "chọn ảnh
 * xe buýt" khó chịu như reCAPTCHA cũ, và verify chỉ cần 1 request HTTP đơn
 * giản (không cần SDK riêng ở backend).
 */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const { getRawClientIp } = require("../utils/clientIp");

/**
 * ==== v2.5.3 [TW-10] — verifyCaptcha: có timeout và kiểm `hostname` ====
 *
 * (1) TIMEOUT: trước đây `fetch` tới Cloudflare không có hạn chót — khi Cloudflare chậm, mỗi request đăng ký/quên mật khẩu treo đến timeout mặc định của
 *     runtime (rất lâu) và giữ socket; kết hợp limiter bị né (TW-01) có thể giữ cạn nhiều socket. Nay `AbortSignal.timeout` (mặc định 5 giây, env
 *     `TURNSTILE_TIMEOUT_MS`, giới hạn 1–15 giây). Hết hạn ⇒ rơi vào nhánh lỗi hạ tầng sẵn có: 503, KHÔNG cho qua (fail-closed như trước).
 * (2) HOSTNAME: Cloudflare trả `hostname` = tên miền nơi widget được hiển thị. Không kiểm thì token do widget của MỘT SITE KHÁC cấp (nếu sitekey bị dùng lại
 *     ở nơi khác) vẫn hợp lệ. Danh sách hợp lệ lấy theo thứ tự: env `TURNSTILE_ALLOWED_HOSTNAMES` (phân cách dấu phẩy, cho phép `*.example.com`) → hostname của
 *     `CORS_ORIGIN` + `FRONTEND_URL` (đã bắt buộc đúng frontend ở production, nên không cần cấu hình thêm). Chỉ kiểm ở production hoặc khi có env riêng
 *     (môi trường dev/test dùng khoá thử của Cloudflare luôn trả hostname `example.com`). Công tắc khẩn: `TURNSTILE_HOSTNAME_CHECK=off`.
 *     Không kiểm `action`: widget dùng chung cho đăng ký + quên mật khẩu và frontend chưa đặt `action` — thêm action là thay đổi riêng ở cả hai phía.
 *     GIỮ NGUYÊN thứ tự captcha TRƯỚC validator ở route (validator đọc Firestore nên không nên chạy cho request chưa qua CAPTCHA).
 */
function turnstileTimeoutMs() {
  const n = Number(process.env.TURNSTILE_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 && n <= 15000 ? Math.round(n) : 5000;
}

function hostnameOf(urlOrHost) {
  try {
    return new URL(urlOrHost).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * v2.5.3 (rà soát độc lập): chuẩn hoá một mục của `TURNSTILE_ALLOWED_HOSTNAMES`. Người vận hành quen viết kiểu `CORS_ORIGIN` (`https://twelveta.vercel.app`, có thể kèm cổng/đường dẫn)
 * trong khi Cloudflare trả `hostname` TRẦN — nếu không chuẩn hoá thì không bao giờ khớp và MỌI lượt đăng ký/quên mật khẩu ở production bị từ chối vì một dòng cấu hình. Giữ `*.example.com`.
 */
function normaliseHostEntry(raw) {
  let e = String(raw || "").trim().toLowerCase();
  if (!e) return null;
  const wildcard = e.startsWith("*.");
  if (wildcard) e = e.slice(2);
  e = e.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[\/?#]/)[0].replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(e)) return null;
  return wildcard ? `*.${e}` : e;
}

/** Danh sách hostname widget hợp lệ, hoặc null nếu không áp dụng kiểm tra. */
function turnstileAllowedHostnames() {
  if (String(process.env.TURNSTILE_HOSTNAME_CHECK || "").toLowerCase() === "off") return null;
  const explicit = String(process.env.TURNSTILE_ALLOWED_HOSTNAMES || "")
    .split(",")
    .map(normaliseHostEntry)
    .filter(Boolean);
  if (explicit.length) return explicit;
  if (process.env.NODE_ENV !== "production") return null;
  const derived = [];
  for (const o of String(process.env.CORS_ORIGIN || "").split(",")) {
    const h = hostnameOf(o.trim());
    if (h) derived.push(h);
  }
  const f = hostnameOf(process.env.FRONTEND_URL || "");
  if (f) derived.push(f);
  return derived.length ? [...new Set(derived)] : null;
}

function hostnameAllowed(hostname, allowed) {
  const h = String(hostname).toLowerCase();
  return allowed.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
}

// Gọi 1 lần lúc khởi động (server.js) — cùng cơ chế fail-fast với CORS_ORIGIN
// ở #8: thiếu cấu hình bắt buộc ở production -> throw ngay, không để lộ ra
// production dưới dạng "tắt CAPTCHA âm thầm" như đã xảy ra ở v0.8.4.
function assertCaptchaConfigured() {
  if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY) {
    throw new Error(
      "TURNSTILE_SECRET_KEY chưa được cấu hình ở production. Đăng ký Cloudflare " +
        "Turnstile (https://dash.cloudflare.com/?to=/:account/turnstile), đặt secret " +
        "key vào biến TURNSTILE_SECRET_KEY (backend) và site key vào " +
        "VITE_TURNSTILE_SITE_KEY (frontend, build-time) trước khi khởi động — " +
        "không được để trống vì sẽ vô hiệu hoá hoàn toàn lớp CAPTCHA chống đăng ký " +
        "hàng loạt (lỗ hổng #4)."
    );
  }
}

async function verifyCaptcha(req, res, next) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Chỉ tới được đây khi KHÔNG phải production (đã được assertCaptchaConfigured
    // chặn ở lúc khởi động nếu là production) -> cho qua để tiện dev cục bộ.
    return next();
  }

  const token = req.body && req.body.captchaToken;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Thiếu xác minh CAPTCHA. Vui lòng thử lại." });
  }

  try {
    const params = new URLSearchParams({ secret: secretKey, response: token });
    // v2.5.3 [TW-01]: IP client thật (qua hàm duy nhất) thay vì `req.ip` có thể là IP edge Cloudflare; `remoteip` chỉ mang tính tham khảo với Turnstile.
    const ip = getRawClientIp(req);
    if (ip && ip !== "unknown") params.append("remoteip", ip);

    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(turnstileTimeoutMs()), // v2.5.3 [TW-10]
    });
    const result = await verifyRes.json();

    if (!result.success) {
      console.warn("verifyCaptcha thất bại:", result["error-codes"]);
      return res.status(400).json({ error: "Xác minh CAPTCHA thất bại. Vui lòng thử lại." });
    }

    // v2.5.3 [TW-10]: token phải do widget hiển thị trên đúng frontend của Twelve.
    const allowedHosts = turnstileAllowedHostnames();
    if (allowedHosts) {
      if (typeof result.hostname !== "string" || !result.hostname) {
        // Cloudflare luôn trả hostname cho token hợp lệ; thiếu thì không thể kết luận — ghi log, không chặn người dùng thật.
        console.warn("verifyCaptcha: phản hồi Turnstile không có `hostname` — bỏ qua kiểm hostname.");
      } else if (!hostnameAllowed(result.hostname, allowedHosts)) {
        console.warn(`verifyCaptcha: hostname không khớp (${String(result.hostname).slice(0, 80)}; cho phép: ${allowedHosts.join(", ").slice(0, 200)}). Nếu đây là frontend hợp lệ ở tên miền khác: đặt TURNSTILE_ALLOWED_HOSTNAMES; khẩn cấp: TURNSTILE_HOSTNAME_CHECK=off.`);
        return res.status(400).json({ error: "Xác minh CAPTCHA thất bại. Vui lòng thử lại." });
      }
    }
    return next();
  } catch (err) {
    console.error("verifyCaptcha error:", err.message);
    // Lỗi hạ tầng (Cloudflare tạm thời không phản hồi...) -> chặn an toàn
    // thay vì mở cửa cho qua, tránh trở thành cách bypass CAPTCHA dễ dàng.
    return res.status(503).json({ error: "Không xác minh được CAPTCHA lúc này, vui lòng thử lại sau." });
  }
}

module.exports = { verifyCaptcha, assertCaptchaConfigured, turnstileAllowedHostnames, hostnameAllowed, turnstileTimeoutMs };
