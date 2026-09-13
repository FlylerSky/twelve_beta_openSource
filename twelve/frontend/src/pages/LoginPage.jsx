import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, Link as RouterLink } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Alert,
} from "@mui/material";
import Navbar from "../components/Navbar";
import { auth } from "../firebase";
import { syncActivation } from "../api/auth.api";
import { useSnackbar } from "../context/SnackbarContext";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const snackbar = useSnackbar();
  const { isAuthReady, hasSession, emailVerified, isPending, refreshProfile, reloadEmailVerified } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const redirectTo = location.state?.from?.pathname || "/";

  // ==== VÁ v0.8.6 ====
  // Nếu người dùng có sẵn session Firebase còn `pending` (ví dụ vừa bị
  // PendingSessionGate đưa về đây từ một tab/URL khác, hoặc quay lại trang
  // này sau khi F5), tự mở lại dialog xác minh thay vì hiện form đăng nhập
  // trống — tránh việc họ tưởng nhầm là "chưa đăng nhập" rồi bỏ dở, để lại
  // session pending treo lơ lửng. Theo dõi qua AuthContext (không chỉ đọc
  // `auth.currentUser` một lần lúc mount) vì Firebase khôi phục session bất
  // đồng bộ — `isAuthReady` mới là lúc trạng thái đã ổn định.
  useEffect(() => {
    if (!isAuthReady) return;
    if (hasSession && !emailVerified) {
      setEmail(auth.currentUser?.email || "");
      setVerifyOpen(true);
    } else if (hasSession && emailVerified && isPending) {
      // Email đã verified nhưng đồng bộ status PENDING → ACTIVE ở lần trước
      // chưa thành công (mất mạng, race condition...). Thử lại thay vì để
      // người dùng đứng nhìn liên tục bị đưa về /login mà không rõ lý do.
      refreshProfile();
    }
  }, [isAuthReady, hasSession, emailVerified, isPending, refreshProfile]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);

      // Reload để lấy trạng thái emailVerified mới nhất (sau khi user bấm link)
      // — dùng context để đồng bộ luôn state emailVerified toàn app (v0.8.13).
      const verified = await reloadEmailVerified();

      if (!verified) {
        snackbar.warning(
          "Tài khoản chưa xác minh email. Vui lòng kiểm tra hộp thư hoặc gửi lại email xác minh."
        );
        setVerifyOpen(true);
        // Giữ đăng nhập để có thể gửi lại verification; UI sẽ hạn chế hành động cho đến khi verified
        return;
      }

      // Đã verified → đồng bộ status Firestore PENDING → ACTIVE (nếu cần)
      try {
        await syncActivation();
      } catch (syncErr) {
        // Không chặn đăng nhập nếu sync lỗi (có thể đã ACTIVE sẵn)
        console.warn("syncActivation:", syncErr);
      }

      snackbar.success("Đăng nhập thành công!");
      navigate(redirectTo, { replace: true });
    } catch (err) {
      handleFirebaseError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFirebaseError = (err) => {
    switch (err.code) {
      case "auth/user-disabled":
        snackbar.error("Tài khoản đã bị vô hiệu hóa.");
        break;
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        snackbar.error("Email hoặc mật khẩu không đúng.");
        break;
      case "auth/too-many-requests":
        snackbar.error("Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.");
        break;
      default:
        snackbar.error("Đăng nhập thất bại. Vui lòng thử lại.");
    }
  };

  const handleResendVerification = async () => {
    const user = auth.currentUser;
    if (!user) {
      snackbar.warning("Vui lòng đăng nhập trước để gửi lại email xác minh.");
      return;
    }
    setResending(true);
    try {
      await sendEmailVerification(user);
      snackbar.success(
        "Đã gửi email xác minh. Kiểm tra hộp thư (kể cả spam) và bấm link trong email."
      );
    } catch (err) {
      console.error(err);
      if (err.code === "auth/too-many-requests") {
        snackbar.error("Gửi quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.");
      } else {
        snackbar.error("Không gửi được email xác minh. Thử lại sau.");
      }
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    const user = auth.currentUser;
    if (!user) {
      snackbar.warning("Chưa đăng nhập.");
      return;
    }
    setSyncing(true);
    try {
      // ==== VÁ v0.8.13 ====
      // Dùng `reloadEmailVerified()` của AuthContext thay vì tự
      // `user.reload()` rồi đọc `user.emailVerified` cục bộ — bản cũ mutate
      // đúng object Firebase nhưng KHÔNG cập nhật lại state trong context,
      // khiến `emailVerified` toàn app kẹt ở giá trị cũ suốt phiên (xem giải
      // thích chi tiết ở AuthContext.jsx). Gọi qua context đảm bảo mọi nơi
      // dùng `emailVerified` (kể cả useEffect ở đầu file này) đều thấy giá
      // trị mới ngay sau khi hàm này chạy xong.
      const verified = await reloadEmailVerified();
      if (!verified) {
        snackbar.warning(
          "Email vẫn chưa được xác minh. Hãy mở email Firebase gửi và bấm link xác minh."
        );
        return;
      }
      await syncActivation();
      snackbar.success("Xác minh thành công! Bạn có thể sử dụng tài khoản ngay.");
      setVerifyOpen(false);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      console.error(err);
      snackbar.error("Kiểm tra xác minh thất bại.");
    } finally {
      setSyncing(false);
    }
  };

  const handleCloseVerify = async () => {
    setVerifyOpen(false);
    // Đăng xuất để tránh user PENDING dùng app khi chưa verify
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await signOut(auth);
    }
  };

  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ mt: 6, mb: 8 }}>
        <Paper elevation={2} sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom fontWeight={600}>
            Đăng nhập Twelve
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Dùng email và mật khẩu đã đăng ký. Nếu chưa xác minh email, hệ thống sẽ hướng dẫn bạn.
          </Typography>
          <Box component="form" onSubmit={handleLogin}>
            <Stack spacing={2.5}>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                autoComplete="email"
              />
              <TextField
                label="Mật khẩu"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                autoComplete="current-password"
              />
              <Button type="submit" variant="contained" size="large" disabled={submitting}>
                {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
              <Button variant="text" size="small" onClick={() => setVerifyOpen(true)}>
                Xác minh / gửi email xác minh
              </Button>
            </Stack>
          </Box>
          <Typography variant="body2" sx={{ mt: 3, textAlign: "center" }}>
            Chưa có tài khoản?{" "}
            <Link component={RouterLink} to="/register">
              Đăng ký ngay
            </Link>
          </Typography>
        </Paper>
      </Container>

      <Dialog open={verifyOpen} onClose={handleCloseVerify} fullWidth maxWidth="xs">
        <DialogTitle>Xác minh email</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Twelve dùng <strong>Firebase Authentication</strong> để gửi email xác minh.
            Bạn không cần nhập mã số — chỉ cần mở email và bấm link.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            1. Đăng nhập bằng email/mật khẩu (nếu chưa).
            <br />
            2. Bấm "Gửi email xác minh".
            <br />
            3. Mở hộp thư (và spam), bấm link trong email từ Firebase.
            <br />
            4. Quay lại đây bấm "Tôi đã xác minh".
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              helperText="Email dùng để đăng nhập (đã được gắn với tài khoản hiện tại nếu bạn vừa đăng nhập)."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: "wrap", gap: 1 }}>
          <Button onClick={handleCloseVerify}>Đóng</Button>
          <Button variant="outlined" onClick={handleResendVerification} disabled={resending}>
            {resending ? "Đang gửi..." : "Gửi email xác minh"}
          </Button>
          <Button variant="contained" onClick={handleCheckVerified} disabled={syncing}>
            {syncing ? "Đang kiểm tra..." : "Tôi đã xác minh"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
