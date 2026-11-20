import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Paper,
  IconButton,
  Box,
  Avatar,
  Typography,
  TextField,
  Button,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Menu,
  MenuItem,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "../utils/time";
import { resolveAuthActionGate } from "../utils/authGate";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import usePaginatedComments from "../hooks/usePaginatedComments";
import CommentText from "./CommentText";


/**
 * props:
 * - open, onClose
 * - post: { id, commentCount }
 * - api: postsApi hoặc blogsApi
 * - onCommentCountChange: (delta) => void
 */
export default function CommentModal({ open, onClose, post, api, onCommentCountChange, collectionName = "posts" }) {
  const { isLoggedIn, profile, hasSession, profileError, loadingProfile, refreshProfile } = useAuth();
  const snackbar = useSnackbar();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const goToProfile = (uid) => {
    if (!uid) return;
    onClose?.();
    navigate(`/u/${uid}`);
  };

  // v0.10.17: thay toàn bộ state/useEffect tải + realtime bình luận cũ bằng
  // hook dùng chung `usePaginatedComments` (phân trang + tự tải thêm khi
  // cuộn tới cuối — xem docblock trong hook để biết lý do/đánh đổi).
  const {
    comments,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sentinelRef,
    containerRef,
    appendOwnComment,
    updateOwnComment,
    removeComment,
  } = usePaginatedComments({ api, id: post?.id, collectionName, active: open && !!post, profile });

  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuComment, setMenuComment] = useState(null);

  const handleSend = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const content = newComment.trim();
      const res = await api.addComment(post.id, content);
      // v0.10.17: thêm optimistic NGAY (dedupe theo id với listener realtime
      // trong hook — xem `appendOwnComment`) thay vì gọi lại listComments
      // toàn bộ danh sách như trước — giữ đúng tiến trình phân trang đã tải.
      appendOwnComment({
        id: res.commentId,
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isEdited: false,
        author: profile,
      });
      setNewComment("");
      onCommentCountChange?.(1);
      refreshProfile();
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const openMenu = (e, comment) => {
    setMenuAnchor(e.currentTarget);
    setMenuComment(comment);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuComment(null);
  };

  const startEdit = () => {
    setEditingId(menuComment.id);
    setEditValue(menuComment.content);
    closeMenu();
  };

  const saveEdit = async (commentId) => {
    if (!editValue.trim()) return;
    try {
      await api.editComment(post.id, commentId, editValue.trim());
      updateOwnComment(commentId, { content: editValue.trim(), isEdited: true });
      setEditingId(null);
    } catch (err) {
      snackbar.error(err.message);
    }
  };

  const handleDelete = async () => {
    const commentId = menuComment.id;
    closeMenu();
    try {
      await api.deleteComment(post.id, commentId);
      removeComment(commentId);
      onCommentCountChange?.(-1);
      refreshProfile();
    } catch (err) {
      snackbar.error(err.message);
    }
  };

  const isMine = (c) => profile && c.author?.uid === profile.uid;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      PaperProps={{
        sx: isMobile
          ? { borderRadius: 0 }
          : {
              m: 2,
              width: { sm: "90vw" },
              maxWidth: 600,
            },
      }}
    >
      {/* v0.10.22: avatar người đang đăng nhập dời từ hộp soạn lên TRƯỚC chữ "Bình luận"
          (giống header khung bình luận ở PostDetailPage) để ô gõ được rộng tối đa. */}
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1.25 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1 }}>
          {isLoggedIn && (
            <Avatar
              src={profile?.avatarUrl}
              sx={{ width: 36, height: 36, cursor: profile?.uid ? "pointer" : "default", flexShrink: 0 }}
              onClick={() => goToProfile(profile?.uid)}
            >
              {profile?.displayName?.[0]}
            </Avatar>
          )}
          <Box component="span" sx={{ minWidth: 0 }}>
            Bình luận
          </Box>
        </Box>
        <IconButton onClick={onClose} edge="end" aria-label="Đóng" sx={{ flexShrink: 0 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        ref={containerRef}
        sx={{ maxHeight: isMobile ? "none" : "60vh", flex: isMobile ? 1 : undefined, overflowY: "auto" }}
      >
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
            Chưa có bình luận nào. Hãy là người đầu tiên bình luận!
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {comments.map((c) => (
              <Paper
                key={c.id}
                variant="outlined"
                sx={{
                  borderRadius: 1,
                  p: { xs: 1.25, sm: 1.5 },
                  display: "flex",
                  gap: 1.25,
                  alignItems: "flex-start",
                  bgcolor: "background.paper",
                }}
              >
                <Avatar
                  src={c.author?.avatarUrl}
                  sx={{ width: 36, height: 36, cursor: c.author?.uid ? "pointer" : "default", flexShrink: 0 }}
                  onClick={() => goToProfile(c.author?.uid)}
                >
                  {c.author?.displayName?.[0]}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography
                      variant="subtitle2"
                      fontWeight={600}
                      onClick={() => goToProfile(c.author?.uid)}
                      sx={{ cursor: c.author?.uid ? "pointer" : "default", "&:hover": c.author?.uid ? { color: "primary.main" } : {} }}
                    >
                      {c.author?.displayName || "Người dùng Twelve"}
                    </Typography>
                    {c.author?.tagName && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={c.author.tagName}
                        onClick={() => goToProfile(c.author?.uid)}
                        sx={{ cursor: c.author?.uid ? "pointer" : "default", height: 22 }}
                      />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(c.createdAt)}
                      {c.isEdited ? " (đã sửa)" : ""}
                    </Typography>
                  </Stack>

                  {editingId === c.id ? (
                    <Box sx={{ mt: 0.75 }}>
                      <TextField
                        fullWidth
                        multiline
                        size="small"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1 } }}
                      />
                      <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                        <Button size="small" variant="contained" onClick={() => saveEdit(c.id)}>
                          Lưu
                        </Button>
                        <Button size="small" onClick={() => setEditingId(null)}>
                          Hủy
                        </Button>
                      </Stack>
                    </Box>
                  ) : (
                    <Box sx={{ mt: 0.5 }}>
                      <CommentText content={c.content} />
                    </Box>
                  )}
                </Box>

                {isMine(c) && editingId !== c.id && (
                  <IconButton size="small" onClick={(e) => openMenu(e, c)} sx={{ flexShrink: 0, mt: -0.5 }}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )}
              </Paper>
            ))}
            {/* v0.10.17: sentinel cho IntersectionObserver trong usePaginatedComments —
                đặt cuối danh sách, tự tải thêm khi cuộn (trong DialogContent) chạm tới đây. */}
            {hasMore && (
              <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
                {loadingMore ? (
                  <CircularProgress size={20} />
                ) : (
                  <Button size="small" onClick={loadMore}>
                    Xem thêm bình luận
                  </Button>
                )}
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>

      {isLoggedIn ? (
        /* v0.10.22: ô soạn full width; nút gửi nằm TRONG ô, góc dưới phải — chữ không đè lên nút
           (cùng cách làm với ô bình luận ở PostDetailPage). Avatar đã dời lên tiêu đề. */
        <Box
          sx={{
            // v0.10.24: trả lề ngang về 12px như v0.10.22 (thử 24px ở v0.10.23 nhìn ô bị co, không ổn).
            p: 1.5,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ position: "relative" }}>
            <TextField
              fullWidth
              size="small"
              placeholder={
                isMobile
                  ? "Viết bình luận..."
                  : "Viết bình luận... (Shift+Enter xuống dòng, Enter gửi)"
              }
              value={newComment}
              multiline
              // v0.10.23: minRows 2 → 1. Dải pb bên dưới (chừa chỗ cho nút gửi) đã tạo thêm ~1 dòng,
              // nên lúc trống ô cao đúng ~2 dòng; gõ nhiều thì tự giãn tới maxRows.
              minRows={1}
              maxRows={6}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (!isMobile && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  // Chừa góc dưới phải cho nút gửi — chữ không đè icon
                  pb: 4.5,
                  pr: 1,
                  alignItems: "flex-start",
                },
                "& .MuiOutlinedInput-input": {
                  pr: 5,
                },
              }}
            />
            <IconButton
              color="primary"
              onClick={handleSend}
              disabled={sending || !newComment.trim()}
              aria-label="Gửi bình luận"
              sx={{
                position: "absolute",
                right: 6,
                bottom: 6,
                zIndex: 1,
              }}
            >
              <SendIcon />
            </IconButton>
          </Box>
        </Box>
      ) : (
        <Box sx={{ p: 2 }}>
          {/* Vá v0.8.11 — resolveAuthActionGate */}
          {(() => {
            const gate = resolveAuthActionGate({
              isLoggedIn,
              hasSession,
              loadingProfile,
              profile,
              profileError,
            });
            if (gate.kind === "profile_error" || gate.kind === "loading") {
              return (
                <Stack alignItems="center" spacing={1}>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    {gate.message}
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => refreshProfile()}
                  >
                    Thử lại
                  </Button>
                </Stack>
              );
            }
            return (
              <Typography variant="body2" color="text.secondary" textAlign="center">
                {gate.message}
              </Typography>
            );
          })()}
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
        <MenuItem onClick={startEdit}>Sửa bình luận</MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
          Xóa bình luận
        </MenuItem>
      </Menu>
    </Dialog>
  );
}
