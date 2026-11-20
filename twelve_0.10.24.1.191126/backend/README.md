# Twelve Backend (v0.10.21.290926) — [FRONTEND v0.10.24.300926, xem mục -23]

## -23. [GIAO DIỆN] Trả độ dài ô soạn bình luận về như cũ (v0.10.24, 30/09/2026)

Lề ngang 24px thử ở v0.10.23 khiến ô soạn bị co, nhìn không ổn → trả lề vùng soạn về 12px (`p: 1.5`) như v0.10.22. Giữ nguyên phần thu chiều cao (`minRows=1`) và placeholder mobile ngắn của v0.10.23. Chỉ frontend (`components/CommentModal.jsx`).

## -22. [GIAO DIỆN] Thu gọn chiều cao và chiều dài ô soạn trong hộp bình luận (v0.10.23, 30/09/2026)

**Yêu cầu:** sau v0.10.22, ô viết bình luận lúc trống cao ~3 dòng (mong muốn 2 dòng) và trông dài hơn các card bình luận.

**Nguyên nhân:** `minRows=2` cộng dải đệm `pb` dưới đáy (chừa chỗ cho nút gửi nằm trong ô) → ~3 dòng; placeholder mobile dài bị xuống 2 dòng nên càng cao. Ô soạn lề ngang 12px trong khi card bình luận (DialogContent) lề 24px.

**Đã làm (chỉ frontend, `components/CommentModal.jsx`):** `minRows` 2 → 1 (kết hợp dải nút gửi → ô trống cao ~2 dòng, vẫn tự giãn tới `maxRows=6`); lề ngang vùng soạn 12px → 24px (`px: 3`) cho thẳng hàng với card; placeholder mobile rút còn "Viết bình luận..." để không xuống dòng (desktop giữ nguyên gợi ý Shift+Enter/Enter).

## -21. [GIAO DIỆN] Tối ưu hộp bình luận trong card bài viết (v0.10.22, 30/09/2026)

**Yêu cầu:** hộp "Bình luận" mở từ card bài viết (danh sách post) còn lãng phí diện tích ở dưới cùng: avatar và nút gửi nằm ngang hai bên ô gõ nên ô gõ bị hẹp.

**Đã làm (chỉ frontend, `components/CommentModal.jsx`; backend không đổi):**
- Avatar người đang đăng nhập dời lên tiêu đề, đứng trước chữ "Bình luận" (chỉ hiện khi đã đăng nhập; vẫn bấm được để sang trang cá nhân).
- Nút gửi chuyển vào trong ô gõ, góc dưới phải (cùng cách làm ô bình luận ở `PostDetailPage`), ô gõ chiếm full chiều ngang, `minRows=2`, `maxRows=6`; chữ không đè lên nút nhờ chừa `pb`/`pr`.
- Logic gửi/Enter/Shift+Enter giữ nguyên. `CommentModal` dùng chung cho Post và Blog nên cả hai cùng được cải thiện.

## -20. [GIAO DIỆN] Trang giám sát tài nguyên trong Cài đặt > Quản trị (v0.10.21, 29/09/2026)

**Yêu cầu:** endpoint `GET /api/admin/assets/stats` (mục -19) chưa có giao diện, phải gọi bằng token SA — đưa vào tab Quản trị ngay để khỏi quên.

**Đã làm:**
- Frontend: component mới `pages/settings/AdminAssetsPanel.jsx`, xếp dưới mục "Domain nhúng media" trong tab Quản trị (`SettingsPage.jsx`, chỉ SA thấy). Hiển thị: tổng số file/dung lượng theo sổ, số liệu theo từng loại, khối "Tài khoản Cloudinary (số liệu thật)" (dung lượng, hạn mức + thanh % đã dùng, số file gốc/phái sinh), Top 10 tài khoản đổi/upload nhiều nhất, nút "Làm mới" (gọi `?refresh=1` bỏ cache 60s của backend). Có sẵn hướng dẫn cách đọc số liệu ngay trong giao diện (số Cloudinary lớn hơn số theo sổ là bình thường vì có media SA tự upload cho bài viết; tăng nhanh mà sổ không tăng → có file lọt ngoài sổ → chạy dry-run `npm run assets:cleanup`).
- API frontend: `getAssetStats({ refresh })` trong `api/admin.api.js`.
- Backend: `topUploaders` nay kèm `displayName`, `tagName`, `accountExists` (tra 1 lượt `db.getAll` cho tối đa 10 user) để SA biết ai chứ không chỉ thấy uid; `accountExists: false` = tài khoản đã xoá mà asset còn trong sổ.

**Đã kiểm chứng:** `npm test` (13 test, thêm test `getAssetStats`: tổng hợp số liệu, gắn tên, cache 60s, Cloudinary `usage()` lỗi vẫn trả phần còn lại); `npm run build` frontend thành công; render panel thật trong jsdom (React + MUI) với API giả ở 3 trạng thái — đủ dữ liệu, Cloudinary lỗi + sổ rỗng, API trả 403 — nội dung hiển thị đúng.

**CHƯA kiểm chứng:** chưa mở trên trình duyệt thật với backend thật (bố cục/màn hình nhỏ chưa xem bằng mắt); số liệu Cloudinary phụ thuộc gói — gói tính theo credit có thể không có `limit`/`used_percent`, khi đó panel hiện "—" và không vẽ thanh %.

## -19. [TÀI NGUYÊN] Quản lý vòng đời file upload lên Cloudinary + dọn ảnh mồ côi (v0.10.20, 29/09/2026)

**Yêu cầu:** Cloudinary của Twelve không được biến thành bãi rác mất kiểm soát; dọn phần rác đã tích luỹ qua hơn 10 bản Beta; quản lý chặt chẽ, có hệ thống hơn.

**Lỗi gốc (đã xác minh trên code v0.10.19):** `uploadAvatar` gọi `upload_stream` với `folder: twelve/avatars/<uid>` nhưng KHÔNG đặt `public_id` → mỗi lần đổi avatar Cloudinary tạo 1 asset MỚI (tên ngẫu nhiên), còn asset cũ bị bỏ lại vì code chỉ ghi đè `avatarUrl` trong Firestore, không xoá gì. Thêm: (1) upload xong mà ghi Firestore lỗi → ảnh mồ côi ngay; (2) Firestore chỉ lưu `secure_url`, không lưu `public_id`; (3) chưa có đường dọn khi xoá tài khoản; (4) giới hạn multer 10MB và cho GIF/AVIF dù frontend chỉ gửi JPEG 512×512; (5) upload avatar dùng chung limiter 30 lần/15 phút với sửa hồ sơ (~2.880 lần/ngày/tài khoản).

### Đã làm
1. **`public_id` cố định + `overwrite`** (`services/assets.service.js#putAvatar`): avatar luôn là `twelve/avatars/<uid>/avatar` → mỗi user CHỈ CÓ 1 asset, đổi avatar = ghi đè (kèm `invalidate` xoá cache CDN). Ép `format: jpg` (GIF động thành ảnh tĩnh), giữ incoming transformation 512×512 (Cloudinary không lưu ảnh gốc), thêm `tags` + `context.owner_uid` để truy vết phía Cloudinary không phụ thuộc chế độ thư mục.
2. **Sổ đăng ký `assets`** (collection mới, doc id = public_id với `/` → `__`): `publicId, kind, ownerUid, url, bytes, format, width, height, version, uploadCount, createdAt, updatedAt`. Ghi cùng batch với `user.avatarUrl` (atomic). Chỉ Backend truy cập (rules chặn tường minh). Muốn mở rộng upload (ảnh bài viết, video...) chỉ cần thêm 1 mục vào `ASSET_KIND` + `ASSET_LIMITS` trong `utils/constants.js` và đi qua service này.
3. **Dọn lười asset kiểu cũ**: ngay lần user đổi avatar kế tiếp, asset cũ (public_id ngẫu nhiên) của CHÍNH user đó bị xoá (`releaseSupersededAvatar`; chỉ xoá nếu nằm trong `twelve/avatars/<uid>/`, cùng cloud, khác asset hiện tại — có test).
4. **Siết giới hạn**: multer 10MB → **2MB**, `files: 1`, chỉ JPEG/PNG/WebP (kiểm cả magic bytes như v0.8.3); **limiter riêng `avatarUploadLimiter` 6 lần/giờ/tài khoản** (đặt TRƯỚC multer; request bị từ chối không tốn lượt).
5. **Giám sát**: `GET /api/admin/assets/stats` (chỉ SA; cache 60s, `?refresh=1` để bỏ cache) — số lượng/dung lượng theo loại, top 10 người upload nhiều nhất, và dung lượng THẬT của tài khoản Cloudinary (`api.usage()`; gồm cả media SA tự up cho bài viết nên lớn hơn số trong sổ là bình thường). Chưa có giao diện — gọi bằng token SA.
6. **`deleteAllAssetsOfUser(uid)`** sẵn trong service để gắn vào tính năng xoá tài khoản khi làm sau này.
7. **Script dọn ảnh mồ côi đã tích luỹ**: `scripts/cleanup-orphan-assets.js` (xem `scripts/README.md` mục "Dọn tài nguyên Cloudinary"). Mặc định DRY-RUN.

### Vì sao chọn cách này
Public_id cố định là cách duy nhất không cần logic "nhớ để xoá": không có race giữa 2 lần upload song song, Firestore lỗi không sinh rác mới, và số asset của mỗi user bị chặn trên là 1 bất kể user đổi bao nhiêu lần. Sổ `assets` + tag/context là lớp đối soát để phát hiện lệch, không phải nguồn sự thật duy nhất.

### Đã kiểm chứng
`npm test` (12 test, không cần Firebase/Cloudinary thật): tách URL↔public_id (có/không version, có transformation, URL giả mạo), kế hoạch dọn (giữ avatar đang dùng, xoá bản cũ/tài khoản đã mất, KHÔNG đụng asset ngoài `twelve/avatars/`, ân hạn, URL nằm trong nội dung bài, dynamic folder mode, phanh an toàn), và service với Cloudinary/Firestore giả. Thêm 1 lần chạy HTTP thật qua express+multer (mock Cloudinary/Firestore): PNG hợp lệ → 200 và xoá asset cũ đúng chủ; file giả PNG → 400; MIME GIF → 400; 3MB → 400; lần thứ 7 trong giờ → 429.

### CHƯA kiểm chứng được — cần bạn xác nhận trên môi trường thật
- Chưa chạy được với Cloudinary/Firestore thật (môi trường vá không có credentials và bị chặn mạng tới Cloudinary). Các lời gọi `api.resources`, `api.delete_resources`, `api.usage`, `AggregateField.sum` dùng đúng API của `cloudinary@2.x`/`firebase-admin@12.x` đã cài (đã kiểm tồn tại), nhưng hình dạng dữ liệu trả về chỉ được kiểm bằng mock.
- Chế độ thư mục của tài khoản Cloudinary (fixed hay dynamic): script xử lý cả hai (dựa vào `public_id` hoặc `asset_folder`), nhưng hãy đọc kỹ báo cáo dry-run để thấy đúng số lượng mong đợi trước khi `--apply`.
- Frontend không đổi (không có giao diện cho trang giám sát); chỉ bump phiên bản cho đồng bộ.

### Triển khai
1. Deploy backend, kiểm `/api/version`.
2. Chạy `npm run assets:cleanup` (dry-run) → đọc báo cáo → `node scripts/cleanup-orphan-assets.js --apply --limit=20` → `npm run assets:cleanup:apply`.
3. Sau đó gọi `GET /api/admin/assets/stats` bằng token SA để xem số liệu.


## -18. [SỬA LỖI SEO] Bot truy cập trang danh sách /blog nhận JSON 404 (v0.10.19, 29/09/2026)

**Nguồn:** báo cáo kiểm thử live của Replit AI trên bản v0.10.18 (báo cáo chưa hoàn thiện, phần dependency audit bị cắt) — phần lớn nội dung là xác nhận lại các mục đã biết/đã vá ở báo cáo trước; MỤC NÀY là phát hiện thật sự mới, đã kiểm chứng lại bằng `path-to-regexp` (thư viện Vercel dùng để dịch matcher) trước khi vá.

**Lỗi:** `frontend/middleware.js` dùng `matcher: ["/post/:path*", "/blog/:path*"]` — `:path*` khớp cả "0 segment", tức khớp luôn URL TRANG DANH SÁCH trần `/blog` (và `/post`). Backend SSR (`ssr.routes.js`) chỉ có route `/blog/:id`/`/post/:id` (trang CHI TIẾT), không có route xử lý URL trần. Bot/crawler (Googlebot, GPTBot...) ghé trang danh sách blog bị rewrite sang backend rồi nhận thẳng `{"error":"Endpoint not found."}` — hỏng index hoá trang danh sách.

**Khắc phục:** đổi sang `:path+` ("1 hoặc nhiều segment") — chỉ khớp URL chi tiết có id, URL trần rơi vào SPA React bình thường (không SSR được nội dung danh sách cho bot, nhưng không còn 404 trần trụi). Đã kiểm chứng bằng `path-to-regexp` thật: `/blog` không khớp, `/blog/abc123` vẫn khớp.

**Chưa làm (ngoài phạm vi vá lỗi):** xây trang SSR riêng cho danh sách blog/post để bot index được cả danh sách — là tính năng mới, cần quyết định thiết kế riêng.

### Rà lại các mục còn lại trong báo cáo (không cần sửa code)
- **M-1/L-1/L-3/L-4** — trùng các mục M-2/L-2/L-4/L-5 đã ghi nhận ở README mục -17, không có thông tin mới.
- **L-2 báo "mật khẩu vẫn tối thiểu 6 ký tự"** — ĐÃ SAI so với source: `validators.js` đang yêu cầu tối thiểu 8 ký tự từ v0.10.18. Khả năng cao là server live tại thời điểm kiểm thử (29/09) CHƯA được deploy bản 0.10.18/0.10.19 — kiểm tra lại `/api/version` sau khi deploy bản này, đừng vá lại theo báo cáo.
- **L-5 `coverImageUrl` chấp nhận mọi HTTPS host** — ĐÚNG như thiết kế (`utils/helpers.js` v0.9.6, có ghi chú rõ: cố tình không whitelist domain vì ảnh bìa có thể dán từ bất kỳ đâu). Đây là đánh đổi tính năng, KHÔNG tự khoá lại — nếu muốn giới hạn giống ảnh/video trong nội dung bài viết (đi qua allowlist domain của SA), cần quyết định của người vận hành vì sẽ chặn bớt cover ảnh hợp lệ từ các site chưa được thêm vào danh sách.
- **Dependency audit (frontend 1 HIGH + 13 MODERATE, backend 9 MODERATE)** — CHƯA xử lý trong bản này: môi trường vá hiện tại không cài đặt/build được frontend (npm install treo) nên không thể nâng cấp rồi tự kiểm chứng không phá app — nâng `firebase`/`react-router-dom`/`react-quill`/`file-type` một cách mù quáng có rủi ro cao hơn lợi ích khi không chạy được `npm run build` + test hồi quy. Cần thực hiện ở máy/CI có mạng npm đầy đủ, nâng từng gói một, chạy lại toàn bộ luồng đăng nhập/đăng ký/routing/upload/editor trước khi deploy.


## -17. [BẢO MẬT] Vá 2 lỗ hổng bộ lọc HTML + gia cố theo báo cáo bảo mật v0.10.17.10 (v0.10.18, 28/09/2026)

**Nguồn:** 2 báo cáo bảo mật (Claude rà soát báo cáo Dola Agent; Dola xác minh lại). Toàn bộ phát hiện được chạy lại trên chính code v0.10.17.10 trước khi vá — không tin nguyên văn báo cáo.

### Đã vá (đều có test)
1. **[N-1 MEDIUM] `<video poster>` bỏ qua allowlist domain → ảnh theo dõi (tracking beacon).** `poster` là URL ảnh trình duyệt tự tải, không đi qua kiểm tra `src`; kẻ đăng bài có thể nhúng pixel theo dõi từ domain bất kỳ, lộ IP/User-Agent/Referer của mọi người xem (kể cả khách). `sanitize.service.js`: chỉ giữ `poster` trên `<video>` và khi qua `isAllowedEmbedSrc()`; trên thẻ khác (audio/img...) xoá hẳn. Editor không tạo `poster` nên không mất tính năng.
2. **[N-2 LOW–MEDIUM] `<iframe allow>` không bị lọc** → uỷ quyền camera/micro/vị trí cho domain bên thứ ba trong allowlist, hộp thoại xin quyền lại hiện tên miền Twelve. Chỉ giữ token là **tên tính năng trơn** thuộc `fullscreen, picture-in-picture, encrypted-media, autoplay, clipboard-write`; token kèm bất kỳ danh sách origin nào (`*`, `https://…`, `'src'`) bị loại — chặt hơn mẫu trong báo cáo (chỉ lọc `*`). Kiểm chứng thêm: dạng không `*` (`camera; microphone`), hoa/thường, `;` thừa.
3. **[L-6] Quét lại bài cũ (`rescanContentForEmbedDomains`) bị race + chết cả lô.** Trước: ghi `batch` từ dữ liệu đã đọc từ trước → chỉnh sửa của người dùng giữa lúc quét bị ghi đè; 1 bài vừa bị xoá làm hỏng cả lô 450 bài trong khi cấu hình đã lưu mà API vẫn trả 500. Giờ mỗi bài chạy trong **transaction riêng** (đọc lại bản mới nhất, sanitize chính bản đó), lỗi 1 bài không ảnh hưởng bài khác; kết quả trả thêm `skipped`, `failed`; lỗi quét toàn bộ trả 200 + `rescan.error` (cấu hình đã lưu). Giao diện SA hiển thị các trường hợp này.
4. **[L-7] Chặn "suffix công cộng"** (`github.io`, `vercel.app`, `netlify.app`, `pages.dev`, `com.vn`, `co.uk`…) khi lưu danh sách domain — cho phép nó nghĩa là tin cậy mọi người dùng của dịch vụ đó (path-scoping không cứu được). SA phải nhập subdomain cụ thể (`ten-ban.github.io`). Danh sách + heuristic ccSLD, không thể đầy đủ tuyệt đối.
5. **[M-3] Header bảo mật cho SPA Vercel** (`frontend/vercel.json`): `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, và **`Content-Security-Policy-Report-Only`** (CHƯA enforce — xem bên dưới). Tách script chống nháy theme ra `public/theme-init.js` (hành vi giống hệt bản inline, đã test 7 trường hợp) để sau này CSP không cần `'unsafe-inline'` cho script.
6. **[L-3]** Mật khẩu đăng ký tối thiểu 6 → **8 ký tự** (backend + gợi ý ở form). Chỉ áp dụng đăng ký mới; đăng nhập đi thẳng Firebase nên tài khoản cũ không ảnh hưởng.
7. **[I-4]** Gỡ file rác `frontend/m+#U00f3yo.txt` (ghi chú cá nhân vô tình nằm trong repo).

**Bổ sung ngoài báo cáo:** thêm `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` (app không dùng các API này) — lớp phòng thủ thứ hai cho N-2 ở cấp trình duyệt. `frame-ancestors` cố ý KHÔNG đặt trong CSP Report-Only (Chrome bỏ qua directive này ở chế độ report-only và chỉ gây nhiễu console); `X-Frame-Options` đã lo phần clickjacking. Khi chuyển sang enforce hãy thêm `frame-ancestors 'self'`.

### SA/vận hành cần làm SAU KHI deploy (không phải việc của code)
1. **Vào Settings > Quản trị, bấm Lưu 1 lần** để quét lại bài cũ có thể đã chứa `poster`/`allow` độc hại từ trước bản vá; đọc kết quả quét (`failed` > 0 thì Lưu thêm lần nữa).
2. Cấu hình embed đang có `res.cloudinary.com/dsviqitiv` nhưng cloud thật là `dk7xohrrk` → ảnh cloud thật bị lược bỏ im lặng. Sửa path (đối chiếu URL ảnh đã upload). Xác minh nguồn gốc `flowmusic.app`.
3. Chạy lại `node src/seed/seedVersion.js` (`/api/version` đang đọc doc Firestore `config/version` cũ, lệch `/health`).
4. **CSP Report-Only:** mở app trên Vercel, thao tác đủ tính năng (đăng nhập, đăng ký + CAPTCHA, xem bài có embed, upload avatar, realtime), xem Console để tìm vi phạm; chỉnh xong mới đổi `Content-Security-Policy-Report-Only` → `Content-Security-Policy`. Nếu đổi domain backend Render phải cập nhật `connect-src`. `style-src 'unsafe-inline'` bắt buộc với MUI/Emotion; `frame-src https:` là thoả hiệp có chủ đích (danh sách embed do SA quản lý động, lọc chính xác đã ở `sanitizeHtml()`). CSP CHƯA được thử trên trình duyệt thật.
5. Dọn bài test còn trên feed; chuẩn hoá `accountRole` của tài khoản SA (`accountGroup=SA` nhưng `accountRole=user`).

### Không làm trong bản này (chủ ý)
- **M-2 Firestore cho phép `list` trực tiếp:** đã biết và chấp nhận rủi ro (cần realtime cho khách); hướng lâu dài là Firebase App Check (cần cấu hình phía Firebase Console).
- **L-2** (dò email qua 409), **L-4** (dò tagname), **L-5** (token trong IndexedDB): đã có CAPTCHA/rate-limit, là hành vi chuẩn của SDK.
- **I-3** bình luận lưu raw HTML-special-chars là có chủ đích; bắt buộc `escapeHtml()` ở mọi điểm render trong tương lai.
- **I-6/I-7:** `trust proxy=1` đúng cho Render (tăng hop nếu thêm Cloudflare); cấu hình embed nạp 1 lần lúc khởi động — nếu scale nhiều instance, domain vừa gỡ vẫn được chấp nhận ở instance khác tới khi restart.


## -16. [SỬA LỖI NGHIÊM TRỌNG] Realtime bình luận bị hỏng sau v0.10.17.9 (v0.10.17.10, 26/09/2026)

**Triệu chứng:** 2 tài khoản A, B cùng ở 1 bài viết: A bình luận thì A thấy comment của mình, B chỉ thấy SỐ bình luận tăng mà không thấy comment mới; sửa bình luận cũng không cập nhật realtime.

**Nguyên nhân — 2 lỗi độc lập do bản v0.10.17.9 (hook `usePaginatedComments`) gây ra:**
1. Điều kiện chặn "còn trang chưa tải" bị viết NGƯỢC (`if (!hasMoreRef.current) return;`) — khi đã tải hết bình luận (bài ít bình luận) thì listener bỏ qua MỌI bình luận mới của người khác. Bên người gửi vẫn thấy comment của mình vì được thêm optimistic.
2. Query realtime không có `limit` bị `firestore.rules` từ chối (`allow list: if request.query.limit <= 50`) → `permission-denied` (chỉ hiện ở console). Dù sửa lỗi 1, listener vẫn không chạy.
Ngoài ra bản .9 đã bỏ realtime khi SỬA bình luận (đánh đổi hiệu năng) — không chấp nhận được, khôi phục lại ở bản này.

**Khắc phục** (`frontend/src/hooks/usePaginatedComments.js` — viết lại phần realtime):
- 1 listener duy nhất: `where("updatedAt", ">=", mốc) + orderBy("updatedAt","desc") + limit(50)` — luôn tuân thủ rules (`limit <= 50`), KHÔNG cần sửa/deploy lại `firestore.rules`. Chỉ nhận bình luận thêm/sửa/xoá TỪ LÚC MỞ nên chi phí không phụ thuộc tổng số bình luận.
- Xử lý theo id: đã có → vá nội dung (sửa realtime); chưa có + đã tải hết → thêm vào cuối; chưa có + còn trang chưa tải → bỏ qua (tránh "khoảng trống", REST sẽ trả đúng khi cuộn tới).
- Mốc thời gian lấy từ GIỜ SERVER: `GET .../comments` trả thêm `serverTimeMs` (`comments.controller.js`), trừ 60s dự phòng — không phụ thuộc đồng hồ máy người dùng. Backend cũ chưa có `serverTimeMs` vẫn chạy (fallback giờ máy).
- Chống race: bỏ qua phản hồi của lần tải đã cũ (đổi bài/mở lại), chống lặp vô hạn khi comment làm cursor bị xoá, tự lùi cursor khi comment cursor bị xoá.
- Thêm nút "Xem thêm bình luận" (trang POST + hộp bình luận) — dấu hiệu nhìn thấy được của phân trang và đường dự phòng nếu cuộn không kích hoạt.
- Xoá thật của bình luận: realtime với bình luận có hoạt động từ lúc mở; **giới hạn đã biết:** bình luận CŨ (chưa được sửa/thêm kể từ lúc mở) bị người khác xoá sẽ chỉ biến mất sau khi tải lại trang.

**Kiểm chứng:** dựng bộ test hook với Firestore giả lập có áp đúng rule `limit <= 50` và `docChanges` như thật: hook v0.10.17.9 tái hiện đúng lỗi (permission-denied, B không thấy comment, sửa không cập nhật); hook mới đạt 21/21 (bài ít/nhiều bình luận, phân trang 20/20/5, sửa/xoá realtime, optimistic không trùng, cursor bị xoá, dọn listener). Chưa chạy thử trên Firestore thật — cần thử lại với 2 tài khoản như đã mô tả.

**Lưu ý triển khai:** cần deploy CẢ backend lẫn frontend. Nếu chỉ deploy frontend, `listComments` (bản cũ) vẫn trả toàn bộ bình luận không phân trang.

## -15. [SỬA LỖI + HIỆU NĂNG] Xếp hạng Hashtag đồng điểm chưa nhất quán, tải bình luận không giới hạn (v0.10.17, 26/09/2026)

**Lưu ý:** `package.json` khi nhận bàn giao đã ở build `.8` (`Twelve_Beta_0_10_17_8_260926_legacy-migration`) nhưng `frontend/public/version.json` và mục README này vẫn còn ở `0.10.16.1` — tức có các build trung gian (`.2`–`.8`, "legacy-migration") đã thực hiện ngoài phiên làm việc này, KHÔNG có trong lịch sử mình nắm được nên không ghi patch note thay cho các build đó. Mục này CHỈ ghi lại 2 việc mình trực tiếp sửa, và đồng bộ lại số phiên bản ở cả 3 nơi cho khớp.

### 1. Xu hướng > tab Hashtag: đồng điểm xếp hạng không nhất quán
`backend/src/controllers/trending.controller.js` — cả 5 chỗ xếp hạng hashtag
(Tuần qua, Toàn thời gian, Tìm kiếm, và 2 bảng chốt vĩnh viễn khi rollover
tuần) chỉ `sort` theo ĐÚNG 1 tiêu chí (điểm/tăng trưởng) — 2 hashtag cùng
điểm thì thứ tự phụ thuộc thứ tự duyệt Map/mảng (không ổn định), khiến
hashtag ÍT lượt dùng hơn đôi khi xếp TRÊN hashtag cùng điểm nhưng NHIỀU lượt
dùng hơn.

**Khắc phục:** thêm hàm `compareHashtagRank(a, b, scoreField)` so sánh 3
cấp: điểm/tăng trưởng → lượt sử dụng (`usageCount`) → thời điểm bài mới
nhất (`lastUsedAtMs`), dùng chung cho cả 5 chỗ.

### 2. Tải bình luận không giới hạn số lượng
`comments.controller.js#listComments` trước đây trả VỀ HẾT toàn bộ bình
luận trong 1 lần gọi (`.get()` không `.limit()`) — bài viết có hàng trăm
bình luận thì mở hộp bình luận (hay trang POST) đều tải hết 1 lúc, vừa chậm
vừa tốn không cần thiết.

**Khắc phục:**
- Backend: phân trang cursor (`?cursor=&limit=`, mặc định
  `CONTENT_LIMITS.COMMENTS_PAGE_SIZE = 20`, tối đa
  `COMMENTS_PAGE_SIZE_MAX = 50`) — cùng quy ước với `listPosts()`.
- Frontend: hook dùng chung mới `frontend/src/hooks/usePaginatedComments.js`
  — tải trang đầu, tự tải thêm bằng `IntersectionObserver` khi cuộn chạm
  cuối danh sách (dùng chung `rootMargin: "300px"` như
  `useIncrementalReveal.js`), thay cho việc tải hết + lắng nghe realtime
  KHÔNG giới hạn theo thời gian của bản cũ (chi phí lắng nghe cũ phụ thuộc
  TỔNG số bình luận của bài viết, bất kể đã xem hay chưa). Áp dụng cho cả
  `CommentModal.jsx` (hộp bình luận) lẫn `PostDetailPage.jsx` (trang POST).
  Đánh đổi: bình luận CŨ bị người khác sửa/xoá trong lúc đang mở sẽ không tự
  cập nhật realtime nữa (phải tải lại mới thấy) — xem docblock trong hook để
  biết chi tiết lý do chấp nhận đánh đổi này.

## -14. [SỬA LỖI + BẢO MẬT] Chèn video/audio trực tiếp bị mất nội dung, domain-allowlist không chặn được media trực tiếp (v0.10.16, 26/09/2026)

**Bối cảnh:** SA báo lỗi không chèn được video/audio Cloudinary vào bài viết
dù đã thêm domain Cloudinary vào danh sách domain nhúng (Settings > Quản trị).
Quá trình debug phát hiện ra **3 lỗi độc lập**, xử lý lần lượt:

### 1. [SỬA LỖI NGHIÊM TRỌNG] `<video>`/`<audio>` chèn trực tiếp biến mất khỏi bài viết ngay khi bấm "Chèn"
Quill.js (bản `quill@1.3.7` dùng qua `react-quill`) chỉ có sẵn blot cho
`<img>` (format "image") và `<iframe>` (format "video", dùng cho nhúng
YouTube/Vimeo...) — **không có blot nào cho thẻ `<video>`/`<audio>` thật**.
`classifyMediaUrl`/`buildMediaHtml` (`utils/media.js`, từ v0.10.13) đã dựng
đúng `<video src="...">`/`<audio src="...">`, nhưng `dangerouslyPasteHTML`
âm thầm loại bỏ thẻ không có blot tương ứng — nên MỌI file video/audio trực
tiếp (không riêng Cloudinary) đều "chèn xong không thấy gì" từ v0.10.13 tới
nay, chưa từng chạm tới backend. Đã kiểm chứng bằng cách dựng thật
`quill@1.3.7` + `jsdom` trong môi trường headless trước và sau khi vá.

**Khắc phục** (`frontend/src/components/QuillEditor.jsx`): đăng ký 2 blot
tuỳ biến kiểu `BlockEmbed` cho tagName `VIDEO`/`AUDIO` (blotName riêng
`"video-file"`/`"audio-file"`, không trùng `"video"` mà Quill dùng cho
iframe), thêm vào whitelist `formats`.

### 2. URL Cloudinary không có đuôi file bị nhận nhầm thành "trang web"
`classifyMediaUrl` phân loại URL chỉ dựa vào đuôi file cuối cùng
(`.mp4`/`.mp3`...). URL Cloudinary khi upload không ép `format` cụ thể (hoặc
dùng `f_auto`) trả về link KHÔNG có đuôi file — rơi vào nhánh "webpage"
(iframe chung) thay vì `<video>`/`<img>` thật.

**Khắc phục** (`frontend/src/utils/media.js`): thêm nhận diện theo cấu trúc
đường dẫn Cloudinary (`/image/upload/` hoặc `/video/upload/`) khi không có
đuôi file, dựng thẳng `<img>`/`<video>` — không qua iframe.

### 3. [BẢO MẬT] Domain-allowlist (Settings > Quản trị) chỉ chặn được `<iframe>`, không chặn được media trực tiếp
Danh sách domain do SA quản lý (v0.10.15) chỉ được `sanitize.service.js`
áp dụng cho `<iframe>` — `<img>`/`<video>`/`<audio>`/`<source>` chèn trực
tiếp chỉ cần là URL http(s) hợp lệ là qua, KHÔNG kiểm tra domain. SA xoá 1
domain khỏi danh sách, hệ thống có quét lại toàn bộ bài viết
(`rescanContentForEmbedDomains`, v0.10.15) nhưng chỉ dọn được iframe — media
trực tiếp trỏ tới domain vừa xoá vẫn còn nguyên.

**Khắc phục** (`backend/src/services/sanitize.service.js`,
`embedDomains.controller.js`):
- Gộp kiểm tra domain của iframe và media trực tiếp thành 1 hàm chung
  (`isAllowedEmbedSrc`) — xoá 1 domain giờ dọn sạch MỌI loại nhúng, không
  riêng iframe.
- Thêm khả năng giới hạn theo **path**: SA nhập `res.cloudinary.com/ten-cloud`
  để chỉ cho phép đúng 1 cloud/thư mục cụ thể, chặn mọi cloud khác dù cùng
  domain. So khớp theo TỪNG SEGMENT đường dẫn (không phải so chuỗi con) —
  tránh lỗ hổng domain giả trùng tiền tố ký tự (vd. "ten-cloud-evil" khớp
  nhầm "ten-cloud" nếu dùng `startsWith()`).
- Siết https bắt buộc cho cả media trực tiếp (trước đây còn cho phép
  `http://`).
- **Thay đổi hành vi có chủ đích:** sau bản vá, dán URL ẢNH từ 1 domain
  chưa được SA cho phép cũng sẽ bị chặn (trước đây ảnh không bị domain-gate
  bao giờ) — SA cần chủ động thêm domain cho các nguồn ảnh/media hợp lệ.
- Sửa kèm 1 lỗi hiển thị UI (`AdminEmbedDomainsPanel.jsx`): sau khi Lưu,
  ô nhập domain hiện lại đúng cả phần path đã nhập (trước đó path bị "biến
  mất" khỏi ô nhập dù vẫn được lưu đúng ở Firestore).

**Quy ước mới:** từ bản này, MỌI lần cập nhật code đều phải (1) nâng số
phiên bản ở `backend/package.json`, `frontend/package.json` VÀ
`frontend/public/version.json` (giữ cùng 1 con số ở cả 3 nơi), và (2) thêm
1 mục patch note mới ngay đầu README này — không để dồn lại như đã xảy ra
từ v0.9.0 (mục -13) tới v0.10.15.

## -13. [TÍNH NĂNG MỚI — CHỈ FRONTEND] Trang Settings + Dark Mode (v0.9.0, 17/09/2026)

**Nội dung:** trang Settings mới với khung nhiều tab (mở rộng được ở các bản
sau), tab đầu tiên "Ứng dụng" chứa "Chế độ giao diện": Sáng / Tối / Theo
trình duyệt.

### Khung trang Settings

- `frontend/src/pages/SettingsPage.jsx` (mới): khai báo mỗi tab bằng 1 phần
  tử `{ key, label, icon, render() }` trong mảng `TABS` — thêm tab mới sau
  này (Tài khoản, Riêng tư, Thông báo...) chỉ cần thêm 1 phần tử, không đụng
  vào phần khung (Tabs MUI, responsive layout).
- Route `/settings` và `/settings/:tab` — tab đang mở đồng bộ với URL (chia
  sẻ được link thẳng tới 1 tab, nút back/forward hoạt động tự nhiên).
- Thêm mục "Cài đặt" vào menu Navbar (cho cả người đã đăng nhập lẫn khách —
  đây là tuỳ chọn thiết bị/trình duyệt, không phải tuỳ chọn tài khoản).

### Dark Mode

- `frontend/src/theme/theme.js`: chuyển từ 1 theme SÁNG cố định sang factory
  `createAppTheme(mode)` — bảng màu SÁNG giữ nguyên y hệt bản cũ (không đổi),
  bổ sung bảng màu TỐI theo tông "surface" xám-tím đậm (không dùng đen tuyệt
  đối #000, theo tinh thần Material Design 3 dark surfaces — tránh chói mắt
  và giữ được phân lớp giữa các Card/Paper). Đồng thời sửa `MuiAppBar` từ màu
  hex cố định (`#FFFBFE`) sang đọc động theo `theme.palette` — bug tiềm ẩn
  nếu không sửa: thanh AppBar sẽ luôn hiện màu SÁNG bất kể Dark Mode.
- `frontend/src/context/ThemeModeContext.jsx` (mới): quản lý lựa chọn
  `mode` ("light"/"dark"/"system") + `resolvedMode` (giá trị thực tế đang áp
  dụng). Lưu vào `localStorage` (áp dụng theo THIẾT BỊ/TRÌNH DUYỆT, chưa
  đồng bộ qua tài khoản/Firestore ở bản này). Khi `mode === "system"`, lắng
  nghe `prefers-color-scheme` real-time — đổi chế độ hệ điều hành trong lúc
  đang mở Twelve thì giao diện tự đổi theo ngay, không cần tải lại trang.
- `frontend/index.html`: thêm script inline nhỏ đọc lựa chọn đã lưu và set
  màu nền `<html>` **trước khi React kịp mount** — chống hiện tượng "nháy
  sáng" (1 khoảnh khắc nền trắng) khi tải trang ở Chế độ Tối, vốn gây chói
  mắt khó chịu nếu không xử lý.
- `theme-color` meta tag tự cập nhật theo mode — đồng bộ màu thanh trạng
  thái/địa chỉ trên trình duyệt mobile với nền app.

### Xử lý nội dung bài viết do người dùng tự chọn màu (lý do chính trì hoãn Dark Mode qua 8 bản Beta)

**Vấn đề:** người viết bài có thể tự chọn MÀU CHỮ tuỳ ý qua color picker của
Quill — lưu thành `style="color: ..."` ngay trong `contentHtml`. Những màu
đó thường được chọn với giả định nền TRẮNG (VD: chữ đen) — ở Chế độ Tối, chữ
màu đó có thể gần như không đọc được. Đây chính là vấn đề "rất nhiều phần tử
màu sắc khác nhau trên trang POST" đã nêu.

**Đã xử lý** (`frontend/src/components/PostContent.jsx`): khi đang ở Chế độ
Tối, LOẠI BỎ khai báo `color:` khỏi style inline trước khi render (regex tách
từng khai báo CSS, chỉ loại đúng `color:`, **giữ nguyên**
`background-color:`, bold/italic/underline/align...) — chữ tự dùng màu mặc
định của theme (luôn tương phản tốt với nền) thay vì giữ màu tác giả chọn
(vốn không tính trước khả năng bài viết được xem ở nền tối). Xử lý này CHỈ Ở
HIỂN THỊ — không đụng vào `contentHtml` gốc lưu trong Firestore; chuyển lại
Chế độ Sáng thì màu gốc tác giả chọn hiện lại y nguyên ngay lập tức. Code
block (nền `#1e1e2e` cố định, không đổi theo theme) và nền video (`#000`)
giữ nguyên vì đây là quy ước hiển thị riêng, không phụ thuộc theme.

**Đã rà soát toàn bộ components/pages** — không còn màu hex/`"white"`/`"black"`
hardcode nào khác ngoài 2 trường hợp cố ý nêu trên (code block, khung cắt ảnh
đại diện `AvatarCropper.jsx`) — phần còn lại của app đã dùng token theme
(`background.paper`, `text.secondary`, `primary.main`...) từ trước nên tự
thích ứng đúng khi đổi theme, không cần sửa thêm.

---

## -12. [SỬA LỖI — CHỈ FRONTEND] Bình luận mới thiếu avatar/tên/tag trên trang POST (v0.8.29, 16/09/2026)

**Báo cáo:** trên trang POST (chi tiết), gửi 1 bình luận thì bình luận đó
hiện avatar mặc định, không tên hiển thị, không tag name — phải F5 mới thấy
đúng.

**Nguyên nhân:** document Firestore thô của 1 comment (nhận qua
`onSnapshot` real-time trong `PostDetailPage.jsx`) chỉ có `authorUid`, KHÔNG
có `author` (displayName/avatarUrl/tagName) — field đó chỉ được BACKEND JOIN
thêm vào khi gọi REST API `GET .../comments` (`listComments`, chỉ gọi 1 lần
lúc tải trang). Listener real-time cũ chỉ "giữ lại" `author` cho comment ĐÃ
TỪNG có trong state trước đó (tra theo **id comment**) — với 1 comment HOÀN
TOÀN MỚI (vừa gửi, hoặc vừa có người khác gửi tới), id đó chưa từng xuất hiện
→ `author: null` → UI hiện avatar mặc định, không tên — chỉ tự hết khi F5
(gọi lại `listComments`, có JOIN đầy đủ).

**Đã vá** (`frontend/src/pages/PostDetailPage.jsx`):
1. Tra cache theo **`authorUid`** thay vì theo id comment — 1 tác giả đã có
   bất kỳ comment nào trong trang thì mọi comment MỚI khác của CHÍNH họ cũng
   dùng lại được ngay, không cần gọi thêm API.
2. Nếu comment mới là **của chính mình** — dùng thẳng `profile` đã có sẵn
   trong `AuthContext` (0 lượt gọi API thêm).
3. Nếu vẫn chưa có author (tác giả hoàn toàn mới, của người khác) — gọi bổ
   sung `getPublicProfile(uid)` (chỉ những uid còn thiếu, không phải gọi lại
   toàn bộ danh sách bình luận) rồi vá lại đúng comment đó ngay khi có kết
   quả — không cần đợi F5.

**Lưu ý:** `components/CommentModal.jsx` (modal bình luận mở từ card trên
trang INDEX/BLOG) đã có 1 bản vá tương tự từ trước (v0.8.24.3) cho đúng lỗi
này — chỉ riêng `PostDetailPage.jsx` (trang POST chi tiết) là chưa được áp
dụng, nên bug chỉ xảy ra ở trang POST như báo cáo. `CommentModal.jsx` dùng
chiến lược "gọi lại toàn bộ `listComments`" khi thiếu author (đơn giản, có
debounce 1.5s) thay vì fetch từng profile riêng lẻ như bản vá này — cả 2 đều
đúng, không cần sửa gì thêm ở đó; có thể cân nhắc thống nhất 2 file dùng
chung 1 chiến lược ở 1 bản sau nếu muốn.

---

## -11. [TỐI ƯU HIỆU NĂNG] Giảm lãng phí quota đọc/ghi Firestore (v0.8.28, 15/09/2026)

**Yêu cầu:** rà soát toàn nền tảng để giảm quota đọc/ghi Firestore lãng phí
và giảm tải không cần thiết lên server.

### 1. [Tác động lớn nhất] Throttle `reconcilePostsScoreSum`

**Phát hiện:** `reconcilePostsScoreSum` (đọc TOÀN BỘ document `posts` +
`blogs` của 1 tác giả — xem đính chính bên dưới, đây KHÔNG phải aggregation
query rẻ như tài liệu cũ mô tả) chạy **vô điều kiện**:
- Mỗi lần `syncPostScore` chạy — tức **mỗi lần** 1 bài viết được xem
  (`getPost`/`getBlog`/2 route SSR), bất kể điểm bài đó có đổi hay không.
- Mỗi lần `syncPostScoresBatch` chạy — tức **mỗi lần** tải trang danh sách
  (`listPosts`/`listBlogs`), cho **từng tác giả khác nhau xuất hiện trong
  trang** (trang 10-20 bài có thể có 10-20 tác giả khác nhau → 10-20 lượt
  quét toàn bộ bài viết của từng người, MỖI LẦN tải trang).

Với 1 tác giả có hàng trăm bài viết, chỉ cần vài lượt xem/tải trang INDEX là
tốn hàng nghìn lượt đọc Firestore không cần thiết — vì mục đích ban đầu (tự
sửa nếu ai đó chỉnh tay Firestore) chỉ cần chạy THỈNH THOẢNG, không cần chạy
lại ở MỌI lần đọc.

**Đã vá:** thêm cơ chế **throttle bằng cache trong bộ nhớ**
(`_reconcileLastRunAt`, xem `utils/helpers.js`) — mỗi `authorUid` chỉ thực sự
chạy lại đối soát (2 lượt quét collection + 1 transaction) **tối đa 1 lần mỗi
15 phút**. Trong cửa sổ đó, mọi lời gọi tiếp theo cho cùng tác giả trả về
ngay lập tức, tra cứu trong bộ nhớ — **0 chi phí Firestore** cho lần kiểm tra
đó. Vẫn giữ nguyên tính chất "tự chữa lành" của `postsScoreSum`, chỉ theo chu
kỳ hợp lý thay vì mỗi lần đọc. Áp dụng tự động cho **cả 4 nơi gọi**
(`syncPostScore`, `syncPostScoresBatch`, `deletePost`, `deleteBlog`) vì tất cả
đều đi qua chung 1 hàm.

**Đính chính tài liệu cũ:** docblock gốc mô tả `reconcilePostsScoreSum` dùng
aggregation query (rẻ, ~1 lượt đọc/1000 index entry) — mô tả này ĐÃ LỖI THỜI
từ v0.8.25, khi hàm chuyển sang đọc từng document thủ công (để fallback đúng
`externalPostScore`/`postScore` cho bài cũ) — chi phí thật là 1 lượt đọc CHO
MỖI document, đắt hơn nhiều so với mô tả cũ. Đã sửa lại docblock cho đúng.

### 2. Cache danh sách quốc gia trong bộ nhớ

`GET /api/countries` trước đây quét lại toàn bộ collection Firestore ở
**mỗi lần** gọi (mỗi lần load trang Đăng ký), dù đây là dữ liệu tham chiếu
tĩnh gần như không bao giờ đổi. Đã thêm cache trong bộ nhớ với TTL 1 giờ
(`countries.controller.js`) — tự làm mới nếu admin chạy lại seed trong lúc
server đang chạy, không cần restart.

### Không đổi (đã rà soát, xác nhận không lãng phí)

- `listPosts`/`listBlogs` tra `myReaction` qua `db.getAll(...)` — đã là 1
  lượt gọi RPC gộp (không phải N lượt riêng lẻ), và có điều kiện bỏ qua hoàn
  toàn nếu chưa đăng nhập hoặc trang rỗng.
- Ghi audit log cho mỗi lần cộng/trừ `positiveScore` (view/like/dislike/
  comment/share/đăng bài) — đây là tính năng chống gian lận chủ đích (đã yêu
  cầu "siết chặt" ở các bản trước), không phải lãng phí ngoài ý muốn, nên giữ
  nguyên.
- Doc dedup cho view/share (`posts/{id}/views/{key}`,
  `posts/{id}/shares/{key}`) — cần thiết cho cơ chế chống bơm số liệu ảo,
  không phải lãng phí.
- `syncPostScore` đã có điều kiện `if (storedScore !== score)` trước khi ghi
  — không ghi thừa khi điểm không đổi, giữ nguyên.

---

## -10. [SỬA LỖI NGHIÊM TRỌNG] View không tăng khi xem bài của người khác (v0.8.27, 15/09/2026)

**Báo cáo:** user đăng nhập xem bài viết của NGƯỜI KHÁC thì `viewCount` không
tăng; chỉ xem bài viết CỦA CHÍNH MÌNH mới thấy tăng.

**Nguyên nhân — vi phạm thứ tự đọc/ghi trong Firestore transaction:**
Firestore bắt buộc mọi lệnh **đọc** (`tx.get`) trong 1 transaction phải xảy ra
**trước** mọi lệnh **ghi** (`tx.set`/`update`/`delete`) — gọi `tx.get()` sau
khi đã gọi `tx.update()` trong cùng transaction sẽ làm cả transaction bị
**reject** (throw). Bản vá v0.8.25 (thêm `externalPostScore` — điểm bài viết
chỉ tính từ tương tác của người khác, phục vụ chống farm điểm) đã thêm 1 lệnh
`tx.get(ref)` **SAU** `tx.update(ref, updates)` đã có sẵn trong
`utils/helpers.js#registerView` — nhưng lệnh đọc thừa này **CHỈ chạy trong
nhánh `viewerUid !== authorUid`** (tức chính xác trường hợp "xem bài của
người khác"). Vì vậy:

- Xem bài **của người khác** → vào nhánh có lệnh đọc sau ghi → transaction
  luôn bị Firestore reject → rơi vào `catch` của `registerView` → hàm âm thầm
  trả về `false` (không tính view) → **KHỚP CHÍNH XÁC** với báo cáo.
- Xem bài **của chính mình** → nhánh đó bị bỏ qua hoàn toàn (không vi phạm
  gì) → transaction thành công bình thường → view vẫn tăng đúng.

Đối chiếu lại **toàn bộ** các `db.runTransaction` khác trong dự án
(`reactions.controller.js`, `comments.controller.js`, `posts.controller.js`
#deletePost, `blog.controller.js`#deleteBlog, `registerShare`,
`reconcilePostsScoreSum`) xác nhận **chỉ duy nhất** `registerView` mắc lỗi
này — các chỗ khác (kể cả `registerShare`, thêm `externalPostScore` cùng đợt
v0.8.25) đều đọc đúng thứ tự trước khi ghi.

**Đã vá:** chuyển lệnh `tx.get(ref)` lên **trước** mọi lệnh ghi trong
transaction của `registerView` — đọc `docSnap` ngay khi xác định
`willCreditViewer = viewerUid && !isAi && viewerUid !== authorUid`, rồi mới
thực hiện toàn bộ `tx.set`/`tx.update` (view record, `viewCount`,
`externalPostScore`, `positiveScore`...). Hành vi/kết quả tính điểm giữ
nguyên 100% — chỉ đổi THỨ TỰ gọi lệnh trong transaction.

---

*(Lưu ý: các bản v0.8.9 → v0.8.26 đã bổ sung nhiều thay đổi quan trọng —
`positiveScore` cấp tài khoản, `externalPostScore` chống farm điểm qua
`postsScoreSum`, chữ ký HMAC chống giả mạo `sharerUid` khi share, audit log
cho mọi lần cộng/trừ điểm — nhưng không được ghi lại đầy đủ ở changelog này.
Xem trực tiếp code trong `utils/helpers.js` và các controller liên quan để
biết chi tiết.)*

---

## -9. [TÍNH NĂNG MỚI] postsScoreSum — Điểm tổng tất cả bài viết cấp tài khoản (v0.8.8, 10/09/2026)

Thêm thông số **cấp tài khoản** `postsScoreSum` (`users/{uid}.postsScoreSum`)
= tổng `postScore` của TẤT CẢ bài viết + bài blog mà tài khoản đó đang có.
**Chỉ backend** — không có thay đổi gì ở frontend, `postsScoreSum` **KHÔNG**
được trả về ở bất kỳ API công khai nào (`toPublicUser` không đưa field này
vào danh sách trả ra) và không hiển thị ở UI tại thời điểm này, đúng như yêu
cầu.

### Vì sao dùng CỘNG DỒN DELTA thay vì "tính lại từ đầu" như postScore

`postScore` (1 bài viết) tính lại được từ đầu mỗi lần đọc vì chỉ phụ thuộc 5
field NẰM TRONG CHÍNH document đó — rẻ. `postsScoreSum` thì khác: nó là tổng
qua **nhiều document** (mọi bài viết/blog của 1 tác giả) — "tính lại từ đầu"
sẽ phải quét toàn bộ bài viết của tác giả mỗi lần, tốn kém và không cần
thiết. Thay vào đó: mỗi khi `postScore` của 1 bài đổi từ `storedScore` thành
`score`, cộng đúng phần chênh lệch (`score - storedScore`) vào
`postsScoreSum` của tác giả bài đó — chi phí O(1), không phụ thuộc số bài
viết tác giả đang có.

- **`utils/helpers.js#postsScoreSumWrite(db, admin, authorUid, delta)`**: hàm
  thuần (không tự ghi) trả về `{ ref, data }` sẵn sàng để `tx.set(...)` (trong
  transaction) hoặc `ref.set(...)` (ngoài transaction) — dùng
  `set({ merge: true })` thay vì `update()` để tự tạo field/doc nếu thiếu,
  không throw nếu user doc tạm thời không tồn tại (không được phép làm hỏng
  thao tác chính chỉ vì bước cộng dồn phụ này lỗi).
- **Áp dụng ở ĐÚNG những nơi `postScore` của 1 bài có thể đổi — khớp yêu cầu
  "khi có sự thay đổi chỉ số thì backend song song cập nhật"**:
  - `reactions.controller.js#react` (like/dislike): cộng dồn delta **ngay
    trong transaction** đã có sẵn để tính/ghi `postScore` — atomic, không có
    khoảng hở race condition dù nhiều người thao tác đồng thời.
  - `comments.controller.js#addComment/#deleteComment`: tương tự, trong
    transaction hiện có.
  - `posts.controller.js#getPost`, `blog.controller.js#getBlog`, 2 route SSR
    (`/post/:id`, `/blog/:id`): cộng dồn ngay sau khi đồng bộ `postScore`
    của bài đó (`utils/helpers.js#syncPostScore` — đã thêm tham số `admin` +
    `authorUid`), chạy song song, không chặn response.
  - `posts.controller.js#listPosts`, `blog.controller.js#listBlogs` (trang
    INDEX/BLOG, và mọi trang dạng list card bài viết tương đương sau này):
    `utils/helpers.js#syncPostScoresBatch` (đã thêm tham số `admin` +
    `authorUid` mỗi item) — nhiều bài **CÙNG tác giả** trong 1 trang danh
    sách được **gộp thành 1 lần tăng `postsScoreSum` duy nhất** (cộng dồn
    delta theo từng tác giả trước khi ghi), không phải N lần riêng lẻ.
  - **Bài viết bị XOÁ** (`posts.controller.js#deletePost`,
    `blog.controller.js#deleteBlog`): bài không còn tồn tại thì không được
    tính vào tổng điểm tài khoản nữa — trừ đúng `postScore` hiện tại của bài
    đó khỏi `postsScoreSum` tác giả, **trong cùng 1 transaction với chính
    thao tác xoá** (tính điểm mới nhất ngay tại thời điểm xoá, không dùng
    field cache có thể hơi cũ, để trừ đúng số đã từng cộng).
- Khởi tạo `postsScoreSum: 0` khi tạo tài khoản mới (`auth.controller.js`) —
  nhất quán với cách khởi tạo `postScore: 0` cho bài viết/blog mới, dù không
  bắt buộc (field tự "vá" đúng nhờ `set({merge:true})` ngay từ delta đầu
  tiên nếu thiếu — tài khoản cũ tạo trước v0.8.8 không cần migrate riêng).

### Lưu ý về độ chính xác

Giống `postScore`, đây là **cache**, không phải nguồn sự thật tuyệt đối theo
nghĩa "luôn tính lại từ đầu mỗi lần đọc" — nhưng khác `postScore` (tự "vá"
lại đúng ở MỌI lần đọc tiếp theo bất kể trước đó có lệch hay không), cơ chế
cộng dồn delta có 1 rủi ro lý thuyết: nếu 2 request cùng đọc "giá trị cũ" của
CÙNG 1 bài gần như đồng thời từ 2 nơi KHÔNG dùng chung 1 transaction (ví dụ 1
request `getPost` và 1 request `listPosts` cho cùng bài, cực hiếm), delta có
thể bị cộng dư 1 lần. Điều này được giảm thiểu tối đa bằng cách đưa các nơi
có tần suất thay đổi cao nhất (like/dislike, comment) vào transaction atomic
— chỉ còn view/share (qua `getPost`/`getBlog`/SSR, ít va chạm hơn nhiều vì
mỗi bài đã có dedupe 30 phút/viewerKey cho view) và list-sync (chủ yếu chỉ
kích hoạt cho bài CHƯA từng được đồng bộ) là chạy ngoài transaction. Việc
đối soát/tự sửa lệch triệt để (nếu cần) sẽ tính đến khi triển khai tính năng
xếp hạng thực tế dùng `postsScoreSum`.

---

## -8. [SỬA LỖI] Điểm bài viết: hỗ trợ điểm âm + lưu cache vào Firestore (v0.8.7, 09/09/2026)

Vá 2 vấn đề được báo cáo trên `postScore` (thêm ở v0.8.0):

### 1. Điểm âm bị hiển thị sai thành "0"

**Nguyên nhân:** `formatCount()` (frontend, dùng để hiển thị mọi chỉ số) cố
tình clamp mọi giá trị `≤ 0` về `"0"` — hợp lý cho các bộ đếm luôn không âm
(view/like/dislike/comment/share), nhưng `postScore` có trọng số âm (1 dislike
= -2 điểm) nên có thể âm hợp lệ. Dùng thẳng `formatCount` cho nó khiến 1 bài
chỉ có 1 dislike hiển thị điểm "0" thay vì "-2". Lưu ý: giá trị **thật** ở
backend/SSR luôn đúng (-2) — đây thuần là lỗi HIỂN THỊ ở phía client.

**Đã vá:**
- Thêm `formatScore()` (`frontend/src/utils/number.js`) — tái dùng logic
  quy đổi K/M/B/T của `formatCount` trên trị tuyệt đối, thêm dấu `-` nếu âm.
- `EngagementPills.jsx`: thêm cờ `signed` cho từng item; dùng `formatScore`
  khi `signed: true` (gắn cho pill "score" ở `PostDetailPage.jsx`).
- `PostCard.jsx`: cả 3 chỗ tự render số liệu (hàng chỉ số hiển thị, bản đo ẩn
  dùng để tính overflow, và menu "...") đều rẽ nhánh dùng `formatScore` khi
  `m.key === "score"`.
- `PostScorePopover.jsx`: dòng "Tổng điểm" đổi sang `formatScore` (các dòng
  chi tiết theo từng thông số gốc — view/like/dislike/comment/share — vẫn giữ
  `formatCount` vì bản thân các con số đó luôn không âm, chỉ có TỔNG mới có
  thể âm).

### 2. Lưu `postScore` vào Firestore làm cache cho xếp hạng sau này

**Nguyên tắc KHÔNG đổi:** response trả cho client **luôn luôn** dùng giá trị
tính trực tiếp bằng `computePostScore()` tại nơi format dữ liệu — KHÔNG BAO
GIỜ đọc lại field `postScore` đã lưu để trả ra. Field lưu trong Firestore chỉ
là **cache** phục vụ truy vấn/sắp xếp nhanh cho các tính năng xếp hạng sau
này (tránh phải tính lại điểm của TOÀN BỘ bài viết trên Twelve mỗi lần cần
bảng xếp hạng) — ghi cache thất bại hay tạm thời lệch KHÔNG ảnh hưởng gì tới
tính đúng đắn của dữ liệu trả cho người dùng, vì nó không phải nguồn sự thật.

**Đồng bộ ở mọi nơi có thể làm đổi 1 trong 5 thông số gốc, hoặc khi bài viết
được đọc ra** (đúng theo yêu cầu — xem `utils/helpers.js#syncPostScore` và
`#syncPostScoresBatch`):

- **`listPosts`/`listBlogs`** (trang INDEX/BLOG, và mọi trang dạng list card
  bài viết tương đương sau này chỉ cần gọi lại 2 hàm này): tính điểm cho từng
  bài trong trang kết quả, so sánh với giá trị đang lưu, **gộp thành 1 lượt
  ghi Firestore duy nhất** (`WriteBatch`) cho các bài có điểm thay đổi — chạy
  song song, không chặn response.
- **`getPost`/`getBlog`** (trang POST/BLOG chi tiết) và **2 route SSR**
  (`/post/:id`, `/blog/:id`): đồng bộ 1 bài ngay sau khi đã tính xong
  `viewCount`/`shareCount` mới nhất của lượt xem hiện tại — cũng chạy song
  song, không chặn response.
- **`reactions.controller.js` (like/dislike)**: tính và ghi `postScore`
  **atomic ngay trong transaction hiện có** (đã dùng `db.runTransaction` để
  toggle like/dislike) — không cần đọc lại lần 2, không có khoảng hở race
  condition dù nhiều người like/dislike đồng thời.
- **`comments.controller.js` (thêm/xoá bình luận)**: **chuyển từ `WriteBatch`
  sang `db.runTransaction`** để đọc số liệu mới nhất và tính/ghi `postScore`
  atomic cùng lúc với `commentCount` — lý do đổi từ batch sang transaction:
  batch không đọc-sửa-ghi nguyên tử được, nên nếu 2 comment được
  thêm/xoá gần như đồng thời trên cùng 1 bài, điểm cache có thể bị tính từ số
  liệu đã cũ tại thời điểm đọc.
- Khởi tạo `postScore: 0` khi tạo bài viết/blog mới — nhất quán với các
  counter khác (dù không bắt buộc, vì field này luôn tự "vá" đúng ở lần đọc
  đầu tiên nếu thiếu).

**Lưu ý cho bài viết cũ (tạo trước v0.8.7):** những bài chưa từng có field
`postScore` sẽ tự động được backfill đúng giá trị ngay ở lần đọc/liệt kê đầu
tiên sau khi cập nhật (không cần chạy script migrate riêng) — vì logic so
sánh "giá trị lưu khác giá trị tính ra thì ghi" coi `undefined` là khác với
bất kỳ số nào.

---

## -7. [BẢO MẬT] Siết lỗ hổng "đăng nhập không cần kích hoạt" ở frontend (v0.8.6, 09/09/2026)

Ghi nhận: người dùng có thể đăng nhập vào tài khoản `pending` (chưa xác minh
email) rồi né được dialog cảnh báo của `LoginPage` — ví dụ mở tab mới, gõ
thẳng URL, hoặc bấm back/forward — khiến `AuthContext` coi họ như đã đăng
nhập thật, Navbar/menu/dialog Chào mừng hiển thị đầy đủ. **Backend không hề
bị ảnh hưởng**: `requireAuth` (mặc định cho mọi route cần xác thực từ v0.5.2)
đã luôn đòi `status === "active"`, chỉ đúng 2 endpoint (`GET /users/me`,
`POST /auth/activation/sync`) cho tài khoản `pending` đi qua và cả hai đều
chỉ đọc/đồng bộ dữ liệu của chính chủ — nên mọi thao tác ghi từ phiên
`pending` này đều bị chặn 403 `ACCOUNT_NOT_ACTIVE`, chưa ghi nhận hậu quả
thực tế. Tuy vậy đây vẫn là lỗ hổng cần siết chặt vì UI đang ngầm xác nhận
một trạng thái đăng nhập mà hệ thống không công nhận.

**Khắc phục ở v0.8.6 (chỉ ở frontend):**

- `AuthContext.isLoggedIn` trước đây chỉ dựa vào việc có session Firebase
  (`!!firebaseUser`); giờ đòi hỏi thêm `profile.status === "active"`, khớp
  đúng định nghĩa "đã đăng nhập" mà `requireAuth` phía backend đã dùng. Tách
  riêng `hasSession` (có session Firebase, bất kể status) cho các luồng
  thuộc chính quy trình kích hoạt.
- Thêm `PendingSessionGate` (mount 1 lần ở gốc `App`): bất kỳ lúc nào phát
  hiện session `pending`, điều hướng thẳng về `/login` — không phụ thuộc
  route hay cách người dùng vào app (tab mới, URL trực tiếp...), đóng hoàn
  toàn đường né dialog xác minh.
- `LoginPage` giờ tự mở lại dialog xác minh khi phát hiện sẵn có session
  pending (kể cả khi bị `PendingSessionGate` đưa về), thay vì hiện form đăng
  nhập trống gây hiểu nhầm.

## -6. [BẢO MẬT] Vá triệt để #4 (CAPTCHA đăng ký) còn sót sau v0.8.4 (v0.8.5, 09/09/2026)

Kiểm thử độc lập trên môi trường thật sau khi deploy v0.8.4 xác nhận **6/8**
lỗ hổng đã báo cáo được vá đúng (#1, #2, #5, #6, #7, #8), riêng #3 và #4 vẫn
ra kết quả "chưa vá":

- **#3 (iframe/style tùy ý)**: rà soát lại + fuzz-test trực tiếp
  `sanitize.service.js` (payload gốc trong báo cáo + nhiều biến thể bypass:
  uppercase tag, `srcdoc`, `background-image`, `javascript:`, style viết hoa...)
  cho thấy **mã nguồn v0.8.4 thực ra đã chặn đúng** — nhiều khả năng kết quả
  "chưa vá" trong đợt test là do server thật lúc đó **chưa deploy lại** bản
  v0.8.4 (không phải lỗi code). v0.8.5 hardening thêm 1 điểm nhỏ (trim
  khoảng trắng thừa trong `src` trước khi so khớp domain YouTube/Vimeo, tránh
  chặn nhầm embed hợp lệ) — không phải lỗ hổng bảo mật mới.
- **#4 (spam đăng ký / CAPTCHA)**: đây là lỗi **thật còn sót**. Turnstile đã
  được cài đúng ở cả backend (`middleware/captcha.js`) và frontend
  (`components/TurnstileWidget.jsx`) từ v0.8.3, nhưng theo thiết kế "tắt mặc
  định, bật khi có cấu hình" — server production chưa từng set
  `TURNSTILE_SECRET_KEY` nên CAPTCHA bị bỏ qua hoàn toàn, chỉ còn
  `registerLimiter` (5 lần/giờ/IP) chặn được, không đủ để ngăn bot đổi IP.
  **Khắc phục ở v0.8.5:** áp dụng đúng nguyên tắc fail-fast đã dùng cho #8
  (`CORS_ORIGIN`) — production giờ **bắt buộc** phải cấu hình
  `TURNSTILE_SECRET_KEY`, thiếu là server **từ chối khởi động**
  (`assertCaptchaConfigured()` gọi từ `server.js`) thay vì âm thầm chạy thiếu
  lớp CAPTCHA như đã xảy ra ở v0.8.4. Nhớ cấu hình cả `VITE_TURNSTILE_SITE_KEY`
  tương ứng ở frontend trước khi build production, nếu không người dùng thật
  sẽ không đăng ký được (backend đòi token nhưng frontend không gửi).

## -5. [TÍNH NĂNG MỚI] ĐIỂM BÀI VIẾT — postScore (v0.8.0, 08/09/2026)

Thêm thông số Điểm bài viết (`postScore`), hiển thị trên card bài viết
(INDEX/BLOG), trang POST/BLOG chi tiết, và trang SSR — giống các thông số
trước (view/share).

- **Công thức** (theo đúng yêu cầu): 1 view = **+1**, 1 like = **+2**,
  1 dislike = **-2**, 1 comment = **+3**, 1 share = **+4**. Xem
  `utils/helpers.js#computePostScore` (backend) và `utils/postScore.js`
  (frontend, mirror y hệt để tính lạc quan trên UI).
- **QUYẾT ĐỊNH KIẾN TRÚC QUAN TRỌNG NHẤT của tính năng này: `postScore` KHÔNG
  được LUÂN LƯU LÀM NGUỒN SỰ THẬT.** *(Cập nhật v0.8.7: từ bản này `postScore`
  CÓ được ghi cache vào Firestore để phục vụ xếp hạng — xem mục "-8" phía
  trên — nhưng nguyên tắc "response luôn dùng giá trị tính trực tiếp, không
  đọc lại cache để trả ra" vẫn giữ nguyên 100%, nên mọi lập luận bên dưới về
  tính đúng đắn vẫn còn hiệu lực.)* Nó luôn được **tính lại (derive)** trực
  tiếp từ 5 thông số gốc đã có sẵn (`viewCount`, `likeCount`, `dislikeCount`,
  `commentCount`, `shareCount`) mỗi khi bài viết/blog được format để trả ra
  cho client — trong `formatCardPost`/`formatFullPost`
  (`posts.controller.js`), `listBlogs`/`getBlog` (`blog.controller.js`), và cả
  2 route SSR (`routes/ssr.routes.js`).
  - **Lý do:** đây là cách DUY NHẤT đảm bảo đúng yêu cầu "phải tự động tính
    đúng trong mọi trường hợp... kể cả khi cố tình vào Firestore tăng/hạ
    thông số khác". Vì `postScore` không tồn tại như dữ liệu lưu trữ độc lập —
    nó chỉ là một phép tính — nên KHÔNG CÓ CÁCH NÀO khiến nó "lệch pha" so với
    5 thông số gốc, dù ai đó chỉnh tay `likeCount`/`viewCount`/... thẳng trên
    Firestore Console. Nếu lưu `postScore` thành 1 field riêng và cộng/trừ nó
    thủ công ở từng chỗ (react, comment, share, view) như cách các counter
    khác đang làm, sẽ luôn có rủi ro quên 1 chỗ nào đó hoặc bị lệch khi dữ
    liệu gốc bị sửa trực tiếp — chuyện chắc chắn xảy ra khi test bằng cách sửa
    tay Firestore.
  - **Hệ quả tự nhiên:** hành vi thao tác ngược lại (like rồi hủy, dislike rồi
    hủy, comment rồi gỡ) tự động trả lại đúng điểm tương ứng — vì code hiện có
    từ trước (reactions.controller.js, comments.controller.js) vốn đã
    tăng/giảm đúng 1 trong 5 thông số gốc khi các hành vi đó xảy ra;
    `postScore` chỉ việc tính lại theo công thức ở lần đọc tiếp theo, không
    cần thêm bất kỳ logic cộng/trừ điểm nào ở các controller đó.
  - Trong `getPost`/`getBlog`, `postScore` được tính **SAU** khi đã cộng thêm
    `viewCount`/`shareCount` +1 của lượt xem hiện tại (không tính trước rồi
    mới cộng view, để tránh lệch 1 điểm ngay tại chính response đó).
- **Hiển thị:** `PostCard.jsx` thêm "score" làm chỉ số thứ 6 trong hàng chỉ số
  hiện có (like/dislike/comment/view/share) — cơ chế tự thu gọn "..." khi
  thiếu chỗ (đã có từ trước) áp dụng luôn không cần sửa gì thêm. Bấm icon điểm
  mở `PostScorePopover.jsx` (mới) — hộp giải thích rõ từng thành phần công
  thức (View×1, Like×2, Dislike×-2, Comment×3, Share×4, Tổng) để người dùng tự
  đối chiếu, xây dựng lòng tin vào tính minh bạch của điểm số. `PostDetailPage.jsx`
  dùng chung `PostScorePopover`, và tính lại `postScore` ngay trên UI (qua
  `utils/postScore.js`) mỗi khi like/dislike/thêm/gỡ comment để hiển thị mượt —
  giá trị chuẩn vẫn luôn lấy từ server ở lần tải lại tiếp theo.
- Trang SSR (`views/post.ejs`, `views/blog.ejs`) hiển thị `postScore` dạng
  text + thêm vào JSON-LD dưới dạng `additionalProperty` (`PropertyValue`,
  kèm `description` giải thích công thức) — vì `postScore` không map vào bất
  kỳ `schema.org` `InteractionCounter` type chuẩn nào như view/like/share.
- **Chuẩn bị cho các bước tiếp theo:** vì `postScore` chỉ là hàm số của 5
  thông số hiện có, một hệ thống xếp hạng (ranking) sau này chỉ cần
  `orderBy` theo giá trị tính được (hoặc thêm 1 field cache **read-only, tự
  động ghi lại bằng batch job định kỳ** nếu cần `orderBy` hiệu quả trên
  Firestore — Firestore không hỗ trợ sort theo computed field trực tiếp).
  Đây là cân nhắc cho bản sau, ngoài phạm vi v0.8.0 này.
  *(Đã triển khai ở v0.8.7 — xem mục "-8" phía trên: field cache `postScore`
  giờ được ghi/đồng bộ song song ở mọi nơi đọc/ghi 5 thông số gốc, sẵn sàng
  cho `orderBy("postScore")` trực tiếp trên Firestore.)*

---

## -4.3. [BẢO MẬT] SHARE — không tính khi chủ bài mở link share (v0.7.3)

- Nếu người đang xem (`req.authUid`) **trùng `authorUid`** → `registerShare`
  trả false, **không** tăng `shareCount` (kể cả link `?idu=` của người khác).
- `viewerKey` ưu tiên `u:{uid}` khi đã đăng nhập (1 tài khoản / bài ≤ 1 share).
- Vẫn: không đếm SSR; dedup theo sid với khách; không ghi công sharer = tác giả.

---


## -4.2. [BUGFIX] SHARE — người thứ 2 mở link không tăng share (v0.7.2)

- **Nguyên nhân:** `viewerKey` ưu tiên / fallback **IP** khóa cả đời bài → nhiều
  người cùng WiFi/NAT hoặc cùng mạng chỉ còn **1** share.
- **Sửa:** client gửi `sid` (sessionStorage) kèm `getOne` khi URL là link share;
  backend ưu tiên `s:{sid}` để dedup **theo phiên trình duyệt**. Người khác
  (sid khác) vẫn +1. F5 cùng tab không cộng thêm.

---


## -4.1. [BUGFIX] SHARE — đếm ảo + link share mở ra SSR (v0.7.1, 07/09/2026)

- **Nguyên nhân đếm ảo khi chỉ bấm Share:** OS / chat **link-preview** fetch URL
  `?idu=` → middleware coi thiếu `Sec-Fetch-User` là bot → **SSR** →
  `registerShare` tăng `shareCount` dù chưa có người xem thật.
- **Sửa:** (1) **Không đếm share trên SSR** (chỉ còn SPA `getPost`/`getBlog`,
  source `web`). (2) Middleware: URL có `?idu=` / `?shared=1` và **không** phải
  bot UA → **luôn SPA**. (3) `registerShare` **dedup** theo `viewerKey`
  (`u:{uid}` hoặc `ip:{hash}`) — 1 người xem / bài chỉ tính 1 share; thiếu
  viewerKey thì không đếm.

---


## -4. [TÍNH NĂNG MỚI] SHARE — đếm lượt chia sẻ bài viết / blog (v0.7.0, 07/09/2026)

Thêm hệ thống chia sẻ bài viết/blog, tham khảo cơ chế 2 pha từ **Twelve Old**
(`handlers/posts/share.js` + `handlers/posts/view.js`), điều chỉnh lại để phù
hợp kiến trúc Express hiện tại và vá 1 lỗ hổng bảo mật của bản gốc.

- **Cơ chế 2 pha (không tính share ngay khi bấm nút):**
  1. `POST /api/posts/:id/share` (và `/api/blogs/:id/share`) — **chỉ tạo và
     trả về 1 URL**, KHÔNG ghi Firestore, KHÔNG tăng `shareCount`. Route dùng
     `optionalAuth` (chia sẻ không cần đăng nhập/kích hoạt tài khoản):
     - Đã đăng nhập: `.../post/:id?idu=<uid người share>`
     - Chưa đăng nhập: `.../post/:id?shared=1`
  2. Share **chỉ thực sự được tính khi có người mở link đó ra** — đúng lúc
     `viewCount` cũng được tính (`GET /api/posts/:id`, `GET /api/blogs/:id`,
     và route SSR `/post/:id`, `/blog/:id` cho Bot A.I) — xem
     `utils/helpers.js#parseShareQuery` + `registerShare`. View và share dùng
     chung 1 lượt "mở trang", không phải 2 sự kiện tách rời.
- **Vá so với Twelve Old:** bản gốc lấy `sharerId` trực tiếp từ **body** do
  client tự gửi lên ở bước tạo link → client có thể giả mạo uid người khác để
  "ghi công" share cho họ. Ở đây `idu` chỉ được **backend gán** (từ
  `req.authUid` đã xác thực qua token) ở bước 1; bước 2 chỉ **đọc lại** `idu`
  từ query string, không tin bất kỳ giá trị nào client gửi trong body.
- **Dữ liệu:** mỗi doc post/blog có thêm `shareCount` (số đếm cache, hiển thị
  nhanh) + subcollection `shares` — mỗi lượt share tính được ghi 1 record
  `{ sharerUid, source: "web"|"ssr", createdAt }` (`sharerUid` bị null hoá nếu
  trùng tác giả bài viết hoặc không phải user tồn tại, để không làm bẩn dữ
  liệu tính điểm sau này). `source` phân biệt người dùng thật mở link trên
  bản React (`"web"`) hay Bot A.I mở link trên trang SSR (`"ssr"`).
- **Chuẩn bị sẵn cho v0.8.0** (điểm bài viết `postScore` + điểm tích cực
  `positiveScore`, theo đúng yêu cầu): lưu **record** thay vì chỉ tăng số đếm
  chính là để bản 0.8.0 truy vấn lại được `shares.where("sharerUid","==",uid)`
  và tính điểm cộng cho người chia sẻ — giống cách Twelve Old làm ở
  `handlers/posts/recalc.js`. Việc chống gian lận điểm số kỹ hơn (giới hạn tần
  suất, đối chiếu phiên...) sẽ hoàn thiện cùng lúc với tính năng tính điểm ở
  v0.8.0, ngoài phạm vi v0.7.0 này.
- **Hiển thị:** card bài viết (INDEX/BLOG — `PostCard.jsx`) và trang chi tiết
  (`PostDetailPage.jsx`, qua component dùng chung `EngagementPills.jsx`) đều
  thêm chỉ số Share vào hàng chỉ số hiện có (like/dislike/comment/view) — cơ
  chế tự thu gọn "..." khi thiếu chỗ (đã có từ trước) tự động áp dụng luôn cho
  Share, không cần sửa gì thêm. Bấm icon Share: ưu tiên Web Share API (bảng
  chia sẻ gốc hệ điều hành trên mobile), rơi xuống copy link vào clipboard nếu
  trình duyệt không hỗ trợ. Trang SSR (`views/post.ejs`, `views/blog.ejs`)
  hiển thị `shareCount` dạng text + `ShareAction` trong JSON-LD
  `interactionStatistic`.
- Frontend dọn `?idu=`/`?shared=` khỏi thanh địa chỉ ngay sau khi tính xong
  (qua `navigate(pathname, { replace: true })`), để tải lại trang không bị
  tính share thêm lần nữa và người xem không vô tình chia sẻ tiếp nguyên link
  gắn uid của người khác.

---

## -3. [TÍNH NĂNG MỚI] VIEWS — đếm lượt xem bài viết / blog (v0.6.0, 05/09/2026)

Thêm hệ thống đếm lượt xem cho toàn bộ bài viết (Posts) và bài blog (Blogs).

- **Dữ liệu:** mỗi doc post/blog có thêm 2 field:
  - `viewCount`: tổng lượt xem (bao gồm cả người dùng thật lẫn Bot A.I).
  - `aiViewCount`: lượt xem riêng của Bot A.I (tập con của `viewCount`).
  Doc cũ (tạo trước v0.6.0) không có 2 field này — mọi nơi đọc ra đều dùng
  `|| 0` để không vỡ khi field chưa tồn tại.
- **Cơ chế tính:** CHỈ tính khi xem ở trang chi tiết (POST / BLOG), không tính
  ở card trang danh sách (INDEX/BLOG chỉ hiển thị số đã có).
  - `GET /api/posts/:id` và `GET /api/blogs/:id` (trang chi tiết bản React,
    người dùng thật điều hướng tới — kể cả CHƯA đăng nhập, route dùng
    `optionalAuth`): +1 `viewCount`.
  - `GET /post/:id` và `GET /blog/:id` ở `src/routes/ssr.routes.js` (route SSR
    EJS — theo `frontend/middleware.js` thì route này CHỈ được phục vụ cho
    bot/crawler/AI agent, không phải người dùng thật điều hướng): +1
    `viewCount` VÀ +1 `aiViewCount`.
  - Việc tăng view dùng `FieldValue.increment()` (atomic, không cần đọc trước
    khi ghi) và được bọc lỗi riêng (`utils/helpers.js#incrementViewCount`) —
    nếu ghi view thất bại thì KHÔNG làm hỏng response chính (xem bài vẫn phải
    trả về được).
- **Hiển thị:**
  - Card bài viết (INDEX/BLOG — `PostCard.jsx`) và trang chi tiết
    (`PostDetailPage.jsx`) đều hiển thị `viewCount`. Bấm vào icon view mở hộp
    thống kê riêng (`ViewStatsPopover.jsx`) gồm: Tổng lượt xem / Người dùng /
    **View Bot A.I**.
  - Trang SSR (`views/post.ejs`, `views/blog.ejs`) hiển thị cả `viewCount` lẫn
    `aiViewCount` dạng text (bot đọc được ngay, không cần chạy JS) và trong
    JSON-LD (`interactionStatistic` — `ViewAction`/`LikeAction`/
    `DislikeAction`/`CommentAction`) để AI agent/Google dễ trích xuất số liệu
    có cấu trúc.
  - **Card không đủ chỗ hiển thị view → tự thu icon view + số liệu lại thành 1
    icon "···"** (bấm vẫn mở được `ViewStatsPopover`), tránh tràn giao diện
    trên màn hình hẹp. Đo bằng cách so sánh chiều rộng "tự nhiên" (đo qua 1
    bản sao ẩn — `width:0; overflow:hidden` nhưng `scrollWidth` vẫn phản ánh
    đúng kích thước đầy đủ) với chiều rộng thực tế mà flexbox cấp cho hàng chỉ
    số, dùng `ResizeObserver` để tự cập nhật khi card đổi kích thước.

---

## -2. [BẢO MẬT] Siết chặt: tài khoản pending không "đăng nhập" được vào API (v0.5.3, 04/09/2026)

Tiếp nối bản vá v0.5.2 (chỉ chặn được các hành động ghi cụ thể: đăng bài,
react, comment). Theo yêu cầu siết chặt hơn: **giờ đây một tài khoản `pending`
(chưa xác minh email) gần như không "đăng nhập" được vào backend nữa, bất kể
client nào gọi API và bất kể client đó có bug gì** — việc kiểm tra không còn
nằm rải rác ở từng route mà nằm ngay tại **cổng xác thực dùng chung**
(`requireAuth`), nên không route ghi/đọc nhạy cảm nào có thể vô tình bỏ sót.

- **`requireAuth` (middleware dùng chung cho hầu hết mọi route cần đăng nhập)
  giờ mặc định đòi hỏi `status === "active"`.** Tài khoản `pending` hoặc
  `suspended` bị từ chối ngay ở bước xác thực với `403 ACCOUNT_NOT_ACTIVE`,
  trước khi chạm tới bất kỳ logic nghiệp vụ nào.
- Thêm biến thể `requireAuthAllowPending` — phiên bản duy nhất còn cho phép
  `pending` đi qua (vẫn chặn `suspended`) — và **chỉ gắn vào đúng 2 endpoint**
  vốn là một phần của chính quy trình kích hoạt / kiểm tra trạng thái, không
  tạo/sửa/xoá nội dung của ai:
  - `POST /api/auth/activation/sync` — để tài khoản pending tự chuyển sang active.
  - `GET /api/users/me` — để client tự biết mình đang pending (không thể biết
    nếu bị chặn tuyệt đối).
- Toàn bộ endpoint còn lại đã dùng `requireAuth` (danh sách xem mục "-1" phía
  dưới) nay **tự động được siết theo mặc định mới**, kể cả những endpoint
  trước đây lỡ quên gắn `requireActive` thủ công — không còn phụ thuộc việc
  developer nhớ thêm middleware ở từng route.
- Riêng `PATCH /api/users/me` và `POST /api/users/me/avatar` (đổi hồ sơ /
  avatar) trước đây chỉ cần `requireAuth` (cũ, cho phép pending) — nay cũng bị
  chặn với tài khoản pending.
- `requireActive` (thêm ở v0.5.2) được giữ lại như một lớp kiểm tra dự phòng
  (defense-in-depth) ở các route posts/blogs — vô hại vì lúc đó `requireAuth`
  đã đảm bảo `status === "active"` từ trước.

**Nguyên tắc:** mặc định là "từ chối" (deny-by-default) — mọi route mới thêm
sau này chỉ cần `require("../middleware/auth").requireAuth` là tự động được
bảo vệ, không cần nhớ thêm bước kiểm tra kích hoạt nào khác. Danh sách ngoại
lệ (`requireAuthAllowPending`) cố tình giữ rất ngắn và có giải thích ngay
trong `src/middleware/auth.js`.

---

## -1. [BẢO MẬT] Vá lỗi bỏ qua kích hoạt tài khoản (v0.5.2, 03/09/2026)

**Mức độ:** Nghiêm trọng. **Ảnh hưởng:** mọi client gọi thẳng REST API bằng
Bearer token hợp lệ của tài khoản `status = pending` (chưa xác minh email) —
phát hiện qua Twelve Mobile App (dùng chung backend này) nhưng **không** tái
hiện được trên frontend web.

- **Nguyên nhân gốc:** `requireAuth` (đăng nhập) chỉ chặn tài khoản
  `SUSPENDED`, cố tình cho `PENDING` đi qua để còn gọi được
  `/api/auth/activation/sync` và `/api/users/me`. Việc "không cho tài khoản
  chưa kích hoạt đăng bài / like / dislike / bình luận" trước đây **chỉ được
  thực hiện ở UI web** (`LoginPage.jsx` đăng xuất user chưa `emailVerified`),
  **không hề được kiểm tra ở backend**. Do đó bất kỳ client nào khác (mobile
  app, Postman, curl...) sở hữu một Firebase ID token hợp lệ (kể cả của tài
  khoản chưa xác minh email) đều có thể gọi thẳng API và thực hiện đầy đủ các
  hành động như tài khoản đã kích hoạt.
- **Đã vá:** thêm middleware `requireActive` (`src/middleware/auth.js`), bắt
  buộc `req.authUser.status === "active"`, áp dụng ngay sau `requireAuth` cho
  toàn bộ endpoint có tác động ghi/nội dung công khai:
  - `POST /api/posts`, `PATCH /api/posts/:id`, `DELETE /api/posts/:id`
  - `POST /api/posts/:id/react`
  - `POST /api/posts/:id/comments`, `PATCH .../comments/:commentId`, `DELETE .../comments/:commentId`
  - Tương tự cho toàn bộ endpoint blog (`/api/blogs/...`), kể cả trước
    `requireSA` để phòng trường hợp tài khoản SA cũng chưa kích hoạt.
  - Tài khoản `pending` gọi các endpoint trên sẽ nhận `403` với
    `{ code: "ACCOUNT_NOT_ACTIVE" }`.
- Không đổi hành vi của `GET /api/users/me`, `PATCH /api/users/me`,
  `POST /api/users/me/avatar`, `POST /api/auth/activation/sync` — các endpoint
  này vẫn cần cho phép tài khoản `pending` truy cập để hoàn tất hồ sơ và đồng
  bộ trạng thái kích hoạt.
- **Khuyến nghị:** vì Firestore Rules đã deny-all với client SDK (chỉ Admin
  SDK ở backend mới ghi được — xem `firestore.rules`), đây là lớp kiểm soát
  duy nhất; mọi endpoint ghi mới thêm sau này cần tự hỏi "hành động này có nên
  chặn tài khoản `pending` không?" và gắn `requireActive` nếu có.

---

## 0. Thay đổi trong v0.4 (18/08/2026)

- **Loại bỏ hoàn toàn Resend** (và mọi phụ thuộc gửi mail tùy chỉnh). Lý do: domain dev của Resend không dùng được khi frontend/backend host trên Vercel/Render, và Resend yêu cầu thẻ Visa.
- **Chuyển sang Firebase Authentication Email Verification** (tính năng có sẵn):
  - Đăng ký tạo user Firebase Auth với `emailVerified: false`, `disabled: false`.
  - Frontend dùng `sendEmailVerification()` của Firebase Client SDK để Firebase tự gửi email (template cấu hình trong Firebase Console > Authentication > Templates).
  - User bấm link trong email → Firebase set `emailVerified = true`.
  - Frontend gọi `POST /api/auth/activation/sync` (cần Bearer token) để đồng bộ `status` Firestore từ `pending` → `active`.
- Endpoint cũ `/auth/activation/send` và `/auth/activation/verify` (mã 6 số) trả **410 Gone**.
- Xóa `src/services/mail.service.js`, dependency `resend`, biến môi trường `RESEND_API_KEY` / `MAIL_FROM` / `ACTIVATION_CODE_TTL_MINUTES`.
- Middleware gắn thêm `req.emailVerified` từ token.

### Cấu hình Firebase Console cần thiết
1. Authentication > Sign-in method > Email/Password: bật.
2. Authentication > Templates > Email address verification: tùy chỉnh nội dung (tùy chọn).
3. Authentication > Settings > Authorized domains: thêm domain frontend (vercel.app) nếu cần.

---

## 0.1. Lịch sử thay đổi v0.2 / v0.3

- **Không còn gửi mã kích hoạt tài khoản ngay lúc đăng ký** (`POST
  /api/auth/register`). Trước đây mã kích hoạt được sinh và gửi email ngay
  sau khi đăng ký thành công dù người dùng chưa hề đăng nhập lần đầu. Giờ
  việc sinh mã + gửi email chỉ xảy ra khi gọi `POST /api/auth/activation/send`
  (do người dùng chủ động bấm "Kích hoạt tài khoản" khi đăng nhập lần đầu mà
  tài khoản chưa active — đúng luồng UX mong muốn). *(Đã bị thay thế hoàn toàn ở v0.4)*
- **Chuyển gửi email từ SMTP (Nodemailer) sang Resend (HTTP API)**. *(Đã gỡ ở v0.4)*
- **Sửa cảnh báo `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`** trong log Render:
  thêm `app.set("trust proxy", 1)` ở `server.js`.

## 1. Kiến trúc tổng quan

```
Frontend (ReactJS, Vercel)  <-- REST API (JSON) -->  Backend (Node/Express, Render.com)
                                                              |
                                                     Firebase Admin SDK
                                                       /            \
                                              Firebase Auth      Firestore
                                                              
Backend cũng tự SSR 2 trang: /post/:id và /blog/:id (dùng EJS) để tối ưu SEO,
phần bình luận trong 2 trang này KHÔNG được SSR — được fetch riêng qua API.
```

**Quan trọng về đăng nhập:** việc kiểm tra email/mật khẩu do **Firebase Client
SDK** ở Frontend đảm nhiệm trực tiếp với Firebase Auth (Admin SDK không kiểm
tra được mật khẩu). Sau khi đăng nhập, Frontend lấy `idToken` và gửi kèm mọi
request cần xác thực qua header:

```
Authorization: Bearer <idToken>
```

Backend xác minh token này bằng `admin.auth().verifyIdToken()`.

## 2. Cài đặt

```bash
cd twelve-backend
npm install
cp .env.example .env   # rồi điền các biến môi trường
```

Các bước cần chuẩn bị trên Firebase Console:
1. Bật **Authentication > Email/Password**.
2. Tạo **Firestore Database**.
3. Vào **Project settings > Service accounts**, tạo private key mới (JSON),
   dán toàn bộ nội dung (rút gọn thành 1 dòng) vào biến `FIREBASE_SERVICE_ACCOUNT`.
4. (Tuỳ chọn) Deploy `firestore.rules` đi kèm để khoá truy cập trực tiếp từ client.

Chạy seed dữ liệu ban đầu:

```bash
npm run seed:countries   # nạp danh sách quốc gia
npm run seed:version     # set phiên bản backend ban đầu vào Firestore
```

Chạy server:

```bash
npm run dev     # môi trường phát triển (nodemon)
npm start       # production
```

## 3. Cấu trúc thư mục

```
twelve-backend/
├── server.js                 # Khởi tạo Express, middleware, routes
├── src/
│   ├── config/                # Firebase Admin, Cloudinary
│   ├── middleware/             # auth (verify token), roles (SA/RA/LLA), upload (multer)
│   ├── controllers/            # Logic nghiệp vụ từng module
│   ├── routes/                 # Khai báo endpoint
│   ├── services/                # mail (gửi mã kích hoạt), sanitize (làm sạch HTML Quill)
│   ├── utils/                   # constants, helpers
│   ├── views/                   # post.ejs, blog.ejs (SSR)
│   └── seed/                    # script nạp dữ liệu mẫu vào Firestore
├── firestore.rules
└── .env.example
```

## 4. Mô hình dữ liệu Firestore (tóm tắt)

| Collection | Mô tả |
|---|---|
| `users/{uid}` | Hồ sơ user: fullName, displayName, tagName, birthday, gender, country, email, avatarUrl, accountGroup (SA/RA/LLA), accountRole, status (pending/active/suspended), isFirstLogin. `postsScoreSum` là CACHE (từ v0.8.8 — xem mục "-9" phía trên): tổng `postScore` của mọi bài viết/blog tác giả này đang có, KHÔNG trả ra ở API công khai, KHÔNG hiển thị UI |
| `tagNames/{tag}` | Đảm bảo Tag Name Search (`@user`) là duy nhất — doc id = tag không dấu `@`, value = `{ uid }` |
| `activations/{uid}` | Mã kích hoạt tài khoản: `{ code, email, expiresAt }`, xoá sau khi kích hoạt thành công |
| `posts/{postId}` | Bài viết thường (trang INDEX/POST). Có `likeCount`, `dislikeCount`, `commentCount`, `viewCount` (tổng lượt xem), `aiViewCount` (lượt xem riêng của Bot A.I, là tập con của `viewCount`), `shareCount` (tổng lượt share đã được TÍNH — xem mục "-4" phía trên). **`postScore` là CACHE** (từ v0.8.7 — xem mục "-8"), luôn được tính lại từ 5 field trên khi trả cho client, KHÔNG đọc lại field này để trả ra |
| `posts/{postId}/comments/{commentId}` | Bình luận của bài viết |
| `posts/{postId}/reactions/{uid}` | Like/dislike của từng user, doc id = uid |
| `posts/{postId}/shares/{shareId}` | 1 lượt share đã được tính: `{ sharerUid (có thể null), source: "web"\|"ssr", createdAt }` — chuẩn bị dữ liệu cho `postScore`/`positiveScore` ở v0.8.0 |
| `blogs/{blogId}` | Bài Blog (chỉ SA đăng/sửa/xoá), cấu trúc comment/reaction/view/share tương tự `posts` |
| `countries/{code}` | Danh sách quốc gia cho form đăng ký |
| `config/version` | `{ backend: "0.1.0" }` — phiên bản backend hiển thị trong Menu |

**3 nhóm tài khoản** (`accountGroup`): `SA` (admin/dev/moderator — toàn quyền,
gồm quyền dùng trang Blog), `RA` (pro_user/user — người dùng sở hữu tài khoản
bình thường), `LLA` (test — tài khoản thử nghiệm, có thể bị `status: suspended`
bất cứ lúc nào và không có quyền sở hữu/định đoạt).

## 5. API Reference (rút gọn)

### Auth
| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/auth/register` | - | Đăng ký (tạo Firebase Auth user `disabled=true` + Firestore doc + gửi mã kích hoạt) |
| GET | `/api/auth/check-tagname?tag=` | - | Kiểm tra Tag Name Search còn trống không |
| POST | `/api/auth/activation/send` | - | Gửi lại mã kích hoạt về email |
| POST | `/api/auth/activation/verify` | - | Xác minh mã, kích hoạt tài khoản (enable Firebase Auth user) |

### Users
| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| GET | `/api/users/me` | ✔ | Hồ sơ đầy đủ của chính mình |
| PATCH | `/api/users/me` | ✔ | Cập nhật hồ sơ (setup lần đầu / sửa sau này), không đổi được email/password |
| POST | `/api/users/me/avatar` | ✔ | Upload avatar (multipart, field `avatar`) lên Cloudinary, tự crop 1:1 |
| GET | `/api/users/:uid` | - | Hồ sơ công khai (đã ẩn field nhạy cảm) |

### Posts (trang INDEX / POST)
| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| GET | `/api/posts?cursor=&limit=` | tuỳ chọn | Feed phân trang cho INDEX |
| POST | `/api/posts` | ✔ | Tạo bài (title, contentHtml từ Quill.js, coverImageUrl dạng URL) |
| GET | `/api/posts/:id` | tuỳ chọn | Chi tiết bài (kèm `myReaction` nếu đã đăng nhập). **Mỗi lần gọi +1 `viewCount`** (mọi đối tượng, kể cả khách chưa đăng nhập). Response luôn kèm `postScore` (tính lại, xem mục "-5") |
| PATCH | `/api/posts/:id` | ✔ (chủ bài / SA) | Sửa bài |
| DELETE | `/api/posts/:id` | ✔ (chủ bài / SA) | Xoá bài |
| POST | `/api/posts/:id/react` | ✔ | `{ type: "like" \| "dislike" }`, bấm lại để hủy |
| POST | `/api/posts/:id/share` | tuỳ chọn | Chỉ TẠO share URL (`?idu=uid` nếu đã đăng nhập, `?shared=1` nếu chưa) — không tính `shareCount` ở đây. Share được tính khi link được mở (xem dòng `GET /api/posts/:id` ở trên) |
| GET | `/api/posts/:id/comments` | - | Danh sách bình luận cho modal |
| POST | `/api/posts/:id/comments` | ✔ | Gửi bình luận |
| PATCH | `/api/posts/:id/comments/:commentId` | ✔ (chủ comment) | Sửa bình luận |
| DELETE | `/api/posts/:id/comments/:commentId` | ✔ (chủ comment / SA) | Xoá bình luận |

### Blog (chỉ SA đăng/sửa/xoá — endpoint tương tự Posts)
`GET/POST /api/blogs`, `GET/PATCH/DELETE /api/blogs/:id`, `POST /api/blogs/:id/react`,
`POST /api/blogs/:id/share`, `GET/POST/PATCH/DELETE /api/blogs/:id/comments...`

### Khác
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/countries` | Danh sách quốc gia cho form đăng ký |
| GET | `/api/version` | Phiên bản backend (Frontend tự đọc `version.json` của mình, không qua API này) |
| GET | `/post/:id` | Trang SSR chi tiết bài viết (SEO + AI agent). Chỉ bot/crawler truy cập được (xem `frontend/middleware.js`) — **mỗi lần render +1 `viewCount` VÀ +1 `aiViewCount`**; nếu có `?idu=`/`?shared=` thì cũng +1 `shareCount` (`source: "ssr"`) |
| GET | `/blog/:id` | Trang SSR chi tiết blog (SEO). Tương tự `/post/:id` — cũng tính View Bot A.I và Share |
| GET | `/health` | Kiểm tra server còn sống |

## 6. Việc còn lại / gợi ý cho các bước tiếp theo
- Frontend cần tự tạo file `version.json` (vd: `{"frontend": "0.1.0"}`) để đọc trong Menu.
- Có thể bổ sung endpoint quản trị (SA) để duyệt/khoá tài khoản LLA, đổi accountRole.
- Nội dung Quill.js hiện được sanitize bằng DOMPurify (chặn XSS) trước khi lưu — nên audit
  lại danh sách thẻ/attr cho phép (`sanitize.service.js`) khi Frontend hoàn thiện toolbar Quill.
- Có thể thêm Firebase Storage rules / CDN cache cho ảnh Cloudinary nếu cần.
