# Twelve Backend (v0.8.8.100926)

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
