/** Session ẩn danh phía client — dùng chống đếm trùng view/share trong cùng tab. */
const KEY = "twelve_sid";

export function getSessionId() {
  try {
    let id = sessionStorage.getItem(KEY);
    if (id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
    id =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
      ).slice(0, 32);
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}
