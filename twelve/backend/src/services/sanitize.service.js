const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

// Quill.js render ra HTML (từ Quill Delta) ở frontend rồi gửi lên; backend chỉ
// chịu trách nhiệm sanitize trước khi lưu để chống XSS, đồng thời cho phép các
// thẻ/attr mà Quill hay dùng (bao gồm iframe cho video nhúng, img cho ảnh).
const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "a", "img", "video", "iframe", "span", "div",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "style", "target", "rel",
  "width", "height", "frameborder", "allow", "allowfullscreen", "controls",
];

/**
 * ==== VÁ #3 [MEDIUM] — iframe/style tùy ý -> Clickjacking/Phishing/Tracking (v0.8.3) ====
 *
 * Cấu hình DOMPurify trước đây chặn tốt JavaScript (onerror, javascript:,
 * iframe srcdoc...) nhưng cho phép NGUYÊN VẸN `<iframe src="bất kỳ đâu">` và
 * thuộc tính `style` tuỳ ý — cho phép:
 *   - Nhúng 1 trang giả mạo full-màn-hình đè lên Twelve (position:fixed +
 *     z-index cao) -> Clickjacking/Phishing.
 *   - CSS injection kiểu `background:url(https://evil.com/beacon.png?...)`
 *     để theo dõi người xem mà không cần JavaScript.
 *
 * Khắc phục bằng 2 DOMPurify hook:
 *   1. `uponSanitizeElement`: chỉ giữ lại <iframe> nếu `src` khớp 1 domain
 *      nhúng media đã biết (YouTube/Vimeo — đúng những gì frontend thật sự hỗ
 *      trợ ở utils/media.js, xem thêm `frameSrc` trong CSP ở server.js phải
 *      khớp danh sách này). Iframe trỏ tới domain khác (kể cả "trang web bất
 *      kỳ" mà UI cũ cho phép dán) sẽ bị loại bỏ hoàn toàn thay vì giữ nguyên.
 *   2. `afterSanitizeAttributes`:
 *      - Với <iframe> còn lại: ép thêm `sandbox` (không cho phép
 *        top-navigation/popup) và `referrerpolicy` để giảm thiểu rủi ro dù
 *        domain trong whitelist bị compromise.
 *      - Với thuộc tính `style` trên MỌI thẻ: chỉ giữ lại các cặp
 *        thuộc-tính:giá-trị nằm trong danh sách trắng an toàn
 *        (`ALLOWED_STYLE_PROPS`) — chặn `position`, `z-index`, `background`
 *        (url tracking), `transform`... theo đúng nguyên tắc allowlist thay
 *        vì cố liệt kê từng thuộc tính nguy hiểm (dễ sót).
 */
const ALLOWED_IFRAME_SRC = [
  /^https:\/\/(www\.)?youtube\.com\/embed\//i,
  /^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//i,
  /^https:\/\/player\.vimeo\.com\/video\//i,
];

function isAllowedIframeSrc(src) {
  if (typeof src !== "string" || !src) return false;
  // ==== HARDENING #3 (v0.8.5, không phải lỗ hổng — cải thiện độ chính xác) ====
  // Kiểm thử v0.8.4 xác nhận payload gốc trong báo cáo bị chặn đúng. Trong
  // lúc rà soát thêm để chuẩn bị 0.8.5, phát hiện regex ^https:// bị neo chặt
  // đầu chuỗi nên 1 src YouTube/Vimeo hợp lệ nhưng có khoảng trắng thừa ở đầu
  // (trình duyệt/HTML vẫn coi là hợp lệ) sẽ bị từ chối oan (over-blocking),
  // không phải lỗ hổng bảo mật nhưng có thể khiến embed hợp lệ bị chặn nhầm.
  // trim() không mở thêm đường bypass nào vì regex vẫn neo ^https:// sau khi
  // trim — domain lạ (kể cả có khoảng trắng) vẫn bị loại như cũ.
  return ALLOWED_IFRAME_SRC.some((re) => re.test(src.trim()));
}

// Allowlist thuộc tính CSS an toàn cho phép giữ lại trong `style` — cố ý
// KHÔNG có position/top/left/right/bottom/z-index/transform/background*/
// filter/clip-path/behavior (vector Clickjacking/CSS-tracking/legacy IE).
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "text-align",
  "font-weight",
  "font-style",
  "text-decoration",
  "font-size",
  "line-height",
  "padding-left",
  "padding-right",
  "margin-left",
  "margin-right",
]);

// Giá trị chỉ được chứa các ký tự "vô hại" thường gặp trong giá trị CSS đơn
// giản (số, đơn vị, tên màu, #hex, rgb()/rgba(), khoảng trắng, dấu phẩy/chấm).
// Bất kỳ ký tự nào khác (đặc biệt "(" đi kèm "url", ";", "<", "\") đều bị loại
// — chặn luôn khả năng chèn thêm khai báo CSS khác hoặc URL bên ngoài.
const SAFE_STYLE_VALUE = /^[a-zA-Z0-9#%.,\-\s()]*$/;

function sanitizeStyleAttr(rawStyle) {
  if (!rawStyle) return "";
  const kept = [];
  for (const decl of rawStyle.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (!value || value.length > 60) continue;
    if (/url\s*\(/i.test(value)) continue; // chặn background/url tracking dù prop không nằm trong allowlist (phòng hờ)
    if (/expression\s*\(/i.test(value)) continue; // legacy IE CSS expression()
    if (!SAFE_STYLE_VALUE.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "iframe") {
    const src = node.getAttribute && node.getAttribute("src");
    if (!isAllowedIframeSrc(src)) {
      node.remove();
    }
  }
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IFRAME") {
    // Vẫn có thể chạy trước khi DOM cập nhật xong ở 1 số phiên bản — kiểm
    // tra lại src cho chắc trước khi ép thêm sandbox.
    const src = node.getAttribute("src");
    if (!isAllowedIframeSrc(src)) {
      node.remove();
      return;
    }
    node.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    node.setAttribute("referrerpolicy", "no-referrer");
    node.setAttribute("loading", "lazy");
  }

  if (node.hasAttribute && node.hasAttribute("style")) {
    const safe = sanitizeStyleAttr(node.getAttribute("style"));
    if (safe) node.setAttribute("style", safe);
    else node.removeAttribute("style");
  }
});

function sanitizeHtml(rawHtml) {
  if (!rawHtml) return "";
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

// Trích 1 đoạn plain-text ngắn từ HTML để làm excerpt / mô tả SEO
function htmlToExcerpt(rawHtml, maxLen = 160) {
  if (!rawHtml) return "";
  const dom = new JSDOM(rawHtml);
  const text = dom.window.document.body.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

module.exports = { sanitizeHtml, htmlToExcerpt };
