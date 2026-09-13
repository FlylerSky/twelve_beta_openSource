import React, { useEffect, useState, useCallback, useRef } from "react";
import { Container, Box, Button, Typography, CircularProgress } from "@mui/material";
import Navbar from "../components/Navbar";
import PostCard from "../components/PostCard";
import CommentModal from "../components/CommentModal";
import WelcomeSetupDialog from "../components/WelcomeSetupDialog";
import { postsApi } from "../api/content.api";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import { useCreatePost } from "../context/CreatePostContext";

export default function IndexPage() {
  const { isLoggedIn } = useAuth();
  const snackbar = useSnackbar();
  const { lastCreated } = useCreatePost();
  const isFirstRender = useRef(true);

  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [commentPost, setCommentPost] = useState(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await postsApi.list(null, 10);
      setPosts(res.posts);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor && res.posts.length > 0);
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [snackbar]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Modal "Đăng bài viết" giờ có thể mở từ bất kỳ trang nào (xem CreatePostContext
  // + App.jsx). Khi có bài mới được tạo (kể cả lúc đang đứng ở trang khác rồi
  // được điều hướng về đây), tự động làm mới lại feed.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (lastCreated) loadInitial();
  }, [lastCreated, loadInitial]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await postsApi.list(cursor, 10);
      setPosts((prev) => [...prev, ...res.posts]);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor && res.posts.length > 0);
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCommentCountChange = (delta) => {
    if (!commentPost) return;
    setPosts((prev) =>
      prev.map((p) => (p.id === commentPost.id ? { ...p, commentCount: (p.commentCount || 0) + delta } : p))
    );
  };

  return (
    <>
      <Navbar />
      {isLoggedIn && <WelcomeSetupDialog />}

      <Container maxWidth="sm" sx={{ py: 3 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : posts.length === 0 ? (
          <Typography variant="body1" color="text.secondary" textAlign="center" sx={{ py: 6 }}>
            Chưa có bài viết nào. Hãy là người đầu tiên chia sẻ trên Twelve!
          </Typography>
        ) : (
          <>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                api={postsApi}
                detailPath="/post"
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

      <CommentModal
        open={!!commentPost}
        onClose={() => setCommentPost(null)}
        post={commentPost}
        api={postsApi}
        onCommentCountChange={handleCommentCountChange}
      />
    </>
  );
}
