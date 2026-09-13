const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/users.controller");
const { requireAuth, requireAuthAllowPending } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { updateMeValidators, handleValidation } = require("../middleware/validators");

// GET /me là endpoint DUY NHẤT còn lại (ngoài /auth/activation/sync) được phép
// dùng requireAuthAllowPending: tài khoản pending cần đọc được chính hồ sơ của
// mình (biết status pending/active) thì mới có thể tự hoàn tất kích hoạt.
// Đây là thao tác ĐỌC dữ liệu của chính chủ, không ảnh hưởng người khác.
router.get("/me", requireAuthAllowPending, ctrl.getMe);

// Mọi thao tác GHI hồ sơ (đổi tên, avatar...) đều bắt buộc tài khoản active —
// requireAuth mặc định giờ đã enforce điều đó.
router.patch("/me", requireAuth, updateMeValidators, handleValidation, ctrl.updateMe);

// Wrapper để bắt lỗi multer (file quá lớn / sai MIME) và trả JSON rõ ràng
function avatarUpload(req, res, next) {
  upload.single("avatar")(req, res, (err) => {
    if (err) {
      console.error("Multer avatar error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Ảnh quá lớn (tối đa 10MB)." });
      }
      return res.status(400).json({ error: err.message || "File ảnh không hợp lệ." });
    }
    next();
  });
}

router.post("/me/avatar", requireAuth, avatarUpload, ctrl.uploadAvatar);
router.get("/:uid", ctrl.getPublicProfile);

module.exports = router;
