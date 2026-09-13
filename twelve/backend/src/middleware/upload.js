const multer = require("multer");

// Lưu file tạm trong bộ nhớ rồi đẩy thẳng lên Cloudinary (không ghi ra ổ đĩa)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB, đủ cho avatar
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Chỉ chấp nhận file ảnh cho avatar."));
    }
    cb(null, true);
  },
});

module.exports = upload;
