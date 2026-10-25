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
  "ul", "ol", "li", "a", "img", "video", "audio", "source", "iframe", "span", "div",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "style", "target", "rel",
  "width", "height", "frameborder", "allow", "allowfullscreen", "controls", "type", "poster",
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
/**
 * ==== VÁ v0.10.13 [Cân bằng bảo mật ↔ tính năng] — mở rộng nền tảng nhúng
 * media trực tiếp (video/audio) mà không hạ chuẩn an toàn iframe ====
 *
 * Bối cảnh: bản vá #3 (v0.8.3, xem docblock phía trên) chặn ĐÚNG lỗ hổng
 * Clickjacking/Phishing bằng cách chỉ cho iframe từ YouTube/Vimeo — nhưng
 * UI thật (`MediaUrlDialog.jsx`) vẫn mời người dùng dán "video, YouTube,
 * Vimeo, HOẶC TRANG WEB MUỐN NHÚNG" bất kỳ (`utils/media.js#classifyMediaUrl`
 * fallback `type: "webpage"` cho MỌI URL lạ) — nghĩa là người dùng nhúng
 * Twitch/SoundCloud/Spotify... vẫn "nhìn thấy" hoạt động ngay trong trình
 * soạn thảo (preview phía client, chưa qua sanitize), rồi biến mất hoàn
 * toàn sau khi lưu bài (đi qua `sanitizeHtml` này) — bug im lặng, khó phát
 * hiện nếu không kiểm tra kỹ bài đã đăng.
 *
 * Hướng vá: KHÔNG mở lại "bất kỳ domain nào" (giữ nguyên bảo mật gốc) — chỉ
 * bổ sung THÊM các nền tảng video/audio TRỰC TIẾP phổ biến, uy tín, có cơ
 * chế embed an toàn tương đương YouTube/Vimeo vào allowlist. `frameSrc`
 * trong CSP (server.js) đã được cập nhật khớp theo — LUÔN sửa CẢ 2 nơi cùng
 * lúc nếu thêm/bớt domain ở đây.
 */
/**
 * ==== VÁ v0.10.15 [Quản trị Twelve] — danh sách domain nhúng iframe giờ
 * QUẢN LÝ ĐƯỢC bởi SA (tab "Quản trị" ở Settings) thay vì hardcode ====
 *
 * Trước đây `ALLOWED_IFRAME_SRC` là 1 mảng regex path-cụ-thể hardcode trong
 * code (vd. "/^https:\/\/player\.vimeo\.com\/video\//i") — mỗi lần muốn
 * thêm/bớt nền tảng phải sửa code + deploy lại. Giờ chuyển sang danh sách
 * DOMAIN đơn giản (không giữ path cụ thể) để SA chỉnh trực tiếp qua UI.
 *
 * VÌ SAO BỎ PATH VẪN AN TOÀN TƯƠNG ĐƯƠNG: toàn bộ domain mặc định bên dưới
 * đều là domain/subdomain CHUYÊN DÙNG cho việc phục vụ embed (player.vimeo.com,
 * w.soundcloud.com, player.twitch.tv...) — không phải domain web đa dụng có
 * nhiều loại trang khác nhau cần phân biệt theo path. Riêng youtube.com tuy
 * đa dụng, nhưng các trang KHÔNG PHẢI /embed/ tự chặn việc bị nhúng iframe từ
 * phía server YouTube (X-Frame-Options riêng của họ, trình duyệt tự chặn bất
 * kể CSP/allowlist của Twelve) — nên domain-level không mở thêm rủi ro thực
 * tế nào. Nếu SA sau này thêm 1 domain đa dụng KHÔNG tự bảo vệ như vậy, rủi
 * ro Clickjacking/Phishing sẽ quay lại — đây là lý do tính năng này CHỈ dành
 * cho SA (đã được tin cậy ở mức cao nhất của nền tảng), không phải người
 * dùng thường.
 *
 * Danh sách dưới đây là MẶC ĐỊNH — dùng để (1) khởi tạo doc Firestore
 * `config/embedDomains` lần đầu tiên (xem embedDomains.controller.js), và
 * (2) làm giá trị "an toàn khi chưa kịp tải cấu hình" ngay tại module-level
 * dưới đây — QUAN TRỌNG: đây chính là lý do khi deploy 0.10.15, KHÔNG có bài
 * viết nào bị quét/xoá nhầm — ngay cả trước khi server.js kịp gọi
 * `setEmbedDomainsConfig()` lúc khởi động, `sanitizeHtml()` đã hoạt động
 * ĐÚNG HỆT hành vi 0.10.14 vì state khởi tạo sẵn bằng đúng 7 domain đang cho
 * phép — không có "khoảng trống" nào giữa lúc khởi động và lúc tải xong
 * cấu hình thật từ Firestore.
 */
/**
 * ==== VÁ v0.10.16 [Bảo mật — theo yêu cầu SA] — thống nhất domain-allowlist
 * cho TẤT CẢ media, thêm khả năng giới hạn theo PATH ====
 *
 * Lỗ hổng phát hiện được: domain-allowlist do SA quản lý (v0.10.15) TRƯỚC
 * ĐÂY chỉ áp dụng cho <iframe> — <img>/<video>/<audio>/<source> chèn trực
 * tiếp (VÁ v0.10.13) chỉ bị kiểm tra "có phải URL http(s) hợp lệ"
 * (`SRC_VALIDATED_TAGS`), HOÀN TOÀN không quan tâm domain có trong danh
 * sách SA hay không. Hệ quả: SA xoá 1 domain khỏi danh sách, bấm Lưu, hệ
 * thống CÓ quét lại toàn bộ bài viết (`rescanContentForEmbedDomains`) nhưng
 * chỉ xoá được iframe — ảnh/video/audio trực tiếp trỏ tới domain vừa bị
 * xoá vẫn còn nguyên, ngược hẳn kỳ vọng "xoá domain = nội dung liên kết
 * tới đó biến mất".
 *
 * Khắc phục: gộp `isAllowedIframeSrc()` cũ vào 1 hàm chung
 * `isAllowedEmbedSrc()` (xem bên dưới), áp dụng cho CẢ iframe LẪN 4 tag
 * trong `SRC_VALIDATED_TAGS` — kết hợp với `rescanContentForEmbedDomains`
 * sẵn có, xoá 1 domain giờ dọn sạch MỌI loại nhúng từ domain đó, không
 * riêng iframe nữa.
 *
 * Thêm khả năng giới hạn theo PATH: mỗi entry giờ là {domain, path} thay vì
 * chỉ {domain} — cho phép SA nhập vd. "res.cloudinary.com/dk7xohrrk" để CHỈ
 * cho phép đúng 1 "cloud" Cloudinary cụ thể, chặn mọi cloud khác dù cùng
 * domain. So khớp path theo TỪNG SEGMENT (`pathMatchesPrefix()`), KHÔNG so
 * khớp chuỗi con — tránh lỗ hổng "path-prefix-bypass" (vd. domain giả
 * "dk7xohrrk-evil" bị khớp nhầm vì trùng tiền tố ký tự với "dk7xohrrk" nếu
 * chỉ dùng `pathname.startsWith()`).
 *
 * KHÔNG áp path lên CSP `frame-src` (`getFrameSrcCspSources`) — source
 * expression của CSP hỗ trợ path rất KHÔNG đáng tin cậy giữa các trình
 * duyệt (spec khuyến cáo tránh dùng) nên CSP vẫn chỉ giữ mức domain (rộng
 * hơn, làm lớp phòng thủ THÔ); quyết định CHÍNH XÁC theo path nằm ở
 * `sanitizeHtml()` — chạy TRƯỚC khi lưu bài, nên URL sai path không bao
 * giờ có mặt trong `contentHtml` được phục vụ để cần CSP chặn thêm lần nữa.
 *
 * Yêu cầu SA đọc kỹ sau khi deploy: `DEFAULT_EMBED_DOMAINS` chỉ gồm domain
 * chuyên embed iframe — KHÔNG domain nào phục vụ ảnh/media tổng quát. Sau
 * bản vá này, dán URL ẢNH từ 1 trang bất kỳ (imgur, báo chí...) sẽ BỊ CHẶN
 * nếu domain đó chưa có trong danh sách — thay đổi hành vi CÓ CHỦ ĐÍCH theo
 * đúng yêu cầu "áp dụng trên tất cả domain", không phải lỗi. SA cần chủ
 * động thêm domain cho các nguồn ảnh/media hợp lệ muốn tiếp tục cho phép.
 */
const DEFAULT_EMBED_DOMAINS = [
  { domain: "youtube.com", path: "", label: "YouTube" },
  { domain: "youtube-nocookie.com", path: "", label: "YouTube (không cookie)" },
  { domain: "player.vimeo.com", path: "", label: "Vimeo" },
  { domain: "player.twitch.tv", path: "", label: "Twitch (kênh/VOD)" },
  { domain: "clips.twitch.tv", path: "", label: "Twitch (clip)" },
  { domain: "w.soundcloud.com", path: "", label: "SoundCloud" },
  { domain: "open.spotify.com", path: "", label: "Spotify" },
];

// State module-level — xem giải thích "an toàn khi deploy" ở docblock trên.
let embedDomainsConfig = {
  enabled: true,
  domains: DEFAULT_EMBED_DOMAINS.map((d) => ({ domain: d.domain, path: d.path || "" })),
};

/**
 * Nạp cấu hình MỚI (từ Firestore) vào state đang dùng để sanitize — gọi 1
 * lần lúc server khởi động (server.js), và gọi lại NGAY mỗi khi SA lưu thay
 * đổi (embedDomains.controller.js#updateEmbedDomains) để áp dụng tức thời,
 * không cần khởi động lại server.
 *
 * v0.10.16: mỗi phần tử `config.domains` giờ có thêm `path` tuỳ chọn (xem
 * docblock "VÁ v0.10.16" phía trên) — chấp nhận cả chuỗi thô "domain/path"
 * lẫn object {domain, path?} để không phá dữ liệu Firestore cũ (chỉ có
 * "domain" dạng chuỗi, từ trước v0.10.16).
 */
function setEmbedDomainsConfig(config) {
  const rawDomains = Array.isArray(config && config.domains) ? config.domains : [];
  const domains = rawDomains
    .map((d) => {
      if (typeof d === "string") {
        const slashIdx = d.indexOf("/");
        const domain = slashIdx === -1 ? d : d.slice(0, slashIdx);
        const path = slashIdx === -1 ? "" : d.slice(slashIdx + 1);
        return domain ? { domain, path } : null;
      }
      if (d && typeof d.domain === "string" && d.domain) {
        return { domain: d.domain, path: typeof d.path === "string" ? d.path : "" };
      }
      return null;
    })
    .filter(Boolean);
  embedDomainsConfig = {
    enabled: config && typeof config.enabled === "boolean" ? config.enabled : true,
    domains,
  };
}

function getEmbedDomainsConfig() {
  return { enabled: embedDomainsConfig.enabled, domains: embedDomainsConfig.domains.map((d) => ({ ...d })) };
}

/**
 * Sinh danh sách "nguồn" cho CSP `frame-src` (server.js) — CHỈ ở mức domain,
 * BỎ QUA `path` (xem giải thích "KHÔNG áp path lên CSP" ở docblock v0.10.16
 * phía trên — CSP source-expression có path không đáng tin cậy giữa các
 * trình duyệt, quyết định CHÍNH XÁC theo path nằm ở `sanitizeHtml()`).
 * Dùng làm 1 GIÁ TRỊ HÀM trong directive (helmet gọi lại mỗi request, giống
 * cách nonce đang được sinh động), để không cần khởi động lại server mỗi
 * khi SA đổi danh sách domain. Mỗi domain sinh ra 2 nguồn CSP: chính domain
 * đó VÀ "*.domain" (subdomain) — khớp đúng ngữ nghĩa "exact-or-subdomain"
 * của `hostnameMatchesDomain()` ở trên. Trả về mảng RỖNG khi bị tắt hoàn
 * toàn (SA gạt công tắc "Tắt").
 */
function getFrameSrcCspSources() {
  if (!embedDomainsConfig.enabled) return [];
  const uniqueDomains = new Set(embedDomainsConfig.domains.map((d) => d.domain));
  const sources = [];
  for (const domain of uniqueDomains) {
    sources.push(`https://${domain}`, `https://*.${domain}`);
  }
  return sources;
}

// Khớp hostname theo domain CHA (chấp nhận subdomain) — "youtube.com" khớp
// cả "www.youtube.com" lẫn chính "youtube.com". Tự bỏ "www."/"*." nếu SA lỡ
// nhập kèm, để tránh lỗi cấu hình phổ biến.
function hostnameMatchesDomain(hostname, domain) {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase().replace(/^\*\.|^www\./, "");
  if (!d) return false;
  return h === d || h.endsWith(`.${d}`);
}

/**
 * v0.10.16 — so khớp PATH theo TỪNG SEGMENT (tách theo "/" rồi so khớp
 * CHÍNH XÁC từng phần), CỐ Ý KHÔNG dùng `pathname.startsWith(path)` (so
 * khớp chuỗi con): nếu SA cho phép "res.cloudinary.com/dk7xohrrk", so khớp
 * kiểu chuỗi con sẽ VÔ TÌNH cho qua luôn 1 cloud khác tên "dk7xohrrk-evil"
 * hay "dk7xohrrk2" (khác chủ, chỉ TRÙNG TIỀN TỐ KÝ TỰ) — đúng dạng lỗ hổng
 * path-prefix-bypass kinh điển. `path` rỗng/không có = không giới hạn,
 * khớp mọi path dưới domain đó (hành vi y hệt trước bản vá này). So khớp
 * PHÂN BIỆT HOA/THƯỜNG (khác domain) vì path trên URL thực tế phân biệt hoa
 * thường — SA cần nhập đúng chữ hoa/thường như trong URL thật.
 */
function pathMatchesPrefix(pathname, path) {
  if (!path) return true;
  const allowedSegments = path.split("/").filter(Boolean);
  if (allowedSegments.length === 0) return true;
  const urlSegments = pathname.split("/").filter(Boolean);
  if (urlSegments.length < allowedSegments.length) return false;
  for (let i = 0; i < allowedSegments.length; i++) {
    if (urlSegments[i] !== allowedSegments[i]) return false;
  }
  return true;
}

/**
 * v0.10.16 — hàm kiểm tra DUY NHẤT cho MỌI loại nhúng có domain-allowlist:
 * trước bản vá chỉ dùng cho iframe (`isAllowedIframeSrc`), giờ dùng chung
 * cho CẢ iframe LẪN img/video/audio/source trực tiếp (xem docblock "VÁ
 * v0.10.16" ở đầu file — lỗ hổng "xoá domain không dọn được media trực
 * tiếp"). Luôn yêu cầu https (khớp yêu cầu bảo mật gốc v0.8.3 cho iframe,
 * giờ áp dụng luôn cho media trực tiếp — trước bản vá media trực tiếp còn
 * được phép cả http://, nới lỏng hơn cần thiết).
 */
function isAllowedEmbedSrc(src) {
  if (typeof src !== "string" || !src) return false;
  if (!embedDomainsConfig.enabled) return false; // SA tắt toàn bộ -> chặn mọi nhúng, không ngoại lệ
  let url;
  try {
    url = new URL(src.trim());
  } catch (_) {
    return false;
  }
  if (url.protocol !== "https:") return false; // chỉ https — domain có trong danh sách vẫn bị chặn nếu dùng http://
  return embedDomainsConfig.domains.some(
    (entry) => hostnameMatchesDomain(url.hostname, entry.domain) && pathMatchesPrefix(url.pathname, entry.path)
  );
}

// Giữ tên cũ để không phải sửa nơi gọi (dưới đây) — trước bản vá này chỉ
// dùng cho iframe, giờ là alias của hàm chung ở trên (hành vi cho iframe
// không đổi: vẫn https + domain-allowlist, giờ có thêm path nếu SA cấu hình).
function isAllowedIframeSrc(src) {
  return isAllowedEmbedSrc(src);
}


// Allowlist thuộc tính CSS an toàn cho phép giữ lại trong `style` — cố ý
// KHÔNG có position/top/left/right/bottom/z-index/transform/background:url/
// filter/clip-path/behavior. background-color (màu đặc Quill) được phép từ v0.9.2.
// v0.9.2: cho phép background-color (bôi nền chữ Quill). Vẫn CHẶN
// background:url(...) qua kiểm tra url() bên dưới — không mở vector tracking.
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
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

// v0.10.13: các thẻ có attribute `src` trỏ tới media thật (không phải link
// điều hướng như <a href>) — cùng cần validate là URL http(s) hợp lệ, xem
// hook afterSanitizeAttributes bên dưới.
const SRC_VALIDATED_TAGS = new Set(["IMG", "VIDEO", "AUDIO", "SOURCE"]);

// v0.10.18 (N-2): tính năng Permissions Policy được phép giữ lại trong
// `allow` của <iframe> — chỉ những gì player media thật sự cần, KHÔNG có
// camera/microphone/geolocation/payment/usb/... Xem hook bên dưới.
const SAFE_IFRAME_ALLOW_FEATURES = new Set([
  "fullscreen",
  "picture-in-picture",
  "encrypted-media",
  "autoplay",
  "clipboard-write",
]);

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
    // ==== VÁ v0.10.14 — YouTube báo "Lỗi 153" (Lỗi cấu hình trình phát) ====
    // `referrerpolicy="no-referrer"` xoá sạch header Referer khi trình duyệt
    // tải iframe — YouTube (và nhiều nền tảng embed khác) dùng Referer để xác
    // minh embed đến từ 1 trang thật, thiếu hẳn header này bị nhiều player
    // coi là embed không xác định được nguồn gốc → từ chối phát (lỗi 153).
    // Đổi sang "strict-origin-when-cross-origin" (mặc định của trình duyệt
    // hiện đại) — vẫn ẩn được đường dẫn/query cụ thể của bài viết (chỉ gửi
    // origin, vd. "https://twelveta.vercel.app", không gửi "/post/abc123"),
    // đủ riêng tư nhưng YouTube/Vimeo/Twitch nhận được origin hợp lệ để xác
    // thực embed.
    node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    node.setAttribute("loading", "lazy");
  }

  // ==== VÁ v0.10.11 [LOW — báo cáo bảo mật V-007], mở rộng v0.10.13, thắt
  // chặt v0.10.16 (xem docblock "VÁ v0.10.16" đầu file) ====
  // `img`/`video`/`audio`/`source` đều có `src` trong allowlist (cần thiết
  // cho media Quill hợp lệ). Trước v0.10.16 chỉ kiểm tra `src` có phải 1 URL
  // http(s) THỰC SỰ hay không (thuần UX/thẩm mỹ — chặn media vỡ trên UI),
  // KHÔNG hề kiểm tra domain có nằm trong danh sách SA quản lý hay không —
  // đây chính là lỗ hổng "xoá domain không dọn được media trực tiếp" mà
  // v0.10.16 vá. Giờ dùng `isAllowedEmbedSrc()` — vừa validate URL http(s)
  // hợp lệ, vừa bắt buộc https + khớp domain(+path) trong danh sách, y hệt
  // cách iframe đã được kiểm tra từ v0.8.3.
  if (SRC_VALIDATED_TAGS.has(node.tagName) && node.hasAttribute("src")) {
    // v0.10.13: chỉ kiểm tra khi CHÍNH thẻ này có khai báo `src` — <video>/
    // <audio> hợp lệ vẫn có thể KHÔNG có src riêng, dựa hoàn toàn vào các
    // <source> con (mỗi <source> tự bị kiểm tra riêng khi hook chạy tới nó).
    // Ban đầu code kiểm tra vô điều kiện đã xoá nhầm CẢ <video>/<audio> hợp
    // lệ chỉ vì chính nó không có src (dù <source> con vẫn hợp lệ).
    const src = node.getAttribute("src");
    if (!isAllowedEmbedSrc(src)) {
      node.remove();
      return;
    }
  }

  // ==== VÁ v0.10.18 [MEDIUM — báo cáo bảo mật N-1] `poster` bỏ qua allowlist ====
  // `poster` là URL ảnh mà trình duyệt TỰ TẢI khi render <video> (không cần
  // người xem bấm gì) nhưng KHÔNG đi qua kiểm tra `src` ở trên -> ảnh theo
  // dõi (tracking beacon) từ domain bất kỳ lộ IP/User-Agent/Referer của mọi
  // người xem, kể cả khách. Đã kiểm chứng: `<video poster="https://attacker/..">`
  // sống sót nguyên vẹn qua `sanitizeHtml()` trước bản vá. Chỉ giữ `poster`
  // trên <video> VÀ khi URL qua `isAllowedEmbedSrc()` (cùng allowlist
  // domain/path với `src`); mọi trường hợp khác (kể cả `poster` gắn lên thẻ
  // khác như <audio>/<img> — vô nghĩa với trình duyệt nhưng vẫn là dữ liệu
  // rác) đều bị xoá. Editor Twelve (utils/media.js) không hề tạo `poster`
  // nên không mất tính năng nào.
  if (node.hasAttribute && node.hasAttribute("poster")) {
    if (node.tagName !== "VIDEO" || !isAllowedEmbedSrc(node.getAttribute("poster"))) {
      node.removeAttribute("poster");
    }
  }

  // ==== VÁ v0.10.18 [LOW–MEDIUM — báo cáo bảo mật N-2] `allow` không bị lọc ====
  // `allow` (Permissions Policy) do người dùng tự điền được giữ nguyên -> uỷ
  // quyền camera/micro/vị trí/thanh toán... cho domain bên thứ ba trong
  // allowlist; hộp thoại xin quyền của trình duyệt lại hiện tên miền TWELVE
  // (top-level) nên dễ lừa người xem cấp quyền. Chỉ giữ token là TÊN TÍNH
  // NĂNG TRƠN thuộc danh sách an toàn cho player media — token có kèm bất kỳ
  // danh sách origin nào (`*`, `https://...`, `'src'`...) đều bị loại (chặt
  // hơn chỉ lọc dấu `*`: uỷ quyền tính năng cho 1 origin cụ thể khác cũng là
  // uỷ quyền). Không còn token nào -> xoá hẳn thuộc tính. Editor Twelve
  // không tạo `allow` (chỉ `allowfullscreen`) nên không mất tính năng.
  if (node.tagName === "IFRAME" && node.hasAttribute("allow")) {
    const kept = node
      .getAttribute("allow")
      .split(";")
      .map((token) => token.trim())
      .filter((token) => token && SAFE_IFRAME_ALLOW_FEATURES.has(token.toLowerCase()));
    if (kept.length) node.setAttribute("allow", kept.join("; "));
    else node.removeAttribute("allow");
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

/**
 * ==== v0.10.11 [MEDIUM — báo cáo bảo mật V-002] — escape cho PLAIN TEXT ====
 *
 * Dùng cho các field lưu PLAIN TEXT thô, không phải HTML từ Quill (khác hẳn
 * `sanitizeHtml` ở trên) — hiện tại chỉ có nội dung bình luận
 * (`comments.controller.js`). KHÔNG áp hàm này khi LƯU (sẽ làm hỏng hiển thị
 * hiện tại — xem giải thích trong comments.controller.js), chỉ dùng khi CẦN
 * chèn plain text (chưa qua xử lý) vào một trang HTML thật (SSR, email, panel
 * quản trị...) — hiện Twelve CHƯA có nơi nào render bình luận dưới dạng HTML
 * nên hàm này chưa được gọi ở đâu, chuẩn bị sẵn cho khi có.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Trích 1 đoạn plain-text ngắn từ HTML để làm excerpt / mô tả SEO
function htmlToExcerpt(rawHtml, maxLen = 160) {
  if (!rawHtml) return "";
  const dom = new JSDOM(rawHtml);
  const text = dom.window.document.body.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

module.exports = {
  sanitizeHtml,
  htmlToExcerpt,
  escapeHtml,
  DEFAULT_EMBED_DOMAINS,
  setEmbedDomainsConfig,
  getEmbedDomainsConfig,
  getFrameSrcCspSources,
  isAllowedEmbedSrc,
};
