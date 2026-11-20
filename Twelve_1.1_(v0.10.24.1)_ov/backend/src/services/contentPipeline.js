const path = require("path");
const { Worker } = require("worker_threads");
const { CONTENT_LIMITS } = require("../utils/constants");
const sanitizeService = require("./sanitize.service");

/**
 * ==== v2.0.10 [BẢO MẬT F1/F10] — đường xử lý `contentHtml` an toàn trước DoS ====
 *
 * Vấn đề (báo cáo bảo mật Phiên 1, F1): `sanitizeHtml` (DOMPurify + JSDOM) là hàm ĐỒNG BỘ; với đầu vào có
 * nhiều thẻ không nằm trong ALLOWED_TAGS (kể cả `<table>`/`<tr>`/`<td>`…) hoặc lồng rất sâu, thời gian tăng
 * siêu tuyến tính (đã đo: 16 KB ≈ 1,5 giây; 4.000 thẻ ≈ 5 giây; 125 KB ≈ 99 giây). Trong lúc đó MỌI request
 * của MỌI người dùng đều bị treo vì chỉ có một tiến trình/event loop.
 *
 * Hai lớp phòng thủ:
 *  1. `assessHtml()` — quét O(n) RẺ, từ chối sớm đầu vào quá dài / quá nhiều phần tử / lồng quá sâu / quá nhiều
 *     thẻ không hỗ trợ (hợp lệ với mọi bài viết thật do Quill sinh ra: Quill chỉ phát ra thẻ trong ALLOWED_TAGS).
 *  2. `processContentHtml()` — chạy sanitize ở `worker_threads` với TIMEOUT CỨNG. Quá hạn thì `terminate()`
 *     worker (luồng chính không bao giờ bị chặn), trả lỗi 422 và dựng lại worker. Đây là chốt chặn cho mọi dạng
 *     đầu vào mà lớp 1 không lường trước (lớp 1 chỉ là heuristic, có thể bị lách bằng thuộc tính chứa `>`…).
 *
 * Trả về cả `excerpt` (JSDOM lần 2 cũng chạy trong worker thay vì luồng chính).
 * Đặt SANITIZE_WORKER=off để chạy tại luồng chính (chỉ cho debug/môi trường không có worker_threads).
 */

const ALLOWED = new Set([
  "p", "br", "strong", "em", "u", "s", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "video", "audio", "source", "iframe", "span", "div",
]);
const MEDIA = new Set(["img", "video", "audio", "source", "iframe"]);
const VOID = new Set(["br", "img", "source", "hr", "input", "meta", "link", "area", "base", "col", "embed", "param", "track", "wbr"]);

class ContentError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ContentError";
    this.code = code;
    this.status = status;
  }
}

/** Kiểm tra nhanh, KHÔNG dùng DOM. Trả { ok:true } hoặc { ok:false, code, message }. */
function assessHtml(raw) {
  const L = CONTENT_LIMITS;
  if (typeof raw !== "string") return { ok: false, code: "CONTENT_INVALID", message: "Nội dung bài viết không hợp lệ." };
  if (raw.length > L.HTML_MAX_CHARS) {
    return { ok: false, code: "CONTENT_TOO_LONG", message: `Nội dung quá dài (tối đa ${Math.round(L.HTML_MAX_CHARS / 1000)}.000 ký tự).` };
  }
  // Số ký tự '<' không thể né bằng thủ thuật dấu nháy trong thuộc tính.
  let lt = 0;
  for (let i = raw.indexOf("<"); i !== -1; i = raw.indexOf("<", i + 1)) lt++;
  if (lt > L.HTML_MAX_ELEMENTS * 2 + 200) {
    return { ok: false, code: "CONTENT_TOO_COMPLEX", message: "Nội dung có quá nhiều thành phần định dạng." };
  }

  let elements = 0;
  let disallowed = 0;
  let media = 0;
  let depth = 0;
  let maxDepth = 0;
  const stack = [];
  const re = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) {
        stack.length = idx;
        depth = stack.length;
      }
      continue;
    }
    elements++;
    if (!ALLOWED.has(name)) disallowed++;
    if (MEDIA.has(name)) media++;
    if (!VOID.has(name) && m[3] !== "/") {
      stack.push(name);
      depth = stack.length;
      if (depth > maxDepth) maxDepth = depth;
    }
    if (elements > L.HTML_MAX_ELEMENTS) {
      return { ok: false, code: "CONTENT_TOO_COMPLEX", message: `Nội dung có quá nhiều thành phần định dạng (tối đa ${L.HTML_MAX_ELEMENTS}).` };
    }
    if (disallowed > L.HTML_MAX_DISALLOWED) {
      return { ok: false, code: "CONTENT_TOO_COMPLEX", message: "Nội dung chứa quá nhiều thẻ định dạng không được hỗ trợ (ví dụ bảng)." };
    }
    if (media > L.HTML_MAX_MEDIA) {
      return { ok: false, code: "CONTENT_TOO_COMPLEX", message: `Nội dung chứa quá nhiều ảnh/video/âm thanh (tối đa ${L.HTML_MAX_MEDIA}).` };
    }
    if (maxDepth > L.HTML_MAX_DEPTH) {
      return { ok: false, code: "CONTENT_TOO_COMPLEX", message: "Nội dung lồng nhau quá sâu." };
    }
  }
  return { ok: true, elements, disallowed, maxDepth };
}

// ------------------------------------------------------------------ worker (một luồng, hàng đợi tuần tự)
const WORKER_FILE = path.join(__dirname, "sanitize.worker.js");
const MAX_QUEUE = 10;
const MAX_WAIT_MS = 15000; // tổng thời gian chờ (xếp hàng + chạy) tối đa cho một yêu cầu

let worker = null;
let workerReady = null; // Promise<void>
let current = null; // job đang chạy
const queue = [];
let nextId = 1;

function spawnWorker() {
  const w = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
  worker = w;
  workerReady = new Promise((resolve) => {
    const onMsg = (msg) => {
      if (msg && msg.type === "ready") {
        w.off("message", onMsg);
        resolve();
      }
    };
    w.on("message", onMsg);
  });
  w.on("message", (msg) => {
    if (!msg || msg.type !== "result" || !current || current.id !== msg.id) return;
    const job = current;
    current = null;
    clearTimeout(job.timer);
    if (msg.ok) job.resolve({ html: msg.html, excerpt: msg.excerpt });
    else job.reject(new ContentError("CONTENT_PROCESS_FAILED", 422, "Không xử lý được nội dung bài viết."));
    if (queue.length === 0 && worker) worker.unref();
    pump();
  });
  const onDead = (err) => {
    if (worker !== w) return; // worker cũ đã bị thay
    worker = null;
    workerReady = null;
    if (current) {
      const job = current;
      current = null;
      clearTimeout(job.timer);
      job.reject(new ContentError("CONTENT_PROCESS_FAILED", 422, "Không xử lý được nội dung bài viết."));
    }
    if (err) console.error("sanitize worker lỗi:", err.message || err);
    pump();
  };
  w.on("error", onDead);
  w.on("exit", () => onDead(null));
  // PHẢI gọi unref() SAU khi đã gắn mọi listener 'message' (gắn listener sẽ ref lại cổng của worker).
  // Worker rảnh không giữ tiến trình sống (test/script thoát được); khi có việc thì ref() lại — xem pump().
  w.unref();
  return w;
}

function pump() {
  if (current || queue.length === 0) return;
  const job = queue.shift();
  if (Date.now() - job.enqueuedAt > MAX_WAIT_MS) {
    job.reject(new ContentError("SERVER_BUSY", 503, "Máy chủ đang bận, vui lòng thử lại sau ít giây."));
    return pump();
  }
  if (!worker) spawnWorker();
  worker.ref(); // đang có việc: không để tiến trình thoát giữa chừng
  current = job;
  workerReady.then(() => {
    if (current !== job) return; // đã bị huỷ trong lúc worker khởi động
    // Bộ đếm giờ chỉ bắt đầu khi worker đã sẵn sàng (không tính thời gian nạp jsdom).
    job.timer = setTimeout(() => {
      if (current !== job) return;
      current = null;
      const w = worker;
      worker = null;
      workerReady = null;
      if (w) w.terminate(); // dừng cứng — luồng chính chưa từng bị chặn
      job.reject(new ContentError("CONTENT_TOO_COMPLEX", 422, "Nội dung quá phức tạp để xử lý. Hãy rút gọn hoặc bỏ bớt định dạng."));
      pump();
    }, CONTENT_LIMITS.SANITIZE_TIMEOUT_MS);
    worker.postMessage({ id: job.id, html: job.html, config: sanitizeService.getEmbedDomainsConfig() });
  });
}

function runInWorker(html) {
  return new Promise((resolve, reject) => {
    if (queue.length >= MAX_QUEUE) {
      return reject(new ContentError("SERVER_BUSY", 503, "Máy chủ đang bận, vui lòng thử lại sau ít giây."));
    }
    queue.push({ id: nextId++, html, resolve, reject, enqueuedAt: Date.now(), timer: null });
    pump();
  });
}

/**
 * Kiểm tra + sanitize + tạo excerpt. Ném ContentError (có `.status`, `.message` tiếng Việt) nếu từ chối.
 * @returns {Promise<{html:string, excerpt:string}>}
 */
async function processContentHtml(raw) {
  const verdict = assessHtml(raw);
  if (!verdict.ok) throw new ContentError(verdict.code, verdict.code === "CONTENT_INVALID" ? 400 : 422, verdict.message);
  if (!raw) return { html: "", excerpt: "" };

  if (process.env.SANITIZE_WORKER === "off") {
    const html = sanitizeService.sanitizeHtml(raw);
    return { html, excerpt: sanitizeService.htmlToExcerpt(html) };
  }
  return runInWorker(raw);
}

/** Nạp sẵn worker lúc khởi động server để request đầu tiên không phải chờ nạp jsdom. */
function warmUp() {
  if (process.env.SANITIZE_WORKER === "off" || worker) return;
  try {
    spawnWorker();
  } catch (err) {
    console.error("Không khởi tạo được sanitize worker (sẽ khởi tạo khi cần):", err.message);
  }
}

/** Dùng trong controller: nếu `err` là ContentError thì trả JSON lỗi và trả về true. */
function sendContentError(res, err) {
  if (err instanceof ContentError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

module.exports = { assessHtml, processContentHtml, warmUp, sendContentError, ContentError, __test: { ALLOWED } };
