require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { assertCaptchaConfigured } = require("./src/middleware/captcha");
const { getFrameSrcCspSources, setEmbedDomainsConfig, DEFAULT_EMBED_DOMAINS } = require("./src/services/sanitize.service");
const { db } = require("./src/config/firebase");
const { COLLECTIONS } = require("./src/utils/constants");
const pkg = require("./package.json");

const app = express();

// ==== VÁ #2 [HIGH] — Defense in depth cho DoS qua multer (v0.8.3) ====
// Bản vá gốc là nâng multer lên ^2.0.2 (xem package.json — các CVE
// 2025-47944/7338/47935/48997 đều nằm ở multer@1.x). Lớp này chỉ là phòng
// thủ bổ sung: nếu có bất kỳ exception nào (kể cả từ 1 dependency khác)
// thoát khỏi mọi try/catch và middleware xử lý lỗi tập trung của Express,
// tiến trình sẽ log rõ nguyên nhân rồi thoát có kiểm soát (exit code 1) để
// process manager (Render/pm2) tự khởi động lại — thay vì để tiến trình ở
// trạng thái treo/hỏng ngầm mà vẫn "sống", ảnh hưởng người dùng khác.
// ==== Twelve 1.1 — BACKPORT A-01 (2.2.1): unhandledRejection KHÔNG thoát ngay ====
// Ở 0.10.24 một rejection lọt ra ngoài (vd id lạ làm Firestore SDK ném trong
// handler async) làm tiến trình THOẤT ngay → DoS một request. Giờ chỉ thoát
// khi dồn dập (>10 lần / 60 giây); rejection đơn lẻ được log và tiến trình
// tiếp tục phục vụ. `uncaughtException` vẫn thoát ngay (trạng thái không an toàn).
process.on("uncaughtException", (err) => {
  console.error("uncaughtException — tiến trình sẽ thoát để process manager khởi động lại:", err);
  process.exit(1);
});
let rejectionTimestamps = [];
const REJECTION_LIMIT = 10;
const REJECTION_WINDOW_MS = 60 * 1000;
process.on("unhandledRejection", (reason) => {
  const now = Date.now();
  rejectionTimestamps = rejectionTimestamps.filter((t) => now - t < REJECTION_WINDOW_MS);
  rejectionTimestamps.push(now);
  console.error(`unhandledRejection (${rejectionTimestamps.length}/${REJECTION_LIMIT} trong 60s):`, reason);
  if (rejectionTimestamps.length > REJECTION_LIMIT) {
    console.error("Quá nhiều unhandledRejection dồn dập — thoát để process manager khởi động lại.");
    process.exit(1);
  }
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
        // mới thực sự còn iframe trong HTML để CSP này chạy tới.
        // v0.10.15: danh sách domain giờ QUẢN LÝ ĐƯỢC bởi SA (tab Quản trị),
        // không còn hardcode — nguồn CSP được SINH ĐỘNG mỗi request từ đúng
        // state `sanitize.service.js` đang dùng (giống cách nonce ở trên
        // cũng là 1 hàm được gọi lại mỗi request), luôn khớp với
        // `isAllowedIframeSrc()` mà KHÔNG cần sửa/deploy lại 2 nơi khi SA
        // đổi danh sách — xem sanitize.service.js#getFrameSrcCspSources.
        frameSrc: ["'self'", (req, res) => getFrameSrcCspSources().join(" ")],
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
// Twelve 1.1 — BACKPORT N2 (2.0.12): gỡ cookie-parser. Twelve dùng Bearer token,
// không có req.cookies/res.cookie nào — giữ lại chỉ tăng bề mặt tấn công vô ích.
// Biến COOKIE_SECRET không còn được dùng (bỏ khỏi .env ở lần deploy tới).

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

// v0.8.20 [BẢO MẬT]: SHARE_LINK_SECRET dùng để ký link share (chống giả mạo
// sharerUid — xem utils/helpers.js#signShareParams). Thiếu ở production
// không tạo lỗ hổng mới (thiếu secret -> mọi chữ ký đều fail-closed, không
// ai được ghi công +8) nhưng ÂM THẦM vô hiệu hoá toàn bộ tính năng ghi công
// người share — fail-fast ngay lúc khởi động để phát hiện sớm thay vì phải
// tự dò tại sao positiveScore không bao giờ cộng cho ai.
if (!process.env.SHARE_LINK_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "SHARE_LINK_SECRET chưa được cấu hình ở production. Đặt biến môi trường SHARE_LINK_SECRET (chuỗi ngẫu nhiên dài, ví dụ: openssl rand -hex 32) trước khi khởi động — thiếu biến này không gây lỗ hổng bảo mật, nhưng sẽ khiến toàn bộ link share mất khả năng ghi công positiveScore cho người share."
  );
}
// Twelve 1.1 — BACKPORT TW-22 (2.5.3): bỏ `credentials: true`. Twelve không gửi
// cookie (Bearer token) nên không cần; bật lên chỉ mở vector CSRF cho trình duyệt.
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
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
app.use("/api/trending", require("./src/routes/trending.routes"));
app.use("/api/admin", require("./src/routes/admin.routes"));

// v0.10.10 — API root/discovery map (tiếng Anh, xem giải thích trong
// controllers/apiInfo.controller.js). Đăng ký TRƯỚC "app.use('/', ssrRoutes)"
// bên dưới để khớp đúng path "/" tuyệt đối — ssrRoutes chỉ có "/post/:id" và
// "/blog/:id" nên thứ tự này không tranh chấp route nào khác.
app.get("/", require("./src/controllers/apiInfo.controller").getApiRoot);

// ==== Routes SSR (SEO) ====
app.use("/", require("./src/routes/ssr.routes"));

// v0.10.12: fallback đổi từ hardcode "0.1.0" sang đọc package.json — trước
// đây nếu quên set BACKEND_VERSION trên Render, "/health" hiện version cũ
// "0.1.0" trong khi "/api/version" (đọc Firestore config/version) và "/"
// (apiInfo.controller.js, cũng fallback package.json) hiện đúng version thật
// — lệch nhau dù cả 2 đều "đúng" theo logic riêng. Không phải lỗ hổng bảo
// mật, chỉ là hiển thị sai lệch (xem báo cáo bảo mật v0.10.11, mục 6.1).
app.get("/health", (req, res) => res.json({ status: "ok", version: process.env.BACKEND_VERSION || pkg.version || "0.1.0" }));

// ==== 404 ====
// v0.10.10: message đổi sang tiếng Anh — đây là response cấp hệ thống (path
// không khớp bất kỳ route nào), không phải lỗi nghiệp vụ hiển thị cho người
// dùng thật trên UI (những lỗi đó vẫn giữ tiếng Việt, xem error handler bên
// dưới) — cùng tinh thần "giao diện API dùng tiếng Anh" ở bản đồ API tại "/".
app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));

// ==== Error handler tập trung ====
// v0.9.6 [MEDIUM]: trước đây `err.message` được trả THẲNG cho client ở MỌI
// môi trường. Với lỗi tự kiểm soát (ví dụ `res.status(400).json({error:...})`
// gọi tường minh trong controller) thì không sao, nhưng lỗi KHÔNG LƯỜNG
// TRƯỚC (exception từ Firestore/Cloudinary/thư viện thứ ba rơi xuống đây)
// có thể có `err.message` chứa đường dẫn nội bộ, tên field cấu hình, hoặc
// chi tiết hạ tầng khác. Ở production: chỉ trả message CHUNG cho lỗi không
// có `err.status` tường minh (tức không phải lỗi nghiệp vụ đã được controller
// chủ động set status) — chi tiết đầy đủ vẫn được log server-side để debug.
// Ở development: giữ nguyên hành vi cũ (trả message thật) để dễ debug local.
app.use((err, req, res, next) => {
  // Twelve 1.1 — BACKPORT A-01 (2.2.1): nếu header đã gửi (vd lỗi giữa luồng
  // stream), không gọi res.status() nữa (sẽ ném "Cannot set headers after sent").
  if (res.headersSent) return next(err);
  console.error("Unhandled error:", err);
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";
  // Lỗi có err.status tường minh (400/403/404...) là lỗi nghiệp vụ đã được
  // chủ động ném ra với message an toàn để hiển thị cho người dùng — luôn
  // trả nguyên message đó. Chỉ ẩn message của lỗi 500 không lường trước.
  const safeMessage = !isProd || (err.status && err.status < 500)
    ? err.message || "Lỗi máy chủ nội bộ."
    : "Lỗi máy chủ nội bộ. Vui lòng thử lại sau.";
  res.status(status).json({ error: safeMessage });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Twelve backend đang chạy tại cổng ${PORT} (${process.env.NODE_ENV || "development"})`);
});

/**
 * ==== v0.10.15 — nạp cấu hình domain nhúng iframe (config/embedDomains) từ
 * Firestore lúc khởi động ====
 * KHÔNG await trước `app.listen()` ở trên — state mặc định AN TOÀN đã sẵn
 * sàng ngay tại module-level của sanitize.service.js (xem giải thích ở đó)
 * nên server không cần chờ Firestore mới bắt đầu phục vụ request; hàm này
 * chạy nền, tự thay thế bằng cấu hình thật ngay khi đọc xong (thường vài
 * trăm mili-giây). Nếu đọc lỗi (mất mạng, Firestore down lúc khởi
 * động...) — KHÔNG làm crash server, chỉ log lại và tiếp tục dùng giá trị
 * mặc định (đúng hệt hành vi 0.10.14, không quét nhầm bài viết nào).
 */
(async function loadEmbedDomainsConfigOnBoot() {
  try {
    const ref = db.collection(COLLECTIONS.CONFIG).doc("embedDomains");
    const snap = await ref.get();
    if (snap.exists) {
      setEmbedDomainsConfig(snap.data());
    } else {
      // Lần đầu deploy 0.10.15 — chưa có doc, seed bằng đúng danh sách mặc
      // định (khớp 100% những gì đang cho phép ở 0.10.14).
      // [v0.10.17.8 — VÁ LỖI] Trước đây seed bằng `.map((d) => d.domain)`,
      // chỉ lấy tên domain (chuỗi) — làm mất `path`/`label`, khiến trang
      // Quản trị (đọc `d.domain`/`d.path` như object) hiển thị RỖNG cho cả
      // 7 ô dù đếm đúng số lượng. Giữ nguyên object đầy đủ khi seed.
      const seed = { enabled: true, domains: DEFAULT_EMBED_DOMAINS };
      await ref.set(seed);
      setEmbedDomainsConfig(seed);
    }
  } catch (err) {
    console.error("loadEmbedDomainsConfigOnBoot: dùng cấu hình mặc định do lỗi đọc Firestore:", err.message);
  }
})();

module.exports = app;
