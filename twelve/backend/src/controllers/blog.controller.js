const { db, admin } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");
const { sanitizeHtml, htmlToExcerpt } = require("../services/sanitize.service");
const { attachAuthors } = require("./posts.controller");
const { registerView, parseShareQuery, registerShare, viewerKeyFromRequest, computePostScore, syncPostScore, syncPostScoresBatch, postsScoreSumWrite, reconcilePostsScoreSum } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

/**
 * POST /api/blogs  (chỉ SA)
 */
async function createBlog(req, res) {
  try {
    const { title, contentHtml, coverImageUrl } = req.body;
    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Cần có tiêu đề và nội dung bài blog." });
    }

    const cleanHtml = sanitizeHtml(contentHtml);
    const ref = db.collection(COLLECTIONS.BLOGS).doc();

    await ref.set({
      id: ref.id,
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
      postScore: 0,
      isPublished: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

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
    const formatted = blogs.map((b) => ({
      id: b.id,
      author: b.author,
      title: b.title,
      excerpt: b.excerpt,
      coverImageUrl: b.coverImageUrl,
      likeCount: b.likeCount,
      dislikeCount: b.dislikeCount,
      commentCount: b.commentCount,
      // Card chỉ HIỂN THỊ view/share, không làm tăng (chỉ trang blog chi tiết mới tăng)
      viewCount: b.viewCount || 0,
      aiViewCount: b.aiViewCount || 0,
      shareCount: b.shareCount || 0,
      postScore: computePostScore(b),
      createdAt: b.createdAt,
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
    });

    // Tính SHARE: xem giải thích chi tiết ở posts.controller.js#getPost.
    const { isShareLink, rawSharerUid } = parseShareQuery(req.query);
    let shareCounted = false;
    if (isShareLink) {
      shareCounted = await registerShare(db, admin, COLLECTIONS.BLOGS, req.params.id, {
        rawSharerUid,
        authorUid: blogData.authorUid,
        source: "web",
        viewerKey: viewerKeyFromRequest(req),
        viewerUid: req.authUid || null,
      });
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
    if (req.body.title) updates.title = req.body.title.trim();
    if (req.body.contentHtml) {
      updates.contentHtml = sanitizeHtml(req.body.contentHtml);
      updates.excerpt = htmlToExcerpt(updates.contentHtml);
    }
    if (req.body.coverImageUrl !== undefined) updates.coverImageUrl = req.body.coverImageUrl || null;
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

      tx.delete(ref);

      const w = postsScoreSumWrite(db, admin, freshData.authorUid, -currentScore);
      if (w) tx.set(w.ref, w.data, { merge: true });
      deletedAuthorUid = freshData.authorUid;
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
