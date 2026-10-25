// Chuẩn hoá Tag Name Search: luôn có dạng "@user", lưu trữ id không có "@" để so khớp không phân biệt hoa/thường
const crypto = require("crypto");
const { COLLECTIONS, SUBCOLLECTIONS, CONTENT_LIMITS } = require("./constants");

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

// ==== v0.9.6 [MEDIUM] — validate title bài viết/blog ====
// Dùng chung cho createPost/updatePost/createBlog/updateBlog. Trả về chuỗi
// lỗi (để controller trả 400 kèm message) hoặc null nếu hợp lệ. KHÔNG throw
// — giữ đúng phong cách xử lý lỗi hiện có của các controller này (kiểm tra
// rồi tự trả `res.status(400)`, không dùng exception cho luồng thường).
function validateTitle(title) {
  if (typeof title !== "string") return "Tiêu đề không hợp lệ.";
  const trimmed = title.trim();
  if (trimmed.length < CONTENT_LIMITS.TITLE_MIN || trimmed.length > CONTENT_LIMITS.TITLE_MAX) {
    return `Tiêu đề phải từ ${CONTENT_LIMITS.TITLE_MIN}-${CONTENT_LIMITS.TITLE_MAX} ký tự.`;
  }
  return null;
}

// ==== v0.9.6 [MEDIUM] — validate cơ bản coverImageUrl ====
// `coverImageUrl` do người dùng TỰ DÁN vào (không upload trực tiếp qua
// server) — không thể whitelist domain cụ thể (ảnh có thể ở bất kỳ host
// nào), nhưng vẫn cần chặn scheme nguy hiểm (`javascript:`, `data:`,
// `vbscript:`...) và giới hạn độ dài để tránh phình document/DoS nhẹ. Trả
// về chuỗi lỗi hoặc null nếu hợp lệ (chuỗi rỗng/undefined luôn hợp lệ — field
// này là optional, "không có ảnh bìa" là trạng thái bình thường).
function validateCoverImageUrl(url) {
  if (url === undefined || url === null || url === "") return null;
  if (typeof url !== "string") return "Ảnh bìa không hợp lệ.";
  if (url.length > CONTENT_LIMITS.COVER_IMAGE_URL_MAX) {
    return `Đường dẫn ảnh bìa quá dài (tối đa ${CONTENT_LIMITS.COVER_IMAGE_URL_MAX} ký tự).`;
  }
  if (!/^https:\/\//i.test(url.trim())) {
    return "Ảnh bìa phải là đường dẫn https:// hợp lệ.";
  }
  return null;
}

// ==== v0.9.7 — validate + chuẩn hoá hashtag bài viết/blog ====
// Nhận vào RAW từ client — có thể là chuỗi "#a #b" (tách nhau bởi khoảng
// trắng, đúng định dạng người dùng gõ) hoặc mảng ["#a","#b"] (nếu frontend
// tự parse trước khi gửi) — KHÔNG tin tưởng mù quáng dữ liệu đã "có vẻ" hợp
// lệ từ client dù ở dạng nào, luôn parse/validate lại toàn bộ từ đầu ở
// backend (đúng triết lý "siết chặt từ gốc backend" đã áp dụng xuyên suốt
// dự án). Hashtag là optional — mảng rỗng hợp lệ.
//
// Định dạng 1 hashtag: bắt đầu bằng "#", theo sau là 1-HASHTAG_MAX_LENGTH
// ký tự chữ/số/gạch dưới (Unicode — cho phép tiếng Việt có dấu), KHÔNG chứa
// khoảng trắng hay ký tự đặc biệt khác (an toàn hiển thị, tránh nhầm lẫn
// với dấu phân cách). Trùng lặp (không phân biệt hoa/thường) bị loại bỏ,
// giữ lần xuất hiện đầu tiên (đúng dạng người dùng gõ, không ép về chữ
// thường) — vượt quá HASHTAG_MAX_COUNT bị từ chối hoàn toàn (không tự cắt
// bớt, để người dùng biết mà tự sửa).
//
// @returns {{ error: string|null, hashtags: string[] }}
function validateHashtags(raw) {
  if (raw === undefined || raw === null || raw === "") return { error: null, hashtags: [] };

  let rawList;
  if (Array.isArray(raw)) {
    rawList = raw;
  } else if (typeof raw === "string") {
    rawList = raw.trim().split(/\s+/).filter(Boolean);
  } else {
    return { error: "Định dạng hashtag không hợp lệ.", hashtags: [] };
  }

  if (rawList.length > CONTENT_LIMITS.HASHTAG_MAX_COUNT) {
    return { error: `Tối đa ${CONTENT_LIMITS.HASHTAG_MAX_COUNT} hashtag.`, hashtags: [] };
  }

  const HASHTAG_RE = new RegExp(`^#[\\p{L}\\p{N}_]{1,${CONTENT_LIMITS.HASHTAG_MAX_LENGTH}}$`, "u");
  const seen = new Set();
  const hashtags = [];
  for (const item of rawList) {
    if (typeof item !== "string") return { error: "Định dạng hashtag không hợp lệ.", hashtags: [] };
    const tag = item.trim();
    if (!tag) continue;
    if (!HASHTAG_RE.test(tag)) {
      return {
        error: `Hashtag "${tag}" không hợp lệ — phải có dạng #tag, chỉ gồm chữ/số/gạch dưới, tối đa ${CONTENT_LIMITS.HASHTAG_MAX_LENGTH} ký tự sau dấu #.`,
        hashtags: [],
      };
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue; // bỏ trùng (không phân biệt hoa/thường), giữ lần xuất hiện đầu
    seen.add(key);
    hashtags.push(tag);
  }
  return { error: null, hashtags };
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
    // v0.10.17 — badge thành viên đã dùng Twelve Old trước ngày chuyển đổi
    // (gán 1 lần bởi backend/scripts/migrate-legacy-data.js, không tự phát sinh)
    isLegacyMember,
    legacySince,
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
    isLegacyMember: !!isLegacyMember,
    legacySince: legacySince || null,
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
  const { viewerKey = null, isAi = false, viewerUid = null, authorUid = null } = opts;
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

      // ==== VÁ v0.8.26 [CRITICAL] — Vi phạm thứ tự đọc/ghi trong transaction ====
      // Firestore BẮT BUỘC mọi lệnh ĐỌC (tx.get) trong 1 transaction phải xảy
      // ra TRƯỚC mọi lệnh GHI (tx.set/update/delete) — gọi tx.get() sau khi đã
      // gọi tx.update() trong CÙNG transaction sẽ làm cả transaction bị REJECT
      // (throw), rơi vào catch bên ngoài, và registerView() lặng lẽ trả về
      // false. Bản trước đây gọi `tx.get(ref)` (để đọc externalPostScore hiện
      // tại) SAU `tx.update(ref, updates)` (đã cộng viewCount) — đúng lúc
      // NGƯỜI XEM KHÁC TÁC GIẢ (viewerUid !== authorUid), tức chính xác
      // trường hợp "xem bài viết của người khác" — nên transaction luôn thất
      // bại và view không được tính, TRÙNG KHỚP với báo cáo: xem bài người
      // khác không tăng view, chỉ xem bài của chính mình mới tăng (vì khi đó
      // nhánh gọi tx.get(ref) thừa này bị bỏ qua hoàn toàn, không vi phạm gì).
      //
      // FIX: đọc TRƯỚC — nếu sắp cộng điểm cho người xem (viewerUid khác
      // authorUid, đã đăng nhập, không phải bot), đọc `ref` NGAY TỪ ĐÂY,
      // trước bất kỳ lệnh ghi nào — rồi mới thực hiện toàn bộ các lệnh ghi.
      const willCreditViewer = viewerUid && !isAi && viewerUid !== authorUid;
      const docSnap = willCreditViewer ? await tx.get(ref) : null;

      tx.set(viewRef, { lastViewedAtMs: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const updates = { viewCount: FieldValue.increment(1) };
      if (isAi) updates.aiViewCount = FieldValue.increment(1);
      tx.update(ref, updates);

      // v0.8.17: +1 điểm tích cực cho NGƯỜI XEM (không phải tác giả) — chỉ
      // khi đã đăng nhập (viewerUid có giá trị; khách ẩn danh không có tài
      // khoản để cộng) VÀ đây thực sự là 1 view MỚI (chưa trùng trong cửa sổ
      // dedup — dùng chung đúng kết quả dedup của viewCount, không phải 1 bộ
      // đếm/điều kiện riêng, tránh 2 nơi lệch nhau). Bot/crawler (isAi=true)
      // không có viewerUid nên tự động không được cộng, không cần check riêng.
      //
      // ==== VÁ v0.8.25 [HIGH] — Chặn tự thưởng điểm ====
      // KHÔNG cộng positiveScore nếu người xem CHÍNH LÀ tác giả bài viết.
      if (willCreditViewer) {
        const w = positiveScoreWrite(db, admin, viewerUid, 1);
        if (w) tx.set(w.ref, w.data, { merge: true });
        // AUDIT LOG (v0.8.25): ghi lại chi tiết lần cộng điểm để sau này điều tra
        const lw = positiveScoreLogWrite(db, admin, viewerUid, 1, "view", {
          collection: collectionName,
          docId,
          relatedUid: authorUid,
        });
        if (lw) tx.set(lw.ref, lw.data);
        // ==== VÁ v0.8.25 [CRITICAL] — Cập nhật externalPostScore ====
        // View từ người khác cũng đóng góp vào `externalPostScore` của bài
        // viết (trọng số view = +1), từ đó vào postsScoreSum của tác giả.
        const currentExternal = docSnap.exists ? docSnap.data().externalPostScore || 0 : 0;
        const newExternal = currentExternal + POST_SCORE_WEIGHTS.view;
        tx.update(ref, { externalPostScore: newExternal });
        const sw = postsScoreSumWrite(db, admin, authorUid, POST_SCORE_WEIGHTS.view);
        if (sw) tx.set(sw.ref, sw.data, { merge: true });
      }

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
/**
 * ==== VÁ v0.8.20 [BẢO MẬT] — Giả mạo sharerUid để "cấy" positiveScore ====
 *
 * Trang Profile hiển thị uid của BẤT KỲ ai ngay trên thanh địa chỉ
 * (`/profile/<uid>`). Trước v0.8.20, link share chỉ mang `?idu=<uid>` TRẦN —
 * `registerShare` chỉ kiểm tra "uid này có tồn tại thật không" chứ KHÔNG hề
 * kiểm tra "chính người này có thật sự tạo link share cho ĐÚNG bài viết
 * này hay không". Hậu quả: kẻ xấu chỉ cần lấy uid bất kỳ (của mình, hoặc để
 * hại người khác) rồi tự chế `?idu=<uid>` gắn vào URL BẤT KỲ bài viết nào
 * (kể cả bài viral không phải của mình), phát tán link đó — mỗi lượt click
 * (qua dedup viewerKey) sẽ "cấy" +8 điểm tích cực cho uid trong link, HOÀN
 * TOÀN không cần thao tác Share thật nào cả.
 *
 * FIX: mọi link share hợp lệ giờ phải mang thêm 1 CHỮ KÝ HMAC-SHA256
 * (`&s=...`), tính từ CHÍNH XÁC bộ 3 (sharerUid, collectionName, docId)
 * bằng 1 secret key CHỈ backend biết (`SHARE_LINK_SECRET`, không bao giờ lộ
 * ra client). `registerShare` tính lại chữ ký từ 3 giá trị nhận được và so
 * sánh bằng `crypto.timingSafeEqual` (tránh timing attack dò từng byte chữ
 * ký) — sai lệch dù chỉ 1 ký tự (đổi uid, đổi sang bài khác, hoặc tự bịa chữ
 * ký) đều bị coi là KHÔNG có sharer hợp lệ (vẫn tính shareCount bình thường
 * cho lượt click đó, chỉ không ghi công +8 cho ai — giống hệt cách xử lý
 * "sharer không tồn tại" đã có từ trước).
 *
 * Vì mỗi chữ ký gắn chặt với ĐÚNG 1 bài viết cụ thể, không thể "tái sử dụng"
 * chữ ký hợp lệ của bài A để giả mạo cho bài B — kể cả khi kẻ xấu có trong
 * tay 1 link share hợp lệ thật (của chính mình hoặc nhặt được).
 *
 * LƯU Ý KHI NÂNG CẤP: các link share cũ (tạo trước v0.8.20, không có `&s=`)
 * sẽ không còn ghi công sharerUid nữa (an toàn — fail-closed, không phải
 * fail-open) — người dùng cần tạo lại link share mới sau khi cập nhật.
 */
function signShareParams(uid, collectionName, docId) {
  const secret = process.env.SHARE_LINK_SECRET;
  if (!secret) {
    console.error("SHARE_LINK_SECRET chưa được cấu hình — link share sẽ không ghi công được sharerUid.");
    return "";
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${uid}:${collectionName}:${docId}`)
    .digest("hex")
    .slice(0, 32); // 128 bit — đủ an toàn, rút ngắn URL so với hex đầy đủ (64 ký tự)
}

function verifyShareSignature(uid, collectionName, docId, signature) {
  if (!uid || !signature || typeof signature !== "string") return false;
  const expected = signShareParams(uid, collectionName, docId);
  if (!expected) return false; // thiếu SHARE_LINK_SECRET -> luôn coi là không hợp lệ (fail-closed)
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual đòi buffer cùng độ dài
  return crypto.timingSafeEqual(a, b);
}

function parseShareQuery(query = {}) {
  const idu = typeof query.idu === "string" && query.idu.trim() ? query.idu.trim() : null;
  const sig = typeof query.s === "string" && query.s.trim() ? query.s.trim() : null;
  const shared = query.shared === "1" || query.shared === "true";
  return { isShareLink: !!(idu || shared), rawSharerUid: idu, signature: sig };
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
 * @param {{ rawSharerUid: string|null, signature: string|null, authorUid: string, source: "web"|"ssr", viewerKey: string, viewerUid: string|null }} opts
 *   source: "web" = người dùng thật mở link trên bản React (CSR),
 *           "ssr"  = Bot A.I / crawler mở link trên trang SSR EJS.
 *   signature: chữ ký HMAC từ `?s=` trên URL — xem đầy đủ giải thích chống
 *              giả mạo sharerUid ở docblock `signShareParams` phía trên.
 * @returns {Promise<{ counted: boolean, sharerUid: string|null }>} — v0.8.17:
 *   đổi từ trả về boolean trần sang object để caller biết CHÍNH XÁC ai vừa
 *   được ghi công (sharerUid đã qua xác thực) — cần thiết để cộng +8 điểm
 *   tích cực đúng người ở phía gọi hàm (posts/blog.controller.js
 *   #getPost/getBlog), tách biệt khỏi việc ghi vào subcollection SHARES ở
 *   đây. Cả 2 việc (đếm shareCount và cộng positiveScore) vẫn nằm CHUNG 1
 *   transaction bên dưới — chỉ là để caller có thể MÔ TẢ lại số liệu trả về
 *   client (formatted.shareCount) mà không cần đoán lại sharerUid lần 2.
 */
async function registerShare(db, admin, collectionName, docId, opts = {}) {
  const {
    rawSharerUid = null,
    signature = null,
    authorUid = null,
    source = "web",
    viewerKey = null,
    viewerUid = null, // uid người đang MỞ link (req.authUid), khác sharerUid trên URL
  } = opts;
  try {
    // Chủ bài mở link share bài của chính mình → KHÔNG tính share
    // (kể cả link do người khác tạo ?idu=friend). Chống tự buff.
    if (authorUid && viewerUid && viewerUid === authorUid) {
      return { counted: false, sharerUid: null };
    }

    // ==== VÁ v0.8.20 [BẢO MẬT] ====
    // Xác thực CHỮ KÝ trước khi tin `rawSharerUid` — xem đầy đủ giải thích
    // ở docblock `signShareParams` phía trên. Sai chữ ký (thiếu, bị sửa uid,
    // dùng nhầm chữ ký của bài khác...) coi như KHÔNG có sharer hợp lệ, dù
    // uid đó có tồn tại thật hay không — KHÔNG được bỏ qua bước này.
    const signatureValid = verifyShareSignature(rawSharerUid, collectionName, docId, signature);

    // v0.8.19: tác giả chia sẻ bài của CHÍNH MÌNH cho người khác vẫn được ghi
    // công (không loại trừ rawSharerUid === authorUid nữa) — chỉ cần chữ ký
    // hợp lệ + sharerUid tồn tại thật.
    let sharerUid = null;
    if (signatureValid) {
      const sharerSnap = await db.collection(COLLECTIONS.USERS).doc(rawSharerUid).get();
      if (sharerSnap.exists) sharerUid = rawSharerUid;
    }

    // ==== DEBUG LOG (v0.8.25) — Chẩn đoán share không cộng điểm ====
    // Ghi rõ lý do tại sao sharerUid bị null (nếu bị) để dễ debug trên production.
    // Có thể gỡ sau khi xác định nguyên nhân.
    if (rawSharerUid && !signatureValid) {
      const expected = signShareParams(rawSharerUid, collectionName, docId);
      console.warn(
        `[SHARE DEBUG] Chữ ký không hợp lệ | uid=${rawSharerUid} collection=${collectionName} doc=${docId} ` +
        `sig_len=${signature?.length || 0} expected_len=${expected?.length || 0} sig_match=${signature === expected}`
      );
    }
    if (rawSharerUid && signatureValid && !sharerUid) {
      console.warn(`[SHARE DEBUG] SharerUid không tồn tại trong Firestore | uid=${rawSharerUid}`);
    }
    if (!rawSharerUid) {
      console.warn(
        `[SHARE DEBUG] Không có sharerUid — link chỉ có ?shared=1 không có ?idu= | ` +
        `collection=${collectionName} doc=${docId} viewerUid=${viewerUid || "null"}`
      );
    }

    // Chống đếm trùng: 1 phiên (sid) / 1 user login chỉ 1 share / bài.
    const key = typeof viewerKey === "string" && viewerKey.trim() ? viewerKey.trim().slice(0, 128) : null;
    if (!key) {
      console.warn(`registerShare(${collectionName}/${docId}): thiếu viewerKey — bỏ qua đếm`);
      return { counted: false, sharerUid: null };
    }
    // Firestore doc id không cho "/" — đã chuẩn hoá ở caller
    const safeId = key.replace(/\//g, "_");
    const FieldValue = admin.firestore.FieldValue;
    const ref = db.collection(collectionName).doc(docId);
    const shareRef = ref.collection(SUBCOLLECTIONS.SHARES).doc(safeId);

    const counted = await db.runTransaction(async (tx) => {
      const existing = await tx.get(shareRef);
      if (existing.exists) return false;
      // ==== v0.8.25 [CRITICAL] — Đọc document bài để cập nhật externalPostScore ====
      const docSnap = await tx.get(ref);
      const currentExternal = docSnap.exists ? docSnap.data().externalPostScore || 0 : 0;
      tx.set(shareRef, {
        sharerUid,
        source,
        viewerKey: key,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(ref, { shareCount: FieldValue.increment(1) });

      // v0.8.17 (đính chính v0.8.19): +8 điểm tích cực cho NGƯỜI TẠO LINK
      // SHARE — chỉ cần sharerUid đã xác thực tồn tại thật (KHÔNG loại trừ
      // trường hợp sharerUid trùng authorUid nữa, xem đính chính ở trên) —
      // atomic trong CÙNG transaction với việc đếm shareCount — mỗi lượt
      // visit link (đã qua dedup viewerKey) chỉ cộng đúng 1 lần, không thể
      // lợi dụng race-condition giữa 2 write.
      //
      // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua share ẩn danh ====
      // Chỉ cộng +8 điểm khi người MỞ link (viewerUid):
      //   1. ĐÃ ĐĂNG NHẬP thật (viewerUid !== null) — khách ẩn danh chỉ được
      //      tính shareCount hiển thị, KHÔNG được cộng điểm thưởng thật.
      //   2. KHÔNG PHẢI chính sharer tự mở link của mình (viewerUid !== sharerUid).
      //   3. KHÔNG PHẢI tác giả bài (đã kiểm tra ở đầu hàm, nhưng nhắc lại
      //      ở đây cho phòng thủ).
      // Điều này chặn kịch bản attacker tự tạo link share rồi gửi hàng loạt
      // request ẩn danh với sid ngẫu nhiên để farm +8 điểm/lượt.
      // Điều kiện chặn farm điểm share ẩn danh — xem giải thích chi tiết ở trên.
      const shouldReward = sharerUid && viewerUid && viewerUid !== sharerUid && viewerUid !== authorUid;
      if (!shouldReward && sharerUid) {
        console.warn(
          `[SHARE DEBUG] Đủ điều kiện sharerUid nhưng không cộng điểm | ` +
          `sharer=${sharerUid} viewer=${viewerUid || "null"} author=${authorUid} ` +
          `viewerIsSharer=${viewerUid === sharerUid} viewerIsAuthor=${viewerUid === authorUid}`
        );
      }
      if (shouldReward) {
        const w = positiveScoreWrite(db, admin, sharerUid, 8);
        if (w) tx.set(w.ref, w.data, { merge: true });
        // AUDIT LOG (v0.8.25): ghi lại chi tiết lần cộng điểm share
        const lw = positiveScoreLogWrite(db, admin, sharerUid, 8, "share", {
          collection: collectionName,
          docId,
          relatedUid: viewerUid,
          meta: { source, authorUid },
        });
        if (lw) tx.set(lw.ref, lw.data);
        // ==== VÁ v0.8.25 [CRITICAL] — Cập nhật externalPostScore ====
        // Share từ người khác cũng đóng góp vào `externalPostScore` của bài
        // viết (trọng số share = +4), từ đó vào postsScoreSum của tác giả.
        const newExternal = currentExternal + POST_SCORE_WEIGHTS.share;
        tx.update(ref, { externalPostScore: newExternal });
        const sw = postsScoreSumWrite(db, admin, authorUid, POST_SCORE_WEIGHTS.share);
        if (sw) tx.set(sw.ref, sw.data, { merge: true });
      }

      return true;
    });
    return { counted, sharerUid };
  } catch (err) {
    console.error(`registerShare(${collectionName}/${docId}) error:`, err.message);
    return { counted: false, sharerUid: null };
  }
}

/**
 * Khóa người xem để chống đếm trùng view/share.
 * Ưu tiên: user đã login (uid) → IP (fallback cho khách ẩn danh — xem VÁ
 * v0.10.11 [HIGH] ngay dưới: KHÔNG còn tin session id do client tự chọn).
 * Không khóa vĩnh viễn theo IP cả đời bài viết (tránh 2 người cùng WiFi chỉ còn 1 share)
 * — chỉ trong cửa sổ chống trùng (xem VIEW_DEDUPE_WINDOW_MS ở registerView()).
 */
/**
 * ==== VÁ v0.10.11 [HIGH] — bỏ nhánh tin `sid`/`X-Twelve-Session` DO CLIENT
 * TỰ CHỌN khi xác định "viewer ẩn danh" ====
 *
 * Trước đây: khách ẩn danh (`!req.authUid`) được ưu tiên định danh bằng
 * `?sid=` hoặc header `X-Twelve-Session` — cả 2 đều do FRONTEND tự sinh
 * (`crypto.randomUUID()`, lưu sessionStorage — xem frontend/src/utils/
 * sessionId.js) và gửi lên KHÔNG kèm bất kỳ xác thực/chữ ký nào. Hệ quả: ai
 * gọi thẳng API (bỏ qua UI) đều tự chọn được `sid` bất kỳ cho MỖI request —
 * bỏ qua hoàn toàn cơ chế chống đếm trùng 30 phút/viewerKey ở registerView()
 * và registerShare() (xem 2 hàm trên) — farm viewCount/shareCount vô hạn chỉ
 * bằng cách đổi 1 query param, không cần đổi IP, không cần tài khoản, không
 * cần chữ ký. Ảnh hưởng trực tiếp postScore → thứ hạng Trending/Khám phá.
 *
 * Vá: khách ẩn danh LUÔN dùng IP làm khoá chống trùng — không còn nhánh nào
 * do client tự chọn giá trị. Đánh đổi CHẤP NHẬN ĐƯỢC: nhiều người dùng thật
 * sau cùng 1 NAT/mạng công ty có thể bị dedup chung (chỉ người đầu tiên
 * trong 30 phút được tính view/share) — nhẹ hơn nhiều so với việc để hở 1
 * lỗ farm không giới hạn. Kết hợp thêm `viewLimiter`/`shareLimiter` (theo
 * IP, xem middleware/rateLimiters.js) làm "trần" tuyệt đối độc lập với
 * viewerKey — chặn cả trường hợp tấn công đổi IP.
 *
 * `sid`/`X-Twelve-Session` KHÔNG bị xoá khỏi request (frontend vẫn có thể
 * gửi, vô hại) — chỉ đơn giản không còn được BACKEND tin dùng nữa.
 */
function viewerKeyFromRequest(req) {
  // User đã login: khóa theo uid (1 tài khoản = tối đa 1 share/bài; phát hiện chủ bài).
  if (req.authUid) return `u:${req.authUid}`;

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
/**
 * ==== ĐIỂM TÀI KHOẢN — accountScore (v0.8.23) ====
 * `accountScore = postsScoreSum + positiveScore` — CHỈ LÀ CACHE (giống hệt
 * triết lý `postsScoreSum`) để các tính năng xếp hạng sau này dùng ngay mà
 * không cần cộng lại 2 field mỗi lần. Vì 2 số hạng của công thức đều là
 * PHÉP CỘNG TUYẾN TÍNH, `postsScoreSumWrite`/`positiveScoreWrite` áp dụng
 * CÙNG delta lên accountScore ngay khi áp dụng lên field gốc — không cần
 * đọc thêm, không tốn thêm 1 lượt Firestore read nào, đúng bằng phép cộng
 * (a+delta) + b = (a+b) + delta. Xem thêm `syncAccountScore` (trigger
 * "đăng nhập/truy cập") và `reconcilePostsScoreSum` (đã cập nhật để giữ
 * đúng invariant này qua đường đối soát aggregation).
 */
function postsScoreSumWrite(db, admin, authorUid, delta) {
  if (!authorUid || !delta) return null;
  return {
    ref: db.collection(COLLECTIONS.USERS).doc(authorUid),
    data: {
      postsScoreSum: admin.firestore.FieldValue.increment(delta),
      accountScore: admin.firestore.FieldValue.increment(delta),
    },
  };
}

/**
 * ==== ĐIỂM TÍCH CỰC — positiveScore (v0.8.17) ====
 * KHÁC HẲN postScore/postsScoreSum: đây KHÔNG phải giá trị động/tính lại từ
 * nguồn — là 1 bộ đếm CỘNG/TRỪ THUẦN TÚY, độc lập, không có cơ chế tự chữa
 * lành hay đối soát qua aggregation. Chỉ quan tâm HÀNH ĐỘNG có hợp lệ hay
 * không (được hệ thống like/dislike/comment/view/share/đăng-bài chấp nhận),
 * không quan tâm chống spam ở TẦNG ĐÓ (chống spam comment là việc của
 * comments.controller.js, không phải của positiveScore).
 *
 * Ai được cộng/trừ = NGƯỜI THỰC HIỆN hành động (không phải tác giả bài viết
 * nhận like/dislike/comment) — xem đủ 6 hành động + giá trị điểm ở docblock
 * tại từng nơi gọi (reactions.controller.js, comments.controller.js,
 * posts.controller.js/blog.controller.js#createPost/deletePost,
 * registerView, registerShare).
 *
 * KHÔNG hồi tố: hành động trước v0.8.17 không được cộng, và (theo đúng yêu
 * cầu sản phẩm) việc ĐẢO NGƯỢC 1 hành động cũ (gỡ like/dislike/xoá bài từ
 * trước v0.8.17, xoá comment cũ...) SAU KHI đã lên v0.8.17 VẪN bị trừ điểm
 * bình thường — vì bản thân việc gỡ/xoá là hành động hợp lệ MỚI, được hệ
 * thống hiện tại quản lý, bất kể hành động gốc có từng được cộng hay chưa.
 * Hệ quả CHẤP NHẬN ĐƯỢC: positiveScore CÓ THỂ ÂM cho tài khoản có nhiều
 * like/dislike/bài viết từ trước 0.8.17 rồi bị gỡ/xoá sau đó — không clamp
 * về 0, không phải bug.
 *
 * Trả về mô tả ghi (giống hệt pattern `postsScoreSumWrite`) để caller tự
 * `tx.set(w.ref, w.data, {merge:true})` TRONG CÙNG transaction với hành động
 * gốc (like/dislike/comment/đăng-xoá bài) — bắt buộc atomic, không tách rời
 * thành 1 write riêng, để không thể lợi dụng race-condition (double-click
 * trước khi transaction đầu commit) tạo chênh lệch giữa hành động thật và
 * điểm được cộng — đúng yêu cầu "siết chặt chống gian lận từ gốc backend".
 */
function positiveScoreWrite(db, admin, uid, delta) {
  if (!uid || !delta) return null;
  return {
    ref: db.collection(COLLECTIONS.USERS).doc(uid),
    data: {
      positiveScore: admin.firestore.FieldValue.increment(delta),
      // v0.8.23: xem docblock accountScore ở postsScoreSumWrite phía trên.
      accountScore: admin.firestore.FieldValue.increment(delta),
    },
  };
}

/**
 * ==== AUDIT LOG positiveScore (v0.8.25) ====
 * Tạo 1 write ghi lại CHI TIẾT từng lần cộng/trừ positiveScore vào
 * subcollection `users/{uid}/positiveScoreLogs`. Mục đích: sau này điều tra
 * gian lận / đối soát / khôi phục số liệu có thể truy ngược nguồn gốc của
 * MỌI thay đổi điểm, không chỉ nhìn thấy con số cuối cùng.
 *
 * Luôn gọi CÙNG transaction/batch với positiveScoreWrite() để 2 thao tác
 * (cộng điểm + ghi log) atomic — không thể có trường hợp "điểm cộng rồi nhưng
 * log bị mất" hay ngược lại.
 *
 * @param {*} db - Firestore instance
 * @param {*} admin - firebase-admin (để lấy FieldValue)
 * @param {string} uid - uid người nhận thay đổi điểm
 * @param {number} delta - số điểm cộng/trừ (+1, -1, +8...)
 * @param {string} action - loại hành động:
 *   "create_post" | "delete_post" | "create_blog" | "delete_blog" |
 *   "react" | "add_comment" | "delete_comment" | "view" | "share"
 * @param {{ collection?: string, docId?: string, relatedUid?: string, meta?: object }} opts
 *   - collection: collection liên quan ("posts", "blogs", "comments"...)
 *   - docId: ID của document liên quan (postId, blogId, commentId...)
 *   - relatedUid: UID đối tượng liên quan (ví dụ: authorUid của bài khi view,
 *                 sharerUid khi share, viewerUid khi share ghi công...)
 *   - meta: object tùy ý chứa thông tin bổ sung (reaction type, source...)
 * @returns {{ ref: FirebaseFirestore.DocumentReference, data: object }|null}
 */
function positiveScoreLogWrite(db, admin, uid, delta, action, opts = {}) {
  if (!uid || !delta || !action) return null;
  const { collection = null, docId = null, relatedUid = null, meta = null } = opts;
  const logRef = db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(SUBCOLLECTIONS.POSITIVE_SCORE_LOGS)
    .doc();
  const data = {
    id: logRef.id,
    action,
    delta,
    collection,
    docId,
    relatedUid,
    meta,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  return { ref: logRef, data };
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
 * ĐÍNH CHÍNH (v0.8.28): đoạn "CHI PHÍ: aggregation query..." ở trên ĐÃ LỖI
 * THỜI — bản v0.8.25 (đọc `externalPostScore` với fallback về `postScore`
 * cho bài cũ) BẮT BUỘC phải đọc TỪNG DOCUMENT thủ công (`.get()` trả về toàn
 * bộ document), KHÔNG còn dùng `.sum()`/aggregation query nữa (lý do: SUM()
 * không hỗ trợ "coalesce" 2 field khác nhau tuỳ document). Nghĩa là chi phí
 * THẬT SỰ của hàm này là 1 lượt đọc CHO MỖI document (`posts` + `blogs`) của
 * tác giả — KHÔNG rẻ như mô tả cũ (1 lượt/1000 index entry). Tác giả có hàng
 * trăm bài viết = hàng trăm lượt đọc MỖI LẦN hàm này chạy — đây chính là lý
 * do bổ sung cơ chế THROTTLE (`_shouldSkipReconcile`, xem ngay phía trên hàm
 * này) ở v0.8.28: giới hạn tần suất chạy THẬT SỰ tốn kém này, thay vì mỗi
 * lần đọc/xem bài như trước (xem thêm docblock v0.8.28 phía trên).
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
/**
 * ==== TỐI ƯU v0.8.28 [HIỆU NĂNG] — Throttle reconcilePostsScoreSum ====
 * TRƯỚC ĐÂY: hàm này (2 lượt full-collection query trên CẢ "posts" VÀ
 * "blogs" + 1 transaction) chạy VÔ ĐIỀU KIỆN mỗi khi 1 bài viết bất kỳ của
 * tác giả được XEM (getPost/getBlog/SSR, qua syncPostScore) hoặc XUẤT HIỆN
 * trong 1 trang danh sách (listPosts/listBlogs, qua syncPostScoresBatch) —
 * kể cả khi không có gì thay đổi (đây chính là ý đồ ban đầu của v0.8.16: chạy
 * mỗi lần đọc để tự sửa nếu ai đó chỉnh tay Firestore). Hậu quả: 1 tác giả có
 * hàng trăm bài thì MỖI LẦN xem 1 bài của họ = quét lại TOÀN BỘ bài viết +
 * blog của họ; trang INDEX/BLOG có 10-20 tác giả khác nhau mỗi trang thì MỖI
 * LẦN TẢI TRANG kích hoạt tới 10-20 lượt quét như vậy — cực kỳ lãng phí quota
 * đọc Firestore và tải CPU/độ trễ phía server, dù mục đích "tự chữa lành"
 * không cần chạy dày đặc đến mức đó (độ lệch cần sửa thường đến từ việc
 * chỉnh tay Firestore — hiếm gặp, không cần sửa trong vòng vài giây).
 *
 * FIX: THROTTLE bằng cache trong bộ nhớ — mỗi authorUid chỉ thực sự được đối
 * soát lại (chạy 2 query + transaction) TỐI ĐA 1 LẦN mỗi
 * RECONCILE_COOLDOWN_MS. Trong cửa sổ đó, mọi lời gọi tiếp theo cho CÙNG tác
 * giả trả về ngay lập tức — tra cứu trong bộ nhớ (0 chi phí Firestore), không
 * phải đọc document. Vẫn giữ nguyên tính chất "tự chữa lành", chỉ là theo
 * chu kỳ hợp lý thay vì mỗi lần đọc.
 *
 * Lưu ý: cache ở cấp PROCESS (không dùng chung giữa nhiều instance nếu scale
 * ngang sau này) — chấp nhận được vì mục tiêu chỉ là giảm tần suất gọi tổng
 * thể, không phải đảm bảo đối soát đúng 1 lần tuyệt đối trên toàn hệ thống;
 * mỗi instance tự throttle riêng vẫn giảm tải đáng kể so với không throttle.
 * Có giới hạn kích thước cache (`RECONCILE_CACHE_MAX_SIZE`) để tránh phình bộ
 * nhớ vô hạn trên process chạy rất lâu với rất nhiều tác giả khác nhau.
 */
const RECONCILE_COOLDOWN_MS = 15 * 60 * 1000; // 15 phút / tác giả / instance
const RECONCILE_CACHE_MAX_SIZE = 5000;
const _reconcileLastRunAt = new Map(); // authorUid -> timestamp (ms) lần chạy gần nhất

function _shouldSkipReconcile(authorUid) {
  const now = Date.now();
  const last = _reconcileLastRunAt.get(authorUid);
  if (last && now - last < RECONCILE_COOLDOWN_MS) return true;

  _reconcileLastRunAt.set(authorUid, now);
  if (_reconcileLastRunAt.size > RECONCILE_CACHE_MAX_SIZE) {
    // Không phải LRU chính xác (Map giữ thứ tự CHÈN, không phải thứ tự truy
    // cập gần nhất) — nhưng đủ dùng làm van an toàn chống phình bộ nhớ, mục
    // tiêu chỉ là có giới hạn trên, không cần tối ưu tuyệt đối.
    const oldestKey = _reconcileLastRunAt.keys().next().value;
    _reconcileLastRunAt.delete(oldestKey);
  }
  return false;
}

async function reconcilePostsScoreSum(db, admin, authorUid) {
  if (!authorUid) return;
  if (_shouldSkipReconcile(authorUid)) return;
  try {
    // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
    // Dùng `externalPostScore` (chỉ tính tương tác từ NGƯỜI KHÁC tác giả) thay
    // vì `postScore` (bao gồm cả tự tương tác). Xem chi tiết ở các controller
    // transaction (reactions, comments, registerShare, registerView).
    //
    // KHÔNG dùng aggregation query nữa vì các bài viết CŨ (tạo trước v0.8.25)
    // chưa có field `externalPostScore` — SUM() sẽ coi chúng = 0 và reset toàn
    // bộ postsScoreSum về 0 sai lệch. Thay vào đó đọc từng document thủ công:
    // nếu có `externalPostScore` thì dùng, nếu không (dữ liệu cũ) fallback
    // về `postScore` để đảm bảo tính liên tục sau khi deploy.
    const [postsSnap, blogsSnap] = await Promise.all([
      db.collection(COLLECTIONS.POSTS).where("authorUid", "==", authorUid).get(),
      db.collection(COLLECTIONS.BLOGS).where("authorUid", "==", authorUid).get(),
    ]);
    let total = 0;
    postsSnap.forEach((d) => {
      const data = d.data();
      total += data.externalPostScore !== undefined ? data.externalPostScore : (data.postScore || 0);
    });
    blogsSnap.forEach((d) => {
      const data = d.data();
      total += data.externalPostScore !== undefined ? data.externalPostScore : (data.postScore || 0);
    });

    // v0.8.23: đây là chỗ DUY NHẤT ghi postsScoreSum bằng SET tuyệt đối (từ
    // aggregation) thay vì increment delta — nên KHÔNG thể áp dụng "cùng
    // delta" cho accountScore như postsScoreSumWrite/positiveScoreWrite làm
    // được (xem docblock ở đó). Phải đọc `positiveScore` HIỆN TẠI trong
    // CÙNG 1 transaction với việc ghi, để accountScore = total + positiveScore
    // luôn đúng ngay cả khi positiveScore vừa đổi đúng lúc đang đối soát
    // postsScoreSum (tránh race-condition đọc positiveScore cũ rồi mới ghi).
    const userRef = db.collection(COLLECTIONS.USERS).doc(authorUid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const currentPositiveScore = snap.exists ? snap.data().positiveScore || 0 : 0;
      tx.set(userRef, { postsScoreSum: total, accountScore: total + currentPositiveScore }, { merge: true });
    });
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

/**
 * ĐIỀU KIỆN TRIGGER THỨ 2 CỦA accountScore (v0.8.23) — "khi người dùng đăng
 * nhập vào tài khoản hoặc truy cập vào Twelve cùng với tài khoản của mình".
 * Gọi ở GET /api/users/me (users.controller.js#getMe) — endpoint này chạy
 * MỖI LẦN AuthContext ở frontend refresh hồ sơ (đăng nhập, mở lại app, F5...).
 *
 * KHÔNG cần đọc thêm gì — `userData` đã có sẵn từ `req.authUser` (middleware
 * đã đọc nguyên document). Tự sửa nếu accountScore lệch so với
 * postsScoreSum + positiveScore hiện tại (ví dụ ai đó chỉnh tay 1 trong 2
 * field gốc trực tiếp trên Firestore) — vá kiểu "tự chữa lành trên đường
 * đọc", cùng triết lý với postScore, nhưng RẺ HƠN NHIỀU vì không cần
 * aggregation query (2 số hạng đã nằm sẵn trên CHÍNH document này).
 *
 * @returns {object} userData đã có accountScore ĐÚNG để trả về client ngay
 *   trong response này, không cần đợi vòng request sau.
 */
function syncAccountScore(db, uid, userData) {
  if (!userData) return userData;
  const expected = (userData.postsScoreSum || 0) + (userData.positiveScore || 0);
  if (userData.accountScore !== expected) {
    // Fire-and-forget — không chặn response GET /me chỉ vì 1 lượt ghi sửa
    // cache phụ này.
    db.collection(COLLECTIONS.USERS)
      .doc(uid)
      .set({ accountScore: expected }, { merge: true })
      .catch((err) => console.error(`syncAccountScore(${uid}) error:`, err.message));
  }
  return { ...userData, accountScore: expected };
}

module.exports = {
  normalizeTagName,
  isValidTagName,
  validateTitle,
  validateCoverImageUrl,
  validateHashtags,
  toPublicUser,
  isSA,
  safeJsonForScript,
  incrementViewCount,
  registerView,
  parseShareQuery,
  signShareParams,
  verifyShareSignature,
  registerShare,
  viewerKeyFromRequest,
  POST_SCORE_WEIGHTS,
  computePostScore,
  postsScoreSumWrite,
  positiveScoreWrite,
  positiveScoreLogWrite,
  syncAccountScore,
  reconcilePostsScoreSum,
  syncPostScore,
  syncPostScoresBatch,
};
