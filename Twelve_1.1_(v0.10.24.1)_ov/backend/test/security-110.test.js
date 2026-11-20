// Twelve 1.1 (0.10.24.1.191126) — hồi quy cho các bản vá bảo mật chuyển từ Twelve 2.5.3.3 sang 0.10.24.
// Chạy: node --test test/security-110.test.js
// Dùng Firestore/Auth GIẢ (test/helpers/fakeFirebase.js) — KHÔNG chạm dịch vụ thật.
process.env.SHARE_LINK_SECRET = "test-secret-110";
process.env.FRONTEND_URL = "https://twelve.example";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const express = require("express");

const { install } = require("./helpers/fakeFirebase");
const nowSec = () => Math.floor(Date.now() / 1000);
const fb = install({
  tokens: { tA: "uA", tB: "uB", tC: "uC", tD: "uD", tSA: "uSA", tP: "uP", tR: "uR" },
  authTimes: { tA: nowSec() - 10, tB: nowSec() - 10, tC: nowSec() - 10, tD: nowSec() - 10, tSA: nowSec() - 10, tP: nowSec() - 10, tR: nowSec() - 10 },
  userRecords: {},
});
const S = fb.store;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { installAsyncErrorForwarding } = require("../src/utils/asyncErrors");
installAsyncErrorForwarding();
const limiters = require("../src/middleware/rateLimiters");
const helpers = require("../src/utils/helpers");
const input = require("../src/utils/input");

const app = express();
app.set("trust proxy", require("../src/utils/clientIp").trustProxySetting());
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth", require("../src/routes/auth.routes"));
app.use("/api/users", require("../src/routes/users.routes"));
app.use("/api/posts", require("../src/routes/posts.routes"));
app.use("/api/blogs", require("../src/routes/blog.routes"));
app.get("/__boom", async () => { throw new Error("boom từ handler async"); });
app.use((err, req, res, next) => { // giống error handler tập trung của server.js
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: "Lỗi máy chủ nội bộ." });
});
let server; let base;
test.before(async () => { server = http.createServer(app); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const call = async (method, url, token, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* không có body */ }
  return { status: res.status, body: json };
};
// Gửi đường dẫn NGUYÊN VĂN (fetch/WHATWG URL tự gộp `%2E%2E`).
const rawCall = (method, rawPath, token) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: server.address().port, path: rawPath, method, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
    let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  req.on("error", reject); req.end();
});

const seedUser = (uid, over = {}) => {
  S[`users/${uid}`] = { uid, displayName: `Tên ${uid}`, tagName: `tag_${uid.toLowerCase()}`, status: "active", accountGroup: "RA", country: "VN", email: `${uid.toLowerCase()}@x.com`, postsScoreSum: 0, positiveScore: 0, accountScore: 0, ...over };
  S[`tagNames/tag_${uid.toLowerCase()}`] = { uid };
};
const seedPost = (id, over = {}) => { S[`posts/${id}`] = { id, authorUid: "uA", title: "t", contentHtml: "<p>x</p>", likeCount: 0, dislikeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0, externalPostScore: 0, ...over }; };
const seedBlog = (id, over = {}) => { S[`blogs/${id}`] = { id, authorUid: "uSA", title: "b", contentHtml: "<p>x</p>", likeCount: 0, dislikeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0, externalPostScore: 0, isPublished: true, ...over }; };
const reset = () => {
  Object.keys(S).forEach((k) => delete S[k]);
  fb.authUsers.clear();
  for (const k of Object.keys(fb.userRecords)) delete fb.userRecords[k];
  fb.authCalls.getUser.length = 0;
  require("../src/middleware/auth").__test.clearRevokeCache();
  seedUser("uA"); seedUser("uB"); seedUser("uC"); seedUser("uD"); seedUser("uR");
  seedUser("uSA", { accountGroup: "SA" });
  seedUser("uP", { status: "pending" });
};
const quiet = async (fn) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// =========================================================== A-01
test("A-01: isSafeDocId chỉ nhận id dạng uid/id tự sinh của Firestore", () => {
  for (const ok of ["abc", "A1b2C3", "uid_ok-1", "x".repeat(128)]) assert.equal(input.isSafeDocId(ok), true, ok);
  for (const bad of ["a/b", "a/b/c", "..", ".", "", "__x__", "a b", "a%2Fb", "x".repeat(129), null, undefined, 5, {}, ["a"], "a\\b"]) assert.equal(input.isSafeDocId(bad), false, String(bad));
});

test("A-01: id chứa %2F => 404 ở MỌI route có :uid/:id/:commentId (không 500, không sập)", async () => {
  reset(); seedPost("p1"); seedBlog("b1");
  const bad = ["a%2Fb", "a%2Fb%2Fc", "uA%2FpositiveScoreLogs%2Fl1", "%2E%2E", "__x__", "a%5Cb"];
  const routes = [
    ["GET", (x) => `/api/users/${x}`], ["GET", (x) => `/api/posts/${x}`], ["GET", (x) => `/api/blogs/${x}`],
    ["GET", (x) => `/api/posts/${x}/comments`], ["POST", (x) => `/api/posts/${x}/share`], ["POST", (x) => `/api/posts/${x}/react`, "tA"],
    ["PATCH", (x) => `/api/posts/${x}`, "tA"], ["DELETE", (x) => `/api/posts/${x}`, "tA"], ["GET", (x) => `/api/blogs/${x}/comments`],
    ["DELETE", (x) => `/api/posts/p1/comments/${x}`, "tA"],
  ];
  await quiet(async () => {
    for (const [m, url, tok] of routes) for (const b of bad) {
      const r = await rawCall(m, url(b), tok);
      assert.equal(r.status, 404, `${m} ${url(b)} => ${r.status}`);
    }
  });
});

test("A-01: lỗi ném ra từ handler async đi vào error handler (500 JSON), không thành unhandledRejection", async () => {
  const seen = [];
  const onRej = (r) => seen.push(r);
  process.on("unhandledRejection", onRej);
  const r = await quiet(() => call("GET", "/__boom"));
  await sleep(100);
  process.off("unhandledRejection", onRej);
  assert.equal(r.status, 500);
  assert.equal(seen.length, 0, "không có unhandledRejection");
});

test("A-01: server.js THẬT — GET /api/users/a%2Fb trả 404 và tiến trình VẪN SỐNG (trước đây thoát với exit code 1)", async () => {
  const port = 19000 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ["-r", "./test/helpers/preload-fake.js", "server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), NODE_ENV: "development", CORS_ORIGIN: "" },
    stdio: "ignore",
  });
  let exitCode = null;
  child.on("exit", (c) => { exitCode = c; });
  const get = async (p) => { try { const r = await fetch(`http://127.0.0.1:${port}${p}`); return r.status; } catch (e) { return `ERR:${e.cause?.code || e.message}`; } };
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { if ((await get("/health")) === 200) up = true; else await sleep(100); }
    assert.ok(up, "server khởi động được với Firestore giả");
    assert.equal(await get("/api/users/a%2Fb"), 404);
    assert.equal(await get("/api/users/a%2Fb%2Fc"), 404);
    assert.equal(await get("/post/a%2Fb"), 404);
    await sleep(300);
    assert.equal(exitCode, null, "tiến trình không được thoát");
    assert.equal(await get("/health"), 200, "dịch vụ vẫn phục vụ sau các request độc hại");
  } finally { child.kill(); }
});

// =========================================================== F4 / F6 (xác thực)
test("F4: tài khoản pending/suspended trên route công khai bị coi như KHÁCH (không có req.authUid)", async () => {
  reset();
  const { optionalAuth } = require("../src/middleware/auth");
  const run = async (token) => { const req = { headers: { authorization: `Bearer ${token}` } }; await optionalAuth(req, {}, () => {}); return req; };
  assert.equal((await run("tA")).authUid, "uA");
  assert.equal((await run("tP")).authUid, undefined, "pending không được coi là người dùng");
  S["users/uB"].status = "suspended";
  assert.equal((await run("tB")).authUid, undefined, "suspended không được coi là người dùng");
});

test("F6: token đã bị thu hồi (tokensValidAfterTime > iat) bị từ chối 401; tra cứu được cache theo uid", async () => {
  reset();
  const ok = await call("GET", "/api/users/me", "tA");
  assert.equal(ok.status, 200);
  await call("GET", "/api/users/me", "tA");
  assert.equal(fb.authCalls.getUser.filter((u) => u === "uA").length, 1, "2 request liên tiếp chỉ tra cứu Auth 1 lần (cache 60 giây)");
  // thu hồi phiên của uB: mốc hợp lệ nằm SAU thời điểm phát token
  fb.userRecords.uB = { tokensValidAfterTime: new Date(Date.now() + 5000).toUTCString() };
  const r = await call("GET", "/api/users/me", "tB");
  assert.equal(r.status, 401);
});

// =========================================================== F7 / F8 / F9 (đầu vào)
test("F7: stripBidiAndInvisible/cleanDisplayText bỏ bidi-override, rộng-0, điều khiển", () => {
  assert.equal(input.stripBidiAndInvisible("a\u202Eb\u200Bc\u2066d"), "abcd", "văn bản tự do: bỏ bidi/rộng-0 (giữ xuống dòng/ZWJ cho emoji)");
  assert.equal(input.cleanDisplayText("  Tên\u202E  A\u200B\u0007  "), "Tên A", "tên hiển thị: bỏ cả ký tự điều khiển");
});

test("F8: parseLimit/parseCursor chịu được sai kiểu", () => {
  assert.equal(input.parseLimit("-5", 10, 30), 10);
  assert.equal(input.parseLimit(["7"], 10, 30), 10);
  assert.equal(input.parseLimit("999", 10, 30), 30);
  assert.equal(input.parseLimit("12", 10, 30), 12);
  assert.equal(input.parseCursor(undefined).ok, true);
  assert.equal(input.parseCursor(["x"]).ok, false);
  assert.equal(input.parseCursor("a/b").ok, false);
  assert.equal(input.parseCursor("abc123").value, "abc123");
});

test("F8: GET /api/posts với limit âm / cursor mảng / cursor chứa '/' không còn 500", async () => {
  reset(); seedPost("p1");
  assert.equal((await call("GET", "/api/posts?limit=-5")).status, 200);
  assert.equal((await call("GET", "/api/posts?cursor=a%2Fb")).status, 400);
  assert.equal((await call("GET", "/api/posts?cursor[]=x&cursor[]=y")).status, 400);
  assert.equal((await call("GET", "/api/blogs?limit=abc")).status, 200);
});

test("F8: bình luận có content sai kiểu (số/mảng/đối tượng) => 400, không 500", async () => {
  reset(); seedPost("p1");
  for (const bad of [123, ["a"], { a: 1 }, true]) {
    const r = await quiet(() => call("POST", "/api/posts/p1/comments", "tB", { content: bad }));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test("F9: validateBirthday nghiêm ngặt (đúng lịch, không nhận định dạng lạ, không ở tương lai)", () => {
  assert.equal(input.validateBirthday("2000-02-29").ok, true);
  for (const bad of ["2023-02-31", "2020-W01-1", "2000-01-01T00:00:00Z", "1899-12-31", "2999-01-01", "", null, 5, ["2000-01-01"]]) assert.equal(input.validateBirthday(bad).ok, false, String(bad));
});

// =========================================================== Blog nháp
test("Blog nháp: người lạ nhận 404 ở getBlog / comments / react / share / thêm bình luận; tác giả/SA vẫn xem được", async () => {
  reset(); seedBlog("bd", { isPublished: false }); seedBlog("bp");
  assert.equal((await call("GET", "/api/blogs/bd")).status, 404, "khách");
  assert.equal((await call("GET", "/api/blogs/bd", "tB")).status, 404, "người dùng khác");
  assert.equal((await call("GET", "/api/blogs/bd", "tSA")).status, 200, "tác giả/SA");
  assert.equal((await call("GET", "/api/blogs/bd/comments")).status, 404);
  assert.equal((await call("POST", "/api/blogs/bd/react", "tB", { type: "like" })).status, 404);
  assert.equal((await call("POST", "/api/blogs/bd/share")).status, 404);
  assert.equal((await call("POST", "/api/blogs/bd/comments", "tB", { content: "hi" })).status, 404);
  assert.equal(S["blogs/bd"].viewCount, 0, "bản nháp không được cộng view khi tác giả xem trước");
  assert.equal((await call("GET", "/api/blogs/bp")).status, 200, "blog đã xuất bản vẫn công khai");
  assert.equal((await call("GET", "/api/blogs/bp/comments")).status, 200);
  assert.equal((await call("GET", "/api/blogs")).body.blogs.some((b) => b.id === "bd"), false, "danh sách không có bản nháp");
});

// =========================================================== Chống farm điểm bình luận
test("Chống farm điểm: chỉ bình luận ĐẦU TIÊN của (người dùng, bài) được cộng điểm; xoá bình luận không hoàn điểm chưa từng cộng", async () => {
  reset(); seedPost("p1");
  const a = await call("POST", "/api/posts/p1/comments", "tB", { content: "một" });
  const b = await call("POST", "/api/posts/p1/comments", "tB", { content: "hai" });
  const c = await call("POST", "/api/posts/p1/comments", "tB", { content: "ba" });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(c.status, 201);
  assert.equal(S["posts/p1"].commentCount, 3, "cả 3 bình luận đều hiện");
  assert.equal(S["posts/p1"].externalPostScore, 3, "chỉ +3 một lần");
  assert.equal(S["users/uB"].positiveScore, 1, "chỉ +1 một lần");
  assert.equal(S[`posts/p1/comments/${a.body.commentId}`].scored, true);
  assert.equal(S[`posts/p1/comments/${b.body.commentId}`].scored, false);
  // xoá bình luận KHÔNG được cộng điểm => không trừ
  assert.equal((await call("DELETE", `/api/posts/p1/comments/${b.body.commentId}`, "tB")).status, 200);
  assert.equal(S["posts/p1"].externalPostScore, 3); assert.equal(S["users/uB"].positiveScore, 1);
  // xoá bình luận ĐÃ được cộng điểm => hoàn đúng
  assert.equal((await call("DELETE", `/api/posts/p1/comments/${a.body.commentId}`, "tB")).status, 200);
  assert.equal(S["posts/p1"].externalPostScore, 0); assert.equal(S["users/uB"].positiveScore, 0);
  // người KHÁC vẫn được cộng điểm cho bình luận đầu của họ
  await call("POST", "/api/posts/p1/comments", "tC", { content: "c" });
  assert.equal(S["posts/p1"].externalPostScore, 3);
  // bình luận cũ (không có field `scored`) coi là đã cộng điểm khi xoá — tương thích dữ liệu 0.10.24
  S["posts/p1/comments/old1"] = { id: "old1", authorUid: "uD", content: "cũ" };
  S["posts/p1"].externalPostScore = 6; S["posts/p1"].commentCount = 3; S["users/uD"].positiveScore = 5;
  await call("DELETE", "/api/posts/p1/comments/old1", "tD");
  assert.equal(S["posts/p1"].externalPostScore, 3); assert.equal(S["users/uD"].positiveScore, 4);
});

// =========================================================== bơm view (XFF) + điểm xem 1 lần/cặp
test("Bơm view: khoá khách KHÔNG còn phụ thuộc X-Forwarded-For do client đặt", () => {
  const mk = (xff) => ({ headers: { "x-forwarded-for": xff }, ip: "9.9.9.9", socket: { remoteAddress: "9.9.9.9" } });
  assert.equal(helpers.viewerKeyFromRequest(mk("1.1.1.1")), helpers.viewerKeyFromRequest(mk("2.2.2.2")));
  assert.equal(helpers.viewerKeyFromRequest({ authUid: "uA", headers: {} }), "u:uA");
});

test("Điểm xem chỉ cộng 1 lần/(người xem, bài); viewCount vẫn tăng; VIEW_SCORE_ONCE_PER_PAIR=off quay về cách cũ", async () => {
  reset(); seedPost("p1");
  const opts = { viewerKey: "u:uB", viewerUid: "uB", authorUid: "uA" };
  assert.equal(await helpers.registerView(fb.db, fb.admin, "posts", "p1", opts), true);
  assert.equal(S["users/uB"].positiveScore, 1);
  S["posts/p1/views/u:uB"].lastViewedAtMs = Date.now() - 31 * 60 * 1000; // hết cửa sổ dedup
  assert.equal(await helpers.registerView(fb.db, fb.admin, "posts", "p1", opts), true);
  assert.equal(S["posts/p1"].viewCount, 2, "view hiển thị vẫn tăng");
  assert.equal(S["users/uB"].positiveScore, 1, "điểm KHÔNG cộng lần 2");
  assert.equal(S["posts/p1"].externalPostScore, 1);
  process.env.VIEW_SCORE_ONCE_PER_PAIR = "off";
  try {
    S["posts/p1/views/u:uB"].lastViewedAtMs = Date.now() - 31 * 60 * 1000;
    await helpers.registerView(fb.db, fb.admin, "posts", "p1", opts);
    assert.equal(S["users/uB"].positiveScore, 2, "công tắc off => hành vi 0.10.24");
  } finally { delete process.env.VIEW_SCORE_ONCE_PER_PAIR; }
});

// =========================================================== trần thưởng chia sẻ
test("Trần thưởng chia sẻ: chỉ N lần +8/ngày cho một người chia sẻ; shareCount vẫn tăng", async () => {
  reset(); seedPost("p1");
  process.env.SHARE_REWARD_DAILY_CAP = "2";
  try {
    const sig = helpers.signShareParams("uB", "posts", "p1");
    const viewers = ["uA2", "uC", "uD", "uR"];
    for (const v of viewers) {
      if (!S[`users/${v}`]) seedUser(v);
      await quiet(() => helpers.registerShare(fb.db, fb.admin, "posts", "p1", { rawSharerUid: "uB", signature: sig, authorUid: "uA", viewerKey: `u:${v}`, viewerUid: v }));
    }
    assert.equal(S["posts/p1"].shareCount, 4, "shareCount hiển thị tăng đủ");
    assert.equal(S["users/uB"].positiveScore, 16, "chỉ 2 lần × 8 điểm");
    assert.equal(S["users/uB"].shareRewardCount, 2);
  } finally { delete process.env.SHARE_REWARD_DAILY_CAP; }
});

// =========================================================== SSR proxy tin cậy
test("SSR: chỉ request mang secret đúng mới được cộng view ở production", () => {
  const { canCountSsrView, isTrustedSsrProxy } = require("../src/utils/clientIp");
  const prevEnv = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  process.env.SSR_PROXY_SECRET = "s3cret";
  try {
    assert.equal(canCountSsrView({ headers: {} }), false);
    assert.equal(canCountSsrView({ headers: { "x-twelve-ssr-secret": "sai" } }), false);
    assert.equal(canCountSsrView({ headers: { "x-twelve-ssr-secret": "s3cret" } }), true);
    assert.equal(isTrustedSsrProxy({ headers: { "x-twelve-ssr-secret": "s3cret" } }), true);
    delete process.env.SSR_PROXY_SECRET;
    assert.equal(canCountSsrView({ headers: { "x-twelve-ssr-secret": "s3cret" } }), false, "không cấu hình secret => không ai được tin");
  } finally { process.env.NODE_ENV = prevEnv; delete process.env.SSR_PROXY_SECRET; }
});

test("TW-01: getClientKey không tin X-Forwarded-For giả khi không đi qua proxy tin cậy", () => {
  const { getClientKey } = require("../src/utils/clientIp");
  const a = getClientKey({ headers: { "x-forwarded-for": "1.2.3.4" }, ip: "8.8.8.8", socket: { remoteAddress: "8.8.8.8" } });
  const b = getClientKey({ headers: { "x-forwarded-for": "5.6.7.8" }, ip: "8.8.8.8", socket: { remoteAddress: "8.8.8.8" } });
  assert.equal(a, b);
});

// =========================================================== sanitize
test("Sanitizer: lọc class (ql-hidden), style (kích thước 0/màu trong suốt), data-*, và ép rel an toàn", () => {
  const { sanitizeHtml } = require("../src/services/sanitize.service");
  assert.ok(!/ql-hidden/.test(sanitizeHtml('<span class="ql-hidden">x</span>')));
  assert.ok(/ql-size-large/.test(sanitizeHtml('<span class="ql-size-large">x</span>')));
  assert.ok(!/font-size/.test(sanitizeHtml('<p style="font-size:0px">x</p>')));
  assert.ok(!/data-|aria-/.test(sanitizeHtml('<p data-a="1" aria-label="x">x</p>')));
  const out = sanitizeHtml('<a href="https://e.example" target="_blank" rel="opener">l</a>');
  assert.match(out, /rel="ugc nofollow noopener"/);
  assert.ok(!/<script/i.test(sanitizeHtml("<p>a</p><script>alert(1)</script>")));
});

test("F1: contentPipeline từ chối HTML quá lớn/quá sâu/sai kiểu bằng mã lỗi rõ ràng (không treo)", async () => {
  const { processContentHtml } = require("../src/services/contentPipeline");
  const ok = await processContentHtml("<p>Xin chào</p>");
  assert.equal(ok.html, "<p>Xin chào</p>");
  await assert.rejects(() => processContentHtml(["<p>x</p>"]), (e) => e.code === "CONTENT_INVALID");
  await assert.rejects(() => processContentHtml("x".repeat(300000)), (e) => e.code === "CONTENT_TOO_LONG");
  await assert.rejects(() => processContentHtml("<div>".repeat(200) + "x"), (e) => e.code === "CONTENT_TOO_COMPLEX");
  const t0 = Date.now();
  await assert.rejects(() => processContentHtml("<foo>".repeat(2000)));
  assert.ok(Date.now() - t0 < 4000, "bị chặn nhanh, không tốn nhiều giây trên event loop");
});

test("F1: POST /api/posts với contentHtml sai kiểu/quá phức tạp => 4xx (không 500)", async () => {
  reset();
  const r1 = await quiet(() => call("POST", "/api/posts", "tA", { title: "Tiêu đề bài viết", contentHtml: { a: 1 } }));
  assert.ok(r1.status >= 400 && r1.status < 500, `status ${r1.status}`);
  const r2 = await quiet(() => call("POST", "/api/posts", "tA", { title: "Tiêu đề bài viết", contentHtml: "<div>".repeat(300) + "x" }));
  assert.equal(r2.status, 422);
  const r3 = await call("POST", "/api/posts", "tA", { title: "Tiêu\u202E đề bài viết", contentHtml: "<p>nội dung</p>" });
  assert.equal(r3.status, 201);
  assert.equal(S[`posts/${r3.body.postId}`].title, "Tiêu đề bài viết", "ký tự bidi bị bỏ khỏi tiêu đề");
});

// =========================================================== giới hạn tần suất
test("Limiter: tạo bài tối đa 20/giờ/tài khoản (request lỗi không tốn lượt)", async () => {
  reset(); limiters.postCreateLimiter.resetKey("uid:uR");
  for (let i = 0; i < 3; i++) await quiet(() => call("POST", "/api/posts", "tR", { title: "", contentHtml: "" })); // 400, không tốn lượt (skipFailedRequests)
  let last;
  for (let i = 0; i < 21; i++) last = await call("POST", "/api/posts", "tR", { title: `Tiêu đề số ${i}`, contentHtml: "<p>x</p>" });
  assert.equal(last.status, 429, "bài thứ 21 trong 1 giờ bị chặn");
  limiters.postCreateLimiter.resetKey("uid:uR");
});

// =========================================================== ảnh bìa theo allowlist + tag dành riêng
test("Ảnh bìa phải thuộc domain được phép (trừ ảnh bìa đang lưu không đổi)", () => {
  const { validateCoverImageUrl } = helpers;
  assert.equal(validateCoverImageUrl(null), null);
  assert.match(validateCoverImageUrl("https://evil.example/x.png"), /domain/);
  assert.equal(validateCoverImageUrl("https://evil.example/x.png", "https://evil.example/x.png"), null, "ảnh đang lưu không bị kiểm tra lại");
  assert.match(validateCoverImageUrl("http://i.imgur.com/x.png"), /https/);
});

test("A-04: tag dành riêng (admin/twelve/support…, kể cả biến thể giống hệt) không đăng ký/kiểm tra được", async () => {
  assert.equal(helpers.isReservedTagName("admin"), true);
  assert.equal(helpers.isReservedTagName("Adm1n"), true, "biến thể thay số");
  assert.equal(helpers.isReservedTagName("tag_binhthuong"), false);
  const r = await call("GET", "/api/auth/check-tagname?tag=admin");
  assert.equal(r.status, 200); assert.equal(r.body.available, false);
});

// =========================================================== firestore.rules
test("firestore.rules: config/* và positiveScoreLogs bị khoá; blog nháp không đọc công khai", () => {
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  const block = (re) => { const m = rules.match(re); assert.ok(m, `không thấy khối ${re}`); return m[0]; };
  assert.match(block(/match \/config\/\{docId\} \{[^}]*\}/), /allow read, write: if false/);
  assert.match(block(/match \/users\/\{uid\}\/positiveScoreLogs\/\{logId\} \{[^}]*\}/), /allow read, write: if false/);
  const blogs = block(/match \/blogs\/\{blogId\} \{[^}]*\}/);
  assert.match(blogs, /isPublished == true/);
  assert.doesNotMatch(blogs, /allow get: if true/);
  assert.match(block(/match \/blogs\/\{blogId\}\/comments\/\{commentId\} \{[^}]*\}/), /isPublished == true/);
});

// =========================================================== upload (F2/F11)
test("F2/F11: multer giới hạn field text; sniffImageMime từ chối file không phải ảnh", () => {
  const upload = require("../src/middleware/upload");
  assert.ok(upload, "middleware upload nạp được");
  const src = fs.readFileSync(path.join(__dirname, "../src/middleware/upload.js"), "utf8");
  assert.match(src, /fields: 5/); assert.match(src, /fieldSize: 1024/);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  assert.equal(input.sniffImageMime(png), "image/png");
  assert.equal(input.sniffImageMime(Buffer.from("<?xml version=\"1.0\"?><svg/>")), null);
  assert.equal(input.sniffImageMime(Buffer.from("30263ca2b2e7d311b9b900c04fc2d6aa", "hex")), null, "tiêu đề ASF (gốc lỗi treo file-type) bị chặn trước");
});
