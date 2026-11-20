/**
 * Twelve 1.1 (0.10.24.1.191126) — test hồi quy bảo mật cho các bản vá backport.
 * Chạy: node --test test/security-11.test.js  (không cần mạng, không cần Firebase).
 * Mỗi test tương ứng một lỗ hổng đã vá; hoàn nguyên vá thì test tương ứng FAIL.
 */
const { test } = require("node:test");
const assert = require("node:assert");

const { isSafeDocId } = require("../src/middleware/idParams");
const { getClientKey, isCloudflareIp } = require("../src/utils/clientIp");
const { assessHtml, sanitizeHtml, sanitizeContentAsync, CONTENT_LIMITS } = require("../src/services/sanitize.service");

// A-01: id lạ chứa /, .., __x__ phải bị chặn.
test("A-01: isSafeDocId chặn id chứa /, .., __x__, rỗng, quá dài", () => {
  assert.strictEqual(isSafeDocId("a/b"), false);
  assert.strictEqual(isSafeDocId("a%2Fb"), false); // % không hợp lệ
  assert.strictEqual(isSafeDocId(".."), false);
  assert.strictEqual(isSafeDocId("__private__"), false);
  assert.strictEqual(isSafeDocId(""), false);
  assert.strictEqual(isSafeDocId("x".repeat(129)), false);
  assert.strictEqual(isSafeDocId("abcDEF123_-"), true);
  assert.strictEqual(isSafeDocId("a".repeat(28)), true); // uid Firebase điển hình
});

// F1: assessHtml chặn input quá khổ trước khi vào DOMPurify.
test("F1: assessHtml chặn quá nhiều ký tự / phần tử / độ sâu / media", () => {
  assert.strictEqual(assessHtml("<p>x</p>").ok, true);
  assert.strictEqual(assessHtml("x".repeat(CONTENT_LIMITS.MAX_CHARS + 1)).ok, false);
  const manyDivs = "<div>".repeat(CONTENT_LIMITS.MAX_DEPTH + 5);
  assert.strictEqual(assessHtml(manyDivs).ok, false);
  const manyImgs = "<img src='https://youtube.com/a.png'>".repeat(CONTENT_LIMITS.MAX_MEDIA + 5);
  assert.strictEqual(assessHtml(manyImgs).ok, false);
  assert.strictEqual(assessHtml(123).ok, false); // không phải chuỗi
});

// R-01 / A-06: color với alpha thấp / transparent / màu hệ thống bị loại.
test("R-01: style color #fff0, transparent, color-mix() bị loại; màu hợp lệ giữ", () => {
  const out1 = sanitizeHtml('<p style="color: #fff0">x</p>');
  assert.ok(!out1.includes("#fff0"), "hex4 alpha thấp bị loại");
  const out2 = sanitizeHtml('<p style="color: transparent">x</p>');
  assert.ok(!out2.includes("transparent"), "transparent bị loại");
  const out3 = sanitizeHtml('<p style="color: red">x</p>');
  assert.ok(out3.includes("color: red"), "tên màu hợp lệ giữ");
  const out4 = sanitizeHtml('<p style="color: #ffffff">x</p>');
  assert.ok(out4.includes("#ffffff"), "hex6 hợp lệ giữ");
  const out5 = sanitizeHtml('<p style="font-size: 500px">x</p>');
  assert.ok(!out5.includes("500px"), "font-size vượt ngưỡng bị loại");
});

// TW-06: class không phải ql-* bị loại.
test("TW-06: class chỉ giữ ql-*; class tùy ý (ẩn chữ qua CSS) bị loại", () => {
  const out = sanitizeHtml('<p class="ql-align-center evil-hidden hidden-text">x</p>');
  assert.ok(out.includes("ql-align-center"), "class ql-* hợp lệ giữ");
  assert.ok(!out.includes("evil-hidden"), "class tùy ý bị loại");
  assert.ok(!out.includes("hidden-text"), "class ẩn chữ bị loại");
});

// PATCH-2 #9: link ngoài bị ép rel="ugc nofollow noopener"; javascript: bị loại.
test("PATCH-2 #9: link ngoài có rel ugc nofollow noopener; javascript: bị loại", () => {
  const out = sanitizeHtml('<a href="https://evil.com/x" target="_blank">x</a>');
  assert.ok(out.includes('rel="ugc nofollow noopener"'), "rel được ép");
  assert.ok(out.includes('target="_blank"'), "target=_blank giữ kèm noopener");
  const outJs = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!outJs.includes("javascript:"), "javascript: bị loại");
});

// TW-01: getClientKey luôn trả chuỗi; IP Cloudflare thì tin CF-Connecting-IP.
test("TW-01: getClientKey không rỗng; IPv6 rút /64; CF-Connecting-IP chỉ tin khi req.ip là Cloudflare", () => {
  const req1 = { ip: "1.2.3.4", headers: {}, socket: { remoteAddress: "1.2.3.4" } };
  assert.ok(getClientKey(req1).startsWith("ip:"));
  const req2 = { ip: "172.71.1.1", headers: { "cf-connecting-ip": "9.9.9.9" }, socket: {} };
  assert.ok(isCloudflareIp("172.71.1.1"));
  assert.ok(getClientKey(req2).includes("9.9.9.9"));
  const req3 = { ip: "1.2.3.4", headers: { "cf-connecting-ip": "9.9.9.9" }, socket: {} };
  assert.ok(!getClientKey(req3).includes("9.9.9.9"), "gọi thẳng origin (ip không phải CF) → bỏ qua header giả");
  const req6 = { ip: "2400:cb00::1", headers: { "cf-connecting-ip": "2001:db8::1234" }, socket: {} };
  assert.ok(getClientKey(req6).includes("/64"), "IPv6 rút /64");
});

// F1 worker: sanitizeContentAsync trả về cleanHtml + excerpt (có fallback sync).
test("F1 worker: sanitizeContentAsync trả cleanHtml+excerpt và chặn script", async () => {
  const r = await sanitizeContentAsync("<p>Hello <b>world</b></p><script>alert(1)</script>");
  assert.ok(r.cleanHtml.includes("Hello"));
  assert.ok(!r.cleanHtml.includes("<script"));
  assert.ok(typeof r.excerpt === "string");
});
