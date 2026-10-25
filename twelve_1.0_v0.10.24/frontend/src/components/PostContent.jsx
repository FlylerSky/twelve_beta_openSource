import React, { useMemo } from "react";
import { Box, useTheme } from "@mui/material";
import "react-quill/dist/quill.snow.css";

/**
 * v0.9.0 [DARK MODE] — Người viết chọn MÀU CHỮ qua Quill (`style="color: ..."`).
 * Màu đó thường chọn trên giả định nền sáng → dark mode có thể không đọc được
 * (chữ đen trên nền tối).
 *
 * Patch note 0.9.0:
 * - Dark mode: LOẠI BỎ chỉ `color:` — chữ dùng màu theme (`text.primary`).
 * - GIỮ `background` / `background-color` (bôi nền chữ Quill vẫn hiện).
 * - Light mode: giữ nguyên toàn bộ style tác giả.
 * Chỉ xử lý HIỂN THỊ — không sửa contentHtml trong Firestore.
 *
 * v0.9.1.1: khôi phục giữ background (bản 0.9.1 từng strip nhầm cả nền).
 */
function stripInlineTextColor(html) {
  if (!html) return html;
  return html.replace(/style\s*=\s*"([^"]*)"/gi, (match, styleContent) => {
    const kept = styleContent
      .split(";")
      .filter((decl) => {
        const trimmed = decl.trim();
        if (!trimmed) return false;
        // Chỉ loại "color: ..." — GIỮ "background-color: ..." / "background: ...".
        return !/^color\s*:/i.test(trimmed);
      })
      .join(";");
    return kept ? `style="${kept}"` : "";
  });
}

/**
 * Render HTML nội dung Quill trên trang POST với đầy đủ style snow theme
 * (header, list, blockquote, code-block, align, color, strike, link, media…).
 *
 * props:
 * - html: contentHtml đã sanitize
 * - onMediaClick: (src: string, tagName: 'IMG'|'VIDEO') => void
 */
export default function PostContent({ html, onMediaClick }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const safeHtml = useMemo(() => {
    const base = html || "";
    return isDark ? stripInlineTextColor(base) : base;
  }, [html, isDark]);

  const handleClick = (e) => {
    const target = e.target;
    if (!target) return;

    if (target.tagName === "IMG" && target.src) {
      e.preventDefault();
      onMediaClick?.(target.src, "IMG");
      return;
    }

    // Click vào video (hoặc control area) — mở trong lightbox nếu có src
    if (target.tagName === "VIDEO" && target.currentSrc) {
      // Cho phép dùng native controls; double-intent: nếu user click poster area
      // without playing, still can open lightbox via data attribute button — skip
      return;
    }

    // Nút phụ: data-twelve-open-media trên wrapper
    const openBtn = target.closest?.("[data-twelve-media-src]");
    if (openBtn) {
      const src = openBtn.getAttribute("data-twelve-media-src");
      if (src) onMediaClick?.(src, openBtn.getAttribute("data-twelve-media-type") || "IMG");
    }
  };

  return (
    <Box
      className="ql-snow"
      onClick={handleClick}
      sx={{
        mb: 3,
        // Khung nội dung giống editor nhưng chỉ để đọc
        "& .ql-editor": {
          padding: 0,
          fontSize: "1.05rem",
          lineHeight: 1.75,
          wordBreak: "break-word",
          overflowWrap: "break-word",
          color: "text.primary",
          // Dark: cưỡng bức màu chữ theme; nền bôi (background-color) vẫn từ HTML
          ...(isDark
            ? {
                "& span[style], & p[style], & strong[style], & em[style], & u[style], & s[style]": {
                  color: `${theme.palette.text.primary} !important`,
                },
              }
            : {}),
        },
        // ---- Typography Quill ----
        "& .ql-editor h1": { fontSize: "1.75rem", fontWeight: 600, mt: 2, mb: 1 },
        "& .ql-editor h2": { fontSize: "1.45rem", fontWeight: 600, mt: 2, mb: 1 },
        "& .ql-editor h3": { fontSize: "1.25rem", fontWeight: 600, mt: 1.5, mb: 0.75 },
        "& .ql-editor p": { mb: 1.25 },
        "& .ql-editor blockquote": {
          borderLeft: "4px solid",
          borderColor: "primary.light",
          pl: 2,
          ml: 0,
          color: "text.secondary",
          fontStyle: "italic",
        },
        // Code block: nền tối + chữ sáng để không bị "trùng màu" với color
        // inline Quill đã gắn (vd. user chọn nền sáng / chữ trắng).
        "& .ql-editor pre.ql-syntax, & .ql-editor .ql-code-block-container, & .ql-editor pre": {
          backgroundColor: "#1e1e2e !important",
          color: "#e2e8f0 !important",
          borderRadius: "8px",
          padding: "12px 16px",
          overflow: "auto",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: "0.9rem",
          border: "1px solid rgba(255,255,255,0.06)",
        },
        "& .ql-editor pre.ql-syntax *, & .ql-editor .ql-code-block-container *, & .ql-editor pre *": {
          color: "#e2e8f0 !important",
          backgroundColor: "transparent !important",
        },
        "& .ql-editor a": {
          color: "primary.main",
          textDecoration: "underline",
        },
        // ---- Lists / align (class từ Quill snow) ----
        "& .ql-editor ul, & .ql-editor ol": { pl: 3, mb: 1.5 },
        "& .ql-editor li": { mb: 0.5 },
        "& .ql-editor .ql-align-center": { textAlign: "center" },
        "& .ql-editor .ql-align-right": { textAlign: "right" },
        "& .ql-editor .ql-align-justify": { textAlign: "justify" },
        // ---- Media ----
        "& .ql-editor img": {
          maxWidth: "100%",
          height: "auto",
          display: "block",
          margin: "16px auto",
          borderRadius: "12px",
          cursor: "zoom-in",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        },
        "& .ql-editor video": {
          maxWidth: "100%",
          width: "100%",
          height: "auto",
          display: "block",
          margin: "16px auto",
          borderRadius: "12px",
          backgroundColor: "#000",
        },
        // v0.10.13: audio trực tiếp (<audio controls>) — không cần full-width
        // như video, giữ kích thước gọn tự nhiên của trình phát audio.
        "& .ql-editor audio": {
          display: "block",
          width: "100%",
          maxWidth: 420,
          margin: "16px auto",
        },
        "& .ql-editor iframe, & .ql-editor .ql-video": {
          width: "100%",
          aspectRatio: "16 / 9",
          height: "auto",
          display: "block",
          margin: "16px auto",
          border: 0,
          borderRadius: "12px",
          overflow: "hidden",
          maxWidth: "100%",
        },
        // v0.10.13: player SoundCloud/Spotify vốn THẤP (không phải 16:9) —
        // selector cụ thể hơn nên override đúng quy tắc chung phía trên.
        "& .ql-editor .ql-audio-embed": {
          width: "100%",
          aspectRatio: "auto",
          height: 166,
          display: "block",
          margin: "16px auto",
          border: 0,
          borderRadius: "12px",
          overflow: "hidden",
          maxWidth: "100%",
        },
      }}
    >
      <div className="ql-editor" dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </Box>
  );
}
