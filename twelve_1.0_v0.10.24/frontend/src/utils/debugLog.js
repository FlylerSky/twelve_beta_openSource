/**
 * Twelve Debug Log — ring buffer in-memory + optional console.
 * Bật panel: bấm 7 lần vào chữ "Twelve" trên AppBar.
 * Không gửi log lên server; chỉ local (session).
 */

const MAX_ENTRIES = 500;
const STORAGE_KEY = "twelve_debug_v1";

let enabled = false;
let entries = [];
let listeners = new Set();
let seq = 0;

try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.entries)) entries = parsed.entries.slice(-MAX_ENTRIES);
    enabled = !!parsed?.enabled;
  }
} catch (_) {
  /* ignore */
}

function persist() {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled, entries: entries.slice(-200) })
    );
  } catch (_) {
    /* quota */
  }
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

function safeClone(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (depth > 4) return "[MaxDepth]";
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        code: value.code,
        stack: value.stack?.split("\n").slice(0, 6),
      };
    }
    if (Array.isArray(value)) return value.slice(0, 30).map((v) => safeClone(v, depth + 1));
    const out = {};
    const keys = Object.keys(value).slice(0, 40);
    for (const k of keys) {
      if (k === "password" || k === "Authorization" || k === "authorization") {
        out[k] = "[redacted]";
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
  const entry = {
    id: ++seq,
    ts: new Date().toISOString(),
    t: Date.now(),
    level: level || "info",
    category: category || "system",
    message: String(message || ""),
    data: data !== undefined ? safeClone(data) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (enabled) {
    const tag = `[Twelve:${category}]`;
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(tag, message, data !== undefined ? data : "");
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
  persist();
  notify();
}

export function isDebugEnabled() {
  return enabled;
}

export function setDebugEnabled(v) {
  enabled = !!v;
  persist();
  dlog.info("system", enabled ? "Debug panel ENABLED" : "Debug panel disabled");
  notify();
}

export function subscribeDebugLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot auth/Firebase lúc xảy ra sự kiện (phục vụ bug isLoggedIn). */
export function snapshotAuth(extra = {}) {
  try {
    const u = authSafeUser();
    return {
      ...extra,
      hasCurrentUser: !!u,
      uid: u?.uid || null,
      email: u?.email || null,
      emailVerified: u?.emailVerified ?? null,
      href: typeof location !== "undefined" ? location.href : null,
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

/** AuthContext đăng ký getter currentUser để snapshot không circular import. */
export function registerAuthSnapshotGetter(fn) {
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
