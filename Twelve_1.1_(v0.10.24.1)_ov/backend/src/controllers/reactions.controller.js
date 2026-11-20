const { db, admin } = require("../config/firebase");
const { SUBCOLLECTIONS, REACTION_TYPE } = require("../utils/constants");
const { computePostScore, postsScoreSumWrite, positiveScoreWrite, positiveScoreLogWrite } = require("../utils/helpers");
const { isHiddenDraft } = require("../utils/visibility");

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
        // v1.1 [BẢO MẬT — vá từ 2.0.4]: không like/dislike blog NHÁP (404 như không tồn tại).
        if (isHiddenDraft(collectionName, docData)) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
        const newScore = computePostScore({
          viewCount: docData.viewCount || 0,
          likeCount: (docData.likeCount || 0) + inc.likeCount,
          dislikeCount: (docData.dislikeCount || 0) + inc.dislikeCount,
          commentCount: docData.commentCount || 0,
          shareCount: docData.shareCount || 0,
        });

        // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
        // `externalPostScore`: chỉ tính điểm từ tương tác của NGƯỜI KHÁC tác
        // giả. Dùng để cộng vào `postsScoreSum`/`accountScore`, thay vì dùng
        // `postScore` vốn bao gồm cả tự tương tác.
        // Trọng số: like = +2, dislike = -2 (giống POST_SCORE_WEIGHTS).
        let externalDelta = 0;
        if (req.authUid !== docData.authorUid) {
          externalDelta = inc.likeCount * 2 + inc.dislikeCount * (-2);
        }
        const newExternalScore = (docData.externalPostScore || 0) + externalDelta;

        tx.update(docRef, {
          likeCount: FieldValue.increment(inc.likeCount),
          dislikeCount: FieldValue.increment(inc.dislikeCount),
          postScore: newScore,
          externalPostScore: newExternalScore,
        });

        // postsScoreSum (v0.8.8): cộng dồn đúng phần chênh lệch điểm bài viết
        // này vào tổng điểm của tác giả — cùng transaction, atomic.
        // Dùng `externalDelta` (chỉ từ người khác) thay vì `scoreDelta` (bao
        // gồm cả tự tương tác) — chống farm điểm.
        const w = postsScoreSumWrite(db, admin, docData.authorUid, externalDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });

        // ==== ĐIỂM TÍCH CỰC (v0.8.17) ====
        // Cộng/trừ cho NGƯỜI THỰC HIỆN (req.authUid) — không phải tác giả bài
        // viết. +1 khi TẠO MỚI 1 reaction (null -> like/dislike), -1 khi GỠ
        // (like/dislike -> null, tức bấm lại đúng loại cũ để toggle-off).
        // Trường hợp CHUYỂN LOẠI (like -> dislike hoặc ngược lại) triệt tiêu
        // lẫn nhau (-1 gỡ loại cũ +1 thêm loại mới = 0) — không ghi gì cả,
        // đúng ý "chuyển loại không phải thêm 1 hành động tích cực mới".
        // Công thức: prevType có giá trị -> -1 (đang gỡ 1 reaction cũ), result
        // có giá trị -> +1 (đang có 1 reaction mới) — cộng lại ra đúng cả 4
        // trường hợp (thêm mới/gỡ/chuyển loại 2 chiều).
        //
        // ==== VÁ v0.8.25 [HIGH] — Chặn tự thưởng điểm ====
        // KHÔNG cộng/trừ positiveScore nếu người thực hiện (req.authUid)
        // CHÍNH LÀ tác giả bài viết — chống tự like/dislike bài của mình
        // để farm điểm.
        let positiveDelta = 0;
        if (req.authUid !== docData.authorUid) {
          positiveDelta = (prevType !== null ? -1 : 0) + (result !== null ? 1 : 0);
        }
        const pw = positiveScoreWrite(db, admin, req.authUid, positiveDelta);
        if (pw) tx.set(pw.ref, pw.data, { merge: true });
        // AUDIT LOG (v0.8.25): ghi lại chi tiết lần thay đổi điểm qua reaction
        if (positiveDelta !== 0) {
          const lw = positiveScoreLogWrite(db, admin, req.authUid, positiveDelta, "react", {
            collection: collectionName,
            docId: req.params.id,
            relatedUid: docData.authorUid,
            meta: { type, prevType, resultType: result },
          });
          if (lw) tx.set(lw.ref, lw.data);
        }

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
