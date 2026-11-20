import React, { useState } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import PostCard from "./PostCard";
import CommentModal from "./CommentModal";
import { postsApi, blogsApi } from "../api/content.api";
import useIncrementalReveal from "../hooks/useIncrementalReveal";

/**
 * ==== v0.10.8 — danh sách bài viết dùng chung cho tab Hashtag / Tìm kiếm ====
 * Khác với IndexPage/BlogPage (chỉ toàn "post" hoặc toàn "blog"), danh sách ở
 * đây có thể TRỘN cả 2 loại (mỗi item có `type: "post"|"blog"` từ backend —
 * xem trending.controller.js#formatContentCards) — nên `api`/`collectionName`
 * cho CommentModal phải được chọn LẠI mỗi khi mở modal, không cố định như
 * IndexPage.
 *
 * v0.10.8.2 — `posts` đã là TOÀN BỘ kết quả (tối đa 100/50, backend giới hạn
 * sẵn, không phân trang qua API). Để tránh dựng sẵn hàng chục PostCard (ảnh,
 * nội dung...) cùng lúc, chỉ render dần theo `useIncrementalReveal` — cùng
 * page size 10 như IndexPage/BlogPage, lộ thêm khi cuộn gần tới cuối danh
 * sách đang hiển thị (không gọi lại API).
 */
export default function HashtagPostList({ posts = [], loading = false, emptyHint = "Không có bài viết nào." }) {
  const [commentTarget, setCommentTarget] = useState(null); // { post, api, collectionName }
  // v0.10.8.2 — Hook PHẢI gọi trước mọi return sớm bên dưới (Rules of Hooks).
  const { visibleCount, sentinelRef, hasMore } = useIncrementalReveal(posts.length, 10);

  const handleCommentCountChange = (delta) => {
    if (!commentTarget) return;
    setCommentTarget((prev) =>
      prev ? { ...prev, post: { ...prev.post, commentCount: (prev.post.commentCount || 0) + delta } } : prev
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!posts.length) {
    return (
      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
        {emptyHint}
      </Typography>
    );
  }

  const visiblePosts = posts.slice(0, visibleCount);

  return (
    <>
      {visiblePosts.map((post) => {
        const isBlog = post.type === "blog";
        const api = isBlog ? blogsApi : postsApi;
        const detailPath = post.detailPath || (isBlog ? "/blog" : "/post");
        return (
          <PostCard
            key={`${post.type || "post"}:${post.id}`}
            post={post}
            api={api}
            detailPath={detailPath}
            onOpenComments={(p) =>
              setCommentTarget({ post: p, api, collectionName: isBlog ? "blogs" : "posts" })
            }
          />
        );
      })}

      {hasMore && (
        <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={22} />
        </Box>
      )}

      <CommentModal
        open={!!commentTarget}
        onClose={() => setCommentTarget(null)}
        post={commentTarget?.post || null}
        api={commentTarget?.api}
        collectionName={commentTarget?.collectionName}
        onCommentCountChange={handleCommentCountChange}
      />
    </>
  );
}
