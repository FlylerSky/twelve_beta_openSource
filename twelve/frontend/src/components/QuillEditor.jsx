import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactQuill, { Quill } from "react-quill";
import "react-quill/dist/quill.snow.css";
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
];

/**
 * props: value (HTML string), onChange
 */
export default function QuillEditor({ value, onChange, placeholder }) {
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

  return (
    <>
      <div className="twelve-quill-wrap">
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
        /* Khung Quill đồng bộ với TextField outlined (bo góc + viền) */
        .twelve-quill-wrap {
          overflow-x: hidden;
          max-width: 100%;
          border: 1px solid rgba(0, 0, 0, 0.23);
          border-radius: 8px;
          background: #fff;
          transition: border-color 0.15s;
        }
        .twelve-quill-wrap:focus-within {
          border-color: var(--mui-palette-primary-main, #7c4dff);
          border-width: 2px;
          /* Giữ kích thước khi viền dày hơn */
          margin: -1px;
        }
        .twelve-quill-wrap .ql-toolbar.ql-snow {
          overflow: visible;
          border: none;
          border-bottom: 1px solid rgba(0, 0, 0, 0.12);
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          font-family: inherit;
        }
        .twelve-quill-wrap .ql-container.ql-snow {
          border: none;
          border-bottom-left-radius: 8px;
          border-bottom-right-radius: 8px;
          font-family: inherit;
          min-height: 180px;
        }
        .twelve-quill-wrap .ql-editor {
          min-height: 180px;
        }
        .twelve-quill-wrap .ql-toolbar .ql-picker-options {
          max-width: min(220px, 80vw);
          left: auto !important;
          right: 0 !important;
        }
        .twelve-quill-wrap .ql-toolbar .ql-color .ql-picker-options,
        .twelve-quill-wrap .ql-toolbar .ql-background .ql-picker-options {
          width: 152px;
          padding: 6px;
        }
        .MuiDialogContent-root {
          overflow-x: hidden;
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
