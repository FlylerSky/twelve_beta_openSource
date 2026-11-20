/**
 * ==== Twelve 1.1 (0.10.24.1.191126) — BACKPORT từ 2.0.10 (F1, CRITICAL DoS) ====
 * Worker thread chạy DOMPurify+jsdom với timeout cứng 3 giây. Luồng chính KHÔNG
 * bao giờ bị chặn bởi HTML độc hại (nested table/div sâu, nhiều media, ASF…).
 * Worker này gọi hàm sanitize thuần từ sanitize.service.js — KHÔNG gọi lại
 * `sanitizeHtmlAsync` (tránh đệ quy spawn worker).
 */
const { parentPort } = require("worker_threads");
const { _sanitizeSyncInternal, _htmlToExcerptInternal } = require("./sanitize.service");

parentPort.on("message", ({ rawHtml, excerptMaxLen }) => {
  try {
    const clean = _sanitizeSyncInternal(rawHtml);
    const excerpt = _htmlToExcerptInternal(clean, excerptMaxLen);
    parentPort.postMessage({ ok: true, cleanHtml: clean, excerpt });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
