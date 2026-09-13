import React from "react";
import { Popover, Box, Typography, Stack, Divider } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import { formatCount } from "../utils/number";

/**
 * Hộp thống kê lượt xem — mở khi click vào icon "view" trên PostCard hoặc
 * trang chi tiết bài viết (PostDetailPage). Tách riêng lượt xem của Bot A.I
 * (tính từ trang SSR /post/:id, /blog/:id — nơi chỉ bot/AI agent truy cập,
 * xem backend/src/routes/ssr.routes.js + frontend/middleware.js) khỏi lượt
 * xem thông thường (người dùng thật xem trên trang POST/BLOG chi tiết, dù
 * đăng nhập hay không).
 *
 * props:
 * - anchorEl: element để neo popover (null = đóng)
 * - onClose: () => void
 * - viewCount: tổng lượt xem (đã bao gồm cả lượt của Bot A.I)
 * - aiViewCount: lượt xem riêng của Bot A.I
 */
export default function ViewStatsPopover({ anchorEl, onClose, viewCount = 0, aiViewCount = 0 }) {
  const humanViewCount = Math.max(0, (viewCount || 0) - (aiViewCount || 0));

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClick={(e) => e.stopPropagation()}
    >
      <Box sx={{ p: 2, minWidth: 240 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25 }}>
          Thống kê lượt xem
        </Typography>

        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={0.75} alignItems="center">
              <VisibilityIcon fontSize="small" color="action" />
              <Typography variant="body2">Tổng lượt xem</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={700} title={String(viewCount)}>
              {formatCount(viewCount)}
            </Typography>
          </Stack>

          <Divider />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={0.75} alignItems="center">
              <PersonIcon fontSize="small" color="action" />
              <Typography variant="body2">Người dùng</Typography>
            </Stack>
            <Typography variant="body2" title={String(humanViewCount)}>
              {formatCount(humanViewCount)}
            </Typography>
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={0.75} alignItems="center">
              <SmartToyIcon fontSize="small" color="action" />
              <Typography variant="body2">View Bot A.I</Typography>
            </Stack>
            <Typography variant="body2" title={String(aiViewCount)}>
              {formatCount(aiViewCount)}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Popover>
  );
}
