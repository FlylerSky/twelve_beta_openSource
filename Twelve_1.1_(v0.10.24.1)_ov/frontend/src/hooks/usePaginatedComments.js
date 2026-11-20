import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
import { getPublicProfile } from "../api/users.api";

/**
 * ==== v0.10.17 [HIỆU NĂNG] — tải bình luận theo trang thay vì tải TOÀN BỘ
 * 1 lần; v0.10.17.10 [SỬA LỖI] — khôi phục realtime (thêm/sửa/xoá) ====
 *
 * PHÂN TRANG: tải `pageSize` bình luận CŨ NHẤT trước (cũ ở trên, mới ở dưới —
 * đúng thứ tự hiển thị trước đây), tự tải thêm khi cuộn chạm `sentinelRef`
 * (IntersectionObserver, `rootMargin: "300px"` như `useIncrementalReveal.js`),
 * và có sẵn `loadMore()` để gắn nút "Xem thêm bình luận" (dự phòng khi
 * trình duyệt không hỗ trợ/không kích hoạt observer).
 *
 * REALTIME — 1 listener duy nhất trên `updatedAt`, KHÔNG phụ thuộc tổng số
 * bình luận:
 *   where("updatedAt", ">=", mốc) + orderBy("updatedAt", "desc") + limit(50)
 * Comment MỚI có `updatedAt` = `createdAt`, comment vừa SỬA có `updatedAt`
 * mới → listener chỉ nhận đúng những bình luận thêm/sửa/xoá TỪ LÚC MỞ trở đi
 * (chi phí đọc tỉ lệ với hoạt động thật, không phải với tổng số bình luận).
 * Bản v0.10.17.9 trước đó hỏng realtime vì 2 lỗi (xem README mục -16):
 *   (1) điều kiện chặn "còn trang chưa tải" bị viết NGƯỢC;
 *   (2) query không có `limit` bị `firestore.rules` từ chối
 *       (`allow list: if request.query.limit <= 50`) -> permission-denied.
 * => MỌI query trong file này BẮT BUỘC có `limit(<= 50)`.
 *
 * MỐC THỜI GIAN lấy từ GIỜ SERVER (`serverTimeMs` do `listComments` trả về)
 * trừ 60s dự phòng lệch giờ — KHÔNG dùng đồng hồ máy người dùng (máy lệch giờ
 * sẽ làm mất comment mới). Các comment nằm trong khoảng dự phòng đã có sẵn ở
 * client sẽ chỉ được "vá" lại (idempotent), không bị thêm trùng.
 *
 * QUY TẮC XỬ LÝ SỰ KIỆN (theo id, không theo loại sự kiện):
 *  - id ĐÃ CÓ ở client            -> vá nội dung/isEdited nếu khác (sửa realtime).
 *  - id CHƯA CÓ + đã tải hết trang -> thêm vào cuối (bình luận mới realtime).
 *  - id CHƯA CÓ + còn trang chưa tải -> BỎ QUA: thêm thẳng sẽ tạo "khoảng
 *    trống"; nó sẽ tự xuất hiện đúng vị trí khi cuộn tải tới (REST là nguồn
 *    chuẩn).
 *  - "removed": chỉ coi là XOÁ THẬT khi cửa sổ chưa đầy (`snap.size < 50`) —
 *    khi cửa sổ đầy, "removed" có thể chỉ là comment bị đẩy ra ngoài giới hạn
 *    50 chứ không phải bị xoá.
 *
 * GIỚI HẠN ĐÃ BIẾT: bình luận CŨ (không được sửa/thêm kể từ lúc mở) bị người
 * khác XOÁ sẽ không tự biến mất realtime (phải tải lại). Sửa/thêm thì luôn
 * realtime, kể cả bình luận cũ.
 *
 * @param {object} params
 * @param {object} params.api - postsApi/blogsApi (cần .listComments(id, cursor, limit))
 * @param {string} params.id - id bài viết/blog
 * @param {string} params.collectionName - "posts" | "blogs"
 * @param {boolean} params.active - modal đang mở / trang đã có id
 * @param {object|null} params.profile - user hiện tại (điền author cho comment của chính mình)
 * @param {number} [params.pageSize=20] - PHẢI <= 50 (firestore.rules + backend)
 */

// Khớp `firestore.rules`: allow list: if request.query.limit <= 50
const LIVE_WINDOW_LIMIT = 50;
const LIVE_BASELINE_MARGIN_MS = 60 * 1000;

function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts._seconds === "number") return ts._seconds * 1000;
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function usePaginatedComments({ api, id, collectionName, active, profile, pageSize = 20 }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [ready, setReady] = useState(false); // đã có trang đầu + mốc thời gian realtime

  const cursorRef = useRef(null);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const knownIdsRef = useRef(new Set());
  const baselineMsRef = useRef(0);
  const generationRef = useRef(0); // bỏ qua phản hồi của lần tải đã cũ (đổi bài / mở lại / StrictMode)
  const commentsRef = useRef([]);
  const sentinelRef = useRef(null);
  const containerRef = useRef(null); // phần tử cuộn cha (vd. DialogContent); null = cuộn theo trang

  commentsRef.current = comments;

  const setHasMoreBoth = (v) => {
    hasMoreRef.current = v;
    setHasMore(v);
  };

  const loadFirstPage = useCallback(() => {
    if (!api || !id) return;
    const gen = ++generationRef.current;
    setLoading(true);
    setReady(false);
    setComments([]);
    cursorRef.current = null;
    knownIdsRef.current = new Set();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setHasMoreBoth(true);

    api
      .listComments(id, null, pageSize)
      .then((res) => {
        if (gen !== generationRef.current) return;
        const list = res.comments || [];
        list.forEach((c) => knownIdsRef.current.add(c.id));
        setComments(list);
        cursorRef.current = res.nextCursor || null;
        setHasMoreBoth(!!res.nextCursor && list.length >= pageSize);
        const serverNow = Number(res.serverTimeMs) || Date.now(); // fallback cho backend cũ chưa trả serverTimeMs
        baselineMsRef.current = serverNow - LIVE_BASELINE_MARGIN_MS;
        setReady(true);
      })
      .catch((err) => {
        if (gen === generationRef.current) console.error("usePaginatedComments loadFirstPage error:", err.message);
      })
      .finally(() => {
        if (gen === generationRef.current) setLoading(false);
      });
  }, [api, id, pageSize]);

  const loadFirstPageRef = useRef(loadFirstPage);
  loadFirstPageRef.current = loadFirstPage; // luôn trỏ bản mới nhất (dùng trong callback ổn định)

  const loadMore = useCallback(() => {
    if (!api || !id || !hasMoreRef.current || loadingMoreRef.current || !cursorRef.current) return;
    const gen = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    api
      .listComments(id, cursorRef.current, pageSize)
      .then((res) => {
        if (gen !== generationRef.current) return;
        const list = res.comments || [];
        const fresh = list.filter((c) => !knownIdsRef.current.has(c.id));
        // Trang trả về TOÀN comment đã có = cursor không còn hợp lệ (comment
        // làm cursor đã bị xoá nên backend bỏ qua cursor, trả lại từ đầu) —
        // dừng phân trang để KHÔNG lặp vô hạn.
        if (list.length > 0 && fresh.length === 0) {
          console.warn("usePaginatedComments: trang tiếp theo toàn comment đã có — dừng phân trang.");
          cursorRef.current = null;
          setHasMoreBoth(false);
          return;
        }
        fresh.forEach((c) => knownIdsRef.current.add(c.id));
        setComments((prev) => [...prev, ...fresh]);
        cursorRef.current = res.nextCursor || null;
        setHasMoreBoth(!!res.nextCursor && list.length >= pageSize);
      })
      .catch((err) => {
        if (gen === generationRef.current) console.error("usePaginatedComments loadMore error:", err.message);
      })
      .finally(() => {
        if (gen === generationRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
  }, [api, id, pageSize]);

  // Comment dùng làm cursor bị xoá -> lùi cursor về comment liền trước để
  // trang kế tiếp vẫn tiếp nối đúng (nếu không còn comment nào -> tải lại từ đầu).
  const fixCursorOnRemove = (removedId) => {
    if (cursorRef.current !== removedId) return;
    const list = commentsRef.current;
    const idx = list.findIndex((c) => c.id === removedId);
    cursorRef.current = idx > 0 ? list[idx - 1].id : null;
    if (!cursorRef.current && hasMoreRef.current) setTimeout(() => loadFirstPageRef.current?.(), 0);
  };

  // ---- Tải trang đầu khi bắt đầu active ----
  useEffect(() => {
    if (!active || !id) return undefined;
    loadFirstPage();
    return () => {
      generationRef.current += 1; // huỷ mọi phản hồi đang bay của lần tải này
    };
  }, [active, id, loadFirstPage]);

  // ---- Tự tải thêm khi cuộn chạm sentinel ----
  useEffect(() => {
    if (!active || !ready || !hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: containerRef.current || null, rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, ready, hasMore, comments.length, loadMore]);

  // ---- Realtime thêm/sửa/xoá (xem docblock) ----
  useEffect(() => {
    if (!active || !id || !ready) return undefined;

    const q = query(
      collection(db, collectionName, id, "comments"),
      where("updatedAt", ">=", Timestamp.fromMillis(baselineMsRef.current)),
      orderBy("updatedAt", "desc"),
      limit(LIVE_WINDOW_LIMIT)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const known = knownIdsRef.current;
        const patches = new Map();
        const removals = new Set();
        const appends = [];

        snap.docChanges().forEach((change) => {
          const cid = change.doc.id;
          const data = change.doc.data();
          if (change.type === "removed") {
            if (snap.size < LIVE_WINDOW_LIMIT && known.has(cid)) removals.add(cid);
            return;
          }
          if (known.has(cid)) {
            patches.set(cid, data);
            return;
          }
          if (!hasMoreRef.current) appends.push({ ...data, id: cid }); // còn trang chưa tải -> bỏ qua (xem docblock)
        });

        if (!patches.size && !removals.size && !appends.length) return;

        appends.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
        const missingAuthorUids = new Set();
        appends.forEach((c) => {
          known.add(c.id);
          if (profile && c.authorUid === profile.uid) {
            c.author = profile;
          } else {
            c.author = null;
            missingAuthorUids.add(c.authorUid);
          }
        });
        removals.forEach((cid) => {
          fixCursorOnRemove(cid);
          known.delete(cid);
        });

        setComments((prev) => {
          let next = prev;
          if (removals.size) next = next.filter((c) => !removals.has(c.id));
          if (patches.size) {
            let changed = false;
            const mapped = next.map((c) => {
              const d = patches.get(c.id);
              if (!d) return c;
              if (c.content === d.content && !!c.isEdited === !!d.isEdited) return c;
              changed = true;
              return { ...c, content: d.content, isEdited: !!d.isEdited, updatedAt: d.updatedAt };
            });
            if (changed) next = mapped;
          }
          if (appends.length) next = [...next, ...appends];
          return next;
        });

        // Document Firestore thô chỉ có `authorUid` — lấy hồ sơ công khai cho
        // tác giả KHÁC mới xuất hiện rồi vá vào state.
        missingAuthorUids.forEach((uid) => {
          getPublicProfile(uid)
            .then((author) => {
              setComments((prev) => prev.map((c) => (c.authorUid === uid && !c.author ? { ...c, author } : c)));
            })
            .catch((err) => console.warn("usePaginatedComments: không lấy được hồ sơ tác giả mới:", err.message));
        });
      },
      (err) => console.error(`usePaginatedComments onSnapshot error (${collectionName}/${id}/comments):`, err.code, err.message)
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id, collectionName, ready, profile?.uid]);

  // ---- Thao tác cục bộ cho hành động của CHÍNH người dùng ----
  const appendOwnComment = useCallback((comment) => {
    if (knownIdsRef.current.has(comment.id)) return; // listener realtime có thể đã thêm trước khi API trả về
    knownIdsRef.current.add(comment.id);
    setComments((prev) => [...prev, comment]);
  }, []);

  const updateOwnComment = useCallback((commentId, patch) => {
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, ...patch } : c)));
  }, []);

  const removeComment = useCallback((commentId) => {
    fixCursorOnRemove(commentId);
    knownIdsRef.current.delete(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    comments,
    setComments,
    loading,
    loadingMore,
    hasMore: hasMore && ready,
    loadMore,
    sentinelRef,
    containerRef,
    appendOwnComment,
    updateOwnComment,
    removeComment,
  };
}
