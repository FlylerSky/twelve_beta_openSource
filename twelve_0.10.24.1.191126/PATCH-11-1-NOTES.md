# PATCH-11-1 — Twelve 1.1 (0.10.24.1.191126) — Backport bảo mật từ 2.5.3.3

**Ngày:** 2026-11-19
**Phiên bản:** `twelve_0.10.24.1.191126` (tên thương mại: **Twelve 1.1**)
**Nền:** Twelve 0.10.24 (Twelve 1.0 Chính thức, `twelve_0_10_24_300926`)
**Nguồn vá:** Twelve 2.5.3.3 Beta (`twelve_2_5_3_3_151126`) — 27 PATCH notes đã đọc.
**Nguyên tắc:** CHỈ backport vá lỗ hổng bảo mật/abuse liên quan đến code CÓ SẴN trên 0.10.24.
TUYỆT ĐỐI không kéo theo tính năng mới của bản Beta (xoá tài khoản, Profile page,
tag names, debug panel, App Check, IP topology panel, Font, settings tree, SEO meta
tags, account deletion, badges, achievements, config audit, pending sweeper…).

---

## Tóm tắt mức độ (theo chuẩn v2.5.3: CRITICAL/HIGH/MEDIUM/LOW)

| Mức | Số lượng |
|---|---|
| CRITICAL | 1 (F1 — DoS sanitize) |
| HIGH | 4 (A-01 sập tiến trình, F2 multer, F11 file-type, TW-07/13 rules) |
| MEDIUM | 6 (F4, F6, R-01/A-06, TW-06, TW-10, TW-01) |
| LOW | 4 (F5 firebase-admin, N2 cookie-parser, TW-22 CORS, TW-25 updateMe) |
| **Tổng** | **15 lỗ hổng/điểm cứng hóa đã vá** |

Test hồi quy: `backend/test/security-11.test.js` — 7 test, tất cả PASS.
Chạy: `cd backend && npm install && npm run test:security`.

---

## Chi tiết các bản vá đã backport

### 1. F1 — CRITICAL DoS sanitize (PATCH-7, v2.0.10)
**Lỗ hổng:** `sanitizeHtml` chạy DOMPurify+jsdom trên LUỒNG CHÍNH, không giới hạn
đầu vào. HTML độc (nested table/div sâu, 2000 thẻ `<b>`, nhiều media) treo request
và ăn 100% CPU — một request là DoS được.
**Vá (3 lớp):**
- `assessHtml()` — quét O(n) KHÔNG dùng DOM, chặn input vượt ngưỡng
  (250KB ký tự / 5000 phần tử / độ sâu 100 / 300 thẻ không hỗ trợ / 200 media)
  TRƯỚC khi đưa vào DOMPurify → trả 422.
- `sanitizeContentAsync()` — chạy ở `worker_threads` (`sanitize.worker.js`) với
  timeout cứng 3 giây. Luồng chính không bao giờ bị chặn.
- Fallback an toàn: nếu worker không khả dụng (môi trường thiếu), tự dùng sync
  (đã qua assessHtml) — không làm hỏng request.
**File:** `src/services/sanitize.service.js` (mới), `src/services/sanitize.worker.js` (mới).
**Call site chuyển sang async:** `posts.controller.js` (createPost/updatePost),
`blog.controller.js` (createBlog/updateBlog). Script seed/migrate vẫn dùng sync.

### 2. A-01 — HIGH sập tiến trình bằng id lạ (PATCH-13, v2.2.1)
**Lỗ hổng:** route `:uid`/`:id`/`:commentId` truyền thẳng giá trị người dùng vào
`db.collection(...).doc(...)`. Id chứa `/`, `..`, `__x__` khiến Firestore SDK ném
trong handler async → lọt thành `unhandledRejection` → ở 0.10.24 tiến trình THOÁT
ngay → DoS một request, không cần đăng nhập.
**Vá (3 lớp):**
- `middleware/idParams.js` (mới) — `isSafeDocId` + `router.param` trả 404 ngay,
  không bao giờ tới Firestore. Gắn vào `users.routes` (uid), `posts.routes`/
  `blog.routes` (id, commentId), `ssr.routes` (id).
- `utils/asyncErrors.js` (mới) — `wrapAsync` cho handler async (dự phòng).
- `server.js` — `unhandledRejection` KHÔNG thoát ngay; chỉ thoát khi >10 lần/60s.
  Error handler kiểm `res.headersSent` trước khi set status.
- `users.controller#getPublicProfile` thêm try/catch (trả 500 có kiểm soát).

### 3. F2 — HIGH multer thiếu giới hạn field (PATCH-7, v2.0.10)
**Lỗ hổng:** `upload.js` chỉ giới hạn `fileSize`+`files`; kẻ tấn công gửi 62MB
toàn field text vẫn qua (HTTP 200, RSS +110MB).
**Vá:** thêm `fields:5, fieldSize:1024, parts:10, headerPairs:50`. Frontend chỉ
gửi đúng 1 field `avatar` nên không ảnh hưởng người dùng thật.

### 4. F11 — HIGH file-type DoS (ASF infinite loop) (PATCH-7, v2.0.10)
**Lỗ hổng:** `file-type@19` lặp VÔ HẠN với file ASF dị dạng → treo tiến trình.
`users.controller#uploadAvatar` đưa TOÀN BỘ buffer người dùng tải lên vào.
**Vá (3 lớp):** (1) kiểm magic-bytes JPEG/PNG/WebP TRƯỚC, file không có chữ ký
hợp lệ bị từ chối ngay; (2) chỉ đưa 4KB ĐẦU cho `file-type`; (3) nâng
`file-type` ^19.6.0 → ^21.3.4 (đã vá lặp vô hạn ASF).

### 5. TW-07 / TW-13 — HIGH Firestore Rules lộ `config/*` và `positiveScoreLogs` (PATCH-24, v2.5.3)
**Lỗ hổng:** `config/*` đọc công khai (chứa uid của Service Account trong
embedDomains/trendingState); `users/{uid}/positiveScoreLogs` chủ đọc được (log
"share" chứa uid người mở link).
**Vá:** `firestore.rules` — khoá hẳn cả hai (`allow read, write: if false`).
Frontend KHÔNG đọc hai collection này (đã grep toàn bộ `frontend/src`) nên khoá
không phá tính năng. **Deploy rules SAU CÙNG (sau backend+frontend).**

### 6. F4 — MEDIUM tài khoản pending/suspended vẫn được tính điểm (PATCH-7, v2.0.10)
**Lỗ hổng:** `optionalAuth` gắn `req.authUid` cho MỌI tài khoản tồn tại, kể cả
pending/suspended → farm điểm view/share bằng tài khoản chưa kích hoạt.
**Vá:** `middleware/auth.js` — chỉ gắn khi `status === active`. pending/suspended
coi như khách (không có khoá dedup riêng theo uid).

### 7. F6 — MEDIUM token đã thu hồi còn dùng tới ~1 giờ (PATCH-7, v2.0.10)
**Lỗ hổng:** `verifyIdToken` không `checkRevoked` → token cũ (đổi mật khẩu, thu hồi
phiên) còn hợp lệ tới hạn tự nhiên (~1 giờ).
**Vá:** `verifyIdTokenCached` — `checkRevoked:true` + cache `tokensValidAfterTime`
theo uid 60 giây (tối đa 1 lượt gọi Firebase Auth/người dùng/phút). Lỗi tra cứu →
bỏ qua kiểm thu hồi (fail-open có log), cửa sổ token cũ giảm xuống ≤60s.

### 8. R-01 / A-06 — MEDIUM style color cho phép ẩn chữ (PATCH-13/14, v2.2.1/2.2.2)
**Lỗ hổng:** `sanitizeStyleAttr` chỉ lọc ký tự (`[a-zA-Z0-9 #%,().-]`) — cho phép
`color: transparent`, `#fff0`, `color-mix()`, `var()`, màu hệ thống → ẩn chữ
(SEO spam / lừa đảo). Không giới hạn số `font-size`/`line-height`/`margin`.
**Vá:** `isSafeColorValue` — allowlist 148 tên màu CSS + hex 3/6 + hex 4/8/rgb(a)/
hsl(a) với alpha ≥ 0.5; chặn `transparent`, `color-mix`, `var`. Giới hạn
font-size 8–72px, line-height 0.8–4, margin/padding 0–200px.

### 9. TW-06 — MEDIUM `class` không giới hạn (ẩn chữ qua CSS site) (PATCH-24, v2.5.3)
**Lỗ hổng:** `class` nằm trong ALLOWED_ATTR nhưng không lọc giá trị → người dùng
đặt class trùng class CSS của site (vd `hidden`, `MuiCollapse-hidden`) để ẩn chữ.
**Vá:** hook `uponSanitizeAttribute` — chỉ giữ token `ql-*` hợp lệ (Quill), loại
mọi class khác. `data-*`/`aria-*` vốn đã không nằm trong ALLOWED_ATTR (đã loại).

### 10. PATCH-2 #9 — MEDIUM link ngoài không ép `rel` (PATCH-2, v2.0.2)
**Lỗ hổng:** link người dùng dán vào giữ nguyên `target`/`rel` → `target=_blank`
không `noopener` (tabnabbing) + không `nofollow` (SEO juice cho site rác).
**Vá:** hook `afterSanitizeAttributes` — link ngoài ép `rel="ugc nofollow noopener"`,
link nội bộ ép `noopener`, chỉ giữ `target="_blank"` (bỏ target khác). `javascript:`
bị loại.

### 11. TW-10 — MEDIUM Turnstile không timeout, không kiểm hostname (PATCH-24, v2.5.3)
**Lỗ hổng:** `fetch` siteverify không timeout → Cloudflare treo làm request người
dùng treo theo. Không kiểm `hostname` của token → token cấp cho site khác dùng được.
**Vá:** `AbortController` timeout 5s (trả 504); kiểm `result.hostname` khớp
hostname suy từ `CORS_ORIGIN`/`FRONTEND_URL` (production), hoặc
`TURNSTILE_ALLOWED_HOSTNAMES` (env, phân cách dấu phẩy). Công tắc khẩn:
`TURNSTILE_HOSTNAME_CHECK=off`.

### 12. TW-01 — MEDIUM rate-limiter khoá IP sai (PATCH-24, v2.5.3)
**Lỗ hổng:** limiter dùng thẳng `req.ip` → sau Cloudflare+Render là IP nội bộ,
nhiều người dùng chung bucket; kẻ tấn công đổi header `X-Forwarded-For` lách limiter.
**Vá:** `utils/clientIp.js` (mới) — `getClientKey` chỉ tin `CF-Connecting-IP` khi
`req.ip` thuộc dải Cloudflare chính thức (gọi thẳng origin → bỏ qua header giả);
IPv6 rút /64. Dùng trong `rateLimiters.js` (key) và `captcha.js` (remoteip).
Giữ `trust proxy=1` (không đổi topology).

### 13. F5 — LOW firebase-admin ^12 → ^13.10 (PATCH-9, v2.0.12)
**Lỗ hổng:** firebase-admin@12 có 2 lỗ hổng HIGH (CVE-2025 của @firebase/auth
interoperability + prototype pollution trong @google-cloud/firestore phụ thuộc).
**Vá:** nâng `firebase-admin` ^12.3.1 → ^13.10.0. Yêu cầu Node ≥20 (đã cập nhật
`engines`). **Lưu ý khi deploy:** Render cài Node 20+.

### 14. N2 / TW-22 — LOW gỡ cookie-parser + `credentials:true` (PATCH-9/24)
**Lỗ hổng:** Twelve dùng Bearer token, KHÔNG có `req.cookies`/`res.cookie` nào
(đã grep toàn bộ backend). Giữ cookie-parser chỉ tăng bề mặt tấn công vô ích;
`CORS credentials:true` mở vector CSRF cho trình duyệt.
**Vá:** gỡ `cookie-parser` khỏi `package.json` + `server.js`; bỏ `credentials:true`
khỏi `cors()`. Biến `COOKIE_SECRET` không còn dùng (bỏ khỏi .env ở lần deploy tới).

### 15. TW-25 — LOW `updateMe` ghi 2 lần (race) (PATCH-24, v2.5.3)
**Lỗ hổng:** `updateMe` gọi `update(updates)` rồi `update({isFirstLogin:false})`
riêng → giữa 2 lần ghi có cửa sổ race đọc trạng thái nửa vời.
**Vá:** gộp `isFirstLogin:false` vào `updates`, một lần ghi duy nhất (atomic).

### 16. G1 / TW-02 — CSP frontend chuyển từ Report-Only sang có enforcing (PATCH-8/24)
**Lỗ hổng:** `frontend/vercel.json` chỉ có `Content-Security-Policy-Report-Only`
(chỉ ghi log, không chặn). Không có `script-src`/`frame-ancestors`/`script-src-attr`
enforcing.
**Vá:** thêm header `Content-Security-Policy` (enforcing) với
`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
script-src 'self' https://challenges.cloudflare.com; script-src-attr 'none'`.
Hai header (Report-Only + enforcing) áp dụng đồng thời (giao nhau). ĐÃ xác nhận
`index.html` KHÔNG có inline script nào → `script-src 'self'` an toàn. Turnstile
vẫn hoạt động (challenges.cloudflare.com trong allowlist).

### 17. G2 / TW-19 — Quill clipboard self-XSS (PATCH-8/24)
**Lỗ hổng:** `clipboard.convert()` của Quill nhận HTML chuỗi (đường
`dangerouslyPasteHTML` mà react-quill và nút chèn media dùng) và gắn thẳng vào
DOM thật để parse → `onerror`/`onload` chạy ngay.
**Vá:** `frontend/src/utils/quillSafeClipboard.js` (mới) — ghi đè `convert()`:
HTML chuỗi đi qua `DOMParser` (tài liệu trơ, không chạy script) để bỏ thẻ nguy
hiểm + mọi thuộc tính `on*` + `javascript:`/`data:text/html`, style đi qua bộ
lọc giá trị an toàn, mới tới Quill. Import trong `QuillEditor.jsx`.

---

## Các vá BỎ QUA (có chủ đích) và lý do

| Vá | Lý do bỏ qua |
|---|---|
| F3 / TW-03 (view-once-per-pair, share daily cap) | Thay đổi mô hình dữ liệu (subcollection mới) + logic nghiệp vụ điểm — không phải vá lỗ hổng thuần. Đề xuất cho Twelve 1.2. |
| PATCH-2 #2 (email normalize Gmail dots) | Yêu cầu đồng bộ frontend + migrate dữ liệu đã có — rủi ro cao, không tự chứa lỗ hổng. |
| PATCH-2 #5 (rate limiter create/edit post) | v0.10.24 ĐÃ có `profileWriteLimiter`/`reactLimiter`/`commentLimiter`; tạo bài đã qua `requireAuth`+`requireActive`+captcha lúc đăng ký. Mức rủi ro thấp. |
| PATCH-2 register (tagName trước createUser) | v0.10.24 KHÔNG có tính năng tag name (tên đăng nhập). Tính năng mới của Beta. |
| A-02 (race account deletion) | v0.10.24 KHÔNG có xoá tài khoản. Tính năng mới. |
| A-03 (forgot-password timing) | v0.10.24 KHÔNG có endpoint quên mật khẩu (chỉ đăng ký + kích hoạt email). |
| A-04 / R-03 (reserved tag / lookalike) | Không có tag name. |
| A-05 / R-02 (CSP report poisoning) | v0.10.24 KHÔNG có endpoint `/csp-report`. Không thêm tính năng mới. |
| TW-08 (pending sweeper), TW-09 (configAudit, requireRecentAuth), TW-20 (SSR tripwire), TW-14 (.doc(null)), TW-27 (share debug) | Phụ thuộc hạ tầng mới (debug panel, config audit, requireRecentAuth middleware). Một phần đã được vá gián tiếp qua idParams + optionalAuth active. |
| PATCH-1 (SSR SEO sitemap, SSR_PROXY_SECRET) | Phần lớn là tính năng SEO mới. v0.10.24 đã có viewLimiter trên SSR (v0.10.11). Blog draft visibility — v0.10.24 blog chỉ SA đăng, không có draft. |
| PATCH-3/4/5/6/10/11/15/16/17/18/19/20/21/22/23/25/26/27 | Toàn bộ tính năng mới (Font, settings tree, debug panel, Profile page, App Check, IP topology panel, SEO meta tags, back button, copy URL, tag-based profile URL, reCAPTCHA CSP, account deletion, badges, achievements). KHÔNG backport theo yêu cầu. |

---

## Hướng dẫn deploy (theo thứ tự, KHÔNG đảo)

1. **Backend (Render):** `npm install` (firebase-admin ^13, file-type ^21, gỡ
   cookie-parser) → deploy. Đảm bảo Node ≥20. Thêm env (tùy chọn):
   `TURNSTILE_ALLOWED_HOSTNAMES=<frontend-domain>` (nếu không suy được từ CORS_ORIGIN).
   Bỏ `COOKIE_SECRET` khỏi env (không còn dùng).
2. **Frontend (Vercel):** deploy (vercel.json đã có CSP enforcing + quillSafeClipboard).
3. **Firestore Rules:** `firebase deploy --only firestore:rules` — **SAU CÙNG**, sau
   khi backend+frontend đã chạy ổn. Rules khoá `config/*` và `positiveScoreLogs`.
4. **Kiểm tra sau deploy:** tạo bài viết có nhúng YouTube + ảnh + link ngoài →
   xác nhận hiển thị đúng; upload avatar JPEG/PNG/WebP; mở trang SSR `/post/:id`
   với id lạ (`a/b`) → phải trả 404, backend KHÔNG sập.
5. **Nội dung cũ:** chạy `npm run content:resanitize` (đã thêm script) để áp dụng
   bộ lọc class/color/rel mới cho bài viết cũ — **chạy `:apply` sau khi kiểm tra
   dry-run**. (Script này dùng sync sanitize, SA chạy tay.)

## Kiểm thử

- `cd backend && npm install && npm run test:security` → 7/7 PASS.
- `node --check` trên tất cả file backend đã sửa → PASS.
- Frontend: `npm run build` (quy trình thông thường) — CSP enforcing đã xác nhận
  không có inline script trong index.html.

## File thay đổi / mới

**Mới:** `backend/src/utils/clientIp.js`, `backend/src/utils/asyncErrors.js`,
`backend/src/middleware/idParams.js`, `backend/src/services/sanitize.worker.js`,
`backend/test/security-11.test.js`, `frontend/src/utils/quillSafeClipboard.js`,
`PATCH-11-1-NOTES.md` (file này), `SECURITY-STATUS.md`.

**Sửa:** `backend/server.js`, `backend/package.json`, `backend/firestore.rules`,
`backend/src/services/sanitize.service.js` (viết lại), `backend/src/middleware/auth.js`,
`backend/src/middleware/upload.js`, `backend/src/middleware/captcha.js`,
`backend/src/middleware/rateLimiters.js`, `backend/src/controllers/posts.controller.js`,
`backend/src/controllers/blog.controller.js`, `backend/src/controllers/users.controller.js`,
`backend/src/routes/{users,posts,blog,ssr}.routes.js`, `frontend/vercel.json`,
`frontend/src/components/QuillEditor.jsx`, `frontend/package.json`,
`frontend/public/version.json`.
