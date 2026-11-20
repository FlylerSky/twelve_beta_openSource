/**
 * ==== v2.2.1 [A-01] — lỗi của handler `async` không còn thành `unhandledRejection` ====
 * Express 4 KHÔNG bắt Promise bị reject của handler `async`: lỗi rơi ra ngoài thành `unhandledRejection`, và (trước 2.2.1) server.js
 * gọi `process.exit(1)` cho mọi `unhandledRejection` => MỘT request lỗi (không cần đăng nhập) đủ làm sập cả tiến trình.
 *
 * Giải pháp: chuyển mọi Promise bị reject của handler/middleware sang `next(err)` — tức vào error handler tập trung ở server.js
 * (trả 500 chung, log đầy đủ). Làm ở một chỗ (Layer của Express) thay vì bọc từng handler, nên route thêm sau này cũng được che.
 * Đây chính là cách gói `express-async-errors` làm, viết gọn tại chỗ để khỏi thêm dependency. Express 5 tự làm việc này: ở đó hàm là no-op.
 *
 * Lưu ý: handler `async` vẫn nên tự try/catch để trả đúng mã lỗi/thông điệp; lớp này là LƯỚI AN TOÀN cuối cùng.
 */
function installAsyncErrorForwarding() {
  let Layer;
  let major;
  try {
    major = parseInt(require("express/package.json").version, 10);
    if (major >= 5) return false;
    Layer = require("express/lib/router/layer");
  } catch (_e) {
    return false; // cấu trúc Express khác dự kiến: không đụng vào, server.js vẫn có lớp bảo vệ rejection-guard bên dưới
  }
  if (!Layer || !Layer.prototype || typeof Layer.prototype.handle_request !== "function") return false;
  if (Layer.prototype.__twelveAsyncPatched) return true;

  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // error-handling middleware: bỏ qua như bản gốc
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.then(undefined, next);
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__twelveAsyncPatched = true;
  return true;
}

/**
 * Bộ đếm `unhandledRejection`: KHÔNG thoát ở lần đầu (một lỗi đơn lẻ — vd. từ tác vụ nền — không đáng làm chết dịch vụ),
 * nhưng nếu dồn dập (> `limit` lần trong `windowMs`) thì coi là tiến trình đã hỏng ngầm và thoát để process manager (Render) khởi động lại sạch.
 * `onExceed` mặc định là `process.exit(1)`; tách ra để test được.
 */
function createRejectionGuard({ limit = 10, windowMs = 60 * 1000, onExceed = () => process.exit(1), log = console.error, now = Date.now } = {}) {
  let hits = [];
  return function onUnhandledRejection(reason) {
    const t = now();
    hits = hits.filter((x) => t - x < windowMs);
    hits.push(t);
    log(`unhandledRejection (${hits.length}/${limit} trong ${Math.round(windowMs / 1000)}s) — tiến trình vẫn chạy:`, reason);
    if (hits.length > limit) {
      log("unhandledRejection dồn dập vượt ngưỡng — thoát để process manager khởi động lại.");
      onExceed();
    }
  };
}

module.exports = { installAsyncErrorForwarding, createRejectionGuard };
