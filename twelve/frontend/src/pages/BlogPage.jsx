import React, { useEffect, useState, useCallback } from "react";
import { Container, Box, Button, Typography, CircularProgress, Stack } from "@mui/material";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import Navbar from "../components/Navbar";
import PostCard from "../components/PostCard";
import CreatePostModal from "../components/CreatePostModal";
import CommentModal from "../components/CommentModal";
import { blogsApi } from "../api/content.api";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";

export default function BlogPage() {
  const { isSA } = useAuth();
  const snackbar = useSnackbar();

  const [blogs, setBlogs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [commentPost, setCommentPost] = useState(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await blogsApi.list(null, 10);
      setBlogs(res.blogs);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor && res.blogs.length > 0);
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [snackbar]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await blogsApi.list(cursor, 10);
      setBlogs((prev) => [...prev, ...res.blogs]);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor && res.blogs.length > 0);
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCommentCountChange = (delta) => {
    if (!commentPost) return;
    setBlogs((prev) =>
      prev.map((p) => (p.id === commentPost.id ? { ...p, commentCount: (p.commentCount || 0) + delta } : p))
    );
  };

  return (
    <>
      <Navbar />

      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h5" fontWeight={600}>
            Blog
          </Typography>
          {isSA && (
            <Button startIcon={<AddCircleIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
              Viết Blog
            </Button>
          )}
        </Stack>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : blogs.length === 0 ? (
          <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ py: 6 }}>
            Chưa có bài Blog nào.
          </Typography>
        ) : (
          <>
            {blogs.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                api={blogsApi}
                detailPath="/blog"
                onOpenComments={setCommentPost}
              />
            ))}

            {hasMore && (
              <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
                <Button onClick={loadMore} disabled={loadingMore} variant="outlined">
                  {loadingMore ? "Đang tải..." : "Tải thêm bài viết"}
                </Button>
              </Box>
            )}
          </>
        )}
      </Container>

      {isSA && (
        <CreatePostModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          api={blogsApi}
          onCreated={loadInitial}
          title="Tạo bài Blog mới"
        />
      )}

      <CommentModal
        open={!!commentPost}
        onClose={() => setCommentPost(null)}
        post={commentPost}
        api={blogsApi}
        onCommentCountChange={handleCommentCountChange}
      />
    </>
  );
}
