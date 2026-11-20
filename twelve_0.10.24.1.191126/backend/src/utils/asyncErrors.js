/**
 * ==== Twelve 1.1 (0.10.24.1.191126) — BACKPORT từ 2.2.1 (A-01) ====
 * Express 4 KHÔNG tự bắt Promise reject của handler async — một rejection lọt
 * ra ngoài thành `unhandledRejection` và (ở 0.10.24) làm tiến trình THOẮT ngay.
 * Bao mọi handler async bằng hàm này để reject luôn đi tới error handler tập
 * trung (trả 500 có kiểm soát, không sập tiến trình).
 *
 * Dùng: router.get("/path", wrapAsync(async (req,res) => { ... }))
 */
function wrapAsync(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { wrapAsync };
