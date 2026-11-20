const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS, CONTENT_LIMITS } = require("../utils/constants");
const { toPublicUser, computePostScore, postsScoreSumWrite, positiveScoreWrite, positiveScoreLogWrite } = require("../utils/helpers");
/**
 * ==== v0.10.11 [MEDIUM — báo cáo bảo mật V-002] — HỢP ĐỒNG DỮ LIỆU cho `content` ====
 *
 * `content` của comment được lưu và trả về NGUYÊN VĂN (plain text thô, không
 * chạy qua `sanitizeHtml`/DOMPurify như nội dung post/blog — đúng vì đây
 * không phải HTML từ Quill). Điều này AN TOÀN với cách hiển thị HIỆN TẠI:
 * frontend (`CommentText.jsx`) render `content` như 1 JSX text child thường
 * (`{content}`), React tự escape mọi ký tự đặc biệt khi tạo text node — KHÔNG
 * có `dangerouslySetInnerHTML` nào đọc field này.
 *
 * CẢNH BÁO cho code trong tương lai: nếu bất kỳ nơi nào khác (trang admin,
 * email thông báo, app di động dùng WebView tự render HTML, API công khai
 * cho bên thứ ba...) cần chèn `content` vào 1 trang/khối HTML — BẮT BUỘC gọi
 * `escapeHtml()` (services/sanitize.service.js) tại chính điểm render đó
 * trước khi nội suy vào HTML. KHÔNG escape sẵn ở đây lúc lưu — sẽ làm hỏng
 * hiển thị hiện tại (React không tự giải mã HTML entity, người dùng gõ
 * "1 < 2" sẽ thấy y hệt "1 &lt; 2" trên UI) trong khi bản thân dữ liệu vốn
 * đã an toàn ở nơi duy nhất đang render nó.
 */
const FieldValue = admin.firestore.FieldValue;
const { isHiddenDraft } = require("../utils/visibility");
const { parseLimit, parseCursor, stripBidiAndInvisible, isSafeDocId } = require("../utils/input");

// parentCollection: COLLECTIONS.POSTS hoặc COLLECTIONS.BLOGS
function commentsRef(parentCollection, parentId) {
  return db.collection(parentCollection).doc(parentId).collection(SUBCOLLECTIONS.COMMENTS);
}

/**
 * GET /api/posts/:id/comments?cursor=<commentId>&limit=20 (hoặc /api/blogs/:id/comments)
 * Trả bình luận theo TRANG (cũ nhất trước, giống thứ tự hiển thị hiện tại),
 * phân trang kiểu cursor — CÙNG QUY ƯỚC với `listPosts()` (posts.controller.js).
 *
 * ==== VÁ v0.10.17 [SỬA LỖI/HIỆU NĂNG] — trước bản vá, endpoint này LUÔN trả
 * TOÀN BỘ bình luận của bài viết (`.get()` không `.limit()`) ====
 * Với bài viết có hàng trăm bình luận, mỗi lần mở hộp bình luận (hoặc trang
 * POST) đều tải hết toàn bộ + JOIN author cho từng bình luận — vừa chậm vừa
 * tốn băng thông/lượt đọc Firestore không cần thiết (người dùng thường chỉ
 * xem vài chục bình luận gần nhất). Giờ chỉ trả `limit` bình luận mỗi lần
 * (mặc định `CONTENT_LIMITS.COMMENTS_PAGE_SIZE`, tối đa
 * `COMMENTS_PAGE_SIZE_MAX`) kèm `nextCursor` để frontend tự tải thêm khi
 * cuộn tới cuối danh sách hiện có (xem `usePaginatedComments` — frontend).
 */
function listComments(parentCollection) {
  return async (req, res) => {
    try {
      // v1.1 [BẢO MẬT — vá từ 2.0.4]: bình luận của blog NHÁP không được đọc công khai (chỉ blog mới tốn thêm 1 lượt đọc).
      if (parentCollection === COLLECTIONS.BLOGS) {
        const parentSnap = await db.collection(parentCollection).doc(req.params.id).get();
        if (!parentSnap.exists || isHiddenDraft(parentCollection, parentSnap.data())) {
          return res.status(404).json({ error: "Không tìm thấy bài viết." });
        }
      }
      // v1.1 [F8 — vá từ 2.0.10]: limit/cursor sai kiểu (âm, mảng, chứa "/") trước đây làm Firestore ném lỗi => 500.
      const limit = parseLimit(req.query.limit, CONTENT_LIMITS.COMMENTS_PAGE_SIZE, CONTENT_LIMITS.COMMENTS_PAGE_SIZE_MAX);
      const cursorParsed = parseCursor(req.query.cursor);
      if (!cursorParsed.ok) return res.status(400).json({ error: "Tham số cursor không hợp lệ." });
      let query = commentsRef(parentCollection, req.params.id).orderBy("createdAt", "asc").limit(limit);

      if (cursorParsed.value) {
        const cursorSnap = await commentsRef(parentCollection, req.params.id).doc(cursorParsed.value).get();
        if (cursorSnap.exists) query = query.startAfter(cursorSnap);
      }

      const snap = await query.get();
      const comments = snap.docs.map((d) => d.data());
      // v1.1 [TW-14 — vá từ 2.5.3]: bình luận di trú có thể có `authorUid` null/không hợp lệ — `.doc(null)` ném lỗi đồng bộ làm CẢ trang bình luận trả 500. Chỉ tra cứu uid hợp lệ; còn lại `author: null`.
      const uids = [...new Set(comments.map((c) => c.authorUid).filter(isSafeDocId))];
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
          author: (isSafeDocId(c.authorUid) && authorMap[c.authorUid]) || null,
        })),
        nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
        // v0.10.17.10: mốc GIỜ SERVER để frontend đặt mốc realtime
        // (`usePaginatedComments`) — không phụ thuộc đồng hồ máy người dùng.
        serverTimeMs: Date.now(),
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
      // v1.1 [F8 — vá từ 2.0.10]: content sai kiểu (số, mảng, đối tượng) trước đây làm `.trim()` ném lỗi => 500.
      if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }
      if (content.length > CONTENT_LIMITS.COMMENT_MAX) {
        return res.status(400).json({ error: `Bình luận quá dài (tối đa ${CONTENT_LIMITS.COMMENT_MAX} ký tự).` });
      }

      const parentRef = db.collection(parentCollection).doc(req.params.id);
      const commentRef = commentsRef(parentCollection, req.params.id).doc();
      const commentData = {
        id: commentRef.id,
        authorUid: req.authUid,
        content: stripBidiAndInvisible(content).trim(), // v1.1 [F7]: bỏ ký tự bidi/rộng-0
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
        // v1.1 [vá từ 2.0.4]: không bình luận vào blog nháp (404 như không tồn tại).
        if (isHiddenDraft(parentCollection, parentData)) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
        const newScore = computePostScore({
          viewCount: parentData.viewCount || 0,
          likeCount: parentData.likeCount || 0,
          dislikeCount: parentData.dislikeCount || 0,
          commentCount: (parentData.commentCount || 0) + 1,
          shareCount: parentData.shareCount || 0,
        });

        // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
        // `externalPostScore`: chỉ tính điểm từ comment của NGƯỜI KHÁC tác giả.
        // Trọng số comment = +3 (giống POST_SCORE_WEIGHTS.comment).
        //
        // ==== v1.1 [CHỐNG FARM ĐIỂM — vá từ 2.0.5] ====
        // Chỉ bình luận ĐẦU TIÊN của mỗi (người dùng, bài) mới được cộng điểm (+3 cho tác giả bài, +1 positiveScore cho người bình luận).
        // Các bình luận sau vẫn đăng bình thường nhưng `scored:false`, không sinh điểm => không thể bơm điểm bằng cách spam bình luận
        // (0.10.24: mỗi bình luận đều +3/+1 — số đo ghi trong báo cáo Twelve 2.0.5 là ~3.800 điểm/ngày/tài khoản; chưa đo lại riêng trên 0.10.24 nhưng cơ chế giống hệt). Bình luận cũ không có field `scored` được coi là
        // đã có điểm (xem deleteComment). Đọc này PHẢI nằm trước mọi lệnh ghi (Firestore: đọc trước, ghi sau).
        const isExternal = req.authUid !== parentData.authorUid;
        let earnsScore = false;
        if (isExternal) {
          const prior = await tx.get(
            commentsRef(parentCollection, req.params.id).where("authorUid", "==", req.authUid).limit(1)
          );
          earnsScore = prior.empty;
        }
        commentData.scored = earnsScore;

        const externalDelta = earnsScore ? 3 : 0;
        const newExternalScore = (parentData.externalPostScore || 0) + externalDelta;

        tx.set(commentRef, commentData);
        tx.update(parentRef, {
          commentCount: FieldValue.increment(1),
          postScore: newScore,
          externalPostScore: newExternalScore,
        });

        // postsScoreSum (v0.8.8) — xem giải thích ở reactions.controller.js.
        // Dùng `externalDelta` (chỉ từ người khác) thay vì `scoreDelta`.
        const w = postsScoreSumWrite(db, admin, parentData.authorUid, externalDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });

        // ĐIỂM TÍCH CỰC (v0.8.17): +1 cho NGƯỜI COMMENT (req.authUid). Mỗi
        // lần comment đều +1, kể cả comment nhiều lần vào cùng 1 bài — chống
        // spam comment (nếu có) là việc của comments.controller.js, không
        // phải phạm vi của positiveScore (chỉ quan tâm hành động có hợp lệ
        // hay không, và request này đã qua mọi kiểm tra hợp lệ ở trên).
        //
        // ==== VÁ v0.8.25 [HIGH] — Chặn tự thưởng điểm ====
        // KHÔNG cộng positiveScore nếu người comment CHÍNH LÀ tác giả bài
        // viết — chống tự comment vào bài của mình để farm điểm.
        if (earnsScore) {
          const pw = positiveScoreWrite(db, admin, req.authUid, 1);
          if (pw) tx.set(pw.ref, pw.data, { merge: true });
          // AUDIT LOG (v0.8.25): ghi lại chi tiết lần cộng điểm khi comment
          const lw = positiveScoreLogWrite(db, admin, req.authUid, 1, "add_comment", {
            collection: parentCollection,
            docId: commentRef.id,
            relatedUid: parentData.authorUid,
            meta: { parentDocId: req.params.id },
          });
          if (lw) tx.set(lw.ref, lw.data);
        }
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
      // v1.1 [F8 — vá từ 2.0.10]: content sai kiểu (số, mảng, đối tượng) trước đây làm `.trim()` ném lỗi => 500.
      if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }
      // v0.9.6 [MEDIUM]: editComment trước đây KHÔNG có giới hạn độ dài, dù
      // addComment đã chặn ở COMMENT_MAX ký tự — cho phép tạo comment ngắn
      // rồi sửa dài tuỳ ý để lách giới hạn ban đầu. Áp cùng giới hạn tại đây.
      if (content.length > CONTENT_LIMITS.COMMENT_MAX) {
        return res.status(400).json({ error: `Bình luận quá dài (tối đa ${CONTENT_LIMITS.COMMENT_MAX} ký tự).` });
      }

      const ref = commentsRef(parentCollection, req.params.id).doc(req.params.commentId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Không tìm thấy bình luận." });
      if (snap.data().authorUid !== req.authUid) {
        return res.status(403).json({ error: "Bạn chỉ có thể sửa bình luận của chính mình." });
      }

      await ref.update({
        content: stripBidiAndInvisible(content).trim(),
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
        // ==== VÁ v0.8.25 [CRITICAL] — Chống farm điểm qua postsScoreSum ====
        // `externalPostScore`: chỉ trừ điểm nếu comment gốc là từ NGƯỜI KHÁC
        // tác giả (tức là nó đã từng được cộng +3 vào externalPostScore).
        // Trọng số comment = +3 → xoá = -3.
        // v1.1 [vá từ 2.0.5]: chỉ hoàn điểm cho bình luận ĐÃ được cộng điểm (field `scored` thiếu = bình luận cũ = đã cộng).
        const wasScored = snap.data().scored !== false && snap.data().authorUid !== parentData.authorUid;
        const externalDelta = wasScored ? -3 : 0;
        const newExternalScore = (parentData.externalPostScore || 0) + externalDelta;

        tx.delete(ref);
        tx.update(parentRef, {
          commentCount: FieldValue.increment(-1),
          postScore: newScore,
          externalPostScore: newExternalScore,
        });

        // postsScoreSum (v0.8.8) — xem giải thích ở reactions.controller.js.
        // Dùng `externalDelta` (chỉ từ người khác) thay vì `scoreDelta`.
        const w = postsScoreSumWrite(db, admin, parentData.authorUid, externalDelta);
        if (w) tx.set(w.ref, w.data, { merge: true });

        // ĐIỂM TÍCH CỰC (v0.8.17): -1 cho TÁC GIẢ GỐC CỦA COMMENT
        // (`snap.data().authorUid`) — KHÔNG PHẢI người bấm xóa (`req.authUid`).
        // Quan trọng vì comment có thể bị SA xóa hộ (isSA ở trên) — nếu trừ
        // nhầm điểm của SA thay vì của người đã spam/vi phạm, người này vẫn
        // giữ nguyên điểm ăn gian trong khi SA (người dọn dẹp) bị trừ oan.
        // Việc "xóa" luôn đảo ngược đúng "hành động comment" gốc, không phụ
        // thuộc ai là người thực hiện thao tác xóa.
        //
        // ==== VÁ v0.8.25-hotfix [MEDIUM] — Đồng bộ điều kiện với addComment ====
        // Chỉ trừ -1 điểm nếu hành động comment GỐC thực sự từng được cộng +1
        // ở addComment — tức khi tác giả comment KHÁC tác giả bài viết. Nếu
        // đây là "tự-comment" (addComment đã không cộng điểm do bản vá HIGH
        // v0.8.25), thì deleteComment cũng KHÔNG được trừ điểm — tránh trừ
        // oan vào một điểm chưa từng tồn tại, khiến positiveScore bị âm giả.
        if (wasScored) {
          const pw = positiveScoreWrite(db, admin, snap.data().authorUid, -1);
          if (pw) tx.set(pw.ref, pw.data, { merge: true });
          // AUDIT LOG (v0.8.25): ghi lại chi tiết lần trừ điểm khi xoá comment
          const lw = positiveScoreLogWrite(db, admin, snap.data().authorUid, -1, "delete_comment", {
            collection: parentCollection,
            docId: req.params.commentId,
            relatedUid: parentData.authorUid,
            meta: { parentDocId: req.params.id, deletedBy: req.authUid },
          });
          if (lw) tx.set(lw.ref, lw.data);
        }
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
