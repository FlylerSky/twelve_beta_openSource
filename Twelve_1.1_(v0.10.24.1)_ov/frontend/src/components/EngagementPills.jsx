import React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { formatCount, formatScore } from "../utils/number";

/**
 * Hàng nút dạng "viên thuốc" trên trang POST/BLOG.
 *
 * Quy tắc lưới (tối đa 2 mục / hàng):
 * - 1 mục trên hàng → chiếm full (span 2) = độ rộng 2
 * - 2 mục trên hàng → mỗi cái 1/2 (1 : 1)
 * - Đủ 2 mục thì xuống hàng mới
 *
 * props:
 * - items: Array<{
 *     key: string,
 *     icon: ReactNode,
 *     count?: number|string|null,  // null/undefined = không hiện số
 *     signed?: boolean,            // true = có thể âm (VD: postScore) → dùng formatScore thay formatCount
 *     active?: boolean,
 *     onClick?: (e) => void,
 *     ariaLabel?: string,
 *     title?: string,             // tooltip số đầy đủ
 *   }>
 */
export default function EngagementPills({ items = [] }) {
  if (!items.length) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 1,
        mb: 3,
        width: "100%",
      }}
    >
      {items.map((item, index) => {
        const isOddLast = items.length % 2 === 1 && index === items.length - 1;
        return (
          <ButtonBase
            key={item.key}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            sx={{
              gridColumn: isOddLast ? "1 / -1" : "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              px: 2,
              py: 1.1,
              borderRadius: 999,
              border: "1px solid",
              borderColor: item.active ? "primary.main" : "divider",
              bgcolor: item.active ? "action.selected" : "background.paper",
              color: item.active ? "primary.main" : "text.primary",
              transition: "background-color 0.15s, border-color 0.15s",
              "&:hover": {
                bgcolor: "action.hover",
              },
              // Icon + số luôn cùng một hàng, không xuống dòng
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                lineHeight: 0,
                "& .MuiSvgIcon-root": { fontSize: 22 },
              }}
            >
              {item.icon}
            </Box>
            {item.count !== undefined && item.count !== null && (
              <Typography
                component="span"
                variant="body2"
                fontWeight={600}
                title={item.title ?? String(item.count)}
                sx={{
                  fontVariantNumeric: "tabular-nums",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {typeof item.count === "number" ? (item.signed ? formatScore(item.count) : formatCount(item.count)) : item.count}
              </Typography>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
