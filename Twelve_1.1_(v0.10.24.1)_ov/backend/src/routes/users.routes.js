const express = require("express");
const router = express.Router();
const { idParam } = require("../middleware/idParams");

// v1.1 [A-01 — vá từ 2.2.1]: `:uid` chỉ nhận id hợp lệ — id có "/" (%2F) trước đây làm SẬP TIẾN TRÌNH (GET /api/users/a%2Fb, không cần đăng nhập). Xem middleware/idParams.js.
router.param("uid", idParam("Không tìm thấy người dùng."));

const ctrl = require("../controllers/users.controller");
const { requireAuth, requireAuthAllowPending } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { updateMeValidators, handleValidation } = require("../middleware/validators");
const { profileWriteLimiter, avatarUploadLimiter, profileReadLimiter } = require("../middleware/rateLimiters");
const { ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");

// GET /me là endpoint DUY NHẤT còn lại (ngoài /auth/activation/sync) được phép
// dùng requireAuthAllowPending: tài khoản pending cần đọc được chính hồ sơ của
// mình (biết status pending/active) thì mới có thể tự hoàn tất kích hoạt.
// Đây là thao tác ĐỌC dữ liệu của chính chủ, không ảnh hưởng người khác.
router.get("/me", requireAuthAllowPending, ctrl.getMe);

// Mọi thao tác GHI hồ sơ (đổi tên, avatar...) đều bắt buộc tài khoản active —
// requireAuth mặc định giờ đã enforce điều đó.
// v0.9.6 [HIGH]: thêm profileWriteLimiter — xem middleware/rateLimiters.js.
router.patch("/me", requireAuth, profileWriteLimiter, updateMeValidators, handleValidation, ctrl.updateMe);

// Wrapper để bắt lỗi multer (file quá lớn / sai MIME) và trả JSON rõ ràng
function avatarUpload(req, res, next) {
  upload.single("avatar")(req, res, (err) => {
    if (err) {
      console.error("Multer avatar error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        const maxMb = ASSET_LIMITS[ASSET_KIND.AVATAR].MAX_BYTES / (1024 * 1024);
        return res.status(400).json({ error: `Ảnh quá lớn (tối đa ${maxMb}MB).` });
      }
      return res.status(400).json({ error: err.message || "File ảnh không hợp lệ." });
    }
    next();
  });
}

// v0.10.20: avatarUploadLimiter đặt TRƯỚC multer để request bị chặn không tốn RAM parse file.
router.post("/me/avatar", requireAuth, profileWriteLimiter, avatarUploadLimiter, avatarUpload, ctrl.uploadAvatar);
router.get("/:uid", profileReadLimiter, ctrl.getPublicProfile);

module.exports = router;
