import React, { useEffect, useState, useRef } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Stack,
  MenuItem,
  RadioGroup,
  FormControlLabel,
  Radio,
  InputAdornment,
  CircularProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import Navbar from "../components/Navbar";
import { useRegisterPageHeader } from "../context/PageHeaderContext";
import TurnstileWidget from "../components/TurnstileWidget";
import { registerUser, checkTagName } from "../api/auth.api";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { listCountries } from "../api/countries.api";
import { useSnackbar } from "../context/SnackbarContext";

const initialForm = {
  fullName: "",
  displayName: "",
  tagName: "",
  birthday: "",
  gender: "",
  country: "",
  email: "",
  password: "",
};

export default function RegisterPage() {
  useRegisterPageHeader({ title: "Đăng ký", isBrand: false, actions: [] });

  const navigate = useNavigate();
  const snackbar = useSnackbar();

  const [form, setForm] = useState(initialForm);
  const [countries, setCountries] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const [tagStatus, setTagStatus] = useState(null); // null | "checking" | "available" | "taken" | "invalid"
  const tagCheckTimer = useRef(null);

  // captchaToken chỉ thực sự bắt buộc khi có VITE_TURNSTILE_SITE_KEY (xem
  // TurnstileWidget.jsx) — nếu chưa cấu hình, widget không render và
  // captchaRequired = false nên không chặn submit (khớp hành vi backend).
  const captchaRequired = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);
  const [captchaToken, setCaptchaToken] = useState(null);
  const turnstileRef = useRef(null);

  useEffect(() => {
    listCountries().then(setCountries).catch(() => {});
  }, []);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleTagNameChange = (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, tagName: value }));

    clearTimeout(tagCheckTimer.current);
    if (!value.trim()) {
      setTagStatus(null);
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(value.replace(/^@/, ""))) {
      setTagStatus("invalid");
      return;
    }
    setTagStatus("checking");
    tagCheckTimer.current = setTimeout(async () => {
      try {
        const res = await checkTagName(value);
        setTagStatus(res.available ? "available" : "taken");
      } catch {
        setTagStatus(null);
      }
    }, 500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (tagStatus !== "available") {
      snackbar.warning("Vui lòng chọn một Tag Name Search hợp lệ và chưa có người dùng.");
      return;
    }
    if (captchaRequired && !captchaToken) {
      snackbar.warning("Vui lòng hoàn thành xác minh bảo mật (CAPTCHA).");
      return;
    }

    setSubmitting(true);
    try {
      await registerUser({ ...form, captchaToken });
      // ==== VÁ v0.8.13 ====
      // TRƯỚC ĐÂY: tự động gọi `sendEmailVerification()` ngay tại đây, ngay
      // sau khi đăng ký — người dùng chưa hề bấm nút gì để yêu cầu gửi.
      // Theo đúng ý tưởng sản phẩm: chỉ gửi khi người dùng CHỦ ĐỘNG bấm nút
      // "Gửi lại email xác minh" ở dialog trên LoginPage. Ở đây chỉ cần
      // đăng nhập ngầm để có sẵn phiên Firebase (để dialog xác minh có
      // `auth.currentUser` mà thao tác), KHÔNG tự gửi email.
      try {
        await signInWithEmailAndPassword(auth, form.email, form.password);
        snackbar.success(
          "Đăng ký thành công! Vui lòng bấm \"Gửi lại email xác minh\" ở màn hình tiếp theo để nhận email xác minh."
        );
      } catch (signInErr) {
        console.warn("Đăng nhập ngầm sau đăng ký thất bại:", signInErr);
        snackbar.success("Đăng ký thành công! Vui lòng đăng nhập để tiếp tục xác minh email.");
      }
      navigate("/login");
    } catch (err) {
      snackbar.error(err?.response?.data?.error || err.message || "Đăng ký thất bại.");
      // Token Turnstile đã bị "đốt" sau lần verify này (dù backend trả lỗi vì
      // lý do khác, ví dụ email trùng) — reset widget để lấy token mới cho
      // lần thử tiếp theo, nếu không request sau sẽ luôn bị 400 CAPTCHA.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const tagAdornment = () => {
    if (tagStatus === "checking") return <CircularProgress size={18} />;
    if (tagStatus === "available") return <CheckCircleIcon color="success" fontSize="small" />;
    if (tagStatus === "taken" || tagStatus === "invalid") return <CancelIcon color="error" fontSize="small" />;
    return null;
  };

  const tagHelperText = () => {
    if (tagStatus === "invalid")
      return "Chỉ dùng chữ, số, gạch dưới, 3-20 ký tự.";
    if (tagStatus === "taken") return "Tag Name Search này đã có người dùng.";
    if (tagStatus === "available") return "Tag Name Search khả dụng.";
    return "Dạng @username, dùng để tìm kiếm và định danh bạn trên Twelve.";
  };

  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper sx={{ p: 4 }} variant="outlined">
          <Typography variant="h5" fontWeight={700} sx={{ mb: 3, textAlign: "center" }}>
            Tạo tài khoản Twelve
          </Typography>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Tên thật (phục vụ xác minh tài khoản)"
                value={form.fullName}
                onChange={handleChange("fullName")}
                required
                fullWidth
              />
              <TextField
                label="Tên hiển thị"
                value={form.displayName}
                onChange={handleChange("displayName")}
                required
                fullWidth
              />
              <TextField
                label="Tag Name Search"
                placeholder="@username"
                value={form.tagName}
                onChange={handleTagNameChange}
                required
                fullWidth
                helperText={tagHelperText()}
                error={tagStatus === "taken" || tagStatus === "invalid"}
                InputProps={{
                  startAdornment: <InputAdornment position="start">@</InputAdornment>,
                  endAdornment: <InputAdornment position="end">{tagAdornment()}</InputAdornment>,
                }}
              />
              <TextField
                label="Sinh nhật"
                type="date"
                value={form.birthday}
                onChange={handleChange("birthday")}
                InputLabelProps={{ shrink: true }}
                required
                fullWidth
              />

              <Box>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Giới tính
                </Typography>
                <RadioGroup row value={form.gender} onChange={handleChange("gender")}>
                  <FormControlLabel value="male" control={<Radio required />} label="Nam" />
                  <FormControlLabel value="female" control={<Radio />} label="Nữ" />
                  <FormControlLabel value="other" control={<Radio />} label="Khác" />
                </RadioGroup>
              </Box>

              <TextField
                select
                label="Quốc gia"
                value={form.country}
                onChange={handleChange("country")}
                required
                fullWidth
              >
                {countries.map((c) => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                required
                fullWidth
              />
              <TextField
                label="Mật khẩu"
                type="password"
                value={form.password}
                onChange={handleChange("password")}
                required
                fullWidth
                helperText="Tối thiểu 8 ký tự."
              />

              <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={submitting || (captchaRequired && !captchaToken)}
              >
                {submitting ? "Đang đăng ký..." : "Đăng ký"}
              </Button>
            </Stack>
          </Box>

          <Typography variant="body2" sx={{ mt: 3, textAlign: "center" }}>
            Đã có tài khoản?{" "}
            <Link component={RouterLink} to="/login">
              Đăng nhập
            </Link>
          </Typography>
        </Paper>
      </Container>
    </>
  );
}
