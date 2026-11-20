# Twelve 1.1 (`0.10.24.1.191126`) — bản vá bảo mật chuyển từ Twelve 2.5.3.3

Nền: **Twelve 0.10.24 (1.0 chính thức)**. Nguồn đối chiếu: **Twelve 2.5.3.3 (Beta)** — `SECURITY-STATUS.md`, `PATCH-1…27-NOTES.md` và mã nguồn.
Nguyên tắc: **chỉ** bê những bản vá có liên quan tới phần ĐANG CÓ ở 0.10.24 và không thêm tính năng. Mọi chỗ sửa trong mã đều có chú thích `v1.1 [mã mục — vá từ …]` để tìm lại.

## 1. Kết quả ngắn gọn

- **Có 1 lỗ hổng nghiêm trọng thật ở 0.10.24 (A-01):** một request *không cần đăng nhập* — `GET /api/users/a%2Fb` — làm **sập tiến trình** backend. Mình đã dựng `server.js` của 0.10.24 với Firestore giả (mô phỏng đúng việc SDK thật ném lỗi với id có dấu `/`) và **tái hiện được**: tiến trình thoát với `exit code 1`, `/health` ngừng trả lời. Cùng thử nghiệm trên bản 1.1: `404`, tiến trình vẫn sống. Mỗi lần dịch vụ khởi động lại, kẻ tấn công chỉ cần gửi lại đúng 1 request là làm nó sập tiếp (suy luận từ mã; mình không thử trên Render thật).
- Ngoài A-01 còn **blog nháp đọc được công khai** (qua API, trang SSR và cả Firestore REST), **bơm view bằng `X-Forwarded-For` giả**, **DoS bằng HTML bài viết** (sanitize chạy trên luồng chính), **cày điểm** (xem / bình luận / chia sẻ), v.v. — chi tiết ở mục 3.
- Kiểm thử: `npm test` ở backend = **39/39** (13 test cũ của 0.10.24 + 26 test mới `test/security-110.test.js`). **Kiểm đột biến:** hoàn nguyên từng bản vá (13 chỗ) thì test tương ứng đều **FAIL**. Frontend `vite build` thành công.
- **Chưa kiểm chứng:** xem mục 7 (chưa chạy trên Render/Vercel/Firebase thật, chưa thử trên trình duyệt).

## 2. Cách xác định "lỗ hổng nào áp dụng được"

Với mỗi mục trong bảng theo dõi của 2.5.3.3 mình đọc mã 0.10.24 tương ứng và xếp vào một trong ba nhóm: **(a)** 0.10.24 có đúng lỗi đó → vá; **(b)** lỗi thuộc tính năng chưa tồn tại ở 0.10.24 (xoá tài khoản, quên mật khẩu, ảnh bìa, App Check, …) → bỏ qua; **(c)** là thay đổi tính năng/hiệu năng chứ không phải lỗ hổng → bỏ qua. Mục 3 = nhóm (a), mục 5 = nhóm (b)/(c).

## 3. Các bản vá đã bê sang

| Mã | Mức (theo 2.x) | Lỗi ở 0.10.24 | Vá ở 1.1 | File chính |
|---|---|---|---|---|
| **A-01** | 🔴 HIGH | `GET /api/users/:uid` không có try/catch; id có `%2F` làm SDK ném lỗi → `unhandledRejection` → `process.exit(1)` (đã tái hiện) | Kiểm id ở route (`router.param`), chuyển lỗi handler async vào error handler, `unhandledRejection` chỉ ghi log (thoát chỉ khi >10 lần/phút), `try/catch` ở `getPublicProfile`, SSR trả 404 cho id lạ | `middleware/idParams.js`, `utils/asyncErrors.js`, `utils/input.js`, `server.js`, `routes/*` |
| **F1 / F10** | 🔴 CRITICAL | `sanitizeHtml` (jsdom+DOMPurify) chạy **trên luồng chính**, không giới hạn đầu vào → một bài độc làm treo server; quét lại domain nhúng cũng vậy | Giới hạn đầu vào (ký tự/phần tử/độ sâu/media) + sanitize ở `worker_threads` có timeout 3 giây; trả 400/422 rõ ràng | `services/contentPipeline.js`, `sanitize.worker.js`, `controllers/posts,blog,embedDomains` |
| **F2** | 🟠 HIGH | multer chỉ giới hạn `fileSize`/`files` — request toàn field text vẫn được nhận | `fields/fieldSize/parts/headerPairs` | `middleware/upload.js` |
| **F11 (+F5)** | 🟡 MEDIUM | `file-type` 19.x lặp vô hạn với file ASF dị dạng; chạy trên buffer người dùng tải lên | Kiểm chữ ký ảnh bằng mã riêng trước, chỉ đưa 4 KB đầu cho `file-type`; nâng `file-type ^21.3.4`, `firebase-admin ^13.10.0`, Node ≥ 20 | `controllers/users.controller.js`, `utils/input.js`, `package.json` |
| **F4** | 🟡 MEDIUM | `optionalAuth` coi cả tài khoản `pending/suspended` là người dùng ở route công khai | Chỉ tài khoản `active` có `req.authUid`; còn lại là khách | `middleware/auth.js` |
| **F6** | 🔵 LOW | Token đã bị thu hồi vẫn dùng được tới ~1 giờ | Kiểm `tokensValidAfterTime`/`disabled`, cache 60 giây/uid (fail-open có log khi tra cứu lỗi) | `middleware/auth.js` |
| **F7/F8/F9** | 🔵 LOW | Ký tự bidi/rộng-0 trong tên/tiêu đề/bình luận; sai kiểu (mảng/đối tượng, `limit=-5`, cursor chứa `/`) → 500; ngày sinh `2023-02-31` | `isString` trước sanitize, `cleanDisplayText`/`stripBidiAndInvisible`, `parseLimit/parseCursor`, `validateBirthday` nghiêm ngặt | `utils/input.js`, `middleware/validators.js`, controllers |
| **Blog nháp** (2.0.4) | 🟠 | Blog `isPublished:false` đọc được bằng id: API, trang SSR `/blog/:id`, bình luận, react, share, và Firestore REST | 404 như không tồn tại với người lạ (tác giả/SA vẫn xem được, không cộng view); **firestore.rules** siết `blogs` + `blogs/*/comments` | `utils/visibility.js`, `blog/comments/reactions/share.controller`, `ssr.routes.js`, `firestore.rules` |
| **Bơm view** (2.0.4) | 🟠 | `viewerKeyFromRequest` đọc phần tử đầu của `X-Forwarded-For` **do client tự đặt** → đổi giá trị mỗi request là né dedup 30 phút; mọi request tới `/post/:id` (kể cả gọi thẳng host Render) đều cộng `aiViewCount`/`postScore` | Khoá lấy từ `getClientKey` (băm SHA-256); SSR chỉ cộng view khi request mang `x-twelve-ssr-secret` khớp `SSR_PROXY_SECRET` (middleware Vercel gắn; header `x-twelve-*` của client bị xoá) | `utils/helpers.js`, `utils/clientIp.js`, `ssr.routes.js`, `frontend/middleware.js` |
| **TW-01** | 🟠 HIGH | `trust proxy = 1`: trên Render+Cloudflare, `req.ip` là IP **nội bộ Render xoay vòng** → mọi limiter theo IP và khoá khách không còn theo người dùng | Chế độ tin proxy theo **dải IP** (Cloudflare + nội bộ), `getClientKey` duy nhất, IPv6 về /64; `TRUST_PROXY_MODE=hops` để quay lại | `utils/clientIp.js`, `server.js`, `rateLimiters.js`, `routes/auth.routes.js` |
| **Giới hạn tần suất** (2.0.5) | 🟡 | Tạo/sửa bài và tải bình luận chỉ chịu limiter chung 300 req/15 phút/IP | `postCreateLimiter` (20/giờ/tài khoản), `postEditLimiter` (60/15 phút), `commentListLimiter` | `middleware/rateLimiters.js`, `routes/posts,blog` |
| **F3 / TW-03** | 🟡 MEDIUM | Điểm xem cộng lại sau mỗi 30 phút; thưởng chia sẻ không có trần theo người chia sẻ | Điểm xem 1 lần/(người xem, bài); trần 25 lần `+8`/ngày/người chia sẻ — **xem mục 4** | `utils/helpers.js` |
| **Farm bình luận** (2.0.5) | 🟡 | Mỗi bình luận đều +3 (tác giả bài) / +1 (người bình luận) kể cả bình luận nhiều lần vào cùng một bài | Chỉ bình luận **đầu tiên** của (người dùng, bài) được cộng điểm (`scored`); xoá chỉ hoàn điểm đã cộng; bình luận cũ (không có `scored`) coi là đã cộng | `controllers/comments.controller.js` |
| **Sanitizer** (2.0.5, TW-06, A-06/R-01) | 🔵 LOW | `class` tuỳ ý (vd. `ql-hidden`), `data-*`/`aria-*`, `style` kích thước 0/màu trong suốt (`#fff0`) → ẩn chữ/phá bố cục; link ngoài thiếu `rel` | Allowlist `class`, tắt `data-*`/`aria-*`, giới hạn số/màu của `style`, ép `rel="ugc nofollow noopener"`; **chạy `content:resanitize` cho bài cũ** (mục 6) | `services/sanitize.service.js`, `seed/resanitizeContent.js` |
| **Ảnh bìa** (2.0.5) | 🔵 | `coverImageUrl` bỏ qua allowlist domain → ảnh bìa (và `og:image`) từ host bất kỳ | Phải thuộc domain được phép; ảnh đang lưu không đổi thì không bị kiểm lại | `utils/helpers.js` |
| **A-04** | 🔵 LOW | Đăng ký được tag mạo danh quản trị (`admin`, `twelve`, `support`…, kể cả biến thể giống hệt) | Danh sách tag dành riêng (chỉ khi **đăng ký** — 0.10.24 chưa có đổi tag); kiểm tag **trước** khi tạo user Firebase | `utils/helpers.js`, `controllers/auth.controller.js` |
| **TW-07 / TW-13** | 🔵 LOW | `config/*` đọc công khai (chứa UID của SA); `positiveScoreLogs` lộ UID người mở link chia sẻ | Khoá hẳn trong `firestore.rules` (đã kiểm: frontend 0.10.24 không đọc hai nơi này bằng Client SDK) | `firestore.rules` |
| **TW-10** | 🔵 LOW | `fetch` tới Cloudflare Turnstile không có timeout; không kiểm hostname widget | Timeout 5 giây (503 fail-closed), kiểm `hostname` ở production | `middleware/captcha.js` |
| **TW-20** | ⚪ | SSR in HTML thô của bài (`<%- post.contentHtml %>`) | Lớp sanitize thứ 2 chỉ chạy khi nội dung đã lưu có dấu hiệu nguy hiểm | `utils/ssrContent.js`, `ssr.routes.js` |
| **TW-14** | 🔵 | `authorUid` null/không hợp lệ → `.doc(null)` ném lỗi → cả danh sách trả 500 | Chỉ tra cứu uid hợp lệ | `posts.controller.js`, `comments.controller.js` |
| **TW-27 / TW-17 / TW-22 / N2** | ⚪ | Log `[SHARE DEBUG]` ghi UID và tràn log; mã chết `requireOwnerCapable`; `credentials:true`, `urlencoded`, `cookie-parser` thừa | Tắt mặc định + giới hạn tần suất (bỏ UID khỏi log); xoá mã chết; gỡ các thứ thừa (`COOKIE_SECRET` không còn cần) | `helpers.js`, `roles.js`, `server.js`, `package.json` |
| **Chi phí Firestore** (2.0.5) | 🟡 | Mỗi request bảng xếp hạng quét toàn bộ `users` | Cache 60 giây + single-flight | `controllers/trending.controller.js` |
| **Frontend** G1/G2/TW-11 | 🟡/🔵 | Nhật ký debug ghi email/uid/URL vào `sessionStorage` ở production; getter `AuthContext` trả cả đối tượng Firebase `User` (có refresh token) qua `globalThis`; Quill 1.3.7 (CVE-2021-3163) | `debugLog` chỉ DEV + che bí mật; getter chỉ DEV và chỉ trả `{uid,email,emailVerified}`; clipboard Quill làm sạch HTML trước khi vào DOM; CSP thêm `script-src-attr 'none'` + `frame-ancestors 'self'`; middleware Vercel gắn secret/IP | `utils/debugLog.js`, `context/AuthContext.jsx`, `utils/quillSafeClipboard.js`, `components/QuillEditor.jsx`, `vercel.json`, `middleware.js` |
| **Nhãn phiên bản** (A-07/A-08) | ⚪ | `backend/package.json` ghi `0.10.21`, seed mặc định `0.10.21`, `.env.example` ghi `0.8.28` trong khi frontend là `0.10.24` | Đồng bộ về `0.10.24.1.191126` | `package.json` (2 nơi), `seedVersion.js`, `.env.example`, `version.json` |

## 4. Thay đổi hành vi cần bạn biết (đây là chỗ có thể làm người dùng nhận ra)

1. **Điểm xem chỉ cộng 1 lần/(người xem, bài)** (mặc định **BẬT**, giống 2.5.3). `viewCount` hiển thị vẫn tăng như cũ; chỉ phần *điểm* bị giới hạn. Muốn về hành vi cũ: `VIEW_SCORE_ONCE_PER_PAIR=off`.
2. **Trần thưởng chia sẻ 25 lần/ngày/người** (= 200 điểm). `shareCount` hiển thị không đổi. Chỉnh bằng `SHARE_REWARD_DAILY_CAP` (`0`/`off` = không giới hạn). *Con số 25 là mặc định do mình chọn ở 2.5.3 — bạn có thể đổi.*
3. **Chỉ bình luận đầu tiên của mỗi người trên mỗi bài được cộng điểm.** Không có công tắc (như ở 2.x). Bình luận vẫn đăng bình thường.
4. **Khoá khách (`views/ip:…`) đổi định dạng** → sau khi cập nhật, mỗi khách ẩn danh được đếm thêm tối đa **1** lượt xem. Không ảnh hưởng điểm.
5. **Tag dành riêng:** `admin`, `twelve`, `support`, `moderator`, `official`, `security`… không đăng ký được. Tài khoản đang giữ tag đó từ trước **không bị đụng tới**. Thêm tên: `RESERVED_TAG_NAMES_EXTRA`.
6. **Blog nháp:** người lạ nhận 404 (trước đây xem được). Tác giả/SA vẫn xem trước. Realtime bình luận của một blog nháp sẽ không chạy qua Firestore (lỗi quyền chỉ hiện ở console) — chỉ là bản nháp.
7. **Ảnh bìa mới phải thuộc domain nhúng được phép** (Cài đặt › Quản trị › Domain nhúng). Ảnh bìa đang lưu không bị chặn.
8. **Bài viết quá lớn/quá phức tạp** bị từ chối với 422 (và 400 khi sai kiểu). Giới hạn ở `CONTENT_LIMITS` (`HTML_MAX_*`). Frontend **không** hiển thị bộ đếm ký tự (đó là G5 của 2.x, mình không bê) nhưng lỗi 422 của backend là tiếng Việt và được giao diện hiển thị như các lỗi khác — **chưa kiểm trên trình duyệt**.
9. **Turnstile kiểm `hostname`** ở production: mặc định hợp lệ = hostname của `CORS_ORIGIN` + `FRONTEND_URL`. Nếu widget hiển thị ở tên miền khác thì đặt `TURNSTILE_ALLOWED_HOSTNAMES`; nếu đăng ký bị chặn nhầm: `TURNSTILE_HOSTNAME_CHECK=off`.
10. **`seed/resanitizeContent.js` mặc định là dry-run** (chỉ báo cáo); phải thêm `--apply` mới ghi. (Bản cũ ghi thẳng.)
11. **`unhandledRejection` không còn thoát ngay** (chỉ ghi log; thoát khi >10 lần/phút). `uncaughtException` vẫn thoát như cũ.

## 5. Không bê sang (và vì sao)

| Mục (2.x) | Lý do |
|---|---|
| A-02, A-03, N5, TW-08, TW-25, `accountDeletion`, quên mật khẩu, tên thật tách collection | **Tính năng chưa có ở 0.10.24** (xoá tài khoản, quên mật khẩu…) |
| TW-04 App Check, reCAPTCHA trong CSP | Tính năng mới (và cần kiểm trình duyệt thật) |
| A-05/R-02 báo cáo CSP, panel "Báo cáo CSP" | Tính năng mới (endpoint + panel quản trị) |
| Panel "Nhận diện IP", `/api/admin/ip-topology`, module **Gỡ lỗi** (`src/debug/`), `configAudit`, `requireRecentAuth` (TW-09) | Tính năng quản trị mới. Mình chỉ giữ `ipTopologyProbe` (log 20 dòng khi `DEBUG_IP_TOPOLOGY=on`, mặc định tắt) để đo lại được |
| Quét lại domain nhúng chạy nền + `GET /embed-domains/rescan` | Là thiết kế lại tính năng. Mình chỉ đưa việc sanitize sang worker (F10); `PUT` vẫn quét đồng bộ như cũ |
| G4 (tách bundle), G5 (bộ đếm giới hạn nội dung phía client) | Hiệu năng/UX, không phải lỗ hổng |
| `normalizeEmail()` bỏ chấm Gmail (2.0.5 "SỬA LỖI") | Là lỗi chức năng (đăng nhập bằng email gốc), và đổi nó yêu cầu thêm `signInWithEmailCompat` ở frontend + migrate; ngược lại, theo mã (mình chưa chạy thử), `normalizeEmail()` ở 0.10.24 đang có tác dụng chặn việc tạo nhiều tài khoản cho cùng một hộp thư Gmail bằng biến thể dấu chấm. Giữ nguyên |
| N3 (`registrationMarkers`, dọn Auth mồ côi) | Độ bền, cần thêm script/collection; chưa có bằng chứng ảnh hưởng ở quy mô hiện tại |
| CSP `img-src`/`frame-src` thu hẹp | Phụ thuộc cấu hình domain nhúng của bạn — thu hẹp có thể làm hỏng bài cũ; 0.10.24 chưa có công cụ quan sát (báo cáo CSP) để làm an toàn |
| TW-12, TW-15, TW-16, `GET /` liệt kê endpoint admin | ⏸ Là quyết định sản phẩm/kiến trúc của bạn (Express 5, thông báo "email đã tồn tại"…) |

**Nợ còn lại (cần đợt riêng):** `firebase`/`react-router-dom` phía frontend và chuỗi `@google-cloud/*` của `firebase-admin` còn cảnh báo `npm audit` mức moderate ở backend; Quill 1.3.7 → Quill 2; Express 4 → 5. Lưu ý: hai file zip bạn gửi **không có `package-lock.json`** nên số cảnh báo thay đổi theo ngày cài; hãy `npm install` rồi **commit lockfile**.

## 6. Triển khai (theo thứ tự)

1. **Sao lưu Firestore** (đặc biệt `posts`, `blogs`) trước khi chạy `content:resanitize`.
2. **Render (backend):**
   - Giữ `NODE_ENV=production`. Cài lại dependency (`npm install`; Node ≥ 20).
   - Đặt `SSR_PROXY_SECRET` (cùng giá trị với Vercel). Thiếu thì server **vẫn khởi động**, chỉ in cảnh báo; trang SSR vẫn chạy nhưng không cộng view bot.
   - Có thể xoá `COOKIE_SECRET` (không còn dùng).
   - Các biến tuỳ chọn ở cuối `backend/.env.example`.
3. **Vercel (frontend):** đặt `SSR_PROXY_SECRET` (không có tiền tố `VITE_`), rồi deploy.
4. **`firebase deploy --only firestore:rules` — làm SAU CÙNG** (sau khi backend và frontend đã chạy bản 1.1).
5. **Bài cũ:** `cd backend && npm run content:resanitize` (dry-run, đọc báo cáo) → sao lưu → `npm run content:resanitize:apply`. (Cần cho allowlist `class`/`style` mới có hiệu lực với bài đã lưu.)
6. **Kiểm sau deploy:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://<backend>/api/users/a%2Fb"     # phải 404 (bản 0.10.24: kết nối bị đứt, tiến trình thoát)
   curl -sI "https://<frontend>/post/<id-thật>" -A "Googlebot" | grep -i x-twelve-ssr-trusted   # phải là 1 khi đã đặt SSR_PROXY_SECRET
   # rồi mở một blog đã đặt isPublished=false khi chưa đăng nhập: phải 404
   ```
7. **Đo IP một lần** (nếu không chắc 1.1 chạy sau Cloudflare+Render như bản 2.5.3.x đã đo): đặt `DEBUG_IP_TOPOLOGY=on`, gọi `/api/version` vài lần, đọc 20 dòng `[IP-TOPO]`, rồi gỡ biến. Cách tin proxy mặc định (`cloudflare`) **giả định** topology giống lần bạn đã đo ở 2.5.3.x; nếu khác, đặt `TRUST_PROXY_MODE=hops` + `TRUST_PROXY_HOPS`.
8. **Rollback:** giữ lại bản 0.10.24 để deploy lại. `firestore.rules` mới **chặt hơn** rules cũ nên deploy lại rules cũ chỉ làm mở quyền đọc trở lại (không làm hỏng chức năng nào). `VIEW_SCORE_ONCE_PER_PAIR=off` và `SHARE_REWARD_DAILY_CAP=off` đưa hai thay đổi điểm số về cũ mà không cần deploy lại mã (cần khởi động lại để nạp biến môi trường).

## 7. Chưa kiểm chứng (nói thẳng)

- Test dùng **Firestore/Auth giả** trong bộ nhớ (chép từ 2.5.3.3, có mô phỏng việc SDK thật ném lỗi với id `a/b`). **Chưa chạy** với Firestore/Firebase Auth thật, **chưa chạy emulator** cho `firestore.rules` (test chỉ kiểm nội dung rules, không thực thi chúng).
- **Chưa thử** trên Render/Cloudflare/Vercel thật: chế độ nhận diện IP `cloudflare`, header `x-twelve-ssr-secret` qua middleware Vercel, Turnstile `hostname`.
- **Chưa thử trên trình duyệt:** clipboard Quill an toàn (đã build thành công; mã giống hệt bản 2.5.3.3 vốn đã được test với Quill 1.3.7 thật ở repo của bạn, và `react-quill` cùng `^2.0.0`), CSP mới, hiển thị lỗi 422.
- `firebase-admin` 12 → 13: mã `config/firebase.js` giữ nguyên (cùng file với 2.5.3.3 đang chạy 13.10). Chưa chạy với dịch vụ thật ở 1.1.
- Các con số "đã đo" (3.800 điểm/ngày, 48 điểm/ngày/bài, 229 MB RSS) lấy từ báo cáo của dòng 2.x; mình **không đo lại** trên 0.10.24 — cơ chế mã giống hệt nhưng đó là suy luận từ mã, không phải số đo.
- Chỉ **tái hiện bằng thực nghiệm** A-01 (mục 1). Các lỗi khác được xác nhận bằng đọc mã + test hồi quy sau khi vá + kiểm đột biến, không phải bằng khai thác trên bản gốc.

## 8. Chạy lại kiểm thử

```bash
cd backend && npm install && npm test        # 39 test (assets + security-110)
cd frontend && npm install && npx vite build
```
