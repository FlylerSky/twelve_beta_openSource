import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Container,
  Box,
  Typography,
  Avatar,
  Chip,
  Stack,
  IconButton,
  TextField,
  Button,
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
} from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbDownOffAltIcon from "@mui/icons-material/ThumbDownOffAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ShareIcon from "@mui/icons-material/Share";
import GradeIcon from "@mui/icons-material/Grade";
import SendIcon from "@mui/icons-material/Send";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import Navbar from "../components/Navbar";
import MediaLightbox, { collectMediaSlides, findSlideIndex } from "../components/MediaLightbox";
import PostContent from "../components/PostContent";
import ConfirmDialog from "../components/ConfirmDialog";
import ViewStatsPopover from "../components/ViewStatsPopover";
import PostScorePopover from "../components/PostScorePopover";
import EngagementPills from "../components/EngagementPills";
import { formatRelativeTime } from "../utils/time";
import { formatCount } from "../utils/number";
import { getSessionId } from "../utils/session";
import { computePostScore } from "../utils/postScore";
import { dlog, snapshotAuth } from "../utils/debugLog";
import { resolveAuthActionGate } from "../utils/authGate";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";

/**
 * props:
 * - api: postsApi hoặc blogsApi
 * - backPath: nơi quay lại khi không tìm thấy bài viết ("/" hoặc "/blog")
 *
 * LƯU Ý: Trang này là bản React (CSR) tương tác đầy đủ, dùng khi người dùng
 * thật điều hướng trong app. Backend (Node/Express) còn có route SSR riêng
 * (/post/:id, /blog/:id trả về HTML tĩnh) phục vụ Google Bot index nội dung —
 * phần bình luận cố ý KHÔNG được SSR bên đó để tránh nặng tải.
 */
export default function PostDetailPage({ api, backPath = "/" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoggedIn, profile, hasSession, profileError, loadingProfile, refreshProfile } = useAuth();
  const snackbar = useSnackbar();

  const [post, setPost] = useState(null);
  const [myReaction, setMyReaction] = useState(null);
  const [loading, setLoading] = useState(true);

  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuComment, setMenuComment] = useState(null);
  const [postMenuAnchor, setPostMenuAnchor] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [viewStatsAnchor, setViewStatsAnchor] = useState(null);
  const [scoreAnchor, setScoreAnchor] = useState(null);

  // Gallery media của bài (cover + img/video trong content)
  const mediaSlides = React.useMemo(
    () => collectMediaSlides(post?.contentHtml, post?.coverImageUrl),
    [post?.contentHtml, post?.coverImageUrl]
  );

  const openMediaAt = (src) => {
    const idx = findSlideIndex(mediaSlides, src);
    setLightboxIndex(idx);
    setLightboxOpen(true);
  };

  useEffect(() => {
    setLoading(true);

    // SHARE: nếu URL đang mở có ?idu=uid hoặc ?shared=1 (link do nút Share
    // tạo ra), chuyển tiếp cho backend để tính 1 lượt share đúng lúc tính
    // view (xem backend/src/controllers/posts.controller.js#getPost). Đọc
    // trực tiếp từ URL thật (location.search) — không phụ thuộc react-router
    // parse lại — để không bỏ sót khi người dùng dán thẳng link vào trình
    // duyệt (không qua <Link>).
    const searchParams = new URLSearchParams(location.search);
    const idu = searchParams.get("idu");
    const shared = searchParams.get("shared");
    // Kèm sid khi mở link share: mỗi trình duyệt/phiên = tối đa 1 share;
    // người khác (sid khác) vẫn được đếm — không khóa cả đời theo IP.
    const shareQuery =
      idu || shared
        ? {
            ...(idu ? { idu } : { shared }),
            sid: getSessionId(),
          }
        : undefined;

    Promise.all([api.getOne(id, shareQuery), api.listComments(id)])
      .then(([detail, commentList]) => {
        setPost(detail.post || detail.blog);
        setMyReaction(detail.myReaction || null);
        setComments(commentList);

        // Đã tính share (nếu có) — dọn query khỏi thanh địa chỉ để: (1) tải
        // lại trang không bị tính share thêm lần nữa, (2) người dùng không
        // vô tình copy nguyên link kèm ?idu=... của người khác đi chia sẻ tiếp.
        if (shareQuery) {
          navigate(location.pathname, { replace: true });
        }
      })
      .catch((err) => {
        snackbar.error(err.message || "Không tìm thấy bài viết.");
        navigate(backPath);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReact = async (type) => {
    if (!isLoggedIn) {
      const gate = resolveAuthActionGate({
        isLoggedIn,
        hasSession,
        loadingProfile,
        profile,
        profileError,
      });
      dlog.warn("ui", "PostDetail handleReact blocked", snapshotAuth({
        type,
        kind: gate.kind,
        hasSession,
        loadingProfile,
        profileError: profileError || null,
        profileStatus: profile?.status ?? null,
        postId: post?.id || id,
      }));
      snackbar.warning(gate.message);
      if (gate.shouldRefresh) refreshProfile();
      return;
    }
    const prevType = myReaction;
    const prevPost = post;

    setPost((p) => {
      const next = { ...p };
      if (prevType === "like") next.likeCount -= 1;
      if (prevType === "dislike") next.dislikeCount -= 1;
      if (prevType !== type) {
        if (type === "like") next.likeCount += 1;
        if (type === "dislike") next.dislikeCount += 1;
      }
      // Tính lại điểm bài viết ngay theo likeCount/dislikeCount vừa cập nhật
      // lạc quan — giá trị chuẩn vẫn lấy từ server ở lần tải lại tiếp theo.
      next.postScore = computePostScore(next);
      return next;
    });
    setMyReaction(prevType === type ? null : type);

    try {
      await api.react(id, type);
    } catch (err) {
      setPost(prevPost);
      setMyReaction(prevType);
      snackbar.error(err.message);
    }
  };

  // SHARE: chỉ tạo link (không tính share ngay). Ưu tiên Web Share API (mở
  // bảng chia sẻ gốc của hệ điều hành trên mobile); nếu trình duyệt không hỗ
  // trợ (hầu hết desktop) thì copy link vào clipboard.
  const handleShare = async () => {
    try {
      const { shareUrl } = await api.share(id);
      if (navigator.share) {
        try {
          await navigator.share({ title: post?.title, url: shareUrl });
          return;
        } catch (shareErr) {
          if (shareErr?.name === "AbortError") return; // người dùng tự hủy, không phải lỗi
          // Web Share API lỗi thật → rơi xuống copy clipboard bên dưới
        }
      }
      await navigator.clipboard.writeText(shareUrl);
      snackbar.success("Đã sao chép link chia sẻ.");
    } catch (err) {
      snackbar.error(err.message || "Không thể tạo link chia sẻ.");
    }
  };

  const handleSendComment = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const res = await api.addComment(id, newComment.trim());
      setComments((prev) => [
        ...prev,
        { id: res.commentId, content: newComment.trim(), createdAt: new Date().toISOString(), author: profile },
      ]);
      setPost((p) => {
        const next = { ...p, commentCount: (p.commentCount || 0) + 1 };
        next.postScore = computePostScore(next);
        return next;
      });
      setNewComment("");
    } catch (err) {
      snackbar.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const openCommentMenu = (e, c) => {
    setMenuAnchor(e.currentTarget);
    setMenuComment(c);
  };
  const closeCommentMenu = () => {
    setMenuAnchor(null);
    setMenuComment(null);
  };

  const startEditComment = () => {
    setEditingId(menuComment.id);
    setEditValue(menuComment.content);
    closeCommentMenu();
  };

  const saveEditComment = async (commentId) => {
    if (!editValue.trim()) return;
    try {
      await api.editComment(id, commentId, editValue.trim());
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, content: editValue.trim(), isEdited: true } : c))
      );
      setEditingId(null);
    } catch (err) {
      snackbar.error(err.message);
    }
  };

  const handleDeleteComment = async () => {
    const commentId = menuComment.id;
    closeCommentMenu();
    try {
      await api.deleteComment(id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setPost((p) => {
        const next = { ...p, commentCount: Math.max(0, (p.commentCount || 1) - 1) };
        next.postScore = computePostScore(next);
        return next;
      });
    } catch (err) {
      snackbar.error(err.message);
    }
  };

  const handleDeletePost = () => {
    setPostMenuAnchor(null);
    setConfirmDeleteOpen(true);
  };

  const confirmDeletePost = async () => {
    setConfirmDeleteOpen(false);
    try {
      await api.remove(id);
      snackbar.success("Đã xóa bài viết.");
      navigate(backPath);
    } catch (err) {
      snackbar.error(err.message);
    }
  };

  const canManagePost = post && profile && (profile.uid === post.author?.uid || profile.accountGroup === "SA");
  const isMyComment = (c) => profile && c.author?.uid === profile.uid;

  if (loading) {
    return (
      <>
        <Navbar />
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  if (!post) return null;

  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Avatar
              src={post.author?.avatarUrl}
              onClick={() => post.author?.uid && navigate(`/u/${post.author.uid}`)}
              sx={{ cursor: post.author?.uid ? "pointer" : "default" }}
            >
              {post.author?.displayName?.[0]}
            </Avatar>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography
                  variant="subtitle1"
                  fontWeight={600}
                  onClick={() => post.author?.uid && navigate(`/u/${post.author.uid}`)}
                  sx={{ cursor: post.author?.uid ? "pointer" : "default", "&:hover": post.author?.uid ? { color: "primary.main" } : {} }}
                >
                  {post.author?.displayName}
                </Typography>
                {post.author?.tagName && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={post.author.tagName}
                    onClick={() => post.author?.uid && navigate(`/u/${post.author.uid}`)}
                    sx={{ cursor: post.author?.uid ? "pointer" : "default" }}
                  />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {formatRelativeTime(post.createdAt)}
              </Typography>
            </Box>
          </Stack>

          {canManagePost && (
            <>
              <IconButton onClick={(e) => setPostMenuAnchor(e.currentTarget)}>
                <MoreVertIcon />
              </IconButton>
              <Menu anchorEl={postMenuAnchor} open={!!postMenuAnchor} onClose={() => setPostMenuAnchor(null)}>
                <MenuItem onClick={handleDeletePost} sx={{ color: "error.main" }}>
                  Xóa bài viết
                </MenuItem>
              </Menu>
            </>
          )}
        </Stack>

        <Typography
          variant="h4"
          sx={{ mb: 2, fontWeight: 700, wordBreak: "break-word", overflowWrap: "break-word" }}
        >
          {post.title}
        </Typography>

        {post.coverImageUrl && (
          <Box
            component="img"
            src={post.coverImageUrl}
            alt={post.title}
            onClick={() => openMediaAt(post.coverImageUrl)}
            sx={{
              width: "100%",
              aspectRatio: "16 / 9",
              objectFit: "cover",
              borderRadius: "12px",
              mb: 3,
              cursor: "zoom-in",
            }}
          />
        )}

        {/* Nội dung Quill: đủ format snow + media responsive; bấm ảnh mở gallery */}
        <PostContent html={post.contentHtml} onMediaClick={(src) => openMediaAt(src)} />

        <MediaLightbox
          open={lightboxOpen}
          slides={mediaSlides}
          index={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />

        {/* Viên thuốc 2 cột: đủ 2 mục/hàng; mục lẻ cuối span full (= 2) */}
        <EngagementPills
          items={[
            {
              key: "like",
              icon: myReaction === "like" ? <ThumbUpIcon color="primary" /> : <ThumbUpOffAltIcon />,
              count: post.likeCount || 0,
              active: myReaction === "like",
              onClick: () => handleReact("like"),
              ariaLabel: "Thích",
              title: String(post.likeCount ?? 0),
            },
            {
              key: "dislike",
              icon: myReaction === "dislike" ? <ThumbDownIcon color="error" /> : <ThumbDownOffAltIcon />,
              count: post.dislikeCount || 0,
              active: myReaction === "dislike",
              onClick: () => handleReact("dislike"),
              ariaLabel: "Không thích",
              title: String(post.dislikeCount ?? 0),
            },
            {
              key: "view",
              icon: <VisibilityIcon />,
              count: post.viewCount || 0,
              onClick: (e) => setViewStatsAnchor(e.currentTarget),
              ariaLabel: "Thống kê lượt xem",
              title: String(post.viewCount ?? 0),
            },
            {
              key: "share",
              icon: <ShareIcon />,
              count: post.shareCount || 0,
              onClick: () => handleShare(),
              ariaLabel: "Chia sẻ",
              title: String(post.shareCount ?? 0),
            },
            {
              key: "score",
              icon: <GradeIcon />,
              count: post.postScore || 0,
              // postScore có thể ÂM (1 dislike = -2 điểm) — bắt buộc dùng
              // formatScore thay vì formatCount trong EngagementPills, nếu
              // không sẽ hiển thị sai thành "0" (bug đã gặp ở v0.8.6).
              signed: true,
              onClick: (e) => setScoreAnchor(e.currentTarget),
              ariaLabel: "Điểm bài viết",
              title: String(post.postScore ?? 0),
            },
          ]}
        />

        <ViewStatsPopover
          anchorEl={viewStatsAnchor}
          onClose={() => setViewStatsAnchor(null)}
          viewCount={post.viewCount || 0}
          aiViewCount={post.aiViewCount || 0}
        />

        <PostScorePopover
          anchorEl={scoreAnchor}
          onClose={() => setScoreAnchor(null)}
          viewCount={post.viewCount || 0}
          likeCount={post.likeCount || 0}
          dislikeCount={post.dislikeCount || 0}
          commentCount={post.commentCount || 0}
          shareCount={post.shareCount || 0}
          score={post.postScore || 0}
        />

        <Divider sx={{ mb: 3 }} />

        <Typography variant="h6" sx={{ mb: 2 }}>
          Bình luận ({formatCount(post.commentCount || 0)})
        </Typography>

        {isLoggedIn ? (
          <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ mb: 3 }}>
            <Avatar
              src={profile?.avatarUrl}
              sx={{ width: 32, height: 32, cursor: profile?.uid ? "pointer" : "default" }}
              onClick={() => profile?.uid && navigate(`/u/${profile.uid}`)}
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
            />
            <IconButton color="primary" onClick={handleSendComment} disabled={sending || !newComment.trim()}>
              <SendIcon />
            </IconButton>
          </Stack>
        ) : (
          <Box sx={{ mb: 3 }}>
            {(() => {
              const gate = resolveAuthActionGate({
                isLoggedIn,
                hasSession,
                loadingProfile,
                profile,
                profileError,
              });
              return (
                <Typography variant="body2" color="text.secondary">
                  {gate.message}
                  {gate.shouldRefresh && (
                    <>
                      {" "}
                      <Button size="small" onClick={() => refreshProfile()}>
                        Thử lại
                      </Button>
                    </>
                  )}
                </Typography>
              );
            })()}
          </Box>
        )}

        <Stack spacing={2}>
          {comments.map((c) => (
            <Box key={c.id} sx={{ display: "flex", gap: 1.5 }}>
              <Avatar
                src={c.author?.avatarUrl}
                sx={{ width: 36, height: 36, cursor: c.author?.uid ? "pointer" : "default" }}
                onClick={() => c.author?.uid && navigate(`/u/${c.author.uid}`)}
              >
                {c.author?.displayName?.[0]}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    onClick={() => c.author?.uid && navigate(`/u/${c.author.uid}`)}
                    sx={{ cursor: c.author?.uid ? "pointer" : "default", "&:hover": c.author?.uid ? { color: "primary.main" } : {} }}
                  >
                    {c.author?.displayName}
                  </Typography>
                  {c.author?.tagName && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={c.author.tagName}
                      onClick={() => c.author?.uid && navigate(`/u/${c.author.uid}`)}
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
                      <Button size="small" variant="contained" onClick={() => saveEditComment(c.id)}>
                        Lưu
                      </Button>
                      <Button size="small" onClick={() => setEditingId(null)}>
                        Hủy
                      </Button>
                    </Stack>
                  </Box>
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {c.content}
                  </Typography>
                )}
              </Box>
              {isMyComment(c) && editingId !== c.id && (
                <IconButton size="small" onClick={(e) => openCommentMenu(e, c)}>
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </Stack>

        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeCommentMenu}>
          <MenuItem onClick={startEditComment}>Sửa bình luận</MenuItem>
          <MenuItem onClick={handleDeleteComment} sx={{ color: "error.main" }}>
            Xóa bình luận
          </MenuItem>
        </Menu>
      </Container>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Xóa bài viết"
        message="Bạn có chắc muốn xóa bài viết này? Hành động này không thể hoàn tác."
        confirmText="Xóa bài viết"
        onConfirm={confirmDeletePost}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}
