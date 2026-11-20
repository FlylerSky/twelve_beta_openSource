# Twelve Frontend (v0.4.2)

Frontend cho nền tảng mạng xã hội **Twelve**, xây dựng bằng **ReactJS (Vite)**,
UI theo **Material Design** của Google (thư viện **MUI**), responsive đa nền
tảng, deploy trên **Vercel**.

## 0. Thay đổi trong v0.5.1 (290826)

- **Bảng màu Quill không gây cuộn ngang**: neo `ql-picker-options` vào mép phải toolbar + `overflow-x: hidden` trên editor wrap và DialogContent.
- **Code block đọc được**: nền tối (`#1e1e2e`) + chữ sáng, ghi đè color/background inline từ Quill.
- **Thời gian đăng**: dưới 1 ngày → "Vài giây trước" / "N phút trước" / "N giờ trước"; từ 1 ngày trở lên → `H:mm:ss D/M/YYYY`.

## 0b. Thay đổi trong v0.5.0 (280826)

- **Trình xem media mới** trên trang POST: thay lightbox tự viết bằng [yet-another-react-lightbox](https://github.com/igordanchenko/yet-another-react-lightbox) — zoom/pan, gallery nhiều ảnh, video file (mp4/webm), đếm slide, tải xuống. (Google không cung cấp lightbox nhúng công khai; thư viện này là chuẩn phổ biến, UI tối tương thích Material.)
- **Render đủ format Quill**: component `PostContent` bọc `ql-snow` + CSS snow theme — header, list, blockquote, code-block, align, link, màu chữ… hiển thị đúng trên trang đọc.
- Cover image cũng mở được trong gallery.

## 0b. Thay đổi trong v0.4.4 (280826)

- **Avatar → Profile**: Mọi avatar / tên / tag name của user (card INDEX & BLOG, trang POST, modal bình luận) bấm vào đều điều hướng tới `/u/:uid`.
- **Menu Twelve**: Thêm mục **Profile** (icon Person) cho user đã đăng nhập, nằm ngay dưới tầng info user; avatar + tên trong drawer cũng bấm được để mở profile của chính mình.
- Bản này là bước đệm trước Twelve 0.5 (đầu tư sâu hơn vào trang profile).

## 0b. Thay đổi trong v0.4.3 (280826)

- **Gemini / AI agent đọc được trang POST**: Middleware không còn chỉ dựa vào chuỗi "bot" trong User-Agent (Gemini và Google-Agent thường gửi UA giống Chrome). Chiến lược mới: phục vụ SSR khi (1) UA khớp bot/AI **hoặc** (2) request **không** có `Sec-Fetch-User: ?1` (dấu hiệu người dùng thật đang navigate). Người dùng mở link trong trình duyệt vẫn nhận SPA React đầy đủ.
- **Sửa `[object Object]` ngày đăng** trên bản SSR: `formatFullPost` / `formatCardPost` chuẩn hoá Firestore Timestamp → ISO string.
- **Canonical / og:url đúng domain frontend**: dùng `FRONTEND_URL` (env backend), không lấy host Render khi bị proxy.
- **meta description / excerpt**: luôn tạo excerpt từ HTML nếu bài cũ chưa lưu `excerpt`.

## 0b. Thay đổi trong v0.4.2 (280826)

- **SSR / SEO cho bot & AI**: Mở rộng danh sách User-Agent bot (Gemini, Google-InspectionTool, GoogleOther, Bing, DuckDuckBot, Meta, Lighthouse…). Template EJS (`post.ejs` / `blog.ejs`) bổ sung meta robots, Twitter Card, CSS cơ bản và nội dung văn bản rõ ràng để crawler đọc được. **Bắt buộc** cấu hình biến môi trường `BACKEND_ORIGIN` trên Vercel (Project Settings → Environment Variables) trỏ tới URL gốc backend (ví dụ `https://your-backend.onrender.com`, không trailing slash) — nếu thiếu, middleware sẽ không rewrite và bot vẫn nhận SPA trống.
- **Custom dialog chèn media**: Thay `window.prompt()` trong QuillEditor bằng `MediaUrlDialog` (Material Design), đồng nhất với ConfirmDialog và các popup khác.
- **Modal mobile rộng hơn**: `CreatePostModal`, `CommentModal`, `WelcomeSetupDialog` dùng `fullScreen` trên breakpoint `xs`; theme `MuiDialog` giảm margin mặc định để hộp không bị co hẹp hai bên trên điện thoại.

## 0b. Thay đổi trong v0.2 (bản vá lỗi)

- **Bot/AI đọc link bài viết chỉ thấy trang trống (SEO)** — đây là bản CSR
  (React dựng giao diện bằng JS), nên crawler/AI không chạy JS sẽ không thấy
  nội dung. Đã thêm `middleware.js` (Vercel Routing Middleware): khi phát
  hiện `User-Agent` là bot/crawler/AI agent quen thuộc (Googlebot, GPTBot,
  ClaudeBot, PerplexityBot, facebookexternalhit, các HTTP client như curl,
  python-requests...), request tới `/post/:id` hoặc `/blog/:id` sẽ được
  **proxy (rewrite) sang bản SSR EJS đã có sẵn ở backend** — URL trên
  thanh địa chỉ không đổi, người dùng thật vẫn dùng bản React như cũ. Xem
  mục 7 bên dưới để biết cách cấu hình `BACKEND_ORIGIN` khi deploy.
- **Sửa lỗi upload avatar thất bại**: `uploadAvatar()` (api/users.api.js)
  trước đó tự set header `Content-Type: multipart/form-data` (thiếu
  boundary) khiến backend không parse được file — đã bỏ để trình duyệt/axios
  tự sinh header đúng.
- **Modal chào mừng (Welcome Setup)** và **modal đăng bài** được mở rộng, bố
  cục dạng lưới responsive để không còn bị hẹp 2 bên.
- **Modal đăng bài viết giờ mở được ở BẤT KỲ trang nào** thông qua
  `CreatePostContext` (mount toàn cục ở `App.jsx`), không còn bị điều hướng
  ngược về trang INDEX trước khi mở được.
- **Gỡ nút chèn ảnh (image) khỏi toolbar Quill.js** + chặn paste ảnh base64
  qua clipboard matcher — tránh Firestore bị phình dữ liệu do base64. Media
  trong bài giờ chỉ chèn được qua nút "video" (nhúng URL).
- **Tiêu đề bài viết trên card INDEX** giới hạn tối đa 5 dòng (dùng
  line-clamp), tiêu đề trên trang POST được `word-break` để không tràn khung.
- **Trình xem ảnh (lightbox)** khi bấm vào ảnh trong nội dung bài viết ở
  trang POST + CSS responsive cho `img`/`video`/`iframe` (video nhúng của
  Quill) để co giãn đúng khung thay vì tràn/vỡ layout.
- **Thay `window.confirm()` bằng popup Material Design** (`ConfirmDialog`)
  khi xóa bài viết.
- **Thêm nút Thoát (đóng)** trong Menu (Drawer) ở Navbar.
- **Giảm thiểu hiện tượng trang tự reload khi chuyển tab trình duyệt** — đây
  là hành vi của Vite dev server (WebSocket HMR bị trình duyệt throttle khi
  tab chạy nền, gây `location.reload()` khi quay lại tab); đã cấu hình lại
  `vite.config.js`. Lưu ý: hiện tượng này **chỉ xảy ra ở môi trường dev**
  (`npm run dev`), không xảy ra ở bản build production deploy trên Vercel.

## 1. Cài đặt

```bash
cd twelve-frontend
npm install
cp .env.example .env    # điền cấu hình Backend API + Firebase Client SDK
npm run dev              # chạy dev server tại http://localhost:3000
```

Lấy cấu hình Firebase Client SDK tại **Firebase Console > Project settings >
General > Your apps > Web app** (biểu tượng `</>`). Đây là **config public**,
khác với service account key ở phía backend.

## 2. Build & Deploy lên Vercel

```bash
npm run build     # build ra thư mục dist/
```

Trên Vercel:
1. Import repo, chọn **Framework Preset: Vite**.
2. Khai báo các biến môi trường `VITE_*` giống `.env.example` trong
   **Project Settings > Environment Variables**.
3. Build command: `npm run build`, Output directory: `dist`.

Sau khi tăng version, nhớ cập nhật `public/version.json` — đây chính là file
được đọc trong Menu ở mục "Phiên bản nền tảng > Frontend".

## 3. Cấu trúc thư mục

```
twelve-frontend/
├── index.html
├── public/version.json        # phiên bản frontend hiển thị trong Menu
├── src/
│   ├── main.jsx                # entry point, bọc ThemeProvider/Router/Auth
│   ├── App.jsx                  # khai báo route cho 4 trang
│   ├── firebase.js              # Firebase Client SDK (Auth)
│   ├── theme/theme.js            # MUI theme theo Material Design (Google)
│   ├── api/                       # gọi REST API backend (axios)
│   ├── context/                    # AuthContext (trạng thái đăng nhập), SnackbarContext
│   ├── components/                  # Navbar, PostCard, CommentModal, CreatePostModal,
│   │                                  QuillEditor, AvatarCropper, WelcomeSetupDialog, RouteGuards
│   └── pages/                        # IndexPage, LoginPage, RegisterPage, BlogPage,
│                                       PostDetailPage (dùng chung cho /post/:id và /blog/:id),
│                                       PublicProfilePage
```

## 4. Các trang & tính năng đã hoàn thiện (v0.1)

- **INDEX** (`/`): Navbar (tên "Twelve" trái, icon Menu phải); Menu hiển thị
  khác nhau tuỳ trạng thái đăng nhập (Đăng ký/Đăng nhập hoặc tên/avatar/email/UID
  + nút Đăng bài viết); luôn có mục Blog + Phiên bản (frontend từ
  `version.json`, backend từ API `/api/version`). Feed bài viết dạng card:
  avatar, tên hiển thị, Tag Name Search, thời gian, tiêu đề, ảnh bìa 16:9,
  like/dislike, nút comment (mở modal), nút "Xem bài".
- **Modal tạo bài viết**: tiêu đề, nội dung dùng **Quill.js** (react-quill) —
  chèn ảnh/video qua URL, ảnh bìa cũng nhập qua URL (không upload trực tiếp).
- **Modal bình luận**: danh sách bình luận (tự động "Xem thêm/Thu gọn" nếu dài),
  card mỗi bình luận có avatar/tên/tag/thời gian, ô nhập bình luận, cho phép
  sửa/xoá bình luận của chính mình.
- **LOGIN / REGISTER** (`/login`, `/register`): đăng ký khai thác đầy đủ
  (tên thật, tên hiển thị, Tag Name Search kiểm tra trùng theo thời gian thực,
  sinh nhật, giới tính, quốc gia lấy từ Firestore qua API, email, mật khẩu).
  Đăng nhập dùng Firebase Client SDK trực tiếp; nếu tài khoản chưa kích hoạt
  (`auth/user-disabled`) sẽ hiện luồng nhập mã kích hoạt gửi qua email.
  Đăng nhập lần đầu (`isFirstLogin`) sẽ tự bật **WelcomeSetupDialog** để hoàn
  thiện hồ sơ + upload/crop avatar tỉ lệ 1:1 (dùng `react-easy-crop`).
- **POST** (`/post/:id`): hiển thị đầy đủ nội dung Quill.js (render qua
  `dangerouslySetInnerHTML`, nội dung đã được backend sanitize), like/dislike,
  bình luận đầy đủ (thêm/sửa/xoá) ngay trên trang.
- **BLOG** (`/blog`, `/blog/:id`): danh sách bài Blog (card không hiển thị nội
  dung chi tiết, bấm "Xem bài" chuyển sang trang chi tiết dùng chung UI với
  POST). Nút "Viết Blog" chỉ hiển thị với tài khoản nhóm **SA**
  (`RequireSA`/kiểm tra `accountGroup` từ hồ sơ).

## 5. Lưu ý quan trọng

- **SSR/SEO**: Bản React này là ứng dụng CSR (Client-Side Rendered) dùng cho
  trải nghiệm tương tác của người dùng thật. Theo đúng yêu cầu thiết kế, việc
  **SSR phục vụ SEO cho Google Bot** được đảm nhiệm bởi Backend (route
  `/post/:id` và `/blog/:id` render bằng EJS, xem `twelve-backend/src/views`).
  Khi deploy thật, có thể cấu hình để crawler (User-Agent bot) được proxy sang
  URL SSR của Backend, còn người dùng thật vẫn dùng bản React trên Vercel.
- Việc đăng nhập (kiểm tra email/mật khẩu) diễn ra **trực tiếp với Firebase
  Auth** qua Client SDK — Backend chỉ xác minh `idToken` cho các API cần
  quyền, không tham gia vào bước nhập mật khẩu.
- `RouteGuards.jsx` cung cấp sẵn `RequireAuth` và `RequireSA` để bảo vệ route
  phía client (ngoài việc Backend đã enforce quyền ở tầng API).

## 6. Việc còn lại / gợi ý bước tiếp theo
- Hiện `PATCH /api/users/me` (backend) chưa hỗ trợ đổi Tag Name Search sau khi
  đăng ký (cần transaction kiểm tra trùng tương tự lúc đăng ký) — nếu cần cho
  phép đổi tag ở màn hình Welcome Setup, nên bổ sung endpoint riêng.
- Có thể thêm code-splitting (`React.lazy`) cho các trang để giảm kích thước
  bundle ban đầu (hiện ~987KB do MUI + Quill + Firebase trong 1 chunk).
- Có thể bổ sung trang quản trị dành cho SA (duyệt/khoá tài khoản LLA...).
