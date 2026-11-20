const multer = require("multer");
const { ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");

const AVATAR = ASSET_LIMITS[ASSET_KIND.AVATAR];

// Lưu file tạm trong bộ nhớ rồi đẩy thẳng lên Cloudinary (không ghi ra ổ đĩa)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  // v0.10.20: hạ 10MB → 2MB và chỉ 1 file/request.
  // Twelve 1.1 — BACKPORT F2 (2.0.10): thêm giới hạn fields/fieldSize/parts/
  // headerPairs. Ở 0.10.24 chỉ giới hạn fileSize → kẻ tấn công gửi 62MB toàn
  // field text vẫn qua (HTTP 200, RSS +110MB). Frontend chỉ gửi đúng 1 field
  // `avatar` nên các giới hạn này không ảnh hưởng người dùng thật.
  limits: {
    fileSize: AVATAR.MAX_BYTES,
    files: 1,
    fields: 5,
    fieldSize: 1024, // 1 KB mỗi field text
    parts: 10,
    headerPairs: 50,
  },
  fileFilter: (req, file, cb) => {
    if (!AVATAR.ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP cho avatar."));
    }
    cb(null, true);
  },
});

module.exports = upload;
