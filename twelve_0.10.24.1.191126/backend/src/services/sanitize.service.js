/**
 * ==== Twelve 1.1 (0.10.24.1.191126) — BACKPORT bảo mật từ 2.0.10 → 2.5.3 ====
 * Các lớp vá thêm so với 0.10.24:
 *   F1 (CRITICAL DoS): assessHtml giới hạn đầu vào O(n) + sanitize chạy ở
 *     worker_threads có timeout cứng 3s (sanitizeContentAsync). Luồng chính
 *     không bao giờ bị chặn. `sanitizeHtml` (sync) vẫn giữ cho script chạy tay.
 *   TW-06: `class` chỉ giữ token `ql-*` hợp lệ (chống ẩn chữ qua CSS site);
 *     data-* và aria-* vốn đã không nằm trong ALLOWED_ATTR nên đã bị loại.
 *   R-01 / A-06: `color` chuyển sang allowlist — hex/rgb/hsl với alpha ≥ 0.5,
 *     tên màu CSS chuẩn; chặn `transparent`, `#fff0`, `color-mix()`, `var()`,
 *     màu hệ thống. Giới hạn số `font-size`/`line-height`/`margin`/`padding`.
 *   PATCH-2 #9: ép `rel="ugc nofollow noopener"` cho link ngoài, `noopener` cho
 *     link nội bộ; bỏ `target` ngoài `_blank` kèm noopener.
 * Giữ nguyên toàn bộ logic allowlist domain nhúng (v0.10.16), poster, `allow`.
 */
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const { Worker } = require("worker_threads");
const path = require("path");

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const CONTENT_LIMITS = {
  MAX_CHARS: 250000,
  MAX_ELEMENTS: 5000,
  MAX_DEPTH: 100,
  MAX_UNSUPPORTED_TAGS: 300,
  MAX_MEDIA: 200,
};

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "a", "img", "video", "audio", "source", "iframe", "span", "div",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "style", "target", "rel",
  "width", "height", "frameborder", "allow", "allowfullscreen", "controls", "type", "poster",
];

const DEFAULT_EMBED_DOMAINS = [
  { domain: "youtube.com", path: "", label: "YouTube" },
  { domain: "youtube-nocookie.com", path: "", label: "YouTube (không cookie)" },
  { domain: "player.vimeo.com", path: "", label: "Vimeo" },
  { domain: "player.twitch.tv", path: "", label: "Twitch (kênh/VOD)" },
  { domain: "clips.twitch.tv", path: "", label: "Twitch (clip)" },
  { domain: "w.soundcloud.com", path: "", label: "SoundCloud" },
  { domain: "open.spotify.com", path: "", label: "Spotify" },
];

let embedDomainsConfig = {
  enabled: true,
  domains: DEFAULT_EMBED_DOMAINS.map((d) => ({ domain: d.domain, path: d.path || "" })),
};

function setEmbedDomainsConfig(config) {
  const rawDomains = Array.isArray(config && config.domains) ? config.domains : [];
  const domains = rawDomains
    .map((d) => {
      if (typeof d === "string") {
        const slashIdx = d.indexOf("/");
        const domain = slashIdx === -1 ? d : d.slice(0, slashIdx);
        const p = slashIdx === -1 ? "" : d.slice(slashIdx + 1);
        return domain ? { domain, path: p } : null;
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

function getFrameSrcCspSources() {
  if (!embedDomainsConfig.enabled) return [];
  const uniqueDomains = new Set(embedDomainsConfig.domains.map((d) => d.domain));
  const sources = [];
  for (const domain of uniqueDomains) {
    sources.push(`https://${domain}`, `https://*.${domain}`);
  }
  return sources;
}

function hostnameMatchesDomain(hostname, domain) {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase().replace(/^\*\.|^www\./, "");
  if (!d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function pathMatchesPrefix(pathname, p) {
  if (!p) return true;
  const allowedSegments = p.split("/").filter(Boolean);
  if (allowedSegments.length === 0) return true;
  const urlSegments = pathname.split("/").filter(Boolean);
  if (urlSegments.length < allowedSegments.length) return false;
  for (let i = 0; i < allowedSegments.length; i++) {
    if (urlSegments[i] !== allowedSegments[i]) return false;
  }
  return true;
}

function isAllowedEmbedSrc(src) {
  if (typeof src !== "string" || !src) return false;
  if (!embedDomainsConfig.enabled) return false;
  let url;
  try {
    url = new URL(src.trim());
  } catch (_) {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return embedDomainsConfig.domains.some(
    (entry) => hostnameMatchesDomain(url.hostname, entry.domain) && pathMatchesPrefix(url.pathname, entry.path)
  );
}

function isAllowedIframeSrc(src) {
  return isAllowedEmbedSrc(src);
}

const CSS_COLOR_NAMES = new Set((
  "aliceblue,antiquewhite,aqua,aquamarine,azure,beige,bisque,black,blanchedalmond,blue,blueviolet,brown,burlywood,cadetblue,chartreuse,chocolate,coral,cornflowerblue,cornsilk,crimson,cyan,darkblue,darkcyan,darkgoldenrod,darkgray,darkgreen,darkgrey,darkkhaki,darkmagenta,darkolivegreen,darkorange,darkorchid,darkred,darksalmon,darkseagreen,darkslateblue,darkslategray,darkslategrey,darkturquoise,darkviolet,deeppink,deepskyblue,dimgray,dimgrey,dodgerblue,firebrick,floralwhite,forestgreen,fuchsia,gainsboro,ghostwhite,gold,goldenrod,gray,green,greenyellow,grey,honeydew,hotpink,indianred,indigo,ivory,khaki,lavender,lavenderblush,lawngreen,lemonchiffon,lightblue,lightcoral,lightcyan,lightgoldenrodyellow,lightgray,lightgreen,lightgrey,lightpink,lightsalmon,lightseagreen,lightskyblue,lightslategray,lightslategrey,lightsteelblue,lightyellow,lime,limegreen,linen,magenta,maroon,mediumaquamarine,mediumblue,mediumorchid,mediumpurple,mediumseagreen,mediumslateblue,mediumspringgreen,mediumturquoise,mediumvioletred,midnightblue,mintcream,mistyrose,moccasin,navajowhite,navy,oldlace,olive,olivedrab,orange,orangered,orchid,palegoldenrod,palegreen,paleturquoise,palevioletred,papayawhip,peachpuff,peru,pink,plum,powderblue,purple,rebeccapurple,red,rosybrown,royalblue,saddlebrown,salmon,sandybrown,seagreen,seashell,sienna,silver,skyblue,slateblue,slategray,slategrey,snow,springgreen,steelblue,tan,teal,thistle,tomato,turquoise,violet,wheat,white,whitesmoke,yellow,yellowgreen,inherit,initial,unset,currentcolor"
).split(","));

function isSafeColorValue(v) {
  const val = v.trim().toLowerCase();
  if (!val || val.length > 40) return false;
  if (val === "transparent") return false;
  if (CSS_COLOR_NAMES.has(val)) return true;
  const hex36 = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;
  if (hex36.test(val)) return true;
  const m4 = val.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m4) return parseInt(m4[4], 16) >= 8;
  const m8 = val.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/);
  if (m8) return parseInt(m8[2], 16) >= 128;
  const m = val.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!m) return false;
  const parts = m[2].split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return false;
  for (const p of parts.slice(0, 3)) {
    if (!/^-?\d+(\.\d+)?(deg|%|turn|rad)?$/.test(p)) return false;
  }
  if (parts.length === 4) {
    const a = parts[3];
    const num = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    if (Number.isNaN(num) || num < 0.5) return false;
  }
  return true;
}

const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "text-align", "font-weight", "font-style",
  "text-decoration", "font-size", "line-height", "padding-left", "padding-right",
  "margin-left", "margin-right",
]);

const FONT_SIZE_KEYWORDS = new Set(["small", "medium", "large", "x-large", "xx-large", "x-small", "xx-small"]);

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
    if (/url\s*\(/i.test(value)) continue;
    if (/expression\s*\(/i.test(value)) continue;
    if ((prop === "color" || prop === "background-color") && !isSafeColorValue(value)) continue;
    if (prop === "font-size") {
      if (FONT_SIZE_KEYWORDS.has(value.toLowerCase())) { kept.push(`${prop}: ${value}`); continue; }
      const m = value.match(/^(\d+(?:\.\d+)?)(px|em|rem)?$/);
      if (!m) continue;
      const n = parseFloat(m[1]);
      const unit = m[2] || "px";
      if (unit === "px" && (n < 8 || n > 72)) continue;
      if ((unit === "em" || unit === "rem") && (n < 0.5 || n > 5)) continue;
    }
    if (prop === "line-height") {
      const n = parseFloat(value);
      if (Number.isNaN(n) || n < 0.8 || n > 4) continue;
    }
    if (prop === "margin-left" || prop === "margin-right" || prop === "padding-left" || prop === "padding-right") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (!m) continue;
      const n = parseFloat(m[1]);
      if (n < 0 || n > 200) continue;
    }
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

const SRC_VALIDATED_TAGS = new Set(["IMG", "VIDEO", "AUDIO", "SOURCE"]);

const SAFE_IFRAME_ALLOW_FEATURES = new Set([
  "fullscreen", "picture-in-picture", "encrypted-media", "autoplay", "clipboard-write",
]);

const QL_CLASS_RE = /^ql-[a-z0-9-]{1,20}$/;

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "class") {
    const kept = (data.attrValue || "")
      .split(/\s+/)
      .filter((t) => QL_CLASS_RE.test(t))
      .join(" ");
    data.attrValue = kept;
    if (!kept) data.keepAttr = false;
  }
});

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
    const src = node.getAttribute("src");
    if (!isAllowedIframeSrc(src)) {
      node.remove();
      return;
    }
    node.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    node.setAttribute("loading", "lazy");
  }

  if (SRC_VALIDATED_TAGS.has(node.tagName) && node.hasAttribute("src")) {
    const src = node.getAttribute("src");
    if (!isAllowedEmbedSrc(src)) {
      node.remove();
      return;
    }
  }

  if (node.hasAttribute && node.hasAttribute("poster")) {
    if (node.tagName !== "VIDEO" || !isAllowedEmbedSrc(node.getAttribute("poster"))) {
      node.removeAttribute("poster");
    }
  }

  if (node.tagName === "IFRAME" && node.hasAttribute("allow")) {
    const kept = node
      .getAttribute("allow")
      .split(";")
      .map((token) => token.trim())
      .filter((token) => token && SAFE_IFRAME_ALLOW_FEATURES.has(token.toLowerCase()));
    if (kept.length) node.setAttribute("allow", kept.join("; "));
    else node.removeAttribute("allow");
  }

  // PATCH-2 #9: ép rel trên mọi link. Link ngoài → ugc nofollow noopener.
  if (node.tagName === "A" && node.hasAttribute("href")) {
    const href = node.getAttribute("href") || "";
    let isExternal = false;
    try {
      const u = new URL(href, "https://localhost");
      if (u.protocol !== "http:" && u.protocol !== "https:") { node.remove(); return; }
      isExternal = u.hostname !== "localhost";
    } catch (_) { node.remove(); return; }
    const rel = isExternal ? "ugc nofollow noopener" : "noopener";
    node.setAttribute("rel", rel);
    if (node.getAttribute("target") !== "_blank") node.removeAttribute("target");
  }

  if (node.hasAttribute && node.hasAttribute("style")) {
    const safe = sanitizeStyleAttr(node.getAttribute("style"));
    if (safe) node.setAttribute("style", safe);
    else node.removeAttribute("style");
  }
});

// F1 — assessHtml: quét O(n) không dùng DOM, chặn input quá khổ trước DOMPurify.
function assessHtml(rawHtml) {
  if (rawHtml == null) return { ok: true };
  if (typeof rawHtml !== "string") return { ok: false, reason: "Nội dung phải là chuỗi." };
  if (rawHtml.length > CONTENT_LIMITS.MAX_CHARS) {
    return { ok: false, reason: `Nội dung quá dài (tối đa ${CONTENT_LIMITS.MAX_CHARS} ký tự).` };
  }
  let elements = 0, depth = 0, maxDepth = 0, media = 0, unsupported = 0;
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)|<!--|-->|>/g;
  let m;
  const allowed = new Set(ALLOWED_TAGS.map((t) => t.toUpperCase()));
  while ((m = tagRe.exec(rawHtml)) !== null) {
    if (m[0] === "<!--") {
      const end = rawHtml.indexOf("-->", m.index);
      if (end === -1) break;
      tagRe.lastIndex = end + 3;
      continue;
    }
    if (m[0] === "-->" || m[0] === ">") continue;
    const isClose = rawHtml[m.index + 1] === "/";
    const tag = (m[1] || "").toUpperCase();
    if (isClose) { depth = Math.max(0, depth - 1); continue; }
    elements++;
    if (elements > CONTENT_LIMITS.MAX_ELEMENTS) return { ok: false, reason: "Nội dung có quá nhiều phần tử." };
    depth++;
    if (depth > maxDepth) maxDepth = depth;
    if (maxDepth > CONTENT_LIMITS.MAX_DEPTH) return { ok: false, reason: "Nội dung lồng quá sâu." };
    if (tag === "IMG" || tag === "VIDEO" || tag === "AUDIO" || tag === "SOURCE" || tag === "IFRAME") {
      media++;
      if (media > CONTENT_LIMITS.MAX_MEDIA) return { ok: false, reason: "Nội dung có quá nhiều media." };
    }
    if (!allowed.has(tag)) {
      unsupported++;
      if (unsupported > CONTENT_LIMITS.MAX_UNSUPPORTED_TAGS) return { ok: false, reason: "Nội dung có quá nhiều thẻ không hỗ trợ." };
    }
    if (rawHtml.slice(m.index, m.index + 80).includes("/>")) depth = Math.max(0, depth - 1);
  }
  return { ok: true };
}

function _sanitizeSyncInternal(rawHtml) {
  if (!rawHtml) return "";
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

function _htmlToExcerptInternal(rawHtml, maxLen = 160) {
  if (!rawHtml) return "";
  const dom = new JSDOM(rawHtml);
  const text = dom.window.document.body.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

function sanitizeHtml(rawHtml) {
  const a = assessHtml(rawHtml);
  if (!a.ok) {
    const err = new Error(a.reason);
    err.code = "CONTENT_TOO_COMPLEX";
    throw err;
  }
  return _sanitizeSyncInternal(rawHtml);
}

function htmlToExcerpt(rawHtml, maxLen = 160) {
  return _htmlToExcerptInternal(rawHtml, maxLen);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ==== Worker pool (F1) — một worker dùng lại, hàng đợi, timeout cứng 3s ====
let worker = null;
let busy = false;
const queue = [];
const SANITIZE_TIMEOUT_MS = 3000;
const WORKER_OFF = process.env.SANITIZE_WORKER === "off";

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, "sanitize.worker.js"));
  worker.on("message", (msg) => {
    busy = false;
    const cur = queue.shift();
    if (cur) cur.resolve(msg);
    pump();
  });
  worker.on("error", (err) => {
    busy = false;
    const cur = queue.shift();
    if (cur) cur.reject(err);
    try { worker.terminate(); } catch (_) {}
    worker = null;
    pump();
  });
  worker.on("exit", () => { worker = null; busy = false; });
  return worker;
}

function pump() {
  if (busy || queue.length === 0) return;
  if (WORKER_OFF) {
    const cur = queue.shift();
    try {
      const clean = _sanitizeSyncInternal(cur.rawHtml);
      const excerpt = _htmlToExcerptInternal(clean, cur.excerptMaxLen);
      cur.resolve({ ok: true, cleanHtml: clean, excerpt });
    } catch (err) {
      cur.reject(err);
    }
    setImmediate(pump);
    return;
  }
  busy = true;
  const cur = queue[0];
  const w = ensureWorker();
  const timer = setTimeout(() => {
    try { w.terminate(); } catch (_) {}
    worker = null;
    busy = false;
    queue.shift();
    cur.reject(Object.assign(new Error("Sanitize timeout — nội dung quá phức tạp."), { code: "SANITIZE_TIMEOUT" }));
    pump();
  }, SANITIZE_TIMEOUT_MS);
  const origResolve = cur.resolve;
  cur.resolve = (v) => { clearTimeout(timer); origResolve(v); };
  w.postMessage({ rawHtml: cur.rawHtml, excerptMaxLen: cur.excerptMaxLen });
}

async function sanitizeContentAsync(rawHtml, excerptMaxLen = 160) {
  const a = assessHtml(rawHtml);
  if (!a.ok) {
    throw Object.assign(new Error(a.reason), { code: "CONTENT_TOO_COMPLEX" });
  }
  try {
    const msg = await new Promise((resolve, reject) => {
      queue.push({ rawHtml, excerptMaxLen, resolve, reject });
      pump();
    });
    if (msg && msg.ok) return { cleanHtml: msg.cleanHtml, excerpt: msg.excerpt };
    throw new Error(msg && msg.error ? msg.error : "sanitize worker lỗi");
  } catch (workerErr) {
    // Fallback sync (đã qua assessHtml) — ghi log, không làm hỏng request.
    console.warn("[sanitize] worker không khả dụng, dùng sync fallback:", workerErr.code || workerErr.message);
    const clean = _sanitizeSyncInternal(rawHtml);
    return { cleanHtml: clean, excerpt: _htmlToExcerptInternal(clean, excerptMaxLen) };
  }
}

module.exports = {
  sanitizeHtml,
  sanitizeContentAsync,
  htmlToExcerpt,
  escapeHtml,
  DEFAULT_EMBED_DOMAINS,
  setEmbedDomainsConfig,
  getEmbedDomainsConfig,
  getFrameSrcCspSources,
  isAllowedEmbedSrc,
  assessHtml,
  CONTENT_LIMITS,
  _sanitizeSyncInternal,
  _htmlToExcerptInternal,
};
