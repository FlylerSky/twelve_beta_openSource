/**
 * ==== v1.1 [BẢO MẬT F7/F8/F9/F11/A-01] — chuẩn hoá & kiểm tra đầu vào dùng chung ====
 * (Vá chuyển từ Twelve 2.0.10 / 2.2.1; xem SECURITY-PORT-1.1.md.)
 */

/** limit từ query: số nguyên >= 1, kẹp tối đa `max`; sai kiểu / âm / NaN => mặc định (trước đây `limit=-5` làm Firestore ném lỗi => 500). */
function parseLimit(raw, def, max) {
  if (typeof raw !== "string" && typeof raw !== "number") return def;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
}

/**
 * cursor (id tài liệu) từ query. Trả { ok:true, value:string|null } hoặc { ok:false }.
 * `?cursor[]=a` / `?cursor[x]=1` (mảng/đối tượng) hoặc chứa "/" làm `.doc()` ném lỗi => trước đây 500.
 */
function parseCursor(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || raw.length > 128 || raw.includes("/") || raw === "." || raw === "..") return { ok: false };
  return { ok: true, value: raw };
}

// Ký tự điều khiển bidi + ký tự rộng-0 thường bị lợi dụng để giả mạo tên/nội dung hiển thị.
const BIDI_AND_INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
// Ký tự "trống" nhìn như khoảng trắng nhưng không bị trim: Braille blank, Hangul filler…
const BLANK_LOOKALIKES = /[\u2800\u3164\uFFA0\u115F\u1160\u17B4\u17B5\u180E]/g;

/**
 * Văn bản tự do (tiêu đề, bình luận): bỏ ký tự bidi/rộng-0 nhưng GIỮ ZWJ/ZWNJ (U+200D/U+200C) để emoji ghép
 * (👨‍👩‍👧) vẫn hiển thị đúng.
 */
function stripBidiAndInvisible(str) {
  return String(str).replace(BIDI_AND_INVISIBLE, "");
}

/**
 * Tên hiển thị / họ tên: chuẩn hoá NFC, bỏ MỌI ký tự điều khiển (\p{Cc}), định dạng (\p{Cf}: bidi, rộng-0, ZWJ…),
 * dấu phân tách dòng/đoạn (\p{Zl}\p{Zp}), vùng dùng riêng (\p{Co}) và ký tự "trống" giả; gộp khoảng trắng; trim.
 * Lưu ý: bỏ cả ZWJ nên emoji ghép tách thành các emoji đơn trong tên hiển thị (chấp nhận được).
 */
function cleanDisplayText(str) {
  return String(str)
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}]/gu, " ")
    .replace(BLANK_LOOKALIKES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ngày YYYY-MM-DD nghiêm ngặt (F9): đúng định dạng, đúng lịch (không có 2023-02-31), từ 1900-01-01 đến hôm nay (UTC).
 * Trả { ok:true, value } hoặc { ok:false, error }.
 */
function validateBirthday(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: "Ngày sinh không hợp lệ (định dạng YYYY-MM-DD)." };
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return { ok: false, error: "Ngày sinh không tồn tại trong lịch." };
  }
  if (value < "1900-01-01") return { ok: false, error: "Ngày sinh không hợp lệ." };
  if (value > now.toISOString().slice(0, 10)) return { ok: false, error: "Ngày sinh không được ở tương lai." };
  return { ok: true, value };
}

/**
 * Nhận diện ảnh bằng "magic bytes" của CHÍNH Twelve (JPEG/PNG/WebP) — chạy TRƯỚC mọi thư viện phân tích file.
 * v2.0.10 [BẢO MẬT F11]: `file-type@<=21.3.0` bị lặp vô hạn với file ASF dị dạng (header + sub-header kích thước 0) và
 * chạy trên chính buffer do người dùng tải lên => một request làm treo cả tiến trình. Nay thư viện chỉ thấy các buffer
 * đã mở đầu bằng chữ ký ảnh hợp lệ, nên đầu vào kiểu ASF/MP4/… không bao giờ tới được bộ phân tích của nó.
 * Trả về mime ("image/jpeg" | "image/png" | "image/webp") hoặc null.
 */
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}


/**
 * ==== v2.2.1 [A-01] — id tài liệu lấy từ URL/tham số ====
 * Express giải mã `%2F` thành "/" rồi đưa thẳng vào `db.collection(...).doc(id)`: SDK Firestore NÉM LỖI ĐỒNG BỘ khi id có dạng "a/b"
 * (đường dẫn lẻ), còn "a/b/c" thì lại hợp lệ và trỏ vào tài liệu LỒNG NHAU (vd `users/a/b/c`) — cả hai đều không được phép tới được Firestore.
 * uid Firebase / id tự sinh của Firestore chỉ gồm chữ-số, "_" và "-". Id dạng `__ten__` là id dành riêng của Firestore (máy chủ từ chối).
 */
const SAFE_DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED_DOC_ID_RE = /^__.*__$/;
function isSafeDocId(value) {
  return typeof value === "string" && SAFE_DOC_ID_RE.test(value) && !RESERVED_DOC_ID_RE.test(value);
}

module.exports = { isSafeDocId, sniffImageMime, parseLimit, parseCursor, stripBidiAndInvisible, cleanDisplayText, validateBirthday };
