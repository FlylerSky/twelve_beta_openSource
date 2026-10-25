import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactQuill, { Quill } from "react-quill";
import "react-quill/dist/quill.snow.css";
import { useTheme } from "@mui/material/styles";
import { classifyMediaUrl, buildMediaHtml } from "../utils/media";
import MediaUrlDialog from "./MediaUrlDialog";

// v0.2: ĐÃ GỠ nút "image" khỏi toolbar (vẫn giữ format "image" bên dưới để
// Quill render được ảnh đã chèn — xem giải thích trong "formats"). Lý do gỡ
// nút: nút ảnh mặc định của Quill.js đọc file người dùng chọn và nhúng thẳng
// vào nội dung dưới dạng base64, khiến Firestore bị "spam" dữ liệu khổng lồ
// chỉ từ 1 bài viết.
//
// v0.2.1: nút "video" không còn luôn bọc URL vào 1 <iframe> thô như mặc định
// của Quill nữa (gây tràn/scroll khi URL thực chất là ảnh hoặc file video).
// Handler tùy biến bên dưới sẽ tự phân loại URL (ảnh / video file / YouTube /
// Vimeo / trang web) và chèn đúng loại thẻ tương ứng — xem utils/media.js.
//
// v0.4.2: thay window.prompt() bằng MediaUrlDialog (Material Design) để
// đồng nhất trải nghiệm với mọi hộp thông báo / popup khác trên Twelve.
//
// ==== v0.10.16 [SỬA LỖI] — chèn video/audio file trực tiếp (Cloudinary...)
// bị "biến mất" ngay khi bấm Chèn ====
// `classifyMediaUrl`/`buildMediaHtml` (utils/media.js) từ v0.10.13 đã dựng
// đúng thẻ <video src="...">/<audio src="..."> cho file media trực tiếp,
// NHƯNG Quill.js chỉ có sẵn blot cho <img> (format "image") và <iframe>
// (format "video", dùng cho YouTube/Vimeo...) — KHÔNG có blot nào cho thẻ
// <video>/<audio> thật. Khi `dangerouslyPasteHTML` gặp 1 thẻ không có blot
// tương ứng, Quill âm thầm loại bỏ toàn bộ thẻ đó (không lỗi, không cảnh
// báo) — nên trước bản vá này, MỌI file video/audio trực tiếp (không riêng
// Cloudinary) đều "chèn xong không thấy gì" ngay tại bước này, chưa từng
// chạm tới backend/domain-list.
//
// Đăng ký 2 blot tuỳ biến kiểu BlockEmbed cho đúng tagName VIDEO/AUDIO —
// dùng blotName riêng ("video-file"/"audio-file", KHÔNG trùng "video" mà
// Quill đã dùng cho iframe) để tránh xung đột. `Quill.register(..., true)`
// an toàn khi gọi lại nhiều lần (module có thể được import lại lúc hot
// reload) — tham số `true` cho phép ghi đè thay vì ném lỗi "đã đăng ký".
const BlockEmbed = Quill.import("blots/block/embed");

class VideoFileBlot extends BlockEmbed {
  static create(url) {
    const node = super.create(url);
    node.setAttribute("src", url);
    node.setAttribute("controls", "");
    return node;
  }
  static value(domNode) {
    return domNode.getAttribute("src");
  }
}
VideoFileBlot.blotName = "video-file";
VideoFileBlot.tagName = "VIDEO";

class AudioFileBlot extends BlockEmbed {
  static create(url) {
    const node = super.create(url);
    node.setAttribute("src", url);
    node.setAttribute("controls", "");
    return node;
  }
  static value(domNode) {
    return domNode.getAttribute("src");
  }
}
AudioFileBlot.blotName = "audio-file";
AudioFileBlot.tagName = "AUDIO";

Quill.register({ "formats/video-file": VideoFileBlot, "formats/audio-file": AudioFileBlot }, true);

const formats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
  "list",
  "bullet",
  "align",
  "blockquote",
  "code-block",
  "link",
  "video",
  // Cần whitelist "image" để Quill render được thẻ <img> do handler ở trên
  // chèn vào — nút bấm chèn ảnh trực tiếp (upload) đã bị gỡ khỏi toolbar nên
  // whitelist này KHÔNG mở lại đường upload base64.
  "image",
  // v0.10.16: whitelist 2 format vừa đăng ký ở trên — thiếu bước này thì dù
  // đã có blot, ReactQuill vẫn tự lọc bỏ mọi format không nằm trong danh
  // sách `formats` truyền vào (xem cách "image"/"video" đã phải khai báo
  // tương tự).
  "video-file",
  "audio-file",
];

/**
 * props: value (HTML string), onChange
 */
export default function QuillEditor({ value, onChange, placeholder }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const quillRef = useRef(null);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  // Lưu range selection tại thời điểm mở dialog (tránh mất con trỏ khi focus vào TextField)
  const pendingRangeRef = useRef(null);

  const openMediaDialog = useCallback(function insertClassifiedMedia() {
    const quill = this.quill;
    pendingRangeRef.current = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
    setMediaDialogOpen(true);
  }, []);

  const handleMediaSubmit = useCallback(
    (url) => {
      const media = classifyMediaUrl(url);
      const html = buildMediaHtml(media);
      const quill = quillRef.current?.getEditor();
      if (!quill) return;

      const range = pendingRangeRef.current || { index: quill.getLength(), length: 0 };
      quill.clipboard.dangerouslyPasteHTML(range.index, html, "user");
      quill.setSelection(range.index + 1, 0, "user");
      pendingRangeRef.current = null;
    },
    []
  );

  const modules = React.useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["blockquote", "code-block"],
          ["link", "video"],
          ["clean"],
        ],
        handlers: {
          video: openMediaDialog,
        },
      },
      clipboard: {
        matchVisual: false,
      },
    }),
    [openMediaDialog]
  );

  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;

    // Chỉ chặn ảnh dạng base64 (data:...) khi dán — đây mới là nguồn phình
    // dữ liệu Firestore thực sự. Ảnh trỏ tới URL bên ngoài (http/https),
    // kể cả ảnh do chính handler "video" ở trên tự chèn, vẫn được giữ lại
    // bình thường.
    const clipboard = editor.getModule("clipboard");
    clipboard.addMatcher("IMG", (node, delta) => {
      const src = node.getAttribute("src") || "";
      if (src.startsWith("data:")) {
        const Delta = Quill.import("delta");
        return new Delta();
      }
      return delta;
    });
  }, []);

  const borderColor = isDark ? "rgba(230, 225, 233, 0.24)" : "rgba(0, 0, 0, 0.23)";
  const borderSubtle = isDark ? "rgba(230, 225, 233, 0.12)" : "rgba(0, 0, 0, 0.12)";
  const surface = isDark ? theme.palette.background.paper : "#fff";
  const ink = isDark ? theme.palette.text.primary : "#1C1B1F";
  const inkMuted = isDark ? theme.palette.text.secondary : "#444";
  const stroke = isDark ? "rgba(230, 225, 233, 0.55)" : "#444";

  return (
    <>
      <div className={`twelve-quill-wrap${isDark ? " twelve-quill-wrap--dark" : ""}`}>
        <ReactQuill
          ref={quillRef}
          theme="snow"
          value={value}
          onChange={onChange}
          modules={modules}
          formats={formats}
          placeholder={placeholder || "Bạn đang nghĩ gì..."}
          style={{ minHeight: 220 }}
        />
      </div>
      <style>{`
        /* Khung Quill đồng bộ TextField; dark mode theo theme MUI */
        .twelve-quill-wrap {
          overflow: visible;
          max-width: 100%;
          border: 1px solid ${borderColor};
          border-radius: 8px;
          background: ${surface};
          color: ${ink};
          transition: border-color 0.15s, background-color 0.15s;
        }
        .twelve-quill-wrap:focus-within {
          border-color: ${theme.palette.primary.main};
          border-width: 2px;
          margin: -1px;
        }
        .twelve-quill-wrap .ql-toolbar.ql-snow {
          overflow: visible;
          border: none;
          border-bottom: 1px solid ${borderSubtle};
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          font-family: inherit;
          background: ${surface};
        }
        .twelve-quill-wrap .ql-container.ql-snow {
          border: none;
          border-bottom-left-radius: 8px;
          border-bottom-right-radius: 8px;
          font-family: inherit;
          min-height: 180px;
          background: ${surface};
          color: ${ink};
        }
        .twelve-quill-wrap .ql-editor {
          min-height: 180px;
          color: ${ink};
        }
        .twelve-quill-wrap .ql-editor.ql-blank::before {
          color: ${inkMuted};
          font-style: normal;
        }
        .twelve-quill-wrap .ql-stroke {
          stroke: ${stroke};
        }
        .twelve-quill-wrap .ql-fill {
          fill: ${stroke};
        }
        .twelve-quill-wrap .ql-picker {
          color: ${ink};
        }
        .twelve-quill-wrap .ql-picker-label {
          color: ${ink};
        }
        .twelve-quill-wrap .ql-picker-options {
          background: ${surface} !important;
          border-color: ${borderSubtle} !important;
          color: ${ink};
          z-index: 20;
        }
        /* Header/size picker nằm bên trái — neo left, không ép right (tránh cắt nửa) */
        .twelve-quill-wrap .ql-toolbar .ql-picker.ql-header .ql-picker-options,
        .twelve-quill-wrap .ql-toolbar .ql-picker.ql-size .ql-picker-options {
          left: 0 !important;
          right: auto !important;
          max-width: min(220px, calc(100vw - 48px));
        }
        /* Color / background — neo phải trong toolbar hẹp mobile */
        .twelve-quill-wrap .ql-toolbar .ql-color .ql-picker-options,
        .twelve-quill-wrap .ql-toolbar .ql-background .ql-picker-options {
          left: auto !important;
          right: 0 !important;
          width: 152px;
          padding: 6px;
          max-width: min(152px, calc(100vw - 32px));
        }
        .twelve-quill-wrap .ql-toolbar .ql-align .ql-picker-options {
          left: auto !important;
          right: 0 !important;
        }
      `}</style>
      <MediaUrlDialog
        open={mediaDialogOpen}
        onClose={() => setMediaDialogOpen(false)}
        onSubmit={handleMediaSubmit}
      />
    </>
  );
}
