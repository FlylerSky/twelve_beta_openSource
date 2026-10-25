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
import { useAuth } from "../context/AuthContext";

/**
 * props:
 * - open, onClose
 * - api: postsApi hoặc blogsApi
 * - onCreated: (newId) => void
 * - title: tiêu đề modal, ví dụ "Tạo bài viết mới" / "Tạo bài Blog mới"
 */
export default function CreatePostModal({ open, onClose, api, onCreated, title = "Tạo bài viết mới" }) {
  const snackbar = useSnackbar();
  const { refreshProfile } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [postTitle, setPostTitle] = useState("");
  const [content, setContent] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // v0.9.7 — hashtag: "#tag1 #tag2" tách nhau bởi khoảng trắng, tối đa 20 tag.
  // Validate lại y hệt logic backend (utils/helpers.js#validateHashtags) để
  // báo lỗi ngay tại chỗ — nhưng KHÔNG thay thế validate backend, chỉ là
  // phản hồi nhanh cho UX (client-side luôn có thể bị bỏ qua/giả mạo).
  const HASHTAG_MAX_COUNT = 20;
  const HASHTAG_RE = /^#[\p{L}\p{N}_]{1,30}$/u;
  const parseHashtags = (raw) => raw.trim().split(/\s+/).filter(Boolean);
  const hashtagTokens = hashtagsInput.trim() ? parseHashtags(hashtagsInput) : [];
  const invalidHashtag = hashtagTokens.find((t) => !HASHTAG_RE.test(t));

  const reset = () => {
    setPostTitle("");
    setContent("");
    setCoverImageUrl("");
    setHashtagsInput("");
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
    if (hashtagTokens.length > HASHTAG_MAX_COUNT) {
      snackbar.warning(`Tối đa ${HASHTAG_MAX_COUNT} hashtag.`);
      return;
    }
    if (invalidHashtag) {
      snackbar.warning(`Hashtag "${invalidHashtag}" không hợp lệ — phải có dạng #tag, chỉ gồm chữ/số/gạch dưới.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.create({
        title: postTitle.trim(),
        contentHtml: content,
        coverImageUrl: coverImageUrl.trim() || undefined,
        hashtags: hashtagTokens,
      });
      snackbar.success("Đăng bài thành công!");
      // v0.8.23.1: đăng bài làm đổi positiveScore (+1) và postsScoreSum →
      // accountScore — đồng bộ profile để Menu hiển thị Điểm tài khoản đúng ngay.
      refreshProfile?.();
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

        <TextField
          fullWidth
          label="Hashtag (tuỳ chọn)"
          placeholder="#tech #tin_tức #côngnghệ"
          value={hashtagsInput}
          onChange={(e) => setHashtagsInput(e.target.value)}
          error={!!invalidHashtag || hashtagTokens.length > HASHTAG_MAX_COUNT}
          helperText={
            invalidHashtag
              ? `Hashtag "${invalidHashtag}" không hợp lệ — dạng #tag, chỉ chữ/số/gạch dưới, không dấu cách.`
              : hashtagTokens.length > HASHTAG_MAX_COUNT
              ? `Tối đa ${HASHTAG_MAX_COUNT} hashtag (đang có ${hashtagTokens.length}).`
              : `Mỗi hashtag bắt đầu bằng "#", cách nhau bởi khoảng trắng — tối đa ${HASHTAG_MAX_COUNT} hashtag.`
          }
          sx={{ mb: 2 }}
        />

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
