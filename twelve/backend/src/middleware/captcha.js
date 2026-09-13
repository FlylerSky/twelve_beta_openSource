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
    const ip = req.ip || req.socket?.remoteAddress;
    if (ip) params.append("remoteip", ip);

    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const result = await verifyRes.json();

    if (!result.success) {
      console.warn("verifyCaptcha thất bại:", result["error-codes"]);
      return res.status(400).json({ error: "Xác minh CAPTCHA thất bại. Vui lòng thử lại." });
    }
    return next();
  } catch (err) {
    console.error("verifyCaptcha error:", err.message);
    // Lỗi hạ tầng (Cloudflare tạm thời không phản hồi...) -> chặn an toàn
    // thay vì mở cửa cho qua, tránh trở thành cách bypass CAPTCHA dễ dàng.
    return res.status(503).json({ error: "Không xác minh được CAPTCHA lúc này, vui lòng thử lại sau." });
  }
}

module.exports = { verifyCaptcha, assertCaptchaConfigured };
