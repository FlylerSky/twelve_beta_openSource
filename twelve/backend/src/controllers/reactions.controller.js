const { db, admin } = require("../config/firebase");
const { SUBCOLLECTIONS, REACTION_TYPE } = require("../utils/constants");
const { computePostScore, postsScoreSumWrite } = require("../utils/helpers");

const FieldValue = admin.firestore.FieldValue;

/**
 * Factory: react(collectionName) -> Express handler
 * body: { type: "like" | "dislike" }
 * Bấm lại cùng loại reaction sẽ hủy reaction (toggle off).
 * Dùng chung cho COLLECTIONS.POSTS và COLLECTIONS.BLOGS.
 */
function react(collectionName) {
  return async (req, res) => {
    try {
      const { type } = req.body;
      if (![REACTION_TYPE.LIKE, REACTION_TYPE.DISLIKE].includes(type)) {
        return res.status(400).json({ error: "Loại reaction không hợp lệ." });
      }

      const docRef = db.collection(collectionName).doc(req.params.id);
      const reactionRef = docRef.collection(SUBCOLLECTIONS.REACTIONS).doc(req.authUid);

      const newType = await db.runTransaction(async (tx) => {
        const docSnap = await tx.get(docRef);
        if (!docSnap.exists) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });

        const reactionSnap = await tx.get(reactionRef);
        const prevType = reactionSnap.exists ? reactionSnap.data().type : null;

        const inc = { likeCount: 0, dislikeCount: 0 };
        if (prevType) inc[prevType === REACTION_TYPE.LIKE ? "likeCount" : "dislikeCount"] -= 1;

        let result = type;
        if (prevType === type) {
          tx.delete(reactionRef);
          result = null;
        } else {
          tx.set(reactionRef, { type, updatedAt: FieldValue.serverTimestamp() });
          inc[type === REACTION_TYPE.LIKE ? "likeCount" : "dislikeCount"] += 1;
        }

        // postScore: tính ngay TRONG transaction (đã có đủ số liệu MỚI NHẤT
        // từ docSnap + delta inc vừa xác định) — ghi cache song song với
        // likeCount/dislikeCount trong CÙNG 1 lần commit, đảm bảo không lệch
        // pha dù nhiều request like/dislike chạy đồng thời (transaction tự
        // retry khi có xung đột) — xem utils/helpers.js#computePostScore.
        const docData = docSnap.data();
        const newScore = computePostScore({
          viewCount: docData.viewCount || 0,
          likeCount: (docData.likeCount || 0) + inc.likeCount,
          dislikeCount: (docData.dislikeCount || 0) + inc.dislikeCount,
          commentCount: docData.commentCount || 0,
          shareCount: docData.shareCount || 0,
        });

        tx.update(docRef, {
          likeCount: FieldValue.increment(inc.likeCount),
          dislikeCount: FieldValue.increment(inc.dislikeCount),
          postScore: newScore,
        });

        // postsScoreSum (v0.8.8): cộng dồn đúng phần chênh lệch điểm bài viết
        // này vào tổng điểm của tác giả — cùng transaction, atomic.
        const scoreDelta = newScore - (docData.postScore || 0);
        const w = postsScoreSumWrite(db, admin, docData.authorUid, scoreDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });

        return result;
      });

      return res.json({ myReaction: newType });
    } catch (err) {
      if (err.code === "NOT_FOUND") return res.status(404).json({ error: "Không tìm thấy nội dung." });
      console.error("react error:", err);
      return res.status(500).json({ error: "Thao tác thất bại." });
    }
  };
}

module.exports = { react };
