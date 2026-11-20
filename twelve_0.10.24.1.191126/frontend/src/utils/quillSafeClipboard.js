/**
 * ==== Twelve 1.1 — BACKPORT từ 2.0.11 (G2) + 2.5.3 (TW-19) ====
 * Quill 1.x/2.x clipboard.convert() nhận HTML dạng chuỗi (đường
 * dangerouslyPasteHTML mà react-quill và nút chèn media dùng) và gắn thẳng vào
 * DOM thật để parse → thẻ có `onerror`/`onload` sẽ chạy ngay (self-XSS, và nếu
 * nội dung bị nhiễm từ nguồn khác → XSS thật). Ghi đè convert(): HTML chuỗi đi
 * qua DOMParser (tài liệu trơ, không chạy script) để bỏ thẻ nguy hiểm và mọi
 * thuộc tính on*, javascript:/data:text/html, rồi style đi qua bộ lọc giá trị
 * an toàn (TW-19: không giữ nguyên văn style khi dán), mới tới Quill.
 *
 * Chỉ gọi 1 lần (kiểm tra cờ). Không đổi Delta của nội dung hợp lệ.
 */
import { Quill } from "react-quill";

let installed = false;

const DANGEROUS_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "MATH", "FORM", "OBJECT", "EMBED", "BASE", "LINK", "META", "FRAME", "IFRAME", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);

function sanitizeStyleForPaste(style) {
  if (!style) return "";
  const ALLOWED = new Set(["color", "background-color", "text-align", "font-weight", "font-style", "text-decoration", "font-size", "line-height"]);
  const kept = [];
  for (const decl of String(style).split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!ALLOWED.has(prop)) continue;
    if (!val || val.length > 60) continue;
    if (/url\s*\(/i.test(val) || /expression\s*\(/i.test(val)) continue;
    if (!/^[a-zA-Z0-9#%.,\-\s()]*$/.test(val)) continue;
    kept.push(`${prop}: ${val}`);
  }
  return kept.join("; ");
}

function sanitizeHtmlString(html) {
  if (typeof html !== "string" || !html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    const children = [...node.children];
    for (const el of children) {
      if (DANGEROUS_TAGS.has(el.tagName)) { el.remove(); continue; }
      // Bỏ mọi thuộc tính on* và javascript:/data:text/html trong href/src
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; }
        if (name === "href" || name === "src") {
          const v = (attr.value || "").trim().toLowerCase();
          if (v.startsWith("javascript:") || v.startsWith("data:text/html")) el.removeAttribute(attr.name);
        }
      }
      if (el.hasAttribute("style")) {
        const safe = sanitizeStyleForPaste(el.getAttribute("style"));
        if (safe) el.setAttribute("style", safe); else el.removeAttribute("style");
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function installQuillSafeClipboard() {
  if (installed) return;
  installed = true;
  const Clipboard = Quill.import("modules/clipboard");
  const origConvert = Clipboard.prototype.convert;
  Clipboard.prototype.convert = function (html) {
    let safe = html;
    try { safe = sanitizeHtmlString(html); } catch (_) { safe = ""; }
    return origConvert.call(this, safe);
  };
  Quill.register("modules/clipboard", Clipboard, true);
}
