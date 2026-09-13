import React from "react";
import { Popover, Box, Typography, Stack, Divider } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ShareIcon from "@mui/icons-material/Share";
import { formatCount, formatScore } from "../utils/number";
import { POST_SCORE_WEIGHTS } from "../utils/postScore";

/**
 * Hộp giải thích Điểm bài viết — mở khi bấm icon "score" trên PostCard hoặc
 * trang chi tiết. Hiển thị đúng công thức đang dùng (xem
 * backend/src/utils/helpers.js#computePostScore) để người dùng tự đối chiếu,
 * kể cả khi các thông số gốc bị thay đổi trực tiếp (điểm luôn tính lại đúng
 * theo công thức, không lưu trữ độc lập).
 *
 * props: anchorEl, onClose, viewCount, likeCount, dislikeCount, commentCount,
 * shareCount, score (tổng — nên lấy từ post.postScore do server trả về).
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
  const rows = [
    { key: "view", label: "Lượt xem", icon: <VisibilityIcon fontSize="small" color="action" />, count: viewCount, weight: POST_SCORE_WEIGHTS.view },
    { key: "like", label: "Thích", icon: <ThumbUpIcon fontSize="small" color="action" />, count: likeCount, weight: POST_SCORE_WEIGHTS.like },
    { key: "dislike", label: "Không thích", icon: <ThumbDownIcon fontSize="small" color="action" />, count: dislikeCount, weight: POST_SCORE_WEIGHTS.dislike },
    { key: "comment", label: "Bình luận", icon: <ChatBubbleOutlineIcon fontSize="small" color="action" />, count: commentCount, weight: POST_SCORE_WEIGHTS.comment },
    { key: "share", label: "Chia sẻ", icon: <ShareIcon fontSize="small" color="action" />, count: shareCount, weight: POST_SCORE_WEIGHTS.share },
  ];

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClick={(e) => e.stopPropagation()}
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
