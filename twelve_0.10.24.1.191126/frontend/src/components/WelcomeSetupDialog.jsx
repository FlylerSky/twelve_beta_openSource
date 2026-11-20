import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Avatar,
  Stack,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import { updateMe, uploadAvatar } from "../api/users.api";
import { listCountries } from "../api/countries.api";
import AvatarCropper from "./AvatarCropper";

export default function WelcomeSetupDialog() {
  const { showWelcome, dismissWelcome, profile, refreshProfile } = useAuth();
  const snackbar = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [countries, setCountries] = useState([]);
  const [form, setForm] = useState({ displayName: "", fullName: "", birthday: "", gender: "", country: "" });
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (showWelcome && profile) {
      setForm({
        displayName: profile.displayName || "",
        fullName: profile.fullName || "",
        birthday: profile.birthday || "",
        gender: profile.gender || "",
        country: profile.country || "",
      });
      setAvatarUrl(profile.avatarUrl || null);
      listCountries().then(setCountries).catch(() => {});
    }
  }, [showWelcome, profile]);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleCropped = async (blob) => {
    try {
      const res = await uploadAvatar(blob);
      setAvatarUrl(res.avatarUrl);
      snackbar.success("Đã cập nhật ảnh đại diện.");
      await refreshProfile();
    } catch (err) {
      console.error("uploadAvatar failed:", err);
      const msg =
        err?.message ||
        err?.response?.data?.error ||
        "Không thể tải ảnh đại diện. Kiểm tra Cloudinary / kết nối mạng.";
      snackbar.error(msg);
      throw err; // để AvatarCropper biết upload thất bại (không đóng dialog nếu muốn)
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMe(form);
      await refreshProfile();
      snackbar.success("Thiết lập tài khoản hoàn tất. Chào mừng bạn đến với Twelve!");
      dismissWelcome();
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={!!showWelcome}
        onClose={dismissWelcome}
        fullWidth
        maxWidth="md"
        fullScreen={isMobile}
        PaperProps={{
          sx: isMobile
            ? { borderRadius: 0 }
            : { m: 2, width: { sm: "90vw" }, maxWidth: 720 },
        }}
      >
        <DialogTitle>Chào mừng bạn đến với Twelve 🎉</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Đây là lần đăng nhập đầu tiên của bạn. Hãy hoàn thiện hồ sơ trước khi bắt đầu (email và mật khẩu không thể thay đổi ở đây).
          </Typography>

          <Stack alignItems="center" sx={{ mb: 3 }}>
            <Avatar src={avatarUrl} sx={{ width: 96, height: 96, mb: 1 }}>
              {form.displayName?.[0]}
            </Avatar>
            <Button size="small" onClick={() => setCropperOpen(true)}>
              Chọn / chỉnh ảnh đại diện
            </Button>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField label="Tên hiển thị" value={form.displayName} onChange={handleChange("displayName")} fullWidth />
            <TextField
              label="Tên thật (dùng để xác minh tài khoản)"
              value={form.fullName}
              onChange={handleChange("fullName")}
              fullWidth
            />
            <TextField
              label="Sinh nhật"
              type="date"
              value={form.birthday}
              onChange={handleChange("birthday")}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField select label="Quốc gia" value={form.country} onChange={handleChange("country")} fullWidth>
              {countries.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Box sx={{ gridColumn: { xs: "1", sm: "1 / -1" } }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Giới tính
              </Typography>
              <RadioGroup row value={form.gender} onChange={handleChange("gender")}>
                <FormControlLabel value="male" control={<Radio />} label="Nam" />
                <FormControlLabel value="female" control={<Radio />} label="Nữ" />
                <FormControlLabel value="other" control={<Radio />} label="Khác" />
              </RadioGroup>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={dismissWelcome}>Để sau</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Hoàn tất"}
          </Button>
        </DialogActions>
      </Dialog>

      <AvatarCropper open={cropperOpen} onClose={() => setCropperOpen(false)} onCropped={handleCropped} />
    </>
  );
}
