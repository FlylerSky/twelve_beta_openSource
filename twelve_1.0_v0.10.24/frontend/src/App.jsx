import React from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Container, Typography, Button, Box } from "@mui/material";
import Navbar from "./components/Navbar";
import CreatePostModal from "./components/CreatePostModal";
import PendingSessionGate from "./components/PendingSessionGate";
import IndexPage from "./pages/IndexPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import BlogPage from "./pages/BlogPage";
import PostDetailPage from "./pages/PostDetailPage";
import PublicProfilePage from "./pages/PublicProfilePage";
import SettingsPage from "./pages/SettingsPage";
import TrendingPage from "./pages/TrendingPage";
import { postsApi, blogsApi } from "./api/content.api";
import { useCreatePost } from "./context/CreatePostContext";

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
        <Typography variant="h3" fontWeight={700} sx={{ mb: 2 }}>
          404
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Không tìm thấy trang bạn yêu cầu.
        </Typography>
        <Box>
          <Button variant="contained" onClick={() => navigate("/")}>
            Về trang chủ
          </Button>
        </Box>
      </Container>
    </>
  );
}

export default function App() {
  const navigate = useNavigate();
  const { open, closeModal, notifyCreated } = useCreatePost();

  const handleCreated = (id) => {
    notifyCreated(id);
    // Sau khi đăng bài thành công, luôn đưa người dùng về trang INDEX để họ
    // thấy ngay bài viết mới — dù trước đó đang đứng ở bất kỳ trang nào.
    navigate("/");
  };

  return (
    <>
      {/* Giám sát toàn cục: nếu có session Firebase nhưng tài khoản chưa
          active (pending), đưa người dùng về /login ở BẤT KỲ route nào —
          không phụ thuộc cách họ vào app (tab mới, URL trực tiếp...). */}
      <PendingSessionGate />

      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/trending" element={<TrendingPage />} />
        <Route path="/post/:id" element={<PostDetailPage api={postsApi} backPath="/" />} />
        <Route path="/blog/:id" element={<PostDetailPage api={blogsApi} backPath="/blog" />} />
        <Route path="/u/:uid" element={<PublicProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      {/* Modal đăng bài viết được mount 1 lần duy nhất ở đây, có thể mở từ
          Navbar tại BẤT KỲ trang nào thông qua CreatePostContext. */}
      <CreatePostModal
        open={open}
        onClose={closeModal}
        api={postsApi}
        onCreated={handleCreated}
        title="Tạo bài viết mới"
      />
    </>
  );
}
