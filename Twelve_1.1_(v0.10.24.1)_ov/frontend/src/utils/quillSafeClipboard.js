import { Quill } from "react-quill";

/**
 * ==== v2.0.11 [Báo cáo bảo mật Phiên 2 — G2] Làm sạch HTML TRƯỚC khi Quill 1.3.7 đưa vào DOM ====
 *
 * Quill 1.3.7 (bản cuối của dòng 1.x, `react-quill@2` bắt buộc dùng) thực hiện `clipboard.convert(html)` bằng cách GÁN
 * chuỗi HTML thô vào `container.innerHTML` — container nằm TRONG tài liệu. Với `<img src=x onerror=...>` thì phần tử được
 * gắn vào DOM đang hiển thị và trình duyệt thật bắt đầu tải ảnh ⇒ `onerror` có thể chạy dù Quill dọn DOM ngay sau đó
 * (đây chính là cơ chế của CVE-2021-3163). Báo cáo Phiên 2 không tái hiện được vì jsdom KHÔNG tải ảnh/không bắn sự kiện;
 * kiểm tra bằng MutationObserver (tests/quillSafeClipboard.test.jsx) cho thấy phần tử mang `on*` thực sự được gắn vào DOM.
 *
 * Vá: ghi đè `convert()` — mọi HTML dạng chuỗi (kể cả đường `dangerouslyPasteHTML` mà react-quill và nút chèn media dùng) được
 * đưa qua `DOMParser` (tài liệu "trơ": không chạy script, không tải ảnh, không bắn sự kiện) để bỏ thuộc tính `on*`/URL nguy hiểm
 * và thẻ nguy hiểm, rồi mới giao cho Quill. Hành vi với nội dung hợp lệ giữ nguyên (có test đối chiếu Delta trước/sau).
 *
 * Giới hạn: Ctrl+V gốc của trình duyệt vẫn do chính trình duyệt chèn vào container trước khi Quill đọc — trình duyệt hiện đại
 * tự lọc script/on* của HTML dán; kế hoạch trung hạn vẫn là chuyển sang Quill 2 (xem PATCH-8-NOTES).
 */

// Thẻ bị loại bỏ HOÀN TOÀN (kèm nội dung): có thể chạy mã, đổi ngữ cảnh phân tích, hoặc không có nghĩa trong bài viết.
const DROP_TAGS = new Set([
  "script", "style", "noscript", "template", "object", "embed", "applet", "base", "link", "meta",
  "svg", "math", "form", "input", "button", "textarea", "select", "option", "frame", "frameset", "title",
]);
// Thuộc tính được GIỮ (mọi thuộc tính khác — gồm toàn bộ on* — bị bỏ). Đủ cho mọi thứ Quill 1.3.7 + blot của Twelve đọc.
const KEEP_ATTRS = new Set(["src", "href", "class", "style", "alt", "title", "controls", "target", "rel", "colspan", "rowspan", "data-list", "width", "height"]);
const URL_ATTRS = new Set(["src", "href"]);
const UNSAFE_URL = /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i;

/**
 * v2.5.3 [TW-19] — `style` khi dán KHÔNG còn giữ nguyên văn. Trước đó `style` nằm trong KEEP_ATTRS và đi vào trình soạn thảo nguyên văn (CSS injection trong khung soạn thảo — không chạy JS,
 * nhưng `position:fixed; inset:0; background:url(…)` phủ lên giao diện/gọi tài nguyên ngoài). Nay chỉ giữ các cặp thuộc tính có trong allowlist của backend (`sanitize.service.js#ALLOWED_STYLE_PROPS`)
 * với giá trị chỉ gồm ký tự vô hại và không có hàm nguy hiểm. Đây là bộ lọc THẬN TRỌNG phía trình duyệt; backend vẫn là nơi quyết định khi lưu (kiểm khoảng số, màu trong suốt…).
 */
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "text-align", "font-weight", "font-style", "text-decoration",
  "font-size", "line-height", "padding-left", "padding-right", "margin-left", "margin-right",
]);
const SAFE_STYLE_VALUE = /^[a-zA-Z0-9#%.,\-\s()]*$/;
const DANGEROUS_STYLE_FN = /(?:url|expression|image|image-set|var|calc|attr|env|element|paint)\s*\(/i;

export function sanitizeStyleForPaste(value) {
  if (typeof value !== "string" || !value) return "";
  const kept = [];
  for (const decl of value.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !val || !SAFE_STYLE_VALUE.test(val) || DANGEROUS_STYLE_FN.test(val) || /!\s*important/i.test(val)) continue;
    kept.push(`${prop}:${val}`);
  }
  return kept.join(";");
}

/** Trả về HTML đã làm sạch (chuỗi). Không bao giờ ném lỗi: nếu DOMParser không có thì trả chuỗi rỗng an toàn. */
export function sanitizePasteHtml(html) {
  if (typeof html !== "string" || !html) return "";
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    for (const child of Array.from(node.children)) {
      if (DROP_TAGS.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!KEEP_ATTRS.has(name) || (URL_ATTRS.has(name) && UNSAFE_URL.test(attr.value.replace(/[\u0000-\u0020]/g, "")))) {
          child.removeAttribute(attr.name);
        } else if (name === "style") {
          const safe = sanitizeStyleForPaste(attr.value);
          if (safe) child.setAttribute("style", safe);
          else child.removeAttribute("style");
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const Clipboard = Quill.import("modules/clipboard");

export class SafeClipboard extends Clipboard {
  convert(html) {
    // Quill chỉ gán vào innerHTML khi `html` là chuỗi; không-chuỗi nghĩa là "đọc nội dung container hiện có".
    return super.convert(typeof html === "string" ? sanitizePasteHtml(html) : html);
  }
}

Quill.register("modules/clipboard", SafeClipboard, true);
