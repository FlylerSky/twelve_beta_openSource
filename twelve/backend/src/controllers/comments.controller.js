const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS } = require("../utils/constants");
const { toPublicUser, computePostScore, postsScoreSumWrite } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

// parentCollection: COLLECTIONS.POSTS hoặc COLLECTIONS.BLOGS
function commentsRef(parentCollection, parentId) {
  return db.collection(parentCollection).doc(parentId).collection(SUBCOLLECTIONS.COMMENTS);
}

/**
 * GET /api/posts/:id/comments  (hoặc /api/blogs/:id/comments)
 * Trả toàn bộ comment của bài viết cho modal comment. Nội dung quá dài sẽ được
 * frontend tự thu gọn (line-clamp), backend chỉ trả full text.
 */
function listComments(parentCollection) {
  return async (req, res) => {
    try {
      const snap = await commentsRef(parentCollection, req.params.id)
        .orderBy("createdAt", "asc")
        .get();

      const comments = snap.docs.map((d) => d.data());
      const uids = [...new Set(comments.map((c) => c.authorUid))];
      const authorDocs = await Promise.all(
        uids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid).get())
      );
      const authorMap = {};
      authorDocs.forEach((d) => {
        if (d.exists) authorMap[d.id] = toPublicUser(d.data());
      });

      return res.json({
        comments: comments.map((c) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          isEdited: !!c.isEdited,
          author: authorMap[c.authorUid] || null,
        })),
      });
    } catch (err) {
      console.error("listComments error:", err);
      return res.status(500).json({ error: "Không tải được bình luận." });
    }
  };
}

/**
 * POST /api/posts/:id/comments
 * body: { content }
 */
function addComment(parentCollection) {
  return async (req, res) => {
    try {
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }
      if (content.length > 2000) {
        return res.status(400).json({ error: "Bình luận quá dài (tối đa 2000 ký tự)." });
      }

      const parentRef = db.collection(parentCollection).doc(req.params.id);
      const commentRef = commentsRef(parentCollection, req.params.id).doc();
      const commentData = {
        id: commentRef.id,
        authorUid: req.authUid,
        content: content.trim(),
        isEdited: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Dùng transaction (thay vì batch trần) để đọc số liệu MỚI NHẤT của
      // bài viết ngay trước khi ghi — cần thiết để tính đúng postScore mới
      // (commentCount+1) trong CÙNG 1 lần commit, tự retry nếu có ghi đồng
      // thời khác vào bài viết này — xem utils/helpers.js#computePostScore.
      await db.runTransaction(async (tx) => {
        const parentSnap = await tx.get(parentRef);
        if (!parentSnap.exists) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });

        const parentData = parentSnap.data();
        const newScore = computePostScore({
          viewCount: parentData.viewCount || 0,
          likeCount: parentData.likeCount || 0,
          dislikeCount: parentData.dislikeCount || 0,
          commentCount: (parentData.commentCount || 0) + 1,
          shareCount: parentData.shareCount || 0,
        });

        tx.set(commentRef, commentData);
        tx.update(parentRef, { commentCount: FieldValue.increment(1), postScore: newScore });

        // postsScoreSum (v0.8.8) — xem giải thích ở reactions.controller.js.
        const scoreDelta = newScore - (parentData.postScore || 0);
        const w = postsScoreSumWrite(db, admin, parentData.authorUid, scoreDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });
      });

      return res.status(201).json({ message: "Đã gửi bình luận.", commentId: commentRef.id });
    } catch (err) {
      if (err.code === "NOT_FOUND") return res.status(404).json({ error: "Không tìm thấy bài viết." });
      console.error("addComment error:", err);
      return res.status(500).json({ error: "Gửi bình luận thất bại." });
    }
  };
}

/**
 * PATCH /api/posts/:id/comments/:commentId  (chỉ chủ comment)
 */
function editComment(parentCollection) {
  return async (req, res) => {
    try {
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }

      const ref = commentsRef(parentCollection, req.params.id).doc(req.params.commentId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bình luận." });
      if (snap.data().authorUid !== req.authUid) {
        return res.status(403).json({ error: "Bạn chỉ có thể sửa bình luận của chính mình." });
      }

      await ref.update({
        content: content.trim(),
        isEdited: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return res.json({ message: "Đã cập nhật bình luận." });
    } catch (err) {
      console.error("editComment error:", err);
      return res.status(500).json({ error: "Cập nhật bình luận thất bại." });
    }
  };
}

/**
 * DELETE /api/posts/:id/comments/:commentId (chủ comment hoặc SA)
 */
function deleteComment(parentCollection) {
  return async (req, res) => {
    try {
      const parentRef = db.collection(parentCollection).doc(req.params.id);
      const ref = commentsRef(parentCollection, req.params.id).doc(req.params.commentId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bình luận." });

      const isOwner = snap.data().authorUid === req.authUid;
      const isSA = req.authUser.accountGroup === "SA";
      if (!isOwner && !isSA) {
        return res.status(403).json({ error: "Bạn không có quyền xóa bình luận này." });
      }

      // Transaction — xem giải thích ở addComment() phía trên.
      await db.runTransaction(async (tx) => {
        const parentSnap = await tx.get(parentRef);
        if (!parentSnap.exists) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });

        const parentData = parentSnap.data();
        const newScore = computePostScore({
          viewCount: parentData.viewCount || 0,
          likeCount: parentData.likeCount || 0,
          dislikeCount: parentData.dislikeCount || 0,
          commentCount: Math.max(0, (parentData.commentCount || 0) - 1),
          shareCount: parentData.shareCount || 0,
        });

        tx.delete(ref);
        tx.update(parentRef, { commentCount: FieldValue.increment(-1), postScore: newScore });

        // postsScoreSum (v0.8.8) — xem giải thích ở reactions.controller.js.
        const scoreDelta = newScore - (parentData.postScore || 0);
        const w = postsScoreSumWrite(db, admin, parentData.authorUid, scoreDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });
      });

      return res.json({ message: "Đã xóa bình luận." });
    } catch (err) {
      if (err.code === "NOT_FOUND") return res.status(404).json({ error: "Không tìm thấy bài viết." });
      console.error("deleteComment error:", err);
      return res.status(500).json({ error: "Xóa bình luận thất bại." });
    }
  };
}

module.exports = { listComments, addComment, editComment, deleteComment };
