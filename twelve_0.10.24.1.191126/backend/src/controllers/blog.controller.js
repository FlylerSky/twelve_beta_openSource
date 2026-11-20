const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS } = require("../utils/constants");
const { sanitizeContentAsync } = require("../services/sanitize.service");
const { attachAuthors } = require("./posts.controller");
const { registerView, parseShareQuery, registerShare, viewerKeyFromRequest, computePostScore, syncPostScore, syncPostScoresBatch, postsScoreSumWrite, reconcilePostsScoreSum, positiveScoreWrite, positiveScoreLogWrite, validateTitle, validateCoverImageUrl, validateHashtags } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

/**
 * Chuẩn hoá Firestore Timestamp / Date / object {_seconds} thành ISO string.
 * Tránh lỗi EJS in ra "[object Object]" khi SSR và frontend formatRelativeTime
 * không parse được Timestamp object.
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

/**
 * POST /api/blogs  (chỉ SA)
 */
async function createBlog(req, res) {
  try {
    const { title, contentHtml, coverImageUrl, hashtags } = req.body;
    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Cần có tiêu đề và nội dung bài blog." });
    }
    // v0.9.6 [MEDIUM]: title trước đây không giới hạn độ dài tối đa.
    const titleErr = validateTitle(title);
    if (titleErr) return res.status(400).json({ error: titleErr });
    const coverErr = validateCoverImageUrl(coverImageUrl);
    if (coverErr) return res.status(400).json({ error: coverErr });
    // v0.9.7 — hashtag bài blog
    const { error: hashtagErr, hashtags: cleanHashtags } = validateHashtags(hashtags);
    if (hashtagErr) return res.status(400).json({ error: hashtagErr });

    // Twelve 1.1 — BACKPORT F1 (CRITICAL): sanitize async worker, timeout 3s.
    let cleanHtml, excerpt;
    try {
      const r = await sanitizeContentAsync(contentHtml);
      cleanHtml = r.cleanHtml;
      excerpt = r.excerpt;
    } catch (sanErr) {
      const status = sanErr.code === "SANITIZE_TIMEOUT" ? 503 : 422;
      return res.status(status).json({ error: sanErr.message || "Nội dung không hợp lệ." });
    }
    const ref = db.collection(COLLECTIONS.BLOGS).doc();

    const blogData = {
      id: ref.id,
      authorUid: req.authUid,
      title: title.trim(),
      contentHtml: cleanHtml,
      excerpt,
      coverImageUrl: coverImageUrl || null,
      // v0.9.7 — hashtag bài blog, dạng ["#tag1", "#tag2"], tối đa 20 tag.
      hashtags: cleanHashtags,
      likeCount: 0,
      dislikeCount: 0,
      commentCount: 0,
      viewCount: 0,
      aiViewCount: 0,
      shareCount: 0,
      postScore: 0,
      // ==== v0.8.25 [CRITICAL] ====
      // externalPostScore: chỉ tính điểm từ tương tác của NGƯỜI KHÁC tác giả.
      externalPostScore: 0,
      isPublished: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // ĐIỂM TÍCH CỰC (v0.8.17): +1 cho tác giả (SA) khi đăng blog — cùng quy
    // tắc "đăng bài" áp dụng cho posts, ghi atomic bằng batch — xem giải
    // thích chi tiết ở posts.controller.js#createPost.
    const pw = positiveScoreWrite(db, admin, req.authUid, 1);
    const batch = db.batch();
    batch.set(ref, blogData);
    if (pw) batch.set(pw.ref, pw.data, { merge: true });
    // AUDIT LOG (v0.8.25): ghi lại chi tiết lần cộng điểm khi đăng blog
    const lw = positiveScoreLogWrite(db, admin, req.authUid, 1, "create_blog", {
      collection: COLLECTIONS.BLOGS,
      docId: ref.id,
    });
    if (lw) batch.set(lw.ref, lw.data);
    await batch.commit();

    return res.status(201).json({ message: "Đăng bài blog thành công.", blogId: ref.id });
  } catch (err) {
    console.error("createBlog error:", err);
    return res.status(500).json({ error: "Đăng bài blog thất bại." });
  }
}

/**
 * GET /api/blogs?cursor=&limit=
 * Công khai — ai cũng xem được danh sách blog (chỉ SA mới đăng/sửa/xóa được).
 */
async function listBlogs(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    let query = db
      .collection(COLLECTIONS.BLOGS)
      .where("isPublished", "==", true)
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (req.query.cursor) {
      const cursorSnap = await db.collection(COLLECTIONS.BLOGS).doc(req.query.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.get();
    const blogs = await attachAuthors(snap.docs.map((d) => d.data()));

    // v0.8.18: xem giải thích chi tiết ở posts.controller.js#listPosts —
    // cùng lỗi/cùng cách vá, chỉ khác collection.
    let myReactionByBlogId = {};
    if (req.authUid && blogs.length) {
      const refs = blogs.map((b) =>
        db.collection(COLLECTIONS.BLOGS).doc(b.id).collection(SUBCOLLECTIONS.REACTIONS).doc(req.authUid)
      );
      const reactionSnaps = await db.getAll(...refs);
      reactionSnaps.forEach((rSnap, i) => {
        if (rSnap.exists) myReactionByBlogId[blogs[i].id] = rSnap.data().type;
      });
    }

    const formatted = blogs.map((b) => ({
      id: b.id,
      author: b.author,
      title: b.title,
      excerpt: b.excerpt,
      coverImageUrl: b.coverImageUrl,
      // v0.9.7 — hashtag bài blog
      hashtags: b.hashtags || [],
      likeCount: b.likeCount,
      dislikeCount: b.dislikeCount,
      commentCount: b.commentCount,
      // Card chỉ HIỂN THỊ view/share, không làm tăng (chỉ trang blog chi tiết mới tăng)
      viewCount: b.viewCount || 0,
      aiViewCount: b.aiViewCount || 0,
      shareCount: b.shareCount || 0,
      postScore: computePostScore(b),
      createdAt: toIsoString(b.createdAt),
      myReaction: myReactionByBlogId[b.id] || null,
    }));

    // Đồng bộ cache postScore (song song, không chặn response) — xem
    // utils/helpers.js#syncPostScoresBatch.
    syncPostScoresBatch(
      db,
      admin,
      COLLECTIONS.BLOGS,
      blogs.map((b, i) => ({ id: b.id, score: formatted[i].postScore, storedScore: b.postScore, authorUid: b.authorUid }))
    );

    return res.json({
      blogs: formatted,
      nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
    });
  } catch (err) {
    console.error("listBlogs error:", err);
    return res.status(500).json({ error: "Không tải được danh sách blog." });
  }
}

/**
 * GET /api/blogs/:id  -> dùng chung trang POST để hiển thị (SSR ở route riêng, xem views/post.ejs)
 */
async function getBlog(req, res) {
  try {
    const snap = await db.collection(COLLECTIONS.BLOGS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài blog." });

    const blogData = snap.data();
    const [full] = await attachAuthors([blogData]);

    // Tính VIEW: chỉ khi xem trang blog chi tiết mới tính, giống cơ chế ở
    // posts.controller.getPost — mọi đối tượng xem đều được tính (kể cả khách
    // chưa đăng nhập, route dùng optionalAuth). Chống bơm view ảo (vá báo cáo
    // bảo mật #5) bằng dedupe theo viewerKey, xem utils/helpers.js#registerView.
    const viewCounted = await registerView(db, admin, COLLECTIONS.BLOGS, req.params.id, {
      viewerKey: viewerKeyFromRequest(req),
      isAi: false,
      viewerUid: req.authUid || null,
      authorUid: blogData.authorUid,
    });

    // Tính SHARE: xem giải thích chi tiết ở posts.controller.js#getPost.
    const { isShareLink, rawSharerUid, signature } = parseShareQuery(req.query);
    let shareCounted = false;
    if (isShareLink) {
      const shareResult = await registerShare(db, admin, COLLECTIONS.BLOGS, req.params.id, {
        rawSharerUid,
        signature,
        authorUid: blogData.authorUid,
        source: "web",
        viewerKey: viewerKeyFromRequest(req),
        viewerUid: req.authUid || null,
      });
      shareCounted = shareResult.counted;
    }

    const finalBlog = {
      ...full,
      viewCount: (blogData.viewCount || 0) + (viewCounted ? 1 : 0),
      aiViewCount: blogData.aiViewCount || 0,
      shareCount: (blogData.shareCount || 0) + (shareCounted ? 1 : 0),
    };
    // postScore PHẢI tính SAU khi đã gán view/share mới nhất ở trên — xem
    // giải thích chi tiết ở posts.controller.js#getPost.
    finalBlog.postScore = computePostScore(finalBlog);
    // Đồng bộ cache trong Firestore (song song, không chặn response).
    syncPostScore(db, admin, COLLECTIONS.BLOGS, req.params.id, finalBlog.postScore, blogData.postScore, blogData.authorUid);

    return res.json({ blog: finalBlog });
  } catch (err) {
    console.error("getBlog error:", err);
    return res.status(500).json({ error: "Không tải được bài blog." });
  }
}

/**
 * PATCH /api/blogs/:id (chỉ SA)
 */
async function updateBlog(req, res) {
  try {
    const ref = db.collection(COLLECTIONS.BLOGS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài blog." });

    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (req.body.title) {
      const titleErr = validateTitle(req.body.title);
      if (titleErr) return res.status(400).json({ error: titleErr });
      updates.title = req.body.title.trim();
    }
    if (req.body.contentHtml) {
      // Twelve 1.1 — BACKPORT F1: sanitize async (worker, timeout 3s).
      try {
        const r = await sanitizeContentAsync(req.body.contentHtml);
        updates.contentHtml = r.cleanHtml;
        updates.excerpt = r.excerpt;
      } catch (sanErr) {
        const status = sanErr.code === "SANITIZE_TIMEOUT" ? 503 : 422;
        return res.status(status).json({ error: sanErr.message || "Nội dung không hợp lệ." });
      }
    }
    if (req.body.coverImageUrl !== undefined) {
      const coverErr = validateCoverImageUrl(req.body.coverImageUrl);
      if (coverErr) return res.status(400).json({ error: coverErr });
      updates.coverImageUrl = req.body.coverImageUrl || null;
    }
    if (req.body.hashtags !== undefined) {
      const { error: hashtagErr, hashtags: cleanHashtags } = validateHashtags(req.body.hashtags);
      if (hashtagErr) return res.status(400).json({ error: hashtagErr });
      updates.hashtags = cleanHashtags;
    }
    if (req.body.isPublished !== undefined) updates.isPublished = !!req.body.isPublished;

    await ref.update(updates);
    return res.json({ message: "Cập nhật bài blog thành công." });
  } catch (err) {
    console.error("updateBlog error:", err);
    return res.status(500).json({ error: "Cập nhật thất bại." });
  }
}

/**
 * DELETE /api/blogs/:id (chỉ SA)
 */
async function deleteBlog(req, res) {
  try {
    const ref = db.collection(COLLECTIONS.BLOGS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bài blog." });

    // Xoá bài + trừ đúng phần đóng góp khỏi postsScoreSum của tác giả — xem
    // giải thích chi tiết ở posts.controller.js#deletePost.
    let deletedAuthorUid = null;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (!freshSnap.exists) return;

      const freshData = freshSnap.data();
      const currentScore = computePostScore(freshData);
      // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
      // Khi xoá blog, trừ đúng `externalPostScore` (chỉ điểm từ người khác)
      // khỏi postsScoreSum.
      const externalScoreToRemove = freshData.externalPostScore || 0;

      tx.delete(ref);

      const w = postsScoreSumWrite(db, admin, freshData.authorUid, -externalScoreToRemove);
      if (w) tx.set(w.ref, w.data, { merge: true });
      deletedAuthorUid = freshData.authorUid;

      // ĐIỂM TÍCH CỰC (v0.8.17): -1 cho tác giả khi xoá blog — xem
      // posts.controller.js#deletePost.
      const pw = positiveScoreWrite(db, admin, freshData.authorUid, -1);
      if (pw) tx.set(pw.ref, pw.data, { merge: true });
      // AUDIT LOG (v0.8.25): ghi lại chi tiết lần trừ điểm khi xoá blog
      const lw = positiveScoreLogWrite(db, admin, freshData.authorUid, -1, "delete_blog", {
        collection: COLLECTIONS.BLOGS,
        docId: req.params.id,
      });
      if (lw) tx.set(lw.ref, lw.data);
    });

    // v0.8.14: đối soát lại bằng aggregation query — xem
    // posts.controller.js#deletePost.
    if (deletedAuthorUid) reconcilePostsScoreSum(db, admin, deletedAuthorUid).catch(() => {});

    return res.json({ message: "Đã xóa bài blog." });
  } catch (err) {
    console.error("deleteBlog error:", err);
    return res.status(500).json({ error: "Xóa thất bại." });
  }
}

module.exports = { createBlog, listBlogs, getBlog, updateBlog, deleteBlog };
