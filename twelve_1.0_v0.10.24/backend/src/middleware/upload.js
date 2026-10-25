const multer = require("multer");
const { ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");

const AVATAR = ASSET_LIMITS[ASSET_KIND.AVATAR];

// Lưu file tạm trong bộ nhớ rồi đẩy thẳng lên Cloudinary (không ghi ra ổ đĩa)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  // v0.10.20: hạ 10MB → 2MB (frontend luôn gửi JPEG 512x512 vài trăm KB) và chỉ 1 file/request.
  limits: { fileSize: AVATAR.MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!AVATAR.ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP cho avatar."));
    }
    cb(null, true);
  },
});

module.exports = upload;
