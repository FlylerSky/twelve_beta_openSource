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
  label = "Dán URL ảnh, video (mp4/webm), YouTube, Vimeo, hoặc trang web muốn nhúng:",
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
