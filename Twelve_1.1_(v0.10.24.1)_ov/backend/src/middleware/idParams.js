const { isSafeDocId } = require("../utils/input");

/**
 * ==== v2.2.1 [A-01] — chặn id không hợp lệ NGAY Ở TẦNG ROUTE ====
 * Dùng với `router.param("id", idParam())`: mọi route có tham số đó đều được kiểm tra MỘT NƠI, trước cả limiter/controller,
 * nên thêm route mới có `:id`/`:uid`/`:commentId` thì tự được bảo vệ. Id sai => 404 (như thể không tồn tại), không bao giờ tới Firestore.
 */
function idParam(message = "Không tìm thấy.") {
  return function validateIdParam(req, res, next, value) {
    if (isSafeDocId(value)) return next();
    return res.status(404).json({ error: message });
  };
}

module.exports = { idParam };
