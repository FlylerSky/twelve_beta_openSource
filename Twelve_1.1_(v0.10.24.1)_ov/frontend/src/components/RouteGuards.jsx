import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { useAuth } from "../context/AuthContext";

// Chặn truy cập nếu chưa đăng nhập
export function RequireAuth({ children }) {
  const { isAuthReady, isLoggedIn, loadingProfile } = useAuth();
  const location = useLocation();

  // ==== VÁ v0.8.9 ====
  // TRƯỚC ĐÂY: chỉ chờ `isAuthReady` (Firebase đã xác định có/không có
  // session) rồi quyết định NGAY — không chờ `loadingProfile` như
  // `RequireSA` bên dưới đã làm đúng. Vì `isLoggedIn` phụ thuộc vào
  // `profile` (được tải BẤT ĐỒNG BỘ, riêng biệt, SAU khi `isAuthReady`
  // chuyển true), có một khoảng thời gian ngắn hoàn toàn bình thường (chưa
  // cần tới lỗi mạng/cold-start) mà `isAuthReady === true` nhưng
  // `profile === null` — route này khi đó kết luận nhầm "chưa đăng nhập"
  // và redirect một tài khoản active thật về /login, đặc biệt dễ gặp khi
  // vào thẳng URL của route được bảo vệ (F5, mở link) thay vì điều hướng
  // từ trong app. Thêm điều kiện chờ `loadingProfile` giống hệt `RequireSA`
  // để nhất quán.
  if (!isAuthReady || loadingProfile) return <FullscreenLoader />;
  if (!isLoggedIn) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// Chặn truy cập nếu không thuộc nhóm SA (dùng cho khu vực quản trị trang Blog)
export function RequireSA({ children }) {
  const { isAuthReady, isLoggedIn, isSA, loadingProfile } = useAuth();
  const location = useLocation();

  if (!isAuthReady || loadingProfile) return <FullscreenLoader />;
  if (!isLoggedIn) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isSA) return <Navigate to="/" replace />;
  return children;
}

export function FullscreenLoader() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
      <CircularProgress />
    </Box>
  );
}
