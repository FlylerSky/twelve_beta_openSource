import React, { useEffect, useState } from "react";
import { Popover, Box, Typography, Stack, Divider } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ShareIcon from "@mui/icons-material/Share";
import { formatCount, formatScore } from "../utils/number";
import { POST_SCORE_WEIGHTS } from "../utils/postScore";

/**
 * Popover thống kê điểm bài viết.
 * v0.10.9: neo bằng anchorPosition (snapshot lúc mở) — tránh nhảy góc trái
 * trên khi onSnapshot re-render thay DOM nút metric (anchorEl detached).
 */
export default function PostScorePopover({
  anchorEl,
  onClose,
  viewCount = 0,
  likeCount = 0,
  dislikeCount = 0,
  commentCount = 0,
  shareCount = 0,
  score = 0,
}) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!anchorEl) {
      setPosition(null);
      return;
    }
    try {
      const r = anchorEl.getBoundingClientRect();
      // Node đã unmount / detached thường ra 0×0 — giữ vị trí cũ
      if (r.width === 0 && r.height === 0) return;
      setPosition({ top: r.top, left: r.left + r.width / 2 });
    } catch {
      /* ignore */
    }
  }, [anchorEl]);

  const rows = [
    { key: "view", label: "Lượt xem", icon: <VisibilityIcon fontSize="small" color="action" />, count: viewCount, weight: POST_SCORE_WEIGHTS.view },
    { key: "like", label: "Thích", icon: <ThumbUpIcon fontSize="small" color="action" />, count: likeCount, weight: POST_SCORE_WEIGHTS.like },
    { key: "dislike", label: "Không thích", icon: <ThumbDownIcon fontSize="small" color="action" />, count: dislikeCount, weight: POST_SCORE_WEIGHTS.dislike },
    { key: "comment", label: "Bình luận", icon: <ChatBubbleOutlineIcon fontSize="small" color="action" />, count: commentCount, weight: POST_SCORE_WEIGHTS.comment },
    { key: "share", label: "Chia sẻ", icon: <ShareIcon fontSize="small" color="action" />, count: shareCount, weight: POST_SCORE_WEIGHTS.share },
  ];

  return (
    <Popover
      open={!!anchorEl && !!position}
      anchorReference="anchorPosition"
      anchorPosition={position || { top: 0, left: 0 }}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClick={(e) => e.stopPropagation()}
      disableRestoreFocus
    >
      <Box sx={{ p: 2, minWidth: 260 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25 }}>
          Điểm bài viết
        </Typography>

        <Stack spacing={1}>
          {rows.map((r) => (
            <Stack key={r.key} direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={0.75} alignItems="center">
                {r.icon}
                <Typography variant="body2">
                  {r.label} × {r.weight > 0 ? `+${r.weight}` : r.weight}
                </Typography>
              </Stack>
              <Typography variant="body2" title={String(r.count)}>
                {formatCount(r.count)}
              </Typography>
            </Stack>
          ))}

          <Divider />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={700}>
              Tổng điểm
            </Typography>
            <Typography variant="body2" fontWeight={700} title={String(score)}>
              {formatScore(score)}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Popover>
  );
}
