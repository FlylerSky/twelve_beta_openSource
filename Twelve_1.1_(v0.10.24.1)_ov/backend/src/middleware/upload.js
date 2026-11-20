const multer = require("multer");
const { ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");

const AVATAR = ASSET_LIMITS[ASSET_KIND.AVATAR];

// Lưu file tạm trong bộ nhớ rồi đẩy thẳng lên Cloudinary (không ghi ra ổ đĩa)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  // v0.10.20: hạ 10MB → 2MB (frontend luôn gửi JPEG 512x512 vài trăm KB) và chỉ 1 file/request.
  // v1.1 [BẢO MẬT F2 — vá từ 2.0.10]: trước đây chỉ giới hạn `fileSize` + `files`. Busboy KHÔNG giới hạn số field text
  // (mỗi field tới 1 MB) và multipart không đi qua express.json({limit}) => một request toàn field text
  // (62 MB, không có file) vẫn được nhận và làm RSS tăng 229 MB (số đo ghi trong báo cáo Twelve 2.0.10; chưa đo lại riêng trên 0.10.24). Route avatar không cần field text nào.
  limits: {
    fileSize: AVATAR.MAX_BYTES,
    files: 1,
    fields: 5,
    fieldSize: 1024,
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
