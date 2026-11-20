// v1.1 — Firestore + Auth GIẢ trong bộ nhớ cho test bảo mật (chép từ src/debug/support/fakeFirebase.js của Twelve 2.5.3.3; chỉ đổi đường dẫn tới config/firebase).
// Mô phỏng đúng SDK thật ở chỗ `.doc("a/b")` ném lỗi đồng bộ — gốc của lỗi A-01.
// (v2.3.0) Đã chuyển từ test/helpers/ vào src/debug/support/ để các module "Gỡ lỗi" (isolated) dùng được ở production; test/helpers/fakeFirebase.js giờ chỉ re-export.
// Firestore + Auth GIẢ trong bộ nhớ dùng chung cho các test bảo mật (v2.0.10).
// Hỗ trợ: doc get/set/update/delete, collection get/where(==, array-contains)/orderBy/limit/select, getAll, batch,
// transaction (đọc trước ghi), FieldValue.increment/serverTimestamp, recursiveDelete.
const path = require("path");

function install(opts = {}) {
  const store = {};
  const tokens = opts.tokens || {}; // token -> uid
  const authTimes = opts.authTimes || {}; // token -> auth_time (giây) — để test requireRecentAuth (v2.2.0)
  const applyWrite = (p, data, merge) => {
    const cur = store[p] || {};
    const base = merge ? { ...cur } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v && v.__del) { delete base[k]; continue; } // FieldValue.delete() (v2.2.0)
      base[k] = v && v.__inc !== undefined ? (cur[k] || 0) + v.__inc : v && v.__ts ? Date.now() : v;
    }
    store[p] = base;
  };
  const snapOf = (p) => ({ id: p.split("/").pop(), exists: p in store, data: () => store[p], get: (k) => (store[p] ? store[p][k] : undefined), ref: refOf(p) });
  function queryOf(colPath, filters = [], order = null, max = Infinity, after = null) {
    const q = {
      where: (field, op, value) => queryOf(colPath, [...filters, { field, op, value }], order, max, after),
      orderBy: (field, dir) => queryOf(colPath, filters, { field, dir }, max, after),
      limit: (n) => queryOf(colPath, filters, order, n, after),
      select: () => q,
      // v2.5.3: con trỏ phân trang theo DocumentSnapshot (đủ cho quét theo trang của pendingCleanup): mặc định Firestore sắp theo id tài liệu (__name__).
      startAfter: (snap) => queryOf(colPath, filters, order, max, snap && snap.id !== undefined ? snap.id : null),
      async get() {
        const depth = colPath.split("/").length + 1;
        let rows = Object.keys(store).filter((p) => p.startsWith(colPath + "/") && p.split("/").length === depth).map((p) => ({ p, v: store[p] }))
          .filter(({ v }) => filters.every((f) => (f.op === "==" ? v[f.field] === f.value : (v[f.field] || []).includes(f.value))));
        if (order) rows.sort((a, b) => (order.dir === "desc" ? -1 : 1) * ((a.v[order.field] || 0) - (b.v[order.field] || 0)));
        // v2.5.3: không có orderBy thì Firestore thật trả theo id tài liệu (__name__) tăng dần — mô phỏng đúng để phân trang bằng startAfter nhất quán.
        if (!order) rows.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
        if (after !== null) rows = rows.filter(({ p }) => p.split("/").pop() > after);
        rows = rows.slice(0, max);
        return { docs: rows.map((r) => snapOf(r.p)), size: rows.length, empty: rows.length === 0 };
      },
    };
    return q;
  }
  function refOf(p) {
    return {
      path: p, id: p.split("/").pop(),
      get: async () => { if (reservedId(p)) throw new Error("INVALID_ARGUMENT: reserved document id"); return snapOf(p); },
      set: async (d, o) => applyWrite(p, d, o && o.merge),
      update: async (d) => { if (!(p in store)) throw new Error("NOT_FOUND"); applyWrite(p, d, true); },
      delete: async () => void delete store[p],
      collection: (n) => colOf(`${p}/${n}`),
      // v2.2.0: các subcollection đang có dữ liệu dưới document này (giống Firestore thật: chỉ trả collection có document).
      listCollections: async () => {
        const names = new Set(Object.keys(store).filter((k) => k.startsWith(p + "/")).map((k) => k.slice(p.length + 1).split("/")[0]));
        return [...names].map((n) => colOf(`${p}/${n}`));
      },
    };
  }
  let autoId = 0;
  // v2.2.1: mô phỏng đúng SDK Firestore thật ở 2 điểm từng gây lỗi: (1) `doc(id)` NÉM LỖI ĐỒNG BỘ khi đường dẫn kết quả có số đoạn LẺ (id "a/b" => `users/a/b`),
  // còn "a/b/c" thì HỢP LỆ và trỏ vào tài liệu lồng nhau; id rỗng/không phải chuỗi cũng ném; (2) máy chủ từ chối id dành riêng (`.`, `..`, `__x__`) khi đọc/ghi.
  const checkDocId = (c, id) => {
    if (id === undefined) return;
    if (typeof id !== "string" || id === "" || (`${c}/${id}`.split("/").length % 2 !== 0) || `${c}/${id}`.split("/").some((x) => x === "")) {
      throw new Error(`Value for argument "documentPath" must point to a document, but was "${id}".`);
    }
  };
  const reservedId = (p) => { const last = p.split("/").pop(); return last === "." || last === ".." || /^__.*__$/.test(last); };
  const colOf = (c) => Object.assign(queryOf(c), { path: c, id: c.split("/").pop(), doc: (id) => { checkDocId(c, id); return refOf(`${c}/${id === undefined ? "auto" + ++autoId : id}`); } });
  const db = {
    collection: colOf,
    async getAll(...refs) { return refs.map((r) => snapOf(r.path)); },
    async runTransaction(fn) {
      const pending = [];
      const tx = {
        get: async (x) => (x.path !== undefined ? snapOf(x.path) : x.get()),
        set: (r, d, o) => pending.push(() => applyWrite(r.path, d, o && o.merge)),
        update: (r, d) => pending.push(() => applyWrite(r.path, d, true)),
        delete: (r) => pending.push(() => delete store[r.path]),
      };
      const out = await fn(tx);
      pending.forEach((f) => f());
      return out;
    },
    batch() {
      const ops = [];
      return { set: (r, d, o) => ops.push(() => applyWrite(r.path, d, o && o.merge)), update: (r, d) => ops.push(() => applyWrite(r.path, d, true)), delete: (r) => ops.push(() => delete store[r.path]), commit: async () => ops.forEach((f) => f()) };
    },
    async recursiveDelete(ref) { Object.keys(store).filter((p) => p === ref.path || p.startsWith(ref.path + "/")).forEach((p) => delete store[p]); },
  };
  const admin = { firestore: { FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }), delete: () => ({ __del: true }) }, FieldPath: { documentId: () => "__name__" } } };
  const authCalls = { verify: [], getUser: [] };
  const authUsers = new Map();
  let uidSeq = 0;
  const userRecords = opts.userRecords || {}; // uid -> { tokensValidAfterTime }
  const auth = {
    verifyIdToken: async (t, checkRevoked) => {
      authCalls.verify.push({ t, checkRevoked });
      if (!(t in tokens)) throw new Error("invalid token");
      return { uid: tokens[t], email_verified: true, iat: Math.floor(Date.now() / 1000) - 10, ...(t in authTimes ? { auth_time: authTimes[t] } : {}) };
    },
    getUser: async (uid) => {
      authCalls.getUser.push(uid);
      if (authUsers.has(uid)) return { ...authUsers.get(uid), ...(userRecords[uid] || {}) };
      return userRecords[uid] || { uid, tokensValidAfterTime: new Date(0).toUTCString() };
    },
    // Kho tài khoản Auth giả (v2.0.12): createUser trùng email => lỗi 'auth/email-already-exists' như Firebase thật.
    createUser: async (args) => {
      const email = String(args.email).toLowerCase();
      if ([...authUsers.values()].some((u) => u.email === email)) throw Object.assign(new Error("email exists"), { code: "auth/email-already-exists" });
      const uid = "auth" + ++uidSeq;
      const rec = { uid, email, displayName: args.displayName, metadata: { creationTime: new Date().toUTCString() } };
      authUsers.set(uid, rec);
      return rec;
    },
    getUserByEmail: async (email) => {
      const u = [...authUsers.values()].find((x) => x.email === String(email).toLowerCase());
      if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      return u;
    },
    deleteUser: async (uid) => { if (!authUsers.delete(uid)) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" }); },
    // v2.2.0 — quy trình xoá tài khoản: vô hiệu hoá + thu hồi phiên (ghi lại để test kiểm).
    updateUser: async (uid, patch) => {
      if (!authUsers.has(uid)) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      authUsers.set(uid, { ...authUsers.get(uid), ...patch });
      authCalls.updateUser = (authCalls.updateUser || []).concat([[uid, patch]]);
    },
    revokeRefreshTokens: async (uid) => {
      if (!authUsers.has(uid)) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      authCalls.revoked = (authCalls.revoked || []).concat([uid]);
    },
  };
  const fbPath = require.resolve(path.join(__dirname, "../../src/config/firebase"));
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { db, admin, auth } };
  return { store, db, admin, auth, tokens, authTimes, authCalls, userRecords, authUsers };
}
module.exports = { install };
