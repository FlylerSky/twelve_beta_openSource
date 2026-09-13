// Chuẩn hoá Tag Name Search: luôn có dạng "@user", lưu trữ id không có "@" để so khớp không phân biệt hoa/thường
const { COLLECTIONS, SUBCOLLECTIONS } = require("./constants");

function normalizeTagName(raw) {
  if (!raw) return "";
  let t = raw.trim().toLowerCase();
  if (t.startsWith("@")) t = t.slice(1);
  return t;
}

function isValidTagName(raw) {
  const t = normalizeTagName(raw);
  // Chỉ cho phép chữ thường, số, dấu gạch dưới, 3-20 ký tự
  return /^[a-z0-9_]{3,20}$/.test(t);
}

function toPublicUser(userDoc) {
  if (!userDoc) return null;
  const {
    uid,
    displayName,
    tagName,
    avatarUrl,
    accountGroup,
    accountRole,
    country,
    createdAt,
  } = userDoc;
  // Không bao giờ trả email/fullName/birthday/gender ra endpoint công khai (chỉ trả cho chính chủ)
  return {
    uid,
    displayName,
    tagName: `@${tagName}`,
    avatarUrl: avatarUrl || null,
    accountGroup,
    accountRole,
    country,
    createdAt,
  };
}

function isSA(accountGroup) {
  return accountGroup === "SA";
}

/**
 * ==== VÁ LỖ HỔNG BẢO MẬT #1 [CRITICAL] — Stored XSS qua SSR (v0.8.3) ====
 * `JSON.stringify()` KHÔNG escape chuỗi "</script>". Khi kết quả được nối
 * chuỗi trực tiếp vào bên trong 1 thẻ <script> (như `views/post.ejs` và
 * `views/blog.ejs` đang làm với `window.__TWELVE_SSR_POST__` và khối
 * `application/ld+json`), một field text của bài viết/blog (ví dụ `title`,
 * vốn chỉ `.trim()` chứ không `sanitizeHtml()`) chứa
 * `</script><script>...</script>` sẽ khiến trình duyệt đóng thẻ <script>
 * sớm và THỰC THI đoạn mã sau đó như JavaScript thật — trên 1 route SSR
 * công khai, không cần đăng nhập.
 *
 * `safeJsonForScript` escape mọi ký tự có thể phá vỡ ngữ cảnh <script>:
 *   - "<"            -> "\u003c"  (chặn "</script>", "<!--", v.v.)
 *   - U+2028/U+2029  -> escape unicode (Line/Paragraph Separator hợp lệ
 *                       trong JSON string nhưng là lỗi cú pháp JS thô,
 *                       có thể bị lợi dụng để chèn statement JS mới ở một
 *                       số engine/parser).
 * Luôn dùng hàm này (thay vì `JSON.stringify` trần) ở BẤT KỲ nơi nào nhúng
 * dữ liệu do người dùng kiểm soát vào bên trong thẻ <script> trong EJS.
 *
 * @param {*} obj
 * @returns {string} chuỗi JSON an toàn để nhúng vào <script>
 */
function safeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Tăng lượt xem (view) của 1 bài viết / bài blog.
 *
 * - Gọi khi có người xem bài trên TRANG POST (chi tiết) — không gọi ở trang
 *   danh sách (INDEX/BLOG), card chỉ HIỂN THỊ view chứ không làm tăng view.
 * - `isAi = true` dành riêng cho lượt truy cập từ route SSR (`src/routes/ssr.routes.js`),
 *   vốn CHỈ được phục vụ cho bot/AI agent (xem frontend/middleware.js) — lượt
 *   này vừa cộng vào tổng `viewCount`, vừa cộng riêng vào `aiViewCount` để
 *   tách bạch thống kê "View Bot A.I".
 * - Không throw ra ngoài: tăng view là tác vụ phụ, không được phép làm hỏng
 *   response chính (xem bài vẫn phải trả về dù việc ghi view thất bại).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {*} admin - firebase-admin (để lấy FieldValue.increment)
 * @param {string} collectionName - COLLECTIONS.POSTS hoặc COLLECTIONS.BLOGS
 * @param {string} docId
 * @param {{ isAi?: boolean }} opts
 */
async function incrementViewCount(db, admin, collectionName, docId, opts = {}) {
  try {
    const FieldValue = admin.firestore.FieldValue;
    const updates = { viewCount: FieldValue.increment(1) };
    if (opts.isAi) updates.aiViewCount = FieldValue.increment(1);
    await db.collection(collectionName).doc(docId).update(updates);
  } catch (err) {
    console.error(`incrementViewCount(${collectionName}/${docId}) error:`, err.message);
  }
}

/**
 * ==== CHỐNG BƠM VIEW ẢO (v0.8.3 — vá báo cáo bảo mật mục #5) ====
 * Trước đây `incrementViewCount` cộng viewCount vô điều kiện mỗi lần
 * GET /api/posts/:id hay GET /api/blogs/:id được gọi — không có cơ chế
 * chống trùng như `registerShare` đã có cho share, cho phép gọi lặp lại
 * endpoint hàng nghìn lần để thổi phồng viewCount -> postScore.
 *
 * `registerView` áp dụng đúng nguyên lý đã dùng cho share: 1 viewerKey
 * (uid đăng nhập / session id / IP — xem `viewerKeyFromRequest`) chỉ được
 * tính THÊM 1 view mới sau khi đã qua `VIEW_DEDUPE_WINDOW_MS` kể từ lần
 * tính gần nhất cho CÙNG bài viết đó. Trong khoảng thời gian đó, gọi lại
 * bao nhiêu lần cũng không cộng thêm viewCount (nhưng response vẫn trả về
 * bài viết bình thường — không chặn request, chỉ không đếm trùng).
 */
const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 phút / viewerKey / bài viết

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {*} admin
 * @param {string} collectionName - COLLECTIONS.POSTS hoặc COLLECTIONS.BLOGS
 * @param {string} docId
 * @param {{ viewerKey: string|null, isAi?: boolean }} opts
 * @returns {Promise<boolean>} true nếu vừa tính thêm 1 view mới (chưa trùng)
 */
async function registerView(db, admin, collectionName, docId, opts = {}) {
  const { viewerKey = null, isAi = false } = opts;
  try {
    const FieldValue = admin.firestore.FieldValue;
    const ref = db.collection(collectionName).doc(docId);

    const key = typeof viewerKey === "string" && viewerKey.trim() ? viewerKey.trim().slice(0, 128) : null;
    if (!key) {
      // Không nên xảy ra vì viewerKeyFromRequest luôn trả về giá trị (kể cả
      // fallback theo IP) — nhưng nếu có, vẫn tính view để không chặn nhầm
      // người dùng thật, chỉ log cảnh báo để theo dõi.
      console.warn(`registerView(${collectionName}/${docId}): thiếu viewerKey — vẫn tính view.`);
      const updates = { viewCount: FieldValue.increment(1) };
      if (isAi) updates.aiViewCount = FieldValue.increment(1);
      await ref.update(updates);
      return true;
    }

    const safeId = key.replace(/\//g, "_");
    const viewRef = ref.collection(SUBCOLLECTIONS.VIEWS).doc(safeId);

    const counted = await db.runTransaction(async (tx) => {
      const existing = await tx.get(viewRef);
      const now = Date.now();
      if (existing.exists) {
        const last = existing.data().lastViewedAtMs || 0;
        if (now - last < VIEW_DEDUPE_WINDOW_MS) return false;
      }
      tx.set(viewRef, { lastViewedAtMs: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const updates = { viewCount: FieldValue.increment(1) };
      if (isAi) updates.aiViewCount = FieldValue.increment(1);
      tx.update(ref, updates);
      return true;
    });
    return counted;
  } catch (err) {
    console.error(`registerView(${collectionName}/${docId}) error:`, err.message);
    return false;
  }
}

/**
 * ==== SHARE (v0.7.0) ====
 * Cơ chế 2 pha, tham khảo từ Twelve Old (`handlers/posts/share.js` +
 * `handlers/posts/view.js`):
 *   1. Bấm nút Share (`POST /:id/share`, xem controllers/share.controller.js)
 *      CHỈ tạo và trả về 1 URL — KHÔNG ghi gì vào Firestore, KHÔNG tính share.
 *      URL có dạng:
 *        Đã đăng nhập:  /post/:id?idu=<uid người share>
 *        Chưa đăng nhập: /post/:id?shared=1
 *   2. Share CHỈ thực sự được tính khi có người mở link đó ra và trang chi
 *      tiết được tải — tức đúng lúc `viewCount` cũng được tính (xem
 *      posts.controller.js#getPost, blog.controller.js#getBlog, và route SSR
 *      cho Bot A.I ở routes/ssr.routes.js). Vì vậy view + share dùng chung 1
 *      lượt "mở trang" — không phải 2 sự kiện tách rời.
 *
 * KHÁC với Twelve Old (cải tiến bảo mật): Twelve Old lấy `sharerId` trực tiếp
 * từ body do client tự gửi lên khi tạo link share → client có thể giả mạo uid
 * của người khác để "ghi công" share cho họ. Ở đây `idu` chỉ được BACKEND gán
 * (từ `req.authUid` đã xác thực) tại bước tạo link (bước 1); bước đếm (bước 2)
 * chỉ ĐỌC lại `idu` đó từ query string — không tin body do client gửi.
 * `idu` trong URL vẫn có thể bị người khác chỉnh sửa/giả mạo thủ công trước
 * khi gửi đi (giới hạn cố hữu của cơ chế URL-based attribution) — việc chống
 * gian lận điểm số kỹ hơn (đối chiếu, giới hạn tần suất...) sẽ hoàn thiện ở
 * v0.8.0 cùng lúc với tính năng điểm bài viết / điểm tích cực.
 *
 * Dữ liệu được lưu vào subcollection `shares` (không chỉ tăng số đếm) ngay từ
 * bây giờ để CHUẨN BỊ SẴN cho v0.8.0: postScore/positiveScore sẽ cần truy vấn
 * lại các lượt share thực tế theo `sharerUid` (xem Twelve Old
 * `handlers/posts/recalc.js` — điểm cộng cho người share dựa trên
 * `shares.where("sharerUid","==",uid)`).
 */

/**
 * Đọc tham số share từ query string của URL trang chi tiết đang được mở.
 * @param {object} query - req.query
 * @returns {{ isShareLink: boolean, rawSharerUid: string|null }}
 */
function parseShareQuery(query = {}) {
  const idu = typeof query.idu === "string" && query.idu.trim() ? query.idu.trim() : null;
  const shared = query.shared === "1" || query.shared === "true";
  return { isShareLink: !!(idu || shared), rawSharerUid: idu };
}

/**
 * Ghi nhận 1 lượt SHARE (gọi khi `parseShareQuery(...).isShareLink === true`).
 * Không throw ra ngoài — giống incrementViewCount, đây là tác vụ phụ không
 * được phép làm hỏng response chính của trang chi tiết.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {*} admin
 * @param {string} collectionName - COLLECTIONS.POSTS hoặc COLLECTIONS.BLOGS
 * @param {string} docId
 * @param {{ rawSharerUid: string|null, authorUid: string, source: "web"|"ssr" }} opts
 *   source: "web" = người dùng thật mở link trên bản React (CSR),
 *           "ssr"  = Bot A.I / crawler mở link trên trang SSR EJS.
 * @returns {Promise<boolean>} true nếu vừa ghi nhận thành công 1 lượt share
 */
async function registerShare(db, admin, collectionName, docId, opts = {}) {
  const {
    rawSharerUid = null,
    authorUid = null,
    source = "web",
    viewerKey = null,
    viewerUid = null, // uid người đang MỞ link (req.authUid), khác sharerUid trên URL
  } = opts;
  try {
    // Chủ bài mở link share bài của chính mình → KHÔNG tính share
    // (kể cả link do người khác tạo ?idu=friend). Chống tự buff.
    if (authorUid && viewerUid && viewerUid === authorUid) {
      return false;
    }

    // Không ghi công sharerUid nếu là chính tác giả (tránh bẩn positiveScore).
    // Người khác mở link vẫn có thể +shareCount.
    let sharerUid = null;
    if (rawSharerUid && rawSharerUid !== authorUid) {
      const sharerSnap = await db.collection(COLLECTIONS.USERS).doc(rawSharerUid).get();
      if (sharerSnap.exists) sharerUid = rawSharerUid;
    }

    // Chống đếm trùng: 1 phiên (sid) / 1 user login chỉ 1 share / bài.
    const key = typeof viewerKey === "string" && viewerKey.trim() ? viewerKey.trim().slice(0, 128) : null;
    if (!key) {
      console.warn(`registerShare(${collectionName}/${docId}): thiếu viewerKey — bỏ qua đếm`);
      return false;
    }
    // Firestore doc id không cho "/" — đã chuẩn hoá ở caller
    const safeId = key.replace(/\//g, "_");
    const FieldValue = admin.firestore.FieldValue;
    const ref = db.collection(collectionName).doc(docId);
    const shareRef = ref.collection(SUBCOLLECTIONS.SHARES).doc(safeId);

    const counted = await db.runTransaction(async (tx) => {
      const existing = await tx.get(shareRef);
      if (existing.exists) return false;
      tx.set(shareRef, {
        sharerUid,
        source,
        viewerKey: key,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(ref, { shareCount: FieldValue.increment(1) });
      return true;
    });
    return counted;
  } catch (err) {
    console.error(`registerShare(${collectionName}/${docId}) error:`, err.message);
    return false;
  }
}

/**
 * Khóa người xem để chống đếm trùng share trong CÙNG một phiên mở trang.
 * Ưu tiên: session id client (?sid= / header) → user đã login → IP (fallback).
 * Không khóa vĩnh viễn theo IP cả đời bài viết (tránh 2 người cùng WiFi chỉ còn 1 share).
 */
function viewerKeyFromRequest(req) {
  // User đã login: khóa theo uid (1 tài khoản = tối đa 1 share/bài; phát hiện chủ bài).
  if (req.authUid) return `u:${req.authUid}`;

  const q = req.query || {};
  const sidRaw = typeof q.sid === "string" ? q.sid.trim() : "";
  const sidHeader = (req.headers["x-twelve-session"] || "").toString().trim();
  const sid = sidRaw || sidHeader;
  if (sid && /^[a-zA-Z0-9_-]{8,64}$/.test(sid)) return `s:${sid}`;

  const xf = req.headers["x-forwarded-for"];
  const ip = (typeof xf === "string" && xf.split(",")[0].trim()) || req.ip || req.socket?.remoteAddress || "unknown";
  const compact = Buffer.from(String(ip)).toString("base64url").slice(0, 24);
  return `ip:${compact}`;
}

/**
 * ==== ĐIỂM BÀI VIẾT (v0.8.0) ====
 * Quy ước: 1 view = +1, 1 like = +2, 1 dislike = -2, 1 comment = +3, 1 share = +4.
 *
 * QUAN TRỌNG — postScore KHÔNG được lưu thành 1 field riêng trong Firestore.
 * Nó luôn được TÍNH LẠI (derive) trực tiếp từ 5 thông số gốc đã có sẵn
 * (viewCount, likeCount, dislikeCount, commentCount, shareCount) mỗi khi trả
 * dữ liệu bài viết ra cho client — xem formatCardPost/formatFullPost
 * (posts.controller.js), listBlogs/getBlog (blog.controller.js), và 2 route
 * SSR (routes/ssr.routes.js).
 *
 * Đây chính là lý do postScore LUÔN đúng trong MỌI trường hợp mà không cần
 * code nào phải nhớ "cộng/trừ điểm" mỗi khi like/unlike, dislike/undislike,
 * comment/gỡ comment, hay share xảy ra: các thao tác đó chỉ tăng/giảm đúng
 * 1 trong 5 thông số gốc (như code hiện có từ trước vẫn làm), còn postScore
 * tự động phản ánh đúng theo công thức ở lần đọc tiếp theo — kể cả khi ai đó
 * vào thẳng Firestore Console chỉnh tay các thông số gốc: vì postScore không
 * tồn tại như dữ liệu lưu trữ độc lập, nó không có cách nào "lệch pha" so với
 * các thông số — chỉ là 1 phép tính, luôn tính từ giá trị hiện tại.
 */
const POST_SCORE_WEIGHTS = Object.freeze({
  view: 1,
  like: 2,
  dislike: -2,
  comment: 3,
  share: 4,
});

function computePostScore(counts = {}) {
  const { viewCount = 0, likeCount = 0, dislikeCount = 0, commentCount = 0, shareCount = 0 } = counts;
  return (
    (viewCount || 0) * POST_SCORE_WEIGHTS.view +
    (likeCount || 0) * POST_SCORE_WEIGHTS.like +
    (dislikeCount || 0) * POST_SCORE_WEIGHTS.dislike +
    (commentCount || 0) * POST_SCORE_WEIGHTS.comment +
    (shareCount || 0) * POST_SCORE_WEIGHTS.share
  );
}

/**
 * ==== ĐIỂM TỔNG TẤT CẢ BÀI VIẾT — postsScoreSum (v0.8.8) ====
 * Thông số CẤP TÀI KHOẢN: tổng tất cả `postScore` của MỌI bài viết/blog mà
 * tài khoản đó đang có. Cùng triết lý với `postScore`: đây cũng CHỈ LÀ CACHE
 * (lưu ở `users/{uid}.postsScoreSum`) để các tính năng sau này (bảng xếp
 * hạng tài khoản...) dùng lại mà không phải quét lại TOÀN BỘ bài viết của
 * TỪNG tài khoản mỗi lần cần. KHÔNG hiển thị ở UI frontend tại thời điểm này.
 *
 * Vì đây là 1 giá trị TỔNG HỢP qua nhiều document (không nằm gọn trong 1 bài
 * viết như postScore), việc "tính lại từ đầu mỗi lần đọc" sẽ tốn kém (phải
 * quét toàn bộ bài viết của 1 tác giả). Thay vào đó dùng cách CỘNG DỒN
 * DELTA: mỗi khi 1 bài viết có postScore đổi từ `storedScore` -> `score`,
 * áp dụng đúng phần chênh lệch đó (`score - storedScore`) vào
 * `postsScoreSum` của tác giả bài đó — O(1) thay vì phải quét lại tất cả.
 *
 * Được cộng dồn ở ĐÚNG những nơi postScore của 1 bài thay đổi (xem
 * syncPostScore/syncPostScoresBatch bên dưới, và các transaction trong
 * reactions.controller.js#react, comments.controller.js#addComment/
 * #deleteComment) — cũng như khi 1 bài bị XOÁ hẳn (posts.controller.js
 * #deletePost, blog.controller.js#deleteBlog trừ đúng phần đóng góp của bài
 * đó khỏi postsScoreSum, vì bài không còn tồn tại nữa).
 *
 * Dùng `set(..., { merge: true })` thay vì `update()` để tự tạo field/doc
 * nếu thiếu, không throw nếu user doc tạm thời không tồn tại (ví dụ tài
 * khoản vừa bị xoá) — không được phép làm hỏng thao tác chính (like/dislike,
 * comment, xoá bài, đồng bộ điểm...) chỉ vì bước cộng dồn phụ này lỗi.
 *
 * @returns {{ ref: FirebaseFirestore.DocumentReference, data: object }|null}
 *   null nếu không có gì cần ghi (thiếu authorUid hoặc delta = 0)
 */
function postsScoreSumWrite(db, admin, authorUid, delta) {
  if (!authorUid || !delta) return null;
  return {
    ref: db.collection(COLLECTIONS.USERS).doc(authorUid),
    data: { postsScoreSum: admin.firestore.FieldValue.increment(delta) },
  };
}

/**
 * ==== LƯU CACHE postScore VÀO FIRESTORE (v0.8.7) ====
 * `postScore` vẫn KHÔNG phải nguồn sự thật — response trả cho client LUÔN
 * dùng giá trị tính trực tiếp bằng computePostScore() ở nơi format dữ liệu
 * (formatCardPost/formatFullPost, listBlogs/getBlog, 2 route SSR), KHÔNG bao
 * giờ đọc lại field `postScore` đã lưu để trả ra. Vì vậy field này ghi thất
 * bại hay tạm thời lệch cũng KHÔNG ảnh hưởng gì tới tính đúng đắn của dữ liệu
 * trả cho người dùng — nó chỉ là 1 bản CACHE để sau này các hệ thống xếp hạng
 * có thể `orderBy("postScore")` trực tiếp trên Firestore mà không phải tự
 * tính lại điểm của TOÀN BỘ bài viết trên Twelve mỗi lần cần bảng xếp hạng.
 *
 * Được đồng bộ (ghi song song, không chặn response chính) ở MỌI nơi có khả
 * năng làm đổi 1 trong 5 thông số gốc hoặc khi bài viết được đọc ra:
 *   - listPosts/listBlogs (trang INDEX/BLOG, mọi trang dạng list card khác)
 *   - getPost/getBlog + 2 route SSR (trang POST/POST SSR)
 *   - react() — like/dislike (tính atomic trong cùng transaction, xem
 *     reactions.controller.js)
 *   - addComment/deleteComment — tính atomic trong cùng transaction, xem
 *     comments.controller.js)
 *   - registerShare/registerView tự thân không set postScore — nhưng
 *     getPost/getBlog/SSR routes gọi syncPostScore NGAY SAU khi gọi 2 hàm đó,
 *     nên share/view vẫn được đồng bộ đúng trong cùng 1 lượt request.
 *
 * v0.8.8 → v0.8.14: từng cộng dồn delta vào `postsScoreSum` ở đây — đã thay
 * bằng cơ chế đối soát qua aggregation query, xem docblock
 * `reconcilePostsScoreSum` và docblock ngay dưới đây.
 *
 * Không throw ra ngoài — không được phép làm hỏng response chính.
 */
/**
 * ĐỐI SOÁT postsScoreSum — 3 ĐIỀU KIỆN TRIGGER (v0.8.16, đính chính v0.8.14):
 * v0.8.14 chỉ gọi `reconcilePostsScoreSum` khi `storedScore !== score` (điểm
 * của CHÍNH bài đang xem đổi) — TỨC LÀ ĐK-3 AND ĐK-1/2, trong khi 3 điều
 * kiện dưới đây phải là OR với nhau (đủ đúng 1 trong 3 là phải đối soát):
 *   1. Bài của tác giả đó được LOAD (danh sách/list) — dù bài đó không đổi
 *      điểm gì cả.
 *   2. Bài được XEM ở trang POST/POST SSR — dù bài đó không đổi điểm.
 *   3. postScore của MỘT bài bất kỳ của tác giả đó thực sự thay đổi.
 * Hậu quả của bug AND: nếu ai đó chỉnh tay `postsScoreSum` trực tiếp trên
 * Firestore mà KHÔNG đụng tới field nào của bất kỳ bài viết nào (không có
 * `postScore` nào đổi), `syncPostScore` return sớm và KHÔNG BAO GIỜ gọi
 * reconcile — dù người dùng xem lại bài bao nhiêu lần. Tách `reconcile` ra
 * khỏi nhánh `if` để nó LUÔN chạy mỗi khi hàm này được gọi (tức mỗi khi bài
 * được xem/load — ĐK-1/2), độc lập với việc `postScore` của bài đó có đổi
 * hay không (ĐK-3) — SET (aggregate lại toàn bộ bài của tác giả) chứ không
 * increment nên gọi thừa cũng không sai kết quả, chỉ tốn thêm 2 lượt đọc rẻ.
 */
async function syncPostScore(db, admin, collectionName, docId, score, storedScore, authorUid) {
  // Chỉ GHI postScore khi giá trị thực sự khác — giảm số lần ghi Firestore
  // không cần thiết (trường hợp phổ biến nhất: điểm không đổi giữa 2 lần đọc
  // liên tiếp). Đây là tối ưu RIÊNG cho việc ghi field `postScore` của CHÍNH
  // bài này — KHÔNG áp dụng cho việc gọi reconcile bên dưới (xem docblock).
  if (storedScore !== score) {
    try {
      await db.collection(collectionName).doc(docId).update({ postScore: score });
    } catch (err) {
      console.error(`syncPostScore(${collectionName}/${docId}) error:`, err.message);
      return; // lỗi ghi postScore của bài này -> bỏ qua cả bước đối soát dưới
    }
  }

  // v0.8.16: LUÔN đối soát postsScoreSum mỗi khi bài này được xem/tải — xem
  // đầy đủ 3 điều kiện trigger ở docblock phía trên. Không `await` — không
  // để bước đối soát phụ này làm chậm response chính (giống triết lý ghi
  // postScore cache "song song, không chặn" đã áp dụng từ trước).
  reconcilePostsScoreSum(db, admin, authorUid).catch(() => {});
}

/**
 * ==== ĐỐI SOÁT postsScoreSum QUA AGGREGATION QUERY (v0.8.14) ====
 *
 * TRƯỚC ĐÂY: `postsScoreSum` được CỘNG DỒN DELTA (`FieldValue.increment`)
 * mỗi khi 1 bài viết có postScore đổi. Cách này có 1 lỗ hổng tự nhiên: nó
 * chỉ cộng/trừ đúng đúng PHẦN THAY ĐỔI so với lần đồng bộ trước — nếu giá
 * trị `postsScoreSum` ĐANG LƯU bị chỉnh tay sai lệch (ví dụ vào thẳng
 * Firestore Console đặt về 0) hay từng bị ghi thiếu/lỗi ở đâu đó, phép cộng
 * delta tiếp theo áp dụng LÊN TRÊN giá trị sai đó — kết quả cộng dồn vẫn sai
 * mãi mãi, khác hẳn `postScore` (luôn tự sửa đúng ở lần đọc tiếp theo vì nó
 * SET giá trị tính lại từ đầu, không cộng dồn — xem `syncPostScore`).
 *
 * FIX: dùng Firestore aggregation query (`sum()`) để tính lại TRỰC TIẾP từ
 * nguồn — tổng `postScore` thật của MỌI bài viết (COLLECTIONS.POSTS) và MỌI
 * blog (COLLECTIONS.BLOGS) mà `authorUid` đang sở hữu — rồi SET (không phải
 * increment) `postsScoreSum` bằng đúng tổng đó. Nhờ vậy `postsScoreSum` có
 * cùng tính chất "tự chữa lành" như `postScore`: dù bị chỉnh tay sai bao
 * nhiêu lần trong Firestore Console, lần gọi kế tiếp của hàm này sẽ ghi đè
 * về đúng giá trị thật — không có cách nào để 1 giá trị sai "sống sót" qua
 * lần đối soát tiếp theo.
 *
 * CHI PHÍ: aggregation query (count/sum/average) của Firestore tính phí
 * theo SỐ INDEX ENTRY được quét, KHÔNG phải theo số document — cụ thể 1 lượt
 * đọc cho mỗi 1000 index entry khớp điều kiện (tối thiểu 1 lượt đọc/query dù
 * khớp 0 document). Vậy dù 1 tác giả có hàng nghìn bài viết, hàm này vẫn chỉ
 * tốn vài lượt đọc — rẻ hơn nhiều so với việc đọc từng document để tự cộng
 * tổng ở tầng ứng dụng (chi tiết:
 * https://firebase.google.com/docs/firestore/pricing#aggregation_queries).
 *
 * ĐÍNH CHÍNH (v0.8.15): bản v0.8.14 từng ghi sai ở đây rằng KHÔNG cần
 * composite index vì `authorUid` đã được tự động single-field-index. Thực
 * tế: `sum()` (khác với `count()`) cần Firestore quét index entry của CHÍNH
 * field được sum (`postScore`) song song với field lọc (`authorUid`) — single
 * -field index riêng lẻ của từng field KHÔNG đủ, Firestore đòi 1 composite
 * index (authorUid ASC, postScore ASC) trên CẢ 2 collection `posts` và
 * `blogs`, trả lỗi `FAILED_PRECONDITION` nếu thiếu. Vì hàm này không throw
 * lỗi ra ngoài (chỉ `console.error`, xem lý do ở cuối docblock), thiếu index
 * sẽ khiến `postsScoreSum` âm thầm không bao giờ được đối soát mà KHÔNG có
 * dấu hiệu gì ở phía client — chỉ thấy trong log backend (Render > Logs, tìm
 * "reconcilePostsScoreSum"). 2 composite index này đã được khai báo trong
 * `backend/firestore.indexes.json` (+ `firebase.json`) — deploy bằng
 * `firebase deploy --only firestore:indexes --project <project-id>`, hoặc
 * tạo tay qua link Firestore tự sinh kèm theo lỗi `FAILED_PRECONDITION`
 * trong log (mất vài phút để build xong tuỳ số lượng document hiện có).
 *
 * ĐƯỢC GỌI Ở ĐÂU (thay cho delta-increment cũ):
 *   - `syncPostScore`/`syncPostScoresBatch` — đúng những nơi `postScore` của
 *     1 bài tự chữa lành: khi bài được XEM (getPost/getBlog/SSR) hoặc XUẤT
 *     HIỆN TRONG DANH SÁCH (listPosts/listBlogs) và giá trị cache đã lệch.
 *   - Sau khi XOÁ bài/blog (posts.controller.js#deletePost,
 *     blog.controller.js#deleteBlog) — gọi thêm 1 lần sau khi transaction
 *     xoá + trừ delta đã commit, để chốt lại đúng giá trị thật.
 *
 * KHÔNG dùng ở reactions.controller.js#react hay comments.controller.js
 * (like/dislike/bình luận) — những thao tác đó vẫn dùng delta-increment
 * NGAY TRONG transaction như cũ, để giữ phản hồi tức thời (aggregation query
 * không chạy được — và không nên chạy — bên trong 1 transaction đang có
 * read/write khác, vừa tăng độ trễ vừa tăng khả năng transaction phải retry
 * do xung đột). Độ lệch tạm thời (nếu có) giữa 1 lượt like và lần đối soát
 * kế tiếp sẽ được lần XEM/DANH SÁCH tiếp theo tự sửa đúng — cùng triết lý
 * "cache tự chữa lành, không cần chính xác tuyệt đối tức thời" đã áp dụng
 * cho `postScore`.
 *
 * Không throw ra ngoài — không được phép làm hỏng luồng chính (xem/tương
 * tác bài viết) chỉ vì bước đối soát phụ này lỗi.
 */
async function reconcilePostsScoreSum(db, admin, authorUid) {
  if (!authorUid) return;
  try {
    const { AggregateField } = admin.firestore;
    const [postsAgg, blogsAgg] = await Promise.all([
      db
        .collection(COLLECTIONS.POSTS)
        .where("authorUid", "==", authorUid)
        .aggregate({ total: AggregateField.sum("postScore") })
        .get(),
      db
        .collection(COLLECTIONS.BLOGS)
        .where("authorUid", "==", authorUid)
        .aggregate({ total: AggregateField.sum("postScore") })
        .get(),
    ]);

    const total = (postsAgg.data().total || 0) + (blogsAgg.data().total || 0);

    await db
      .collection(COLLECTIONS.USERS)
      .doc(authorUid)
      .set({ postsScoreSum: total }, { merge: true });
  } catch (err) {
    // v0.8.15: nếu thiếu composite index (authorUid + postScore) trên
    // "posts"/"blogs" — xem đính chính ở docblock phía trên — Firestore trả
    // lỗi FAILED_PRECONDITION kèm link tự tạo index. Log rõ gợi ý thay vì chỉ
    // in message gốc (có thể dài, chứa link Console dễ bị bỏ sót giữa các
    // log khác) để việc chẩn đoán nhanh hơn nếu deploy sang project khác
    // (staging, disaster recovery...) mà quên chạy `firebase deploy --only
    // firestore:indexes`.
    if (err.code === 9 || /FAILED_PRECONDITION/i.test(err.message || "")) {
      console.error(
        `reconcilePostsScoreSum(${authorUid}): THIẾU COMPOSITE INDEX (authorUid + postScore) trên "posts"/"blogs". ` +
          `Xem backend/firestore.indexes.json — deploy bằng "firebase deploy --only firestore:indexes" hoặc bấm link trong lỗi gốc bên dưới để tạo tay:`,
        err.message
      );
    } else {
      console.error(`reconcilePostsScoreSum(${authorUid}) error:`, err.message);
    }
  }
}


/**
 * Biến thể batch cho danh sách (listPosts/listBlogs) — nhiều bài trong 1 lần
 * gọi, gộp thành 1 lượt ghi Firestore (WriteBatch) thay vì N lượt riêng lẻ.
 *
 * v0.8.16 (đính chính v0.8.14): TRƯỚC ĐÂY `if (!toUpdate.length) return;` ở
 * ngay đầu hàm khiến việc đối soát postsScoreSum bị bỏ qua HOÀN TOÀN nếu
 * KHÔNG bài nào trong trang danh sách này đổi điểm — vi phạm đúng điều kiện
 * "bài được LOAD trong danh sách" (không cần điểm đổi) đã nêu ở
 * syncPostScore. FIX: tách riêng — `toUpdate` (bài cần ghi lại postScore)
 * và `authorsToReconcile` (MỌI tác giả xuất hiện trong `items`, bất kể bài
 * của họ có đổi điểm hay không) là 2 tập hợp độc lập.
 * Mỗi authorUid xuất hiện trong `items` chỉ đối soát ĐÚNG 1 LẦN (dùng Set
 * khử trùng) dù có nhiều bài của cùng tác giả đó trong cùng 1 trang.
 * @param {Array<{ id: string, score: number, storedScore: number|undefined, authorUid?: string }>} items
 */
async function syncPostScoresBatch(db, admin, collectionName, items = []) {
  if (!items.length) return;
  const toUpdate = items.filter((it) => it.storedScore !== it.score);
  const authorsToReconcile = new Set();
  items.forEach((it) => {
    if (it.authorUid) authorsToReconcile.add(it.authorUid);
  });

  try {
    if (toUpdate.length) {
      const batch = db.batch();
      toUpdate.forEach((it) => {
        batch.update(db.collection(collectionName).doc(it.id), { postScore: it.score });
      });
      await batch.commit();
    }
  } catch (err) {
    console.error(`syncPostScoresBatch(${collectionName}) error:`, err.message);
    return; // lỗi ghi batch postScore -> bỏ qua cả bước đối soát dưới
  }

  // v0.8.16: đối soát MỌI tác giả xuất hiện trong trang danh sách này (xem
  // reconcilePostsScoreSum) — kể cả tác giả không có bài nào đổi điểm trong
  // trang này, vì bản thân việc bài được LOAD đã là điều kiện trigger. Không
  // `await` từng cái, chạy song song, không chặn response chính.
  authorsToReconcile.forEach((authorUid) => {
    reconcilePostsScoreSum(db, admin, authorUid).catch(() => {});
  });
}

module.exports = {
  normalizeTagName,
  isValidTagName,
  toPublicUser,
  isSA,
  safeJsonForScript,
  incrementViewCount,
  registerView,
  parseShareQuery,
  registerShare,
  viewerKeyFromRequest,
  POST_SCORE_WEIGHTS,
  computePostScore,
  postsScoreSumWrite,
  reconcilePostsScoreSum,
  syncPostScore,
  syncPostScoresBatch,
};
