# Chuyển đổi Twelve Old → Twelve Beta (2/10/2026)

Tài liệu này đi kèm `migrate-legacy-data.js`. Lưu lại đây để sau này cần tra
lại quy trình không phải lục lại chat.

## Bối cảnh
- Twelve Old và Twelve Beta dùng **cùng một Firebase project** (Auth +
  Firestore). Không có bước export/import Auth — mật khẩu, uid người dùng
  giữ nguyên.
- Việc cần làm là **biến đổi tại chỗ** các document Firestore hiện có (đang
  ở schema Old) sang schema mà code Beta yêu cầu, trước khi deploy code
  Beta lên thay Old.

## Thứ tự thực hiện trước khi cắt sang Beta

1. **Backup Firestore** trước tiên (Firebase Console > Firestore > Export,
   hoặc `gcloud firestore export`).
2. Deploy tạm backend Beta ở môi trường staging/preview (chưa trỏ traffic
   thật vào) để có sẵn service account chạy script.
3. Chạy dry-run (2 cách tương đương — dùng `npm run` cho ngắn, hoặc gọi
   thẳng `node` nếu cần thêm cờ như `--limit`):
   ```
   cd backend
   npm run migrate:legacy
   # tương đương: node scripts/migrate-legacy-data.js
   ```
   Đọc kỹ log — không có gì bị ghi ở bước này.
4. Chạy thử với số lượng nhỏ trước khi làm toàn bộ:
   ```
   node scripts/migrate-legacy-data.js --apply --limit=5
   ```
   Vào Firestore Console kiểm tra 5 user/post đó đã đúng như mong đợi.
5. Chạy thật toàn bộ:
   ```
   npm run migrate:legacy:apply
   # tương đương: node scripts/migrate-legacy-data.js --apply
   ```
6. Deploy chính thức code Beta lên Vercel/Render đang phục vụ Old (xem bảng
   biến môi trường bên dưới).
7. Kiểm thử: đăng nhập bằng 1 tài khoản Old cũ, xem bài viết cũ hiển thị
   đúng, badge "Đến từ Twelve cũ" hiện trên trang cá nhân, điểm số các
   loại đều = 0.

Script **an toàn để chạy lại nhiều lần** — mỗi user/post sau khi migrate có
field `legacyMigratedAt`, lần sau tự bỏ qua, không reset điểm 2 lần.

## Bảng đối chiếu biến môi trường (đổi code, giữ nguyên Firebase project)

Giá trị Firebase (project id, service account, web config) giữ **y nguyên**
— chỉ khác *tên biến* và các biến Beta cần bổ sung mà Old không có.

### Backend (Vercel/Render)
| Biến | Old | Beta | Ghi chú |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | ✅ | ✅ | Giữ nguyên giá trị, tên biến giống nhau |
| `FIREBASE_SERVICE_ACCOUNT` | — | tuỳ chọn thay 3 biến trên | có thể dùng cách này thay vì 3 biến rời |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | — | ✅ bắt buộc | Beta dùng Cloudinary cho ảnh |
| `TURNSTILE_SECRET_KEY` | — | ✅ bắt buộc ở production | CAPTCHA, server từ chối khởi động nếu thiếu |
| `SHARE_LINK_SECRET` | — | ✅ bắt buộc ở production | ký link share, tạo bằng `openssl rand -hex 32` |
| `CORS_ORIGIN`, `FRONTEND_URL` | — | ✅ | trỏ đúng domain frontend đang chạy |
| `BACKEND_VERSION` | — | ✅ | xem `package.json` |

### Frontend (Vercel)
| Old (`NEXT_PUBLIC_*`) | Beta (`VITE_*`) |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `VITE_FIREBASE_API_KEY` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `VITE_FIREBASE_PROJECT_ID` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `VITE_FIREBASE_STORAGE_BUCKET` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `VITE_FIREBASE_APP_ID` |
| — | `VITE_API_BASE_URL` (trỏ backend Beta) |
| — | `VITE_TURNSTILE_SITE_KEY` (bắt buộc) |
| — | `BACKEND_ORIGIN` (dùng bởi `middleware.js`, không tiền tố `VITE_`) |

Giá trị Firebase web config (apiKey, authDomain...) copy y nguyên từ Old
sang, chỉ đổi tên biến.

## Những gì đã thay đổi trong bản cập nhật Beta này
- `backend/scripts/migrate-legacy-data.js` (mới, đã qua 3 bản sửa lỗi) — script migrate mô tả ở trên
- `backend/src/utils/helpers.js` — `toPublicUser()` trả thêm `isLegacyMember`, `legacySince`
- `frontend/src/pages/PublicProfilePage.jsx` — hiện badge "Đến từ Twelve cũ" (icon MUI `WorkspacePremium`, không dùng emoji) khi `isLegacyMember`
- `backend/firestore.indexes.json` — thêm composite index còn thiếu cho `blogs` (`isPublished` + `createdAt`)
- `backend/server.js` — sửa lỗi seed `config/embedDomains` lúc khởi động chỉ lưu tên domain (chuỗi) thay vì object đầy đủ `{domain, path, label}`, khiến trang Quản trị hiện 7 ô rỗng dù đếm đúng số lượng (**lưu ý: chỉ fix cho lần seed sau — doc đã lỡ ghi sai trên Firestore hiện tại cần SA tự gõ lại 7 domain qua UI rồi bấm Lưu, xem hướng dẫn ở cuối file này**)
- Bump version `0.10.17.8.260926` (backend + frontend)

## 4 phát hiện quan trọng sau khi rà soát/vận hành thật (đã sửa trong script v3)

1. **[Nghiêm trọng] tagName lệch chuẩn** — xem chi tiết ở mục cũ bên dưới.
2. **[Quan trọng] Nội dung bài viết cũ là plain text** — xem chi tiết ở mục cũ bên dưới.
3. **[Cần hiểu đúng, không phải bug] postScore luôn tính lại sống** — xem chi tiết ở mục cũ bên dưới.
4. **[Nghiêm trọng — phát hiện khi vận hành thật] Thiếu field `uid` nội bộ trên document user.**
   Old không lưu field `uid` bên trong chính document `users/{uid}` (chỉ dựa
   vào ID document). Beta lưu `uid` ngay trong document lúc đăng ký, và
   `toPublicUser()` (dùng để ghép thông tin tác giả cho danh sách bài viết ở
   `attachAuthors()`) đọc `uid` từ field đó — KHÔNG phải từ ID document.
   Bản v1/v2 của script quên thêm field này khi migrate user cũ, khiến
   `post.author.uid` luôn `undefined` với bài viết của user cũ — hậu quả
   thực tế: **bấm vào thông tin tác giả trên card bài viết (Index/Blog/Post)
   không có phản ứng gì** (không lỗi console, chỉ im lặng không điều hướng).
   Trang Xu hướng không bị ảnh hưởng vì nó lấy `uid` từ ID document riêng,
   không qua field này.
   Script v3 vá field `uid` theo 2 đường: (a) tự thêm cho user chưa migrate
   lần nào; (b) **vá lại cho cả user ĐÃ migrate trước đó** bằng bản script
   cũ (v1/v2) đang thiếu field này — an toàn chạy `--apply` lại, không ảnh
   hưởng gì tới các field khác đã đúng.

## Việc bạn cần làm ngay (bản v3 sửa lỗi #4 ở trên)
- Nếu bạn đã từng chạy `--apply` bằng bản script cũ (v1/v2) trước đây, **chạy
  lại `--apply` bằng script v3 này ngay** — script tự phát hiện và chỉ vá
  đúng phần field `uid` còn thiếu cho user đã migrate, không đụng gì khác.
- Sau khi chạy xong, thử bấm lại vào thông tin tác giả trên 1 vài bài viết ở
  Index/Blog để xác nhận đã điều hướng đúng sang trang profile.

1. **[Nghiêm trọng] tagName lệch chuẩn** — Old lưu `tagName` kèm "@" và cho
   phép chữ hoa (vd `"@JohnDoe"`); Beta yêu cầu không "@", luôn chữ thường.
   Không sửa sẽ khiến tagName hiển thị lỗi (`"@@johndoe"`) và làm hỏng cơ chế
   chống trùng tagName. Script v2 tự chuẩn hoá và cảnh báo (không tự ý ghi
   đè) nếu 2 user cũ trùng tagName sau khi chuẩn hoá — **cần xử lý tay nếu
   log báo trùng, trước khi launch**.

2. **[Quan trọng] Nội dung bài viết cũ là plain text** — Old không có thẻ
   HTML nào trong `content`. Script v2 escape ký tự đặc biệt rồi bọc
   `<p>`/`<br>` trước khi sanitize, để giữ đúng xuống dòng nhiều đoạn và
   không vỡ nội dung nếu người dùng cũ từng gõ ký tự kiểu `<`, `>`, `&`.

3. **[Cần hiểu đúng, không phải bug]** `postScore` hiển thị trên mỗi bài viết
   ở Beta LUÔN được tính lại sống từ likeCount/viewCount/v.v. mỗi lần tải —
   không đọc từ giá trị lưu sẵn. Vì bạn muốn GIỮ các chỉ số bài viết, điểm
   hiển thị của từng bài cũ sẽ phản ánh đúng tương tác thật (không thể vừa
   giữ chỉ số vừa hiện 0 cho từng bài — 2 điều này loại trừ nhau trong kiến
   trúc hiện tại của Beta). Điều THỰC SỰ được đảm bảo công bằng là **điểm
   tài khoản / bảng xếp hạng** (`accountScore`, trang Xu hướng) — vì nó chỉ
   cộng dồn qua `externalPostScore` (được reset về 0), nên mọi tài khoản cũ
   đều bắt đầu lại từ 0 trên bảng xếp hạng, chỉ tăng khi có tương tác MỚI
   sau ngày cutover. Nếu ý bạn là muốn cả điểm-mỗi-bài cũng về 0, cần cho
   mình biết — cách duy nhất để làm vậy là reset luôn likeCount/dislikeCount/
   viewCount/commentCount/shareCount, tức KHÔNG giữ được chỉ số bài viết nữa.

## Việc bạn cần tự làm trước khi chạy `--apply` trên dữ liệu thật
- Backup Firestore (bắt buộc, xem bước 1 ở trên).
- Chạy dry-run trước, đọc kỹ phần `tagNames.collisions` trong kết quả — nếu
  > 0, xử lý tay (đổi tagName 1 trong 2 tài khoản trùng) rồi chạy lại dry-run
  cho tới khi collisions = 0, mới chạy `--apply`.

## Vá dữ liệu đã lỡ ghi sai — cấu hình domain nhúng media (config/embedDomains)

Do lỗi seed ở `server.js` (đã sửa ở bản này, xem mục thay đổi ở trên), nếu
site của bạn đã từng khởi động với code CŨ, doc `config/embedDomains` trên
Firestore hiện đang lưu `domains` là mảng CHUỖI thay vì mảng object — khiến
trang Cài đặt > Quản trị hiện đúng 7 ô nhưng tất cả đều rỗng.

**Cách sửa (qua UI, không cần deploy lại, không cần chạy script):**
Vào Cài đặt > Quản trị (chỉ SA thấy tab này), gõ lại đúng 7 giá trị sau vào
7 ô theo thứ tự, rồi bấm "Lưu thay đổi":
```
youtube.com
youtube-nocookie.com
player.vimeo.com
player.twitch.tv
clips.twitch.tv
w.soundcloud.com
open.spotify.com
```
Bấm Lưu sẽ ghi lại đúng cấu trúc object chuẩn và quét lại toàn bộ bài viết
hiện có theo danh sách domain mới (hành vi có chủ đích của tính năng này,
xem docblock `updateEmbedDomainsSettings` trong `embedDomains.controller.js`).


---

# Dọn tài nguyên Cloudinary (`cleanup-orphan-assets.js`, v0.10.20)

Dọn các avatar "mồ côi" do lỗi cũ (đổi avatar mà không xoá ảnh trước) và đối
soát sổ `assets` trong Firestore. **Xoá trên Cloudinary không hoàn tác** — làm
đúng thứ tự dưới đây.

## Thứ tự
1. Deploy backend v0.10.20 TRƯỚC (để không sinh thêm rác mới trong lúc dọn).
2. Trong `backend`, với đúng file `.env` của production (Firebase + Cloudinary):
   ```
   npm run assets:cleanup
   ```
   Dry-run: chỉ đọc, in báo cáo, ghi file JSON vào `scripts/reports/`. Đối chiếu:
   số user, số ảnh trong phạm vi avatar, số ảnh sẽ xoá có hợp lý với số user × số lần
   đổi avatar không.
3. Nếu script in "PHANH AN TOÀN", dừng lại và kiểm tra `.env`/project — script sẽ từ chối `--apply`.
4. Thử xoá ít trước, rồi vào Cloudinary Media Library kiểm 1–2 ảnh đã xoá là ảnh cũ chứ không phải avatar đang dùng:
   ```
   node scripts/cleanup-orphan-assets.js --apply --limit=20
   ```
5. Xoá toàn bộ:
   ```
   npm run assets:cleanup:apply
   ```

## Điều script KHÔNG bao giờ xoá
Avatar đang dùng; asset có URL nằm trong nội dung bài viết/blog; asset mới hơn 24h
(`--grace-hours`); asset không suy ra được chủ sở hữu (trừ khi `--include-unattributed`);
mọi thứ ngoài `twelve/avatars/` (ảnh/video SA tự upload cho bài viết).

## Hạn mức
Admin API Cloudinary giới hạn theo giờ (gói free ~500 lệnh/giờ; liệt kê 500 ảnh/lệnh, xoá 100 ảnh/lệnh).
Gặp lỗi hạn mức script dừng gọn, báo tiến độ; chạy lại sau ít nhất 1 giờ (an toàn chạy lại nhiều lần).

## Chạy định kỳ (khuyến nghị)
Sau v0.10.20 không còn phát sinh rác thường xuyên; vẫn nên chạy dry-run hằng tháng và xem
`GET /api/admin/assets/stats`. Nếu sau này thêm loại upload mới, cập nhật `scope`/kế hoạch trong
`src/utils/assetAudit.js` tương ứng.
