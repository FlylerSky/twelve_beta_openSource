import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  TextField,
  Button,
  Box,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import QuillEditor from "./QuillEditor";
import { useSnackbar } from "../context/SnackbarContext";

/**
 * props:
 * - open, onClose
 * - api: postsApi hoặc blogsApi
 * - onCreated: (newId) => void
 * - title: tiêu đề modal, ví dụ "Tạo bài viết mới" / "Tạo bài Blog mới"
 */
export default function CreatePostModal({ open, onClose, api, onCreated, title = "Tạo bài viết mới" }) {
  const snackbar = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [postTitle, setPostTitle] = useState("");
  const [content, setContent] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPostTitle("");
    setContent("");
    setCoverImageUrl("");
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const isEmptyContent = (html) => {
    // Quill trả về "<p><br></p>" khi rỗng
    const text = html?.replace(/<[^>]*>/g, "").trim();
    return !text;
  };

  const handleSubmit = async () => {
    if (!postTitle.trim()) {
      snackbar.warning("Vui lòng nhập tiêu đề bài viết.");
      return;
    }
    if (isEmptyContent(content)) {
      snackbar.warning("Vui lòng nhập nội dung bài viết.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.create({
        title: postTitle.trim(),
        contentHtml: content,
        coverImageUrl: coverImageUrl.trim() || undefined,
      });
      snackbar.success("Đăng bài thành công!");
      reset();
      onClose();
      onCreated?.(res.postId || res.blogId);
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="lg"
      fullScreen={isMobile}
      PaperProps={{
        sx: isMobile
          ? { borderRadius: 0 }
          : {
              width: { sm: "90vw" },
              maxWidth: 960,
              m: 2,
            },
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {title}
        <IconButton onClick={handleClose} edge="end" aria-label="Đóng">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowX: "hidden" }}>
        <TextField
          fullWidth
          label="Tiêu đề bài viết"
          value={postTitle}
          onChange={(e) => setPostTitle(e.target.value)}
          sx={{ mb: 2 }}
          autoFocus
        />

        <TextField
          fullWidth
          label="Ảnh bìa bài viết (dán URL, tỉ lệ 16:9)"
          placeholder="https://..."
          value={coverImageUrl}
          onChange={(e) => setCoverImageUrl(e.target.value)}
          sx={{ mb: 2 }}
        />
        {coverImageUrl && (
          <Box
            component="img"
            src={coverImageUrl}
            alt="Xem trước ảnh bìa"
            sx={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: "12px", mb: 2 }}
            onError={(e) => (e.target.style.display = "none")}
          />
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Nội dung bài viết
        </Typography>
        <QuillEditor value={content} onChange={setContent} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Dùng nút chèn ảnh/video trên thanh công cụ và dán URL — Twelve không upload media trực tiếp trong nội dung bài viết.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleClose} disabled={submitting}>
          Hủy
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Đang đăng..." : "Đăng bài"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
