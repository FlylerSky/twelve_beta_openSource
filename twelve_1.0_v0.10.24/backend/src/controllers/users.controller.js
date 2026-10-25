const { db } = require("../config/firebase");
const cloudinary = require("../config/cloudinary");
const assets = require("../services/assets.service");
const { COLLECTIONS, ASSET_KIND, ASSET_LIMITS } = require("../utils/constants");
const { avatarPublicId } = require("../utils/cloudinaryUrl");
const { toPublicUser, syncAccountScore } = require("../utils/helpers");

// GET /api/users/me
async function getMe(req, res) {
  // v0.8.23: đối soát accountScore = postsScoreSum + positiveScore mỗi khi
  // user truy cập/tải hồ sơ của chính mình — đúng điều kiện trigger "đăng
  // nhập/truy cập Twelve" (xem utils/helpers.js#syncAccountScore).
  const user = syncAccountScore(db, req.authUid, req.authUser);
  return res.json({ user });
}

// GET /api/users/:uid  (thông tin công khai)
async function getPublicProfile(req, res) {
  const snap = await db.collection(COLLECTIONS.USERS).doc(req.params.uid).get();
  if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy người dùng." });
  return res.json({ user: toPublicUser(snap.data()) });
}

/**
 * PATCH /api/users/me
 * Dùng cho màn hình "Chào mừng & Setup tài khoản" khi đăng nhập lần đầu, và
 * cho việc chỉnh sửa hồ sơ sau này. KHÔNG cho phép đổi email/password ở đây.
 * body: { displayName?, fullName?, birthday?, gender?, country? }
 */
async function updateMe(req, res) {
  try {
    const allowedFields = ["displayName", "fullName", "birthday", "gender", "country"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Không có dữ liệu để cập nhật." });
    }

    await db.collection(COLLECTIONS.USERS).doc(req.authUid).update(updates);

    // Nếu đây là setup lần đầu, đánh dấu đã hoàn tất
    if (req.authUser.isFirstLogin) {
      await db.collection(COLLECTIONS.USERS).doc(req.authUid).update({ isFirstLogin: false });
    }

    return res.json({ message: "Cập nhật hồ sơ thành công." });
  } catch (err) {
    console.error("updateMe error:", err);
    return res.status(500).json({ error: "Cập nhật thất bại." });
  }
}

/**
 * POST /api/users/me/avatar
 * multipart/form-data, field "avatar". Ảnh nên được crop 1:1 ở frontend trước khi upload.
 *
 * Lưu ý: không dùng streamifier.from() — API đúng là createReadStream(),
 * hoặc đơn giản hơn là uploadStream.end(buffer) (không cần streamifier).
 */
async function uploadAvatar(req, res) {
  try {
    const { cloud_name, api_key, api_secret } = cloudinary.config();
    if (!cloud_name || !api_key || !api_secret) {
      console.error(
        "uploadAvatar: Cloudinary chưa được cấu hình đầy đủ (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)."
      );
      return res.status(503).json({
        error:
          "Máy chủ chưa cấu hình Cloudinary. Vui lòng kiểm tra biến môi trường CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET trên Render.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Chưa chọn file ảnh hoặc file không hợp lệ." });
    }
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "File ảnh rỗng, vui lòng chọn ảnh khác." });
    }

    // ==== VÁ #6 [LOW] — Kiểm tra file upload chỉ dựa vào mimetype (v0.8.3) ====
    // `middleware/upload.js` trước đây chỉ kiểm tra `file.mimetype` — giá trị
    // này do CLIENT tự khai báo trong header multipart, không phải điều
    // server xác minh từ nội dung file thật. Đổi Content-Type là qua được
    // filter đó dù file thực chất không phải ảnh. Ở đây đọc "magic bytes"
    // (vài byte đầu file) bằng `file-type` để xác định định dạng THẬT trước
    // khi đẩy lên Cloudinary — chỉ có thể làm ở bước này (không thể làm
    // trong `fileFilter` của multer vì buffer chưa đọc xong lúc đó).
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(req.file.buffer);
    // v0.10.20: danh sách cho phép lấy từ ASSET_LIMITS (bỏ GIF/AVIF — xem utils/constants.js).
    const ALLOWED_IMAGE_MIMES = new Set(ASSET_LIMITS[ASSET_KIND.AVATAR].ALLOWED_MIMES);
    if (!detected || !ALLOWED_IMAGE_MIMES.has(detected.mime)) {
      return res.status(400).json({
        error: "File không phải ảnh hợp lệ (nội dung file không khớp định dạng ảnh được hỗ trợ).",
      });
    }

    // v0.10.20: public_id CỐ ĐỊNH + overwrite (xem services/assets.service.js) — mỗi
    // user luôn chỉ có 1 avatar trên Cloudinary, đổi avatar không còn sinh ảnh mồ côi.
    const previousUrl = req.authUser?.avatarUrl || null;
    const uploadResult = await assets.putAvatar(req.authUid, req.file.buffer);

    if (!uploadResult?.secure_url) {
      console.error("Cloudinary trả về không có secure_url:", uploadResult);
      return res.status(500).json({ error: "Cloudinary không trả về URL ảnh." });
    }

    // Ghi user.avatarUrl + sổ `assets` trong 1 batch. Nếu bước này lỗi, ảnh trên
    // Cloudinary vẫn chỉ là 1 asset cố định của user (lần upload sau sẽ ghi đè) → không rò rỉ thêm.
    await assets.commitAvatarRecord(req.authUid, uploadResult);

    // Dọn lười asset avatar KIỂU CŨ (public_id ngẫu nhiên) của chính user này, nếu có.
    await assets.releaseSupersededAvatar(req.authUid, previousUrl, avatarPublicId(req.authUid));

    return res.json({ avatarUrl: uploadResult.secure_url });
  } catch (err) {
    // v0.9.6 [MEDIUM]: trước đây khối catch này tự dựng message chi tiết
    // (kể cả nội dung lỗi thô từ Cloudinary — có thể chứa mảnh api_key/
    // cloud_name) rồi trả THẲNG cho client, bỏ qua hoàn toàn error handler
    // tập trung ở server.js (vốn đã được vá để ẩn chi tiết ở production).
    // Log đầy đủ server-side để debug, nhưng chỉ trả message an toàn cho
    // client ở production; giữ chi tiết ở development để tiện debug local.
    console.error("uploadAvatar error:", err);
    const detail =
      err?.message ||
      err?.error?.message ||
      (typeof err === "string" ? err : null) ||
      "Tải ảnh đại diện thất bại.";
    const isProd = process.env.NODE_ENV === "production";
    return res.status(500).json({
      error: isProd ? "Tải ảnh đại diện thất bại. Vui lòng thử lại sau." : `Tải ảnh đại diện thất bại: ${detail}`,
    });
  }
}

module.exports = { getMe, getPublicProfile, updateMe, uploadAvatar };
