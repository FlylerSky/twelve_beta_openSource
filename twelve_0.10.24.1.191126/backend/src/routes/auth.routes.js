const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/auth.controller");
const { requireAuthAllowPending } = require("../middleware/auth");
const { verifyCaptcha } = require("../middleware/captcha");
const { registerValidators, checkTagNameValidators, handleValidation } = require("../middleware/validators");

/**
 * VÁ #4 [MEDIUM] — bổ sung 2 rate-limiter RIÊNG, chặt hơn `authLimiter` chung
 * (20 req/15 phút/IP ở server.js), áp dụng đúng vào 2 endpoint dễ bị lạm dụng
 * để tạo tài khoản rác hàng loạt / dò tagname đã tồn tại:
 *   - registerLimiter: tối đa 5 lần đăng ký / giờ / IP.
 *   - tagCheckLimiter: tối đa 30 lần / 15 phút / IP (endpoint này còn được
 *     gọi tự nhiên khi người dùng gõ tagName lúc đăng ký, nên không nên siết
 *     quá thấp).
 * Đây là phòng thủ bổ sung, KHÔNG thay thế CAPTCHA (`verifyCaptcha` bên
 * dưới) — rate-limit theo IP vẫn có thể bị bypass bằng cách đổi IP.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đã thử đăng ký quá nhiều lần. Vui lòng thử lại sau." },
});
const tagCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đã kiểm tra Tag Name Search quá nhiều lần. Vui lòng thử lại sau." },
});

router.post("/register", registerLimiter, verifyCaptcha, registerValidators, handleValidation, ctrl.register);
router.get("/check-tagname", tagCheckLimiter, checkTagNameValidators, handleValidation, ctrl.checkTagName);

// Đồng bộ status PENDING → ACTIVE sau khi Firebase xác minh email.
// Đây là 1 trong 2 endpoint DUY NHẤT được phép dùng requireAuthAllowPending
// (tài khoản pending phải gọi được endpoint này thì mới có đường thoát khỏi
// trạng thái pending) — xem giải thích trong middleware/auth.js.
router.post("/activation/sync", requireAuthAllowPending, ctrl.syncActivation);

// Legacy endpoints (trả 410) — giữ để frontend cũ không crash, sẽ gỡ ở bản sau
router.post("/activation/send", ctrl.sendActivation);
router.post("/activation/verify", ctrl.verifyActivation);

module.exports = router;
