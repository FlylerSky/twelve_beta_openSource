import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
} from "@mui/material";

/**
 * Dialog custom thay cho window.prompt() khi người dùng chọn chèn media
 * (ảnh / video / YouTube / Vimeo / trang web) trong QuillEditor.
 * Đồng bộ trải nghiệm Material Design với các popup còn lại của Twelve.
 *
 * props:
 * - open, onClose
 * - onSubmit: (url: string) => void
 * - title, label, placeholder (tùy chọn)
 */
export default function MediaUrlDialog({
  open,
  onClose,
  onSubmit,
  title = "Chèn media",
  label = "Dán URL ảnh, video/audio (mp4/webm/mp3...), YouTube, Vimeo, Twitch, SoundCloud, Spotify, hoặc trang web muốn nhúng:",
  placeholder = "https://...",
}) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          m: { xs: 1, sm: 2 },
          width: { xs: "calc(100% - 16px)", sm: "100%" },
          maxWidth: { xs: "calc(100% - 16px)", sm: 600 },
        },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {label}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          variant="outlined"
        />
        {/* v0.10.13 — trang web NGOÀI danh sách nền tảng đã liệt kê ở label
            phía trên nhìn CÓ VẺ hoạt động ngay trong ô xem trước (chưa qua
            kiểm duyệt bảo mật), nhưng sẽ bị loại bỏ khi lưu bài (chặn
            clickjacking/phishing qua iframe lạ) — cảnh báo trước để người
            dùng không bất ngờ khi nội dung "biến mất" sau khi đăng.
            v0.10.16: danh sách domain do SA quản lý giờ áp dụng cho CẢ ảnh/
            video/audio file trực tiếp, không riêng iframe nữa — bỏ khẳng
            định cũ "file trực tiếp luôn được đảm bảo hiển thị" vì không còn
            đúng. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Lưu ý: hệ thống chỉ hiển thị media (kể cả file ảnh/video/audio trực
          tiếp) từ những domain đã được quản trị viên (SA) cho phép. Domain
          không nằm trong danh sách đó có thể bị loại bỏ vì lý do bảo mật dù
          xem trước trông vẫn ổn.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Hủy</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!url.trim()}>
          Chèn
        </Button>
      </DialogActions>
    </Dialog>
  );
}
