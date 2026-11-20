// v2.0.10 [BẢO MẬT F1] — chạy sanitize HTML (DOMPurify + JSDOM) ở LUỒNG RIÊNG.
// Vì sanitize là hàm đồng bộ tốn CPU, nếu chạy ở luồng chính thì một đầu vào độc hại làm treo cả server.
// Ở luồng riêng, luồng chính có thể `terminate()` worker khi quá hạn (xem contentPipeline.js).
const { parentPort } = require("worker_threads");
const svc = require("./sanitize.service");

parentPort.postMessage({ type: "ready" });

parentPort.on("message", (msg) => {
  const { id, html, config } = msg;
  try {
    svc.setEmbedDomainsConfig(config); // cấu hình domain nhúng của luồng chính (SA có thể đổi lúc chạy)
    const clean = svc.sanitizeHtml(html);
    parentPort.postMessage({ type: "result", id, ok: true, html: clean, excerpt: svc.htmlToExcerpt(clean) });
  } catch (err) {
    parentPort.postMessage({ type: "result", id, ok: false, error: String((err && err.message) || err) });
  }
});
