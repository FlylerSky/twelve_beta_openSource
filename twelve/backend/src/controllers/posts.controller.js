const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS, REACTION_TYPE } = require("../utils/constants");
const { sanitizeHtml, htmlToExcerpt } = require("../services/sanitize.service");
const { toPublicUser, registerView, parseShareQuery, registerShare, viewerKeyFromRequest, computePostScore, syncPostScore, syncPostScoresBatch, postsScoreSumWrite, reconcilePostsScoreSum } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

/**
 * POST /api/posts
 * body: { title, contentHtml, coverImageUrl? }
 * contentHtml: HTML do Quill.js render ra ở frontend (đã gồm ảnh/video/media chèn qua URL)
 * coverImageUrl: URL do người dùng dán vào (không upload trực tiếp)
 */
async function createPost(req, res) {
  try {
    const { title, contentHtml, coverImageUrl } = req.body;
    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Cần có tiêu đề và nội dung bài viết." });
    }

    const cleanHtml = sanitizeHtml(contentHtml);
    const postRef = db.collection(COLLECTIONS.POSTS).doc();

    const postData = {
      id: postRef.id,
      authorUid: req.authUid,
      title: title.trim(),
      contentHtml: cleanHtml,
      excerpt: htmlToExcerpt(cleanHtml),
      coverImageUrl: coverImageUrl || null,
      likeCount: 0,
      dislikeCount: 0,
      commentCount: 0,
      viewCount: 0,
      aiViewCount: 0,
      shareCount: 0,
      // postScore chỉ là CACHE (xem utils/helpers.js#syncPostScore) — khởi tạo
      // 0 cho nhất quán với các counter khác, không phải nguồn sự thật.
      postScore: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await postRef.set(postData);
    return res.status(201).json({ message: "Đăng bài thành công.", postId: postRef.id });
  } catch (err) {
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
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    let query = db.collection(COLLECTIONS.POSTS).orderBy("createdAt", "desc").limit(limit);

    if (req.query.cursor) {
      const cursorSnap = await db.collection(COLLECTIONS.POSTS).doc(req.query.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.get();
    const posts = await attachAuthors(snap.docs.map((d) => d.data()));
    const formatted = posts.map(formatCardPost);

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
    });

    // Tính SHARE: nếu URL đang mở có ?idu=uid hoặc ?shared=1 (link do
    // POST /api/posts/:id/share tạo ra) thì đây chính là lượt "có người click
    // vào link chia sẻ" — ghi nhận 1 share (xem utils/helpers.js).
    const { isShareLink, rawSharerUid } = parseShareQuery(req.query);
    let shareCounted = false;
    if (isShareLink) {
      shareCounted = await registerShare(db, admin, COLLECTIONS.POSTS, req.params.id, {
        rawSharerUid,
        authorUid: post.authorUid,
        source: "web",
        viewerKey: viewerKeyFromRequest(req),
        viewerUid: req.authUid || null,
      });
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
    if (req.body.title) updates.title = req.body.title.trim();
    if (req.body.contentHtml) {
      updates.contentHtml = sanitizeHtml(req.body.contentHtml);
      updates.excerpt = htmlToExcerpt(updates.contentHtml);
    }
    if (req.body.coverImageUrl !== undefined) updates.coverImageUrl = req.body.coverImageUrl || null;

    await ref.update(updates);
    return res.json({ message: "Cập nhật bài viết thành công." });
  } catch (err) {
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

      tx.delete(ref);

      const w = postsScoreSumWrite(db, admin, freshData.authorUid, -currentScore);
      if (w) tx.set(w.ref, w.data, { merge: true });
      deletedAuthorUid = freshData.authorUid;
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
  const uids = [...new Set(posts.map((p) => p.authorUid))];
  const authorDocs = await Promise.all(
    uids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid).get())
  );
  const authorMap = {};
  authorDocs.forEach((d) => {
    if (d.exists) authorMap[d.id] = toPublicUser(d.data());
  });
  return posts.map((p) => ({ ...p, author: authorMap[p.authorUid] || null }));
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
