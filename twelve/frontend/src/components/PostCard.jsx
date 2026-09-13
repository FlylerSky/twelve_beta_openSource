import React, { useState, useRef, useLayoutEffect, useCallback, useMemo } from "react";
import {
  Card,
  CardHeader,
  CardMedia,
  CardContent,
  CardActions,
  Avatar,
  Typography,
  IconButton,
  Button,
  Box,
  Chip,
  Popover,
  Stack,
  Divider,
} from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbDownOffAltIcon from "@mui/icons-material/ThumbDownOffAlt";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ShareIcon from "@mui/icons-material/Share";
import GradeIcon from "@mui/icons-material/Grade";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "../utils/time";
import { formatCount, formatScore } from "../utils/number";
import { computePostScore } from "../utils/postScore";
import { dlog, snapshotAuth } from "../utils/debugLog";
import { resolveAuthActionGate } from "../utils/authGate";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import ViewStatsPopover from "./ViewStatsPopover";
import PostScorePopover from "./PostScorePopover";

/**
 * Metric row: ưu tiên hiển thị like → dislike → comment → view → share → score.
 * Khi thiếu chỗ, ẩn từ phải sang trái vào nút "..." (bấm hiện đủ chỉ số).
 * View trong menu "..." vẫn mở được ViewStatsPopover. Share trong menu "..."
 * vẫn bấm tạo link chia sẻ được bình thường. Score mở PostScorePopover giải
 * thích công thức tính điểm (xem utils/postScore.js).
 */
export default function PostCard({ post, api, detailPath, onOpenComments }) {
  const navigate = useNavigate();
  const { isLoggedIn, hasSession, profileError, loadingProfile, profile, refreshProfile } = useAuth();
  const snackbar = useSnackbar();

  const [myReaction, setMyReaction] = useState(post.myReaction || null);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [dislikeCount, setDislikeCount] = useState(post.dislikeCount || 0);
  const [busy, setBusy] = useState(false);

  const viewCount = post.viewCount || 0;
  const aiViewCount = post.aiViewCount || 0;
  const commentCount = post.commentCount || 0;
  const shareCount = post.shareCount || 0;
  // Điểm bài viết: tính lại ngay trên UI theo likeCount/dislikeCount state
  // (cập nhật lạc quan) để bấm like/dislike thấy điểm đổi ngay, không cần
  // đợi tải lại. Giá trị chuẩn vẫn là post.postScore do server trả — dùng nó
  // làm điểm khởi đầu, chỉ recompute khi có thao tác làm lệch tại chỗ.
  const score = computePostScore({ viewCount, likeCount, dislikeCount, commentCount, shareCount });

  const [viewStatsAnchor, setViewStatsAnchor] = useState(null);
  const [scoreAnchor, setScoreAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);

  // Số metric hiển thị trực tiếp. Phần còn lại vào "...".
  // Khởi tạo thấp để tránh nháy icon cắt nửa trước khi đo xong.
  const [visibleCount, setVisibleCount] = useState(3);

  const containerRef = useRef(null);
  const measureRefs = useRef([]);

  // ==== VÁ v0.8.12 ====
  // Ref luôn trỏ auth/state mới nhất — tránh stale closure trong metrics useMemo.
  // PHẢI gán SAU useState (tránh TDZ → crash màn hình trắng khi render PostCard).
  const liveRef = useRef({});
  liveRef.current = {
    isLoggedIn,
    hasSession,
    profileError,
    loadingProfile,
    profile,
    refreshProfile,
    snackbar,
    myReaction,
    likeCount,
    dislikeCount,
    busy,
    post,
    api,
    onOpenComments,
  };

  const handleReact = useCallback(async (type) => {
    const s = liveRef.current;
    // ==== VÁ v0.8.11 + 0.8.12 ====
    // Đọc auth/state từ liveRef — không phụ thuộc closure của useMemo metrics.
    if (!s.isLoggedIn) {
      const gate = resolveAuthActionGate({
        isLoggedIn: s.isLoggedIn,
        hasSession: s.hasSession,
        loadingProfile: s.loadingProfile,
        profile: s.profile,
        profileError: s.profileError,
      });
      dlog.warn("ui", "handleReact blocked", snapshotAuth({
        type,
        kind: gate.kind,
        hasSession: s.hasSession,
        loadingProfile: s.loadingProfile,
        profileError: s.profileError || null,
        profileStatus: s.profile?.status ?? null,
        postId: s.post?.id,
        note: "liveRef (0.8.12)",
      }));
      s.snackbar.warning(gate.message);
      if (gate.shouldRefresh) s.refreshProfile();
      return;
    }
    if (s.busy) return;
    setBusy(true);

    const prevType = s.myReaction;
    let nextLike = s.likeCount;
    let nextDislike = s.dislikeCount;
    if (prevType === "like") nextLike -= 1;
    if (prevType === "dislike") nextDislike -= 1;

    let nextType = type;
    if (prevType === type) {
      nextType = null;
    } else {
      if (type === "like") nextLike += 1;
      if (type === "dislike") nextDislike += 1;
    }

    setMyReaction(nextType);
    setLikeCount(nextLike);
    setDislikeCount(nextDislike);

    try {
      await s.api.react(s.post.id, type);
    } catch (err) {
      setMyReaction(prevType);
      setLikeCount(s.post.likeCount || 0);
      setDislikeCount(s.post.dislikeCount || 0);
      s.snackbar.error(err.message || "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  }, []);

  // SHARE: chỉ tạo link (không tính share ngay) — xem giải thích đầy đủ ở
  // PostDetailPage.jsx#handleShare. Lượt share thực sự được tính khi có
  // người mở link đó ra ở trang chi tiết.
  const handleShare = useCallback(async () => {
    const s = liveRef.current;
    try {
      const { shareUrl } = await s.api.share(s.post.id);
      if (navigator.share) {
        try {
          await navigator.share({ title: s.post.title, url: shareUrl });
          return;
        } catch (shareErr) {
          if (shareErr?.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(shareUrl);
      s.snackbar.success("Đã sao chép link chia sẻ.");
    } catch (err) {
      s.snackbar.error(err.message || "Không thể tạo link chia sẻ.");
    }
  }, []);

  const metrics = useMemo(
    () => [
      {
        key: "like",
        priority: 0,
        count: likeCount,
        renderIcon: (active) =>
          active ? <ThumbUpIcon fontSize="small" color="primary" /> : <ThumbUpOffAltIcon fontSize="small" />,
        active: myReaction === "like",
        onClick: () => handleReact("like"),
      },
      {
        key: "dislike",
        priority: 1,
        count: dislikeCount,
        renderIcon: (active) =>
          active ? <ThumbDownIcon fontSize="small" color="error" /> : <ThumbDownOffAltIcon fontSize="small" />,
        active: myReaction === "dislike",
        onClick: () => handleReact("dislike"),
      },
      {
        key: "comment",
        priority: 2,
        count: commentCount,
        renderIcon: () => <ChatBubbleOutlineIcon fontSize="small" />,
        onClick: () => onOpenComments(post),
      },
      {
        key: "view",
        priority: 3,
        count: viewCount,
        renderIcon: () => <VisibilityIcon fontSize="small" />,
        onClick: (e) => setViewStatsAnchor(e.currentTarget),
      },
      {
        key: "share",
        priority: 4,
        count: shareCount,
        renderIcon: () => <ShareIcon fontSize="small" />,
        onClick: () => handleShare(),
      },
      {
        key: "score",
        priority: 5,
        count: score,
        renderIcon: () => <GradeIcon fontSize="small" />,
        onClick: (e) => setScoreAnchor(e.currentTarget),
      },
    ],
    // handleReact/handleShare ổn định (useCallback + liveRef) — không stale auth.
    [likeCount, dislikeCount, commentCount, viewCount, shareCount, score, myReaction, post, handleReact, handleShare, onOpenComments]
  );

  const checkOverflow = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const available = container.clientWidth;
    if (available <= 0) return;

    // getBoundingClientRect chính xác hơn offsetWidth; margin không nằm trong width
    // nên cộng thêm GAP (khớp ml: 0.5 ≈ 4px trên theme mặc định).
    const GAP = 4;
    const widths = metrics.map((_, i) => {
      const el = measureRefs.current[i];
      if (!el) return 0;
      const w = el.getBoundingClientRect().width;
      return w;
    });
    // Chưa đo được (font/icon chưa layout) → thử lại frame sau, tránh nhét quá nhiều → icon cắt nửa
    if (widths.some((w) => w < 8)) {
      requestAnimationFrame(() => checkOverflow());
      return;
    }
    const moreEl = measureRefs.current[metrics.length];
    const moreW = moreEl ? Math.max(moreEl.getBoundingClientRect().width, 32) : 40;

    // Chọn số metric lớn nhất sao cho: sum(widths + gap) + (còn ẩn ? moreW : 0) <= available
    // Không cho “lọt” metric cuối bị CSS overflow:hidden cắt một nửa.
    let canShow = 0;
    for (let n = metrics.length; n >= 0; n--) {
      let used = 0;
      for (let i = 0; i < n; i++) {
        used += widths[i] + (i > 0 ? GAP : 0);
      }
      const needMore = n < metrics.length ? moreW + (n > 0 ? GAP : 0) : 0;
      if (used + needMore <= available - 2) {
        canShow = n;
        break;
      }
    }
    setVisibleCount(canShow);
  }, [metrics]);

  useLayoutEffect(() => {
    checkOverflow();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      checkOverflow();
    });
    ro.observe(container);
    // Font icon MUI có thể load chậm → đo lại sau một nhịp
    const t = window.setTimeout(() => checkOverflow(), 100);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [checkOverflow]);

  const visible = metrics.slice(0, visibleCount);
  const hidden = metrics.slice(visibleCount);

  const renderMetric = (m, opts = {}) => (
    <Box
      key={m.key}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.25,
        flexShrink: 0,
        ml: opts.first ? 0 : 0.5,
      }}
    >
      <IconButton
        size="small"
        onClick={m.onClick}
        disabled={busy && (m.key === "like" || m.key === "dislike")}
        aria-label={m.key}
      >
        {m.renderIcon(m.active)}
      </IconButton>
      <Typography
        variant="body2"
        title={String(m.count)}
        sx={{
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {m.key === "score" ? formatScore(m.count) : formatCount(m.count)}
      </Typography>
    </Box>
  );

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        avatar={
          <Avatar
            src={post.author?.avatarUrl}
            onClick={() => post.author?.uid && navigate(`/u/${post.author.uid}`)}
            sx={{ cursor: post.author?.uid ? "pointer" : "default" }}
          >
            {post.author?.displayName?.[0]}
          </Avatar>
        }
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography
              variant="subtitle2"
              fontWeight={600}
              onClick={() => post.author?.uid && navigate(`/u/${post.author.uid}`)}
              sx={{
                cursor: post.author?.uid ? "pointer" : "default",
                "&:hover": post.author?.uid ? { color: "primary.main" } : {},
              }}
            >
              {post.author?.displayName || "Người dùng Twelve"}
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
          </Box>
        }
        subheader={formatRelativeTime(post.createdAt)}
      />

      {post.coverImageUrl && (
        <CardMedia
          component="img"
          src={post.coverImageUrl}
          alt={post.title}
          sx={{ aspectRatio: "16 / 9", objectFit: "cover" }}
        />
      )}

      <CardContent sx={{ pb: 1 }}>
        <Typography
          variant="h6"
          sx={{
            cursor: "pointer",
            wordBreak: "break-word",
            overflowWrap: "break-word",
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          onClick={() => navigate(`${detailPath}/${post.id}`)}
        >
          {post.title}
        </Typography>
        {post.excerpt && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.5,
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {post.excerpt}
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ justifyContent: "space-between", px: 2, pb: 1.5, gap: 1, flexWrap: "nowrap" }}>
        <Box
          ref={containerRef}
          sx={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            flex: "1 1 auto",
            overflow: "hidden",
          }}
        >
          {visible.map((m, i) => renderMetric(m, { first: i === 0 }))}

          {hidden.length > 0 && (
            <IconButton
              size="small"
              sx={{ ml: 0.5, flexShrink: 0 }}
              onClick={(e) => setMoreAnchor(e.currentTarget)}
              aria-label="Thêm chỉ số"
            >
              <MoreHorizIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {/* Bản đo ẩn từng metric + nút "..." để tính overflow */}
        <Box
          aria-hidden="true"
          sx={{
            position: "absolute",
            left: -9999,
            top: 0,
            visibility: "hidden",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            // Không height:0 / overflow:hidden — nếu không, width đo ra 0 → nhét quá nhiều metric
          }}
        >
          {metrics.map((m, i) => (
            <Box
              key={m.key}
              ref={(el) => {
                measureRefs.current[i] = el;
              }}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: i ? 0.5 : 0 }}
            >
              <IconButton size="small" tabIndex={-1}>
                {m.renderIcon(false)}
              </IconButton>
              <Typography variant="body2">{m.key === "score" ? formatScore(m.count) : formatCount(m.count)}</Typography>
            </Box>
          ))}
          <Box
            ref={(el) => {
              measureRefs.current[metrics.length] = el;
            }}
            sx={{ display: "inline-flex", ml: 0.5 }}
          >
            <IconButton size="small" tabIndex={-1}>
              <MoreHorizIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Button size="small" onClick={() => navigate(`${detailPath}/${post.id}`)} sx={{ flexShrink: 0 }}>
          Xem bài
        </Button>
      </CardActions>

      {/* Menu "..." — các chỉ số bị ẩn vì thiếu chỗ */}
      <Popover
        open={!!moreAnchor}
        anchorEl={moreAnchor}
        onClose={() => setMoreAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Box sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Chỉ số
          </Typography>
          <Stack spacing={0.5}>
            {hidden.map((m) => (
              <Box
                key={m.key}
                onClick={(e) => {
                  setMoreAnchor(null);
                  m.onClick?.(e);
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                  px: 1,
                  py: 0.75,
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  {m.renderIcon(m.active)}
                  <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                    {m.key === "like"
                      ? "Thích"
                      : m.key === "dislike"
                        ? "Không thích"
                        : m.key === "comment"
                          ? "Bình luận"
                          : m.key === "share"
                            ? "Chia sẻ"
                            : m.key === "score"
                              ? "Điểm bài viết"
                              : "Lượt xem"}
                  </Typography>
                </Stack>
                <Typography variant="body2" fontWeight={600} title={String(m.count)}>
                  {m.key === "score" ? formatScore(m.count) : formatCount(m.count)}
                </Typography>
              </Box>
            ))}
          </Stack>
          {hidden.some((m) => m.key === "view") && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Chạm “Lượt xem” để xem chi tiết Bot A.I
              </Typography>
            </>
          )}
        </Box>
      </Popover>

      <ViewStatsPopover
        anchorEl={viewStatsAnchor}
        onClose={() => setViewStatsAnchor(null)}
        viewCount={viewCount}
        aiViewCount={aiViewCount}
      />

      <PostScorePopover
        anchorEl={scoreAnchor}
        onClose={() => setScoreAnchor(null)}
        viewCount={viewCount}
        likeCount={likeCount}
        dislikeCount={dislikeCount}
        commentCount={commentCount}
        shareCount={shareCount}
        score={score}
      />
    </Card>
  );
}
