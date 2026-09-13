import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
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

const CLAMP_LENGTH = 260;

function CommentText({ content }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > CLAMP_LENGTH;
  const shown = expanded || !isLong ? content : content.slice(0, CLAMP_LENGTH) + "…";

  return (
    <Box>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {shown}
      </Typography>
      {isLong && (
        <Button size="small" sx={{ p: 0, minWidth: 0 }} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Thu gọn" : "Xem thêm"}
        </Button>
      )}
    </Box>
  );
}

/**
 * props:
 * - open, onClose
 * - post: { id, commentCount }
 * - api: postsApi hoặc blogsApi
 * - onCommentCountChange: (delta) => void
 */
export default function CommentModal({ open, onClose, post, api, onCommentCountChange }) {
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

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuComment, setMenuComment] = useState(null);

  useEffect(() => {
    if (!open || !post) return;
    setLoading(true);
    api
      .listComments(post.id)
      .then(setComments)
      .catch((err) => snackbar.error(err.message))
      .finally(() => setLoading(false));
  }, [open, post, api]);

  const handleSend = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const res = await api.addComment(post.id, newComment.trim());
      setComments((prev) => [
        ...prev,
        {
          id: res.commentId,
          content: newComment.trim(),
          createdAt: new Date().toISOString(),
          author: profile,
          isEdited: false,
        },
      ]);
      setNewComment("");
      onCommentCountChange?.(1);
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
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, content: editValue.trim(), isEdited: true } : c))
      );
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
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      onCommentCountChange?.(-1);
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
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Bình luận
        <IconButton onClick={onClose} edge="end" aria-label="Đóng">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: isMobile ? "none" : "60vh", flex: isMobile ? 1 : undefined }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
            Chưa có bình luận nào. Hãy là người đầu tiên bình luận!
          </Typography>
        ) : (
          <Stack spacing={2}>
            {comments.map((c) => (
              <Box key={c.id} sx={{ display: "flex", gap: 1.5 }}>
                <Avatar
                  src={c.author?.avatarUrl}
                  sx={{ width: 36, height: 36, cursor: c.author?.uid ? "pointer" : "default" }}
                  onClick={() => goToProfile(c.author?.uid)}
                >
                  {c.author?.displayName?.[0]}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
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
                        sx={{ cursor: c.author?.uid ? "pointer" : "default" }}
                      />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(c.createdAt)}
                      {c.isEdited ? " (đã sửa)" : ""}
                    </Typography>
                  </Stack>

                  {editingId === c.id ? (
                    <Box sx={{ mt: 0.5 }}>
                      <TextField
                        fullWidth
                        multiline
                        size="small"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                        <Button size="small" variant="contained" onClick={() => saveEdit(c.id)}>
                          Lưu
                        </Button>
                        <Button size="small" onClick={() => setEditingId(null)}>
                          Hủy
                        </Button>
                      </Stack>
                    </Box>
                  ) : (
                    <CommentText content={c.content} />
                  )}
                </Box>

                {isMine(c) && editingId !== c.id && (
                  <IconButton size="small" onClick={(e) => openMenu(e, c)}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>

      {isLoggedIn ? (
        <Box sx={{ p: 2, display: "flex", gap: 1, alignItems: "flex-end" }}>
          <Avatar
            src={profile?.avatarUrl}
            sx={{ width: 32, height: 32, cursor: profile?.uid ? "pointer" : "default" }}
            onClick={() => goToProfile(profile?.uid)}
          >
            {profile?.displayName?.[0]}
          </Avatar>
          <TextField
            fullWidth
            size="small"
            placeholder="Viết bình luận..."
            value={newComment}
            multiline
            maxRows={4}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <IconButton color="primary" onClick={handleSend} disabled={sending || !newComment.trim()}>
            <SendIcon />
          </IconButton>
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
