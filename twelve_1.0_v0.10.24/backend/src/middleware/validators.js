/**
 * ==== VÁ #7 [LOW] — Thiếu validate định dạng cho các trường hồ sơ (v0.8.3) ====
 *
 * Trước đây `displayName`, `fullName`, `birthday`, `gender`, `country` chỉ
 * được kiểm tra "có tồn tại" (`!== undefined` / truthy), không kiểm tra định
 * dạng, độ dài tối đa, hay việc `country` có thuộc danh sách quốc gia hợp lệ
 * hay không — package `express-validator` đã có sẵn trong package.json
 * nhưng chưa được dùng ở đâu cả. File này tập trung toàn bộ validate hồ sơ
 * người dùng vào 1 nơi, dùng lại được cho cả `register` và `updateMe`.
 */
const { body, query, validationResult } = require("express-validator");
const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

const GENDER_VALUES = ["male", "female", "other"];

/**
 * Middleware dùng chung: đọc kết quả validate (do các validator chain ở dưới
 * gắn vào `req`) và trả 400 kèm thông báo lỗi ĐẦU TIÊN nếu có, nếu không thì
 * đi tiếp sang controller.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, fields: errors.array().map((e) => e.path) });
  }
  return next();
}

// Country hợp lệ = có tồn tại trong collection `countries` (đối chiếu thay vì
// chỉ kiểm tra "có giá trị") — collection này khá nhỏ (~13 quốc gia hiện tại)
// nên 1 lượt đọc doc theo id là đủ rẻ để chạy mỗi lần đăng ký/cập nhật hồ sơ.
//
// Lưu ý: đây là kiểm tra CHẤT LƯỢNG DỮ LIỆU (mức LOW trong báo cáo), không
// phải kiểm tra bảo mật — nếu Firestore tạm thời lỗi/timeout, KHÔNG được để
// lộ chi tiết lỗi hạ tầng ra ngoài qua message validate, và KHÔNG nên chặn
// toàn bộ luồng đăng ký chỉ vì 1 request phụ trợ này gặp sự cố tạm thời.
// Vì vậy khi có lỗi đọc Firestore, coi như "không xác minh được" -> cho qua
// (fail-open), chỉ log lỗi để theo dõi.
async function isKnownCountryCode(code) {
  if (typeof code !== "string" || !code.trim()) return false;
  try {
    const snap = await db.collection(COLLECTIONS.COUNTRIES).doc(code.trim().toUpperCase()).get();
    return snap.exists;
  } catch (err) {
    console.error("isKnownCountryCode: lỗi đọc Firestore, fail-open:", err.message);
    return true;
  }
}

const fullNameField = () =>
  body("fullName").trim().isLength({ min: 1, max: 100 }).withMessage("Họ và tên phải từ 1-100 ký tự.");

const displayNameField = () =>
  body("displayName").trim().isLength({ min: 1, max: 50 }).withMessage("Tên hiển thị phải từ 1-50 ký tự.");

const birthdayField = () =>
  body("birthday")
    .isISO8601()
    .withMessage("Ngày sinh không hợp lệ (định dạng YYYY-MM-DD).")
    .bail()
    .custom((value) => {
      const date = new Date(value);
      const now = new Date();
      const minDate = new Date("1900-01-01");
      if (date > now) throw new Error("Ngày sinh không được ở tương lai.");
      if (date < minDate) throw new Error("Ngày sinh không hợp lệ.");
      return true;
    });

const genderField = () =>
  body("gender").isIn(GENDER_VALUES).withMessage(`Giới tính phải là một trong: ${GENDER_VALUES.join(", ")}.`);

const countryField = () =>
  body("country")
    .trim()
    .isLength({ min: 1, max: 10 })
    .withMessage("Mã quốc gia không hợp lệ.")
    .bail()
    .custom(async (value) => {
      if (!(await isKnownCountryCode(value))) {
        throw new Error("Quốc gia không nằm trong danh sách hỗ trợ.");
      }
      return true;
    });

const emailField = () => body("email").trim().isEmail().withMessage("Email không hợp lệ.").normalizeEmail();

// v0.10.18 [báo cáo bảo mật L-3]: nâng tối thiểu 6 -> 8 ký tự. CHỈ áp dụng
// khi ĐĂNG KÝ mới — đăng nhập đi thẳng Firebase (không qua validator này) nên
// tài khoản cũ có mật khẩu 6–7 ký tự vẫn đăng nhập bình thường.
const passwordField = () =>
  body("password").isLength({ min: 8, max: 128 }).withMessage("Mật khẩu phải có ít nhất 8 ký tự.");

// POST /api/auth/register — mọi field đều bắt buộc (giữ nguyên hành vi cũ:
// controller vẫn tự kiểm tra "đủ field" trước khi tới đây, các validator này
// bổ sung phần ĐỊNH DẠNG/ĐỘ DÀI mà trước đây hoàn toàn bỏ trống).
const registerValidators = [
  fullNameField(),
  displayNameField(),
  // tagName giữ nguyên validate riêng ở helpers.js#isValidTagName (dùng cả ở
  // register lẫn check-tagname) — không lặp lại logic ở đây.
  birthdayField(),
  genderField(),
  countryField(),
  emailField(),
  passwordField(),
];

const checkTagNameValidators = [
  query("tag").optional().isString().isLength({ max: 20 }),
];

// PATCH /api/users/me — mọi field đều optional (chỉ validate field nào có mặt
// trong body, giữ đúng hành vi "cập nhật từng phần" hiện tại). Mỗi field
// dùng 1 CHAIN MỚI (gọi lại factory) — KHÔNG tái sử dụng chain đã build ở
// registerValidators, vì ValidationChain là đối tượng mutable: gọi
// `.optional()` trên 1 chain đã tồn tại sẽ làm rò rỉ trạng thái sang mọi nơi
// khác đang dùng chung chain đó (kể cả registerValidators ở trên).
const updateMeValidators = [
  displayNameField().optional(),
  fullNameField().optional(),
  birthdayField().optional(),
  genderField().optional(),
  countryField().optional(),
];

module.exports = {
  handleValidation,
  registerValidators,
  checkTagNameValidators,
  updateMeValidators,
};
