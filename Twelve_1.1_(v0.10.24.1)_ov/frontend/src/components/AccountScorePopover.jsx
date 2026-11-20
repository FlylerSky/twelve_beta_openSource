import React from "react";
import { Popover, Box, Typography, Stack, Divider } from "@mui/material";
import ArticleIcon from "@mui/icons-material/Article";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { formatScore } from "../utils/number";

/**
 * Hộp giải thích Điểm tài khoản (accountScore, v0.8.23) — mở khi bấm vào
 * số điểm tài khoản trong card info user (Menu, xem Navbar.jsx). Cùng
 * pattern với PostScorePopover: hiển thị đúng công thức đang dùng
 * (backend/src/utils/helpers.js — accountScore = postsScoreSum +
 * positiveScore) để người dùng tự đối chiếu.
 *
 * props: anchorEl, onClose, postsScoreSum, positiveScore, accountScore.
 */
export default function AccountScorePopover({
  anchorEl,
  onClose,
  postsScoreSum = 0,
  positiveScore = 0,
  accountScore = 0,
}) {
  const rows = [
    {
      key: "postsScoreSum",
      label: "Điểm bài viết tổng",
      icon: <ArticleIcon fontSize="small" color="action" />,
      value: postsScoreSum,
    },
    {
      key: "positiveScore",
      label: "Điểm tích cực",
      icon: <FavoriteIcon fontSize="small" color="action" />,
      value: positiveScore,
    },
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
          Điểm tài khoản
        </Typography>

        <Stack spacing={1}>
          {rows.map((r) => (
            <Stack key={r.key} direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={0.75} alignItems="center">
                {r.icon}
                <Typography variant="body2">{r.label}</Typography>
              </Stack>
              <Typography variant="body2" title={String(r.value)}>
                {formatScore(r.value)}
              </Typography>
            </Stack>
          ))}

          <Divider />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={700}>
              Tổng điểm tài khoản
            </Typography>
            <Typography variant="body2" fontWeight={700} title={String(accountScore)}>
              {formatScore(accountScore)}
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Điểm tài khoản = Điểm bài viết tổng + Điểm tích cực. Đây là số liệu
            cache dùng cho các tính năng xếp hạng sau này.
          </Typography>
        </Stack>
      </Box>
    </Popover>
  );
}
