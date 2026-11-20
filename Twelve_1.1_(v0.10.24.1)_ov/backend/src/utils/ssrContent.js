/**
 * ==== v1.1 — Lớp sanitize THỨ HAI cho trang SSR (chỉ phần TW-20 của utils/ssrContent.js ở Twelve 2.5.3) ====
 * (Các hàm SEO khác của file gốc — điền alt ảnh, bình luận SSR — là tính năng mới của bản Beta nên KHÔNG được đưa vào 1.1.)
 */
/**
 * ==== v1.1 [TW-20 — vá từ 2.5.3] — Lớp sanitize THỨ HAI khi SSR đọc bài ====
 * `views/content.ejs` in `post.contentHtml` THÔ (`<%- … %>`) — chỗ duy nhất tin hoàn toàn HTML đã lưu. HTML được làm sạch lúc GHI, nhưng bài cũ chỉ sạch theo bộ lọc LÚC ĐÓ
 * (đổi bộ lọc phải chạy `npm run content:resanitize`). Đây là lưới an toàn rẻ: một "dây vấp" bằng regex trên chuỗi đã lưu; chỉ khi thấy dấu hiệu mà bộ lọc hiện hành chắc chắn
 * không cho phép (thẻ nguy hiểm, trình xử lý sự kiện on*, URL javascript:/vbscript:/data:text/html, srcdoc) mới chạy lại DOMPurify (qua worker) — nội dung bình thường KHÔNG tốn thêm gì.
 * Lỗi khi làm sạch ⇒ trả chuỗi rỗng (đóng an toàn) chứ không in HTML chưa làm sạch. Có thay đổi ⇒ log id bài (kèm số ký tự) để biết kho dữ liệu còn HTML cũ cần re-sanitize.
 */
const SSR_TRIPWIRE = /<\s*\/?\s*(?:script|object|embed|applet|link|meta|base|form|style|svg|math|template|noscript)\b|[\s"'\/]on[a-z]{3,}\s*=|(?:java|vb)script\s*:|data\s*:\s*text\/html|\bsrcdoc\s*=/i;

/**
 * v2.5.3 (rà soát độc lập): `SSR_TRIPWIRE` chạy trên chuỗi THÔ nên bị lách bằng thứ mà TRÌNH DUYỆT giải mã trước khi phân tích URL/thuộc tính:
 *   • thực thể HTML: `&#106;avascript:`, `&#x6A;avascript:`, `javascript&colon;` (thuộc tính được giải mã thực thể);
 *   • TAB/LF/CR nằm giữa chữ của scheme (`java&#9;script:`, `java<TAB>script:`) — trình duyệt xoá chúng khỏi URL.
 * Nay kiểm ba dạng của cùng một chuỗi: (A) thô, (B) đã giải mã thực thể, (C) B + bỏ \t\n\r\f\0. B và C tách riêng vì bỏ khoảng trắng làm dính `x\nonerror=` thành `xonerror=` (mất tiền tố
 * `\s` của mẫu on*=), còn B giữ nguyên. Cố ý KHÔNG giải mã `&lt; &gt; &#60; &#62;` (chỉ có thể là CHỮ, không bao giờ tạo thẻ) để `<pre>&lt;script&gt;…` của bài hướng dẫn lập trình không bị bắt oan.
 * Bắt oan chỉ tốn một lượt DOMPurify (và trang SSR được CDN giữ ~40 phút); bắt thiếu mới là lỗ hổng — nên mọi nghi ngờ đều nghiêng về "làm sạch lại".
 */
const NAMED_ENTITIES = { colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", bsol: "\\", num: "#", equals: "=", quot: '"', apos: "'", amp: "&", semi: ";", period: ".", comma: ",", excl: "!" };
function decodeEntitiesLoose(str) {
  return str.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,9}));?/gi, (m, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      if (!(cp > 0 && cp <= 0x10ffff) || cp === 60 || cp === 62) return cp === 60 || cp === 62 ? m : "";
      return String.fromCodePoint(cp);
    }
    const v = NAMED_ENTITIES[name.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function ssrTripwireHit(html) {
  if (typeof html !== "string" || !html) return false;
  if (SSR_TRIPWIRE.test(html)) return true;
  if (html.indexOf("&") === -1 && !/[\t\n\r\f\0]/.test(html)) return false; // không có gì để giải mã/bỏ ⇒ dạng thô là đủ
  const decoded = decodeEntitiesLoose(html);
  return SSR_TRIPWIRE.test(decoded) || SSR_TRIPWIRE.test(decoded.replace(/[\t\n\r\f\0]/g, ""));
}

async function sanitizeAgainForSsr(html, { id = "?", processContentHtml } = {}) {
  if (typeof html !== "string" || !html || !ssrTripwireHit(html)) return html;
  try {
    const run = processContentHtml || require("../services/contentPipeline").processContentHtml;
    const { html: clean } = await run(html);
    if (clean !== html) console.warn(`[ssr-tripwire] bài ${String(id).slice(0, 40)}: HTML đã lưu còn phần bộ lọc hiện hành sẽ bỏ (${html.length} → ${clean.length} ký tự) — chạy \`npm run content:resanitize\`.`);
    return clean;
  } catch (err) {
    console.error(`[ssr-tripwire] bài ${String(id).slice(0, 40)}: làm sạch lại thất bại, không hiển thị nội dung:`, err && err.message);
    return "";
  }
}

module.exports = { sanitizeAgainForSsr, SSR_TRIPWIRE, ssrTripwireHit };
