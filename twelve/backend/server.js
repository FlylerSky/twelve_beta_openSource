require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { assertCaptchaConfigured } = require("./src/middleware/captcha");

const app = express();

// ==== VÁ #2 [HIGH] — Defense in depth cho DoS qua multer (v0.8.3) ====
// Bản vá gốc là nâng multer lên ^2.0.2 (xem package.json — các CVE
// 2025-47944/7338/47935/48997 đều nằm ở multer@1.x). Lớp này chỉ là phòng
// thủ bổ sung: nếu có bất kỳ exception nào (kể cả từ 1 dependency khác)
// thoát khỏi mọi try/catch và middleware xử lý lỗi tập trung của Express,
// tiến trình sẽ log rõ nguyên nhân rồi thoát có kiểm soát (exit code 1) để
// process manager (Render/pm2) tự khởi động lại — thay vì để tiến trình ở
// trạng thái treo/hỏng ngầm mà vẫn "sống", ảnh hưởng người dùng khác.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException — tiến trình sẽ thoát để process manager khởi động lại:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection — tiến trình sẽ thoát để process manager khởi động lại:", reason);
  process.exit(1);
});

// Render (và hầu hết PaaS) đặt app sau 1 reverse proxy nên request luôn có
// header X-Forwarded-For. Nếu không khai báo "trust proxy", Express từ chối
// tin header này (đúng ra là mặc định an toàn), khiến express-rate-limit
// không xác định đúng IP người dùng và log ra ValidationError liên tục.
// "1" nghĩa là tin đúng 1 hop proxy phía trước (đúng với kiến trúc Render).
app.set("trust proxy", 1);

// ==== Bảo mật & tối ưu cơ bản ====
// VÁ #1 [CRITICAL] (phần 2/2 — xem helpers.js#safeJsonForScript cho phần 1):
// trước đây contentSecurityPolicy bị TẮT HOÀN TOÀN để không chặn iframe/img/
// video nhúng từ URL trong bài viết — nghĩa là dù lỗ hổng SSR có được vá,
// vẫn không có lớp phòng thủ thứ hai nào chặn inline script nếu 1 vector XSS
// khác (chưa biết) xuất hiện sau này. Bật lại CSP với nonce riêng cho mỗi
// request: 2 khối <script>/<style> hợp lệ trong post.ejs/blog.ejs được gắn
// nonce đó (xem res.locals.cspNonce, dùng trong routes/ssr.routes.js), còn
// mọi inline script khác (kể cả bị chèn qua XSS) sẽ bị trình duyệt chặn vì
// không có nonce đúng. img/video/iframe nhúng từ URL ngoài vẫn hoạt động
// bình thường vì nằm trong thẻ <img>/<video>/<iframe> của DOM thật (được
// DOMPurify lọc ở services/sanitize.service.js), không phải bị CSP chặn.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' chỉ có tác dụng fallback cho trình duyệt rất cũ
        // không hiểu nonce-source — mọi trình duyệt hiện đại sẽ BỎ QUA
        // 'unsafe-inline' ngay khi thấy có nonce hợp lệ (CSP Level 2+).
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-inline'"],
        styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-inline'"],
        // Ảnh/video bài viết là URL do người dùng dán vào (Cloudinary hoặc bất
        // kỳ host https nào) — không thể whitelist từng domain cụ thể.
        imgSrc: ["'self'", "https:", "data:"],
        mediaSrc: ["'self'", "https:"],
        // Chỉ các domain nhúng iframe đã được sanitize.service.js cho phép
        // (YouTube/Vimeo) mới thực sự còn iframe trong HTML để CSP này chạy tới.
        frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Chống Clickjacking: trang Twelve không tự cho phép bị nhúng iframe
        // ở domain khác (bổ sung cho X-Frame-Options mặc định của helmet).
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);
app.use(compression());
app.use(cookieParser(process.env.COOKIE_SECRET));

// VÁ #8 [LOW] — trước đây nếu CORS_ORIGIN rỗng khi deploy thật (lỗi thao tác
// vận hành), CORS sẽ mở cho MỌI origin (`origin: true`) kèm `credentials:
// true` — cấu hình rủi ro cao nếu vô tình xảy ra ở production. Giờ fail-fast:
// throw lỗi khởi động ngay ở production nếu thiếu CORS_ORIGIN, để lỗi cấu
// hình bị phát hiện lúc deploy thay vì sau khi đã lộ ra ngoài. Ở development
// (không có process.env.NODE_ENV=production), vẫn fallback mở toàn bộ để
// tiện chạy thử cục bộ.
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!allowedOrigins.length && process.env.NODE_ENV === "production") {
  throw new Error(
    "CORS_ORIGIN chưa được cấu hình ở production. Đặt biến môi trường CORS_ORIGIN (danh sách domain, phân cách bởi dấu phẩy) trước khi khởi động — không được để trống vì sẽ mở CORS cho mọi origin kèm credentials."
  );
}
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);

// VÁ #4 [MEDIUM] (v0.8.5) — kiểm thử v0.8.4 cho thấy CAPTCHA (Turnstile) chưa
// từng được cấu hình ở production, khiến middleware verifyCaptcha (thiết kế
// "tắt mặc định, bật khi có cấu hình" từ v0.8.3) im lặng bỏ qua hoàn toàn,
// vô hiệu hoá lớp chống đăng ký hàng loạt. Áp dụng cùng cơ chế fail-fast như
// CORS_ORIGIN ở trên: production bắt buộc phải có TURNSTILE_SECRET_KEY, nếu
// không server từ chối khởi động thay vì chạy hở mà không ai biết.
assertCaptchaConfigured();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Giới hạn tần suất request để chống spam / brute-force
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api", globalLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use("/api/auth", authLimiter);

// ==== View engine cho SSR (trang POST / BLOG) ====
app.set("views", path.join(__dirname, "src/views"));
app.set("view engine", "ejs");

// ==== Routes API ====
app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/users", require("./src/routes/users.routes"));
app.use("/api/posts", require("./src/routes/posts.routes"));
app.use("/api/blogs", require("./src/routes/blog.routes"));
app.use("/api/countries", require("./src/routes/countries.routes"));
app.use("/api/version", require("./src/routes/version.routes"));

// ==== Routes SSR (SEO) ====
app.use("/", require("./src/routes/ssr.routes"));

app.get("/health", (req, res) => res.json({ status: "ok", version: process.env.BACKEND_VERSION || "0.1.0" }));

// ==== 404 ====
app.use((req, res) => res.status(404).json({ error: "Không tìm thấy endpoint." }));

// ==== Error handler tập trung ====
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({ error: err.message || "Lỗi máy chủ nội bộ." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Twelve backend đang chạy tại cổng ${PORT} (${process.env.NODE_ENV || "development"})`);
});

module.exports = app;
