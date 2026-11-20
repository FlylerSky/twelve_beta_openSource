import React, { useEffect, useState } from "react";
import { Popover, Box, Typography, Stack, Divider } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import { formatCount } from "../utils/number";

/**
 * Thống kê lượt xem. v0.10.9: neo anchorPosition snapshot — tránh nhảy góc
 * khi realtime re-render metric row.
 */
export default function ViewStatsPopover({ anchorEl, onClose, viewCount = 0, aiViewCount = 0 }) {
  const humanViewCount = Math.max(0, (viewCount || 0) - (aiViewCount || 0));
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!anchorEl) {
      setPosition(null);
      return;
    }
    try {
      const r = anchorEl.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      setPosition({ top: r.top, left: r.left + r.width / 2 });
    } catch {
      /* ignore */
    }
  }, [anchorEl]);

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
