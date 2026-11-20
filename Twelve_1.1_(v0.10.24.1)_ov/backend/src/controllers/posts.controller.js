const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS, REACTION_TYPE } = require("../utils/constants");
const { sanitizeHtml, htmlToExcerpt } = require("../services/sanitize.service");
const { processContentHtml, sendContentError } = require("../services/contentPipeline");
const { parseLimit, parseCursor, stripBidiAndInvisible, isSafeDocId } = require("../utils/input");
const { toPublicUser, registerView, parseShareQuery, registerShare, viewerKeyFromRequest, computePostScore, syncPostScore, syncPostScoresBatch, postsScoreSumWrite, reconcilePostsScoreSum, positiveScoreWrite, positiveScoreLogWrite, validateTitle, validateCoverImageUrl, validateHashtags } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

/**
 * POST /api/posts
 * body: { title, contentHtml, coverImageUrl? }
 * contentHtml: HTML do Quill.js render ra ở frontend (đã gồm ảnh/video/media chèn qua URL)
 * coverImageUrl: URL do người dùng dán vào (không upload trực tiếp)
 */
async function createPost(req, res) {
  try {
    const { title, contentHtml, coverImageUrl, hashtags } = req.body;
    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Cần có tiêu đề và nội dung bài viết." });
    }
    // v0.9.6 [MEDIUM]: title trước đây không giới hạn độ dài tối đa.
    const titleErr = validateTitle(title);
    if (titleErr) return res.status(400).json({ error: titleErr });
    const coverErr = validateCoverImageUrl(coverImageUrl);
    if (coverErr) return res.status(400).json({ error: coverErr });
    // v0.9.7 — hashtag bài viết
    const { error: hashtagErr, hashtags: cleanHashtags } = validateHashtags(hashtags);
    if (hashtagErr) return res.status(400).json({ error: hashtagErr });

    // v1.1 [BẢO MẬT F1 — vá từ 2.0.10]: kiểm tra giới hạn + sanitize ở worker có timeout (không chặn event loop).
    const { html: cleanHtml, excerpt: cleanExcerpt } = await processContentHtml(contentHtml);
    const postRef = db.collection(COLLECTIONS.POSTS).doc();

    const postData = {
      id: postRef.id,
      authorUid: req.authUid,
      title: stripBidiAndInvisible(title).trim(), // v1.1 [F7]: bỏ ký tự bidi/rộng-0
      contentHtml: cleanHtml,
      excerpt: cleanExcerpt,
      coverImageUrl: coverImageUrl || null,
      // v0.9.7 — hashtag bài viết, dạng ["#tag1", "#tag2"], tối đa 20 tag.
      hashtags: cleanHashtags,
      likeCount: 0,
      dislikeCount: 0,
      commentCount: 0,
      viewCount: 0,
      aiViewCount: 0,
      shareCount: 0,
      // postScore chỉ là CACHE (xem utils/helpers.js#syncPostScore) — khởi tạo
      // 0 cho nhất quán với các counter khác, không phải nguồn sự thật.
      postScore: 0,
      // ==== v0.8.25 [CRITICAL] ====
      // externalPostScore: chỉ tính điểm từ tương tác của NGƯỜI KHÁC tác giả.
      // Dùng để tính postsScoreSum/accountScore, chống farm điểm qua tự tương tác.
      externalPostScore: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // ĐIỂM TÍCH CỰC (v0.8.17): +1 cho tác giả khi đăng bài thành công. Ghi
    // BẰNG BATCH cùng lúc với việc tạo bài (không phải 2 lệnh `await` rời
    // nhau) để atomic — tránh trường hợp tạo bài xong nhưng crash/lỗi mạng
    // ngay trước khi cộng điểm, khiến bài đã tồn tại mà tác giả không được
    // cộng đúng điểm cho hành động "đăng bài" đó.
    const pw = positiveScoreWrite(db, admin, req.authUid, 1);
    const batch = db.batch();
    batch.set(postRef, postData);
    if (pw) batch.set(pw.ref, pw.data, { merge: true });
    // AUDIT LOG (v0.8.25): ghi lại chi tiết lần cộng điểm khi đăng bài
    const lw = positiveScoreLogWrite(db, admin, req.authUid, 1, "create_post", {
      collection: COLLECTIONS.POSTS,
      docId: postRef.id,
    });
    if (lw) batch.set(lw.ref, lw.data);
    await batch.commit();

    return res.status(201).json({ message: "Đăng bài thành công.", postId: postRef.id });
  } catch (err) {
    if (sendContentError(res, err)) return;
    console.error("createPost error:", err);
    return res.status(500).json({ error: "Đăng bài thất bại." });
  }
}

/**
 * GET /api/posts?cursor=<postId>&limit=10
 * Feed cho trang INDEX, sắp xếp mới nhất trước, phân trang kiểu cursor.
 */
async function listPosts(req, res) {
  try {
    // v1.1 [F8 — vá từ 2.0.10]: limit/cursor sai kiểu (âm, mảng, chứa "/") trước đây làm Firestore ném lỗi => 500.
    const limit = parseLimit(req.query.limit, 10, 30);
    const cursorParsed = parseCursor(req.query.cursor);
    if (!cursorParsed.ok) return res.status(400).json({ error: "Tham số cursor không hợp lệ." });
    let query = db.collection(COLLECTIONS.POSTS).orderBy("createdAt", "desc").limit(limit);

    if (cursorParsed.value) {
      const cursorSnap = await db.collection(COLLECTIONS.POSTS).doc(cursorParsed.value).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.get();
    const posts = await attachAuthors(snap.docs.map((d) => d.data()));

    // ==== VÁ v0.8.18 ====
    // TRƯỚC ĐÂY endpoint danh sách này KHÔNG bao giờ trả `myReaction` cho
    // từng bài, khác hẳn `getPost` (trang chi tiết) đã làm đúng — khiến
    // PostCard trên trang INDEX/BLOG luôn hiển thị nút Like/Dislike ở trạng
    // thái "chưa bấm" sau mỗi lần tải lại trang, dù Firestore đã có sẵn
    // reaction thật của người dùng. Hậu quả: người dùng tưởng đang bấm Like
    // MỚI nhưng thực chất đang GỠ 1 like đã có từ trước — backend xử lý hoàn
    // toàn đúng (toggle-off, đúng thiết kế) nhưng trải nghiệm gây hiểu lầm
    // nghiêm trọng (đặc biệt sau khi có positiveScore v0.8.17: gỡ nhầm 1 like
    // tưởng là thêm mới sẽ thấy điểm bị TRỪ thay vì CỘNG).
    // Route này trước đây cũng thiếu `optionalAuth` nên `req.authUid` không
    // tồn tại — đã thêm ở posts.routes.js.
    let myReactionByPostId = {};
    if (req.authUid && posts.length) {
      const refs = posts.map((p) =>
        db.collection(COLLECTIONS.POSTS).doc(p.id).collection(SUBCOLLECTIONS.REACTIONS).doc(req.authUid)
      );
      // db.getAll(): gộp N lượt đọc thành 1 network round-trip duy nhất thay
      // vì N request tuần tự — vẫn tính phí N lượt đọc nhưng nhanh hơn nhiều.
      const reactionSnaps = await db.getAll(...refs);
      reactionSnaps.forEach((rSnap, i) => {
        if (rSnap.exists) myReactionByPostId[posts[i].id] = rSnap.data().type;
      });
    }

    const formatted = posts.map((p) => ({
      ...formatCardPost(p),
      myReaction: myReactionByPostId[p.id] || null,
    }));

    // Đồng bộ cache postScore trong Firestore cho các bài mà điểm vừa tính
    // ra khác với giá trị đang lưu — chạy song song, KHÔNG chặn response
    // (xem utils/helpers.js#syncPostScoresBatch).
    syncPostScoresBatch(
      db,
      admin,
      COLLECTIONS.POSTS,
      posts.map((p, i) => ({ id: p.id, score: formatted[i].postScore, storedScore: p.postScore, authorUid: p.authorUid }))
    );

    return res.json({
      posts: formatted,
      nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
    });
  } catch (err) {
    console.error("listPosts error:", err);
    return res.status(500).json({ error: "Không tải được danh sách bài viết." });
  }
}

/**
 * GET /api/posts/:id
 * Dùng cho trang POST (chi tiết, SSR). Trả về đầy đủ nội dung + reaction của user hiện tại (nếu có).
 */
async function getPost(req, res) {
  try {
    const snap = await db.collection(COLLECTIONS.POSTS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài viết." });

    const post = snap.data();
    const [author] = await attachAuthors([post]);

    let myReaction = null;
    if (req.authUid) {
      const reactionSnap = await db
        .collection(COLLECTIONS.POSTS)
        .doc(req.params.id)
        .collection(SUBCOLLECTIONS.REACTIONS)
        .doc(req.authUid)
        .get();
      if (reactionSnap.exists) myReaction = reactionSnap.data().type;
    }

    // Tính VIEW: chỉ trang POST (chi tiết) này mới tính view, không tính ở
    // trang danh sách. Mọi đối tượng xem đều được tính, kể cả khách chưa
    // đăng nhập (route dùng optionalAuth). Không chờ ghi xong mới trả response
    // là không cần thiết ở đây vì update rất nhẹ, nhưng vẫn bọc lỗi để không
    // làm hỏng response chính nếu Firestore tạm thời lỗi.
    // Chống bơm view ảo (vá báo cáo bảo mật #5): 1 viewerKey (uid/session/IP)
    // chỉ được tính thêm 1 view mới sau mỗi 30 phút/bài — xem
    // utils/helpers.js#registerView. Gọi lặp lại endpoint này không còn
    // thổi phồng viewCount/postScore được nữa.
    const viewCounted = await registerView(db, admin, COLLECTIONS.POSTS, req.params.id, {
      viewerKey: viewerKeyFromRequest(req),
      isAi: false,
      viewerUid: req.authUid || null,
      authorUid: post.authorUid,
    });

    // Tính SHARE: nếu URL đang mở có ?idu=uid hoặc ?shared=1 (link do
    // POST /api/posts/:id/share tạo ra) thì đây chính là lượt "có người click
    // vào link chia sẻ" — ghi nhận 1 share (xem utils/helpers.js).
    const { isShareLink, rawSharerUid, signature } = parseShareQuery(req.query);
    let shareCounted = false;
    if (isShareLink) {
      const shareResult = await registerShare(db, admin, COLLECTIONS.POSTS, req.params.id, {
        rawSharerUid,
        signature,
        authorUid: post.authorUid,
        source: "web",
        viewerKey: viewerKeyFromRequest(req),
        viewerUid: req.authUid || null,
      });
      shareCounted = shareResult.counted;
    }

    const formatted = formatFullPost(author);
    // Phản ánh ngay lượt xem / lượt share vừa tính vào response để client
    // không cần chờ round-trip khác mới thấy số cập nhật. Chỉ +1 viewCount
    // nếu registerView xác nhận đây thực sự là 1 view mới (chưa trùng).
    formatted.viewCount = (post.viewCount || 0) + (viewCounted ? 1 : 0);
    formatted.shareCount = (post.shareCount || 0) + (shareCounted ? 1 : 0);
    // postScore PHẢI tính lại SAU khi đã cộng view/share ở trên — nếu tính
    // trong formatFullPost (dùng viewCount/shareCount cũ) thì sẽ bị lệch 1
    // nhịp so với số vừa cập nhật.
    formatted.postScore = computePostScore(formatted);
    // Đồng bộ cache trong Firestore (song song, không chặn response) — xem
    // utils/helpers.js#syncPostScore.
    syncPostScore(db, admin, COLLECTIONS.POSTS, req.params.id, formatted.postScore, post.postScore, post.authorUid);

    return res.json({ post: formatted, myReaction });
  } catch (err) {
    console.error("getPost error:", err);
    return res.status(500).json({ error: "Không tải được bài viết." });
  }
}

/**
 * PATCH /api/posts/:id  (chỉ chủ bài viết hoặc SA)
 */
async function updatePost(req, res) {
  try {
    const ref = db.collection(COLLECTIONS.POSTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài viết." });

    const post = snap.data();
    const isOwner = post.authorUid === req.authUid;
    const isSA = req.authUser.accountGroup === "SA";
    if (!isOwner && !isSA) return res.status(403).json({ error: "Bạn không có quyền sửa bài viết này." });

    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (req.body.title) {
      const titleErr = validateTitle(req.body.title);
      if (titleErr) return res.status(400).json({ error: titleErr });
      updates.title = stripBidiAndInvisible(req.body.title).trim();
    }
    if (req.body.contentHtml) {
      // v1.1 [F1/F10]: giới hạn + sanitize ở worker có timeout.
      const processed = await processContentHtml(req.body.contentHtml);
      updates.contentHtml = processed.html;
      updates.excerpt = processed.excerpt;
    }
    if (req.body.coverImageUrl !== undefined) {
      // v1.1 [vá từ 2.0.5]: ảnh bìa phải thuộc domain được phép; ảnh bìa đang lưu không đổi thì không bị kiểm tra lại.
      const coverErr = validateCoverImageUrl(req.body.coverImageUrl, post.coverImageUrl || null);
      if (coverErr) return res.status(400).json({ error: coverErr });
      updates.coverImageUrl = req.body.coverImageUrl || null;
    }
    if (req.body.hashtags !== undefined) {
      const { error: hashtagErr, hashtags: cleanHashtags } = validateHashtags(req.body.hashtags);
      if (hashtagErr) return res.status(400).json({ error: hashtagErr });
      updates.hashtags = cleanHashtags;
    }

    await ref.update(updates);
    return res.json({ message: "Cập nhật bài viết thành công." });
  } catch (err) {
    if (sendContentError(res, err)) return;
    console.error("updatePost error:", err);
    return res.status(500).json({ error: "Cập nhật thất bại." });
  }
}

/**
 * DELETE /api/posts/:id (chỉ chủ bài viết hoặc SA)
 */
async function deletePost(req, res) {
  try {
    const ref = db.collection(COLLECTIONS.POSTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài viết." });

    const post = snap.data();
    const isOwner = post.authorUid === req.authUid;
    const isSA = req.authUser.accountGroup === "SA";
    if (!isOwner && !isSA) return res.status(403).json({ error: "Bạn không có quyền xóa bài viết này." });

    // Xoá bài + trừ đúng phần đóng góp (postScore hiện tại) của bài này khỏi
    // postsScoreSum của tác giả — trong CÙNG 1 transaction (atomic), vì bài
    // không còn tồn tại nữa thì không được tính vào tổng điểm tài khoản. Tính
    // điểm MỚI NHẤT ngay tại thời điểm xoá (không dùng field postScore cache
    // có thể hơi cũ) để đảm bảo trừ đúng số đã từng cộng.
    let deletedAuthorUid = null;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (!freshSnap.exists) return; // đã bị xoá bởi request khác, bỏ qua

      const freshData = freshSnap.data();
      const currentScore = computePostScore(freshData);
      // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
      // Khi xoá bài, trừ đúng `externalPostScore` (chỉ điểm từ người khác)
      // khỏi postsScoreSum, thay vì trừ `postScore` (bao gồm cả tự tương tác
      // chưa từng được cộng vào postsScoreSum).
      const externalScoreToRemove = freshData.externalPostScore || 0;

      tx.delete(ref);

      const w = postsScoreSumWrite(db, admin, freshData.authorUid, -externalScoreToRemove);
      if (w) tx.set(w.ref, w.data, { merge: true });
      deletedAuthorUid = freshData.authorUid;

      // ĐIỂM TÍCH CỰC (v0.8.17): -1 cho tác giả khi xoá bài — đảo ngược
      // đúng +1 lúc đăng bài (createPost), atomic trong CÙNG transaction xoá.
      const pw = positiveScoreWrite(db, admin, freshData.authorUid, -1);
      if (pw) tx.set(pw.ref, pw.data, { merge: true });
      // AUDIT LOG (v0.8.25): ghi lại chi tiết lần trừ điểm khi xoá bài
      const lw = positiveScoreLogWrite(db, admin, freshData.authorUid, -1, "delete_post", {
        collection: COLLECTIONS.POSTS,
        docId: req.params.id,
      });
      if (lw) tx.set(lw.ref, lw.data);
    });

    // v0.8.14: đối soát lại bằng aggregation query SAU KHI transaction xoá +
    // trừ delta đã commit — chốt lại đúng giá trị thật (bài vừa xoá chắc
    // chắn không còn được tính nữa vì query aggregate chỉ quét document đang
    // tồn tại). Xem giải thích ở utils/helpers.js#reconcilePostsScoreSum.
    if (deletedAuthorUid) reconcilePostsScoreSum(db, admin, deletedAuthorUid).catch(() => {});

    return res.json({ message: "Đã xóa bài viết." });
  } catch (err) {
    console.error("deletePost error:", err);
    return res.status(500).json({ error: "Xóa thất bại." });
  }
}

// ==== Helpers dùng chung ====

async function attachAuthors(posts) {
  // v1.1 [TW-14 — vá từ 2.5.3]: bài/bình luận di trú có thể có `authorUid` null/không hợp lệ — `.doc(null)` ném lỗi đồng bộ làm CẢ danh sách trả 500. Chỉ tra cứu uid hợp lệ; còn lại `author: null`.
  const uids = [...new Set(posts.map((p) => p.authorUid).filter(isSafeDocId))];
  const authorDocs = await Promise.all(
    uids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid).get())
  );
  const authorMap = {};
  authorDocs.forEach((d) => {
    if (d.exists) authorMap[d.id] = toPublicUser(d.data());
  });
  return posts.map((p) => ({ ...p, author: (isSafeDocId(p.authorUid) && authorMap[p.authorUid]) || null }));
}

/**
 * Chuẩn hoá Firestore Timestamp / Date / object {_seconds} thành ISO string.
 * Tránh lỗi EJS in ra "[object Object]" khi SSR.
 */
function toIsoString(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      /* fall through */
    }
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  return null;
}

function formatCardPost(p) {
  // Dữ liệu cho card bài viết trên trang INDEX (không cần full content)
  return {
    id: p.id,
    author: p.author,
    title: p.title,
    excerpt: p.excerpt || htmlToExcerpt(p.contentHtml),
    coverImageUrl: p.coverImageUrl,
    // v0.9.7 — hashtag bài viết
    hashtags: p.hashtags || [],
    likeCount: p.likeCount,
    dislikeCount: p.dislikeCount,
    commentCount: p.commentCount,
    // Card chỉ HIỂN THỊ view/share, không làm tăng (chỉ trang POST mới tăng)
    viewCount: p.viewCount || 0,
    aiViewCount: p.aiViewCount || 0,
    shareCount: p.shareCount || 0,
    // Điểm bài viết — LUÔN tính lại từ 5 thông số gốc ở trên, không lưu
    // riêng (xem utils/helpers.js#computePostScore).
    postScore: computePostScore(p),
    createdAt: toIsoString(p.createdAt),
  };
}

function formatFullPost(p) {
  return {
    id: p.id,
    author: p.author,
    title: p.title,
    contentHtml: p.contentHtml,
    // Luôn có excerpt cho meta description / OG (kể cả bài cũ chưa lưu excerpt)
    excerpt: p.excerpt || htmlToExcerpt(p.contentHtml),
    coverImageUrl: p.coverImageUrl,
    // v0.9.7 — hashtag bài viết
    hashtags: p.hashtags || [],
    likeCount: p.likeCount || 0,
    dislikeCount: p.dislikeCount || 0,
    commentCount: p.commentCount || 0,
    viewCount: p.viewCount || 0,
    aiViewCount: p.aiViewCount || 0,
    shareCount: p.shareCount || 0,
    postScore: computePostScore(p),
    createdAt: toIsoString(p.createdAt),
    updatedAt: toIsoString(p.updatedAt),
  };
}

module.exports = {
  createPost,
  listPosts,
  getPost,
  updatePost,
  deletePost,
  attachAuthors,
  formatFullPost,
  formatCardPost,
};
