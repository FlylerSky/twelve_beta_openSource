import React, { useEffect, useState, useCallback, useRef } from "react";
import { Container, Box, Button, Typography, CircularProgress } from "@mui/material";
import Navbar from "../components/Navbar";
import { useRegisterPageHeader } from "../context/PageHeaderContext";
import PostCard from "../components/PostCard";
import CommentModal from "../components/CommentModal";
import WelcomeSetupDialog from "../components/WelcomeSetupDialog";
import { postsApi } from "../api/content.api";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import { useCreatePost } from "../context/CreatePostContext";
import { db } from "../firebase";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

export default function IndexPage() {
  useRegisterPageHeader({ title: "Twelve", isBrand: true, actions: [] });



  const { isLoggedIn, isAuthReady } = useAuth();
  const snackbar = useSnackbar();
  const { lastCreated } = useCreatePost();
  const isFirstRender = useRef(true);
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commentPost, setCommentPost] = useState(null);
  // v0.8.24: real-time lắng nghe bài viết mới — hiển thị banner "Có bài mới"
  // giống Facebook/Twitter. `newPostCount` đếm số bài chưa xem.
  const [newPostCount, setNewPostCount] = useState(0);
  const newPostUnsubRef = useRef(null);
  const initialFeedLoadedRef = useRef(false);
  // v0.8.24.1: lưu id của bài mới nhất hiện tại — listener chỉ tăng bộ đếm
  // khi id này thực sự thay đổi (bài HOÀN TOÀN MỚI), không phải khi bài cũ
  // chỉ cập nhật chỉ số (like/comment...). Trước đây mỗi lần likeCount đổi
  // listener cũng kích hoạt → báo nhầm "có bài mới".
  const latestPostIdRef = useRef(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await postsApi.list(null, 10);
      setPosts(res.posts);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor && res.posts.length > 0);
      // v0.8.24: đã xem bài mới → reset bộ đếm + đánh dấu feed đã load xong
      // để listener real-time bên dưới bắt đầu đếm bài MỚI thực sự.
      setNewPostCount(0);
      initialFeedLoadedRef.current = true;
      // v0.8.24.1: lưu id bài mới nhất để listener phân biệt bài mới / cập nhật
      if (res.posts.length > 0) latestPostIdRef.current = res.posts[0].id;
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [snackbar]);

  // v0.8.21.2: ĐỢI `isAuthReady === true` mới gọi loadInitial().
  useEffect(() => {
    if (!isAuthReady) return;
    loadInitial();
  }, [isAuthReady, loadInitial]);

  // v0.8.24: Real-time lắng nghe bài viết MỚI trên toàn hệ thống.
  // Query: lấy bài mới nhất (`orderBy createdAt desc, limit 1`). Listener tự
  // động kích hoạt ngay lần đầu với bài hiện tại (bỏ qua, vì feed vừa load),
  // sau đó chỉ kích hoạt lại khi có bài MỚI hơn bài cũ được đăng → tăng
  // `newPostCount` → hiển thị banner "Có X bài mới".
  // KHÔNG tự động chèn bài mới vào đầu feed (tránh làm xáo trộn vị trí bài
  // người dùng đang đọc) — chỉ hiển thị banner, user chủ động bấm để xem.
  useEffect(() => {
    if (!isAuthReady) return;
    const q = query(
      collection(db, "posts"),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    newPostUnsubRef.current = onSnapshot(
      q,
      (snap) => {
        if (!initialFeedLoadedRef.current) return; // lần đầu: bỏ qua
        if (snap.empty) return;
        const newLatestId = snap.docs[0].id;
        // v0.8.24.1: CHỈ tăng bộ đếm khi id bài mới nhất THỰC SỰ thay đổi
        // (bài HOÀN TOÀN MỚI được đăng). Bỏ qua nếu chỉ là bài cũ cập nhật
        // chỉ số (likeCount, commentCount...) — listener vẫn kích hoạt nhưng
        // id không đổi.
        if (latestPostIdRef.current && newLatestId !== latestPostIdRef.current) {
          latestPostIdRef.current = newLatestId;
          setNewPostCount((prev) => prev + 1);
        }
        // Trường hợp đặc biệt: latestPostIdRef chưa có giá trị (ít xảy ra
        // vì loadInitial đã set), vẫn set để có mốc so sánh sau này.
        if (!latestPostIdRef.current) {
          latestPostIdRef.current = newLatestId;
        }
      },
      (err) => {
        // Fail-soft: nếu lỗi quyền/mạng, app vẫn hoạt động bình thường
        console.error("IndexPage newPost onSnapshot error:", err.code, err.message);
      }
    );
    return () => {
      if (newPostUnsubRef.current) {
        newPostUnsubRef.current();
        newPostUnsubRef.current = null;
      }
    };
  }, [isAuthReady]);

  // Modal "Đăng bài viết" giờ có thể mở từ bất kỳ trang nào.
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
      {/* v0.8.24: Banner thông báo có bài viết mới — giống Facebook/Twitter. */}
      {newPostCount > 0 && (
        <Box
          sx={{
            position: "sticky",
            top: 56,
            zIndex: 10,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            py: 1,
            textAlign: "center",
            cursor: "pointer",
            "&:hover": { bgcolor: "primary.dark" },
            transition: "background-color 0.15s",
          }}
          onClick={loadInitial}
        >
          <Typography variant="body2" fontWeight={600}>
            {newPostCount === 1
              ? "Có 1 bài viết mới — nhấn để xem"
              : `Có ${newPostCount} bài viết mới — nhấn để xem`}
          </Typography>
        </Box>
      )}
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
        collectionName="posts"
        onCommentCountChange={handleCommentCountChange}
      />
    </>
  );
}
