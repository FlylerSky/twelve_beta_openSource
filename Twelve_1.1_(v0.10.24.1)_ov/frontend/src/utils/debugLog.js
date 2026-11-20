/**
 * Twelve Debug Log — ring buffer in-memory + optional console.
 * Bật panel: bấm 7 lần vào chữ "Twelve" trên AppBar (CHỈ ở bản dev — Navbar.jsx khoá panel bằng import.meta.env.DEV).
 * Không gửi log lên server; chỉ local (session).
 *
 * ==== v2.5.3 [TW-11] — chỉ chạy ở bản DEV ====
 * Trước 2.5.3 module này ghi nhật ký ở MỌI môi trường và `persist()` ghi tối đa 200 mục vào sessionStorage["twelve_debug_v1"] ngay trên mỗi lần ghi — kể cả production,
 * dù panel xem log bị khoá DEV. Nội dung gồm email, uid, `location.href` (có thể kèm mã xác minh/đặt lại mật khẩu trong query), dữ liệu lỗi API; `safeClone` chỉ che
 * `password`/`Authorization`. Nay:
 *   - Production: `debugLog`/`dlog.*` là NO-OP (không giữ RAM, không sessionStorage, không console); `setDebugEnabled` no-op; khoá sessionStorage cũ (từ bản ≤2.5.2) bị xoá khi tải.
 *   - DEV: ghi RAM; sessionStorage chỉ được ghi TRỄ (gộp ≤1 lần/0,5 giây — trước đây ghi đồng bộ mỗi lần, tốn hiệu năng).
 *   - Che mạnh hơn (cả DEV): khoá chứa password/token/secret/authorization/cookie… → "[redacted]"; email → "a***@host"; uid → 4 ký tự đầu; chuỗi "Bearer …" và JWT trong giá trị chuỗi bị che;
 *     `snapshotAuth` chỉ giữ origin + pathname (bỏ query/hash).
 */
const DEV = import.meta.env.DEV === true;

const MAX_ENTRIES = 500;
const STORAGE_KEY = "twelve_debug_v1";
const PERSIST_DELAY_MS = 500;

let enabled = false;
let entries = [];
let listeners = new Set();
let seq = 0;
let persistTimer = null;

try {
  if (DEV) {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.entries)) entries = parsed.entries.slice(-MAX_ENTRIES);
      enabled = !!parsed?.enabled;
    }
  } else {
    // v2.5.3: dọn dấu vết từ bản cũ — người dùng production từng có nhật ký (email/uid/URL) nằm trong sessionStorage của tab.
    sessionStorage.removeItem(STORAGE_KEY);
  }
} catch (_) {
  /* ignore */
}

function persistNow() {
  persistTimer = null;
  if (!DEV) return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled, entries: entries.slice(-200) })
    );
  } catch (_) {
    /* quota */
  }
}

// v2.5.3: ghi TRỄ + gộp (trước đây đồng bộ trên mỗi lần ghi: stringify 200 mục mỗi request/sự kiện).
function persist() {
  if (!DEV || persistTimer) return;
  persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(entries);
    } catch (_) {
      /* ignore */
    }
  });
}

// v2.5.3 [TW-11]: danh sách che mở rộng (trước: chỉ "password" / "Authorization").
const SENSITIVE_KEY = /pass(word)?|authorization|cookie|token|secret|credential|api[-_]?key|stsTokenManager/i;
const maskEmail = (v) => {
  const str = String(v);
  const at = str.indexOf("@");
  return at > 0 ? `${str[0]}***${str.slice(at)}` : "[email]";
};
const shortUid = (v) => (typeof v === "string" && v.length > 4 ? `${v.slice(0, 4)}…` : v);
const scrubString = (str) =>
  str
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]");

function redactEntry(key, value) {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (/^e-?mail$/i.test(key)) return value == null ? value : maskEmail(value);
  if (/^uid$|Uid$/.test(key)) return shortUid(value);
  return undefined; // không che
}

function safeClone(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value !== "object") return value;
  if (depth > 4) return "[MaxDepth]";
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: scrubString(String(value.message ?? "")),
        code: value.code,
        stack: value.stack?.split("\n").slice(0, 6).map(scrubString), // dòng đầu của stack lặp lại `message` — phải che cả ở đây
      };
    }
    if (Array.isArray(value)) return value.slice(0, 30).map((v) => safeClone(v, depth + 1));
    const out = {};
    const keys = Object.keys(value).slice(0, 40);
    for (const k of keys) {
      const redacted = redactEntry(k, value[k]);
      if (redacted !== undefined) {
        out[k] = redacted;
        continue;
      }
      try {
        out[k] = safeClone(value[k], depth + 1);
      } catch {
        out[k] = "[unserializable]";
      }
    }
    return out;
  } catch {
    return String(value);
  }
}

/**
 * @param {string} level - debug|info|warn|error
 * @param {string} category - auth|api|ui|nav|react|system|...
 * @param {string} message
 * @param {object} [data]
 */
export function debugLog(level, category, message, data) {
  if (!DEV) return null; // v2.5.3 [TW-11]: production không ghi gì (không RAM, không sessionStorage, không console)
  const entry = {
    id: ++seq,
    ts: new Date().toISOString(),
    t: Date.now(),
    level: level || "info",
    category: category || "system",
    message: scrubString(String(message || "")),
    data: data !== undefined ? safeClone(data) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (enabled) {
    const tag = `[Twelve:${category}]`;
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(tag, entry.message, entry.data !== undefined ? entry.data : ""); // in bản ĐÃ che (không in `data` gốc)
  }
  persist();
  notify();
  return entry;
}

export const dlog = {
  debug: (cat, msg, data) => debugLog("debug", cat, msg, data),
  info: (cat, msg, data) => debugLog("info", cat, msg, data),
  warn: (cat, msg, data) => debugLog("warn", cat, msg, data),
  error: (cat, msg, data) => debugLog("error", cat, msg, data),
};

export function getDebugEntries() {
  return entries.slice();
}

export function clearDebugLog() {
  entries = [];
  persistNow(); // xoá phải có hiệu lực ngay (không chờ trễ)
  notify();
}

export function isDebugEnabled() {
  return enabled;
}

export function setDebugEnabled(v) {
  if (!DEV) return; // v2.5.3 [TW-11]: production không bật được
  enabled = !!v;
  persist();
  dlog.info("system", enabled ? "Debug panel ENABLED" : "Debug panel disabled");
  notify();
}

export function subscribeDebugLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Snapshot auth/Firebase lúc xảy ra sự kiện (phục vụ bug isLoggedIn).
 * v2.5.3 [TW-11]: production chỉ trả `extra` (không đọc người dùng hiện tại); DEV giữ uid/email nhưng `debugLog` sẽ che (uid 4 ký tự, email a***@host) và `href` bỏ query/hash
 * (query có thể chứa mã xác minh email / đặt lại mật khẩu).
 */
export function snapshotAuth(extra = {}) {
  if (!DEV) return { ...extra };
  try {
    const u = authSafeUser();
    return {
      ...extra,
      hasCurrentUser: !!u,
      uid: u?.uid || null,
      email: u?.email || null,
      emailVerified: u?.emailVerified ?? null,
      href: typeof location !== "undefined" ? `${location.origin}${location.pathname}` : null,
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
    };
  } catch (e) {
    return { ...extra, snapshotError: String(e) };
  }
}

function authSafeUser() {
  try {
    return globalThis.__TWELVE_AUTH_CURRENT__?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * AuthContext đăng ký getter currentUser để snapshot không circular import.
 * v2.5.3 [TW-11]: CHỈ ở DEV, và AuthContext chỉ được trả bản chiếu {uid,email,emailVerified} — không bao giờ cả đối tượng Firebase `User`
 * (có getIdToken(), accessToken, stsTokenManager.refreshToken) qua `globalThis`. Production: không đặt gì lên globalThis.
 */
export function registerAuthSnapshotGetter(fn) {
  if (!DEV) return;
  globalThis.__TWELVE_AUTH_CURRENT__ = fn;
}

export function exportDebugLogText() {
  return entries
    .map((e) => {
      const dataStr = e.data !== undefined ? " " + JSON.stringify(e.data) : "";
      return `${e.ts} [${e.level}] [${e.category}] ${e.message}${dataStr}`;
    })
    .join("\n");
}

// Boot marker
dlog.info("system", "debugLog module loaded", { max: MAX_ENTRIES });
