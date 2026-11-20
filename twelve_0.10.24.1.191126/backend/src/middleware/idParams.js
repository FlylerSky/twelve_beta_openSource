/**
 * ==== Twelve 1.1 (0.10.24.1.191126) — BACKPORT từ 2.2.1 (A-01, HIGH) ====
 * LỖ HỔNG gốc ở 0.10.24: route `:uid`/`:id`/`:commentId` truyền thẳng giá trị
 * người dùng gửi vào `db.collection(...).doc(req.params.uid)`. Id chứa `/`
 * (vd `a%2Fb`) hoặc `..` / `__x__` khiến Firestore SDK ném exception trong
 * handler async → lọt thành unhandledRejection → tiến trình SẬP (DoS một
 * request, không cần đăng nhập).
 *
 * Vá 3 lớp (đúng 2.2.1):
 *   1. `isSafeDocId` + `router.param` — id lạ trả 404 NGAY, không bao giờ tới Firestore.
 *   2. `wrapAsync` (utils/asyncErrors.js) — mọi handler async reject → error handler.
 *   3. `unhandledRejection` không thoát ngay (server.js) — chỉ thoát khi dồn dập.
 *
 * Uid Firebase Auth / id Firestore tự sinh đều khớp `[A-Za-z0-9_-]{1,128}`.
 * Id di trú từ Twelve cũ dùng đúng uid Auth (đã đọc migrate-legacy-data.js).
 */

const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeDocId(id) {
  if (typeof id !== "string") return false;
  if (!SAFE_DOC_ID.test(id)) return false;
  if (id.startsWith("__") && id.endsWith("__")) return false; // tài liệu đặc biệt Firestore
  if (id === "." || id === "..") return false;
  return true;
}

/**
 * Gắn vào từng route file:
 *   const { attachIdGuards } = require("../middleware/idParams");
 *   attachIdGuards(router, ["uid", "id", "commentId"]);
 * Id lạ → response 404 và dừng (không gọi next, không tới handler/controller).
 */
function attachIdGuards(router, paramNames) {
  for (const name of paramNames) {
    router.param(name, (req, res, next, val) => {
      if (!isSafeDocId(val)) {
        return res.status(404).json({ error: "Không tìm thấy tài nguyên." });
      }
      next();
    });
  }
}

module.exports = { isSafeDocId, attachIdGuards };
