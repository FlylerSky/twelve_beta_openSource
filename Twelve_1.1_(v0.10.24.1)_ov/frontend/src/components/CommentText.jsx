import React, { useState } from "react";
import { Box, Typography, Button } from "@mui/material";

/** Độ dài tối đa trước khi thu gọn (ký tự). */
export const COMMENT_CLAMP_LENGTH = 260;

/**
 * Nội dung bình luận có thu gọn — dùng chung CommentModal + trang POST.
 */
export default function CommentText({ content = "", clampLength = COMMENT_CLAMP_LENGTH }) {
  const [expanded, setExpanded] = useState(false);
  const text = content || "";
  const isLong = text.length > clampLength;
  const shown = expanded || !isLong ? text : text.slice(0, clampLength) + "…";

  return (
    <Box>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
        {shown}
      </Typography>
      {isLong && (
        <Button
          size="small"
          sx={{ p: 0, minWidth: 0, mt: 0.25, textTransform: "none" }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Thu gọn" : "Xem thêm"}
        </Button>
      )}
    </Box>
  );
}
