import React, { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Video from "yet-another-react-lightbox/plugins/video";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";

/**
 * Trình xem media của Twelve (v0.5) — dựa trên yet-another-react-lightbox.
 * Hỗ trợ: ảnh (zoom/pan), video file (mp4/webm…), gallery nhiều slide,
 * đếm số slide, tải xuống. YouTube/Vimeo vẫn xem inline trong bài (iframe).
 *
 * props:
 * - open: boolean
 * - slides: Array<{ type?: 'image'|'video', src: string, sources?: [...] }>
 * - index: số thứ tự slide mở đầu
 * - onClose: () => void
 */
export default function MediaLightbox({ open, slides = [], index = 0, onClose }) {
  const normalized = useMemo(
    () =>
      (slides || [])
        .filter((s) => s && s.src)
        .map((s) => {
          if (s.type === "video") {
            return {
              type: "video",
              sources: s.sources || [{ src: s.src, type: s.mime || "video/mp4" }],
              poster: s.poster,
              download: s.src,
            };
          }
          return {
            type: "image",
            src: s.src,
            alt: s.alt || "",
            download: s.src,
          };
        }),
    [slides]
  );

  if (!normalized.length) return null;

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={Math.min(Math.max(0, index), normalized.length - 1)}
      slides={normalized}
      plugins={[Zoom, Video, Counter, Download]}
      carousel={{ finite: normalized.length <= 1, padding: "16px" }}
      animation={{ fade: 250 }}
      controller={{ closeOnBackdropClick: true }}
      zoom={{
        maxZoomPixelRatio: 4,
        scrollToZoom: true,
        doubleTapDelay: 300,
      }}
      video={{
        controls: true,
        playsInline: true,
        autoPlay: true,
      }}
      styles={{
        container: { backgroundColor: "rgba(0,0,0,0.92)" },
      }}
    />
  );
}

/**
 * Quét HTML nội dung bài viết (và cover) để dựng danh sách slide cho lightbox.
 * Trả về { slides, indexOf(src) }.
 */
export function collectMediaSlides(contentHtml, coverImageUrl) {
  const slides = [];
  const seen = new Set();

  const pushImage = (src, alt = "") => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    slides.push({ type: "image", src, alt });
  };
  const pushVideo = (src) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    const lower = src.toLowerCase();
    let mime = "video/mp4";
    if (lower.includes(".webm")) mime = "video/webm";
    else if (lower.includes(".ogg") || lower.includes(".ogv")) mime = "video/ogg";
    slides.push({ type: "video", src, mime });
  };

  if (coverImageUrl) pushImage(coverImageUrl, "Ảnh bìa");

  if (contentHtml && typeof document !== "undefined") {
    const doc = new DOMParser().parseFromString(contentHtml, "text/html");
    doc.querySelectorAll("img[src]").forEach((img) => pushImage(img.getAttribute("src"), img.getAttribute("alt") || ""));
    doc.querySelectorAll("video[src]").forEach((v) => pushVideo(v.getAttribute("src")));
    doc.querySelectorAll("video source[src]").forEach((s) => pushVideo(s.getAttribute("src")));
  }

  return slides;
}

export function findSlideIndex(slides, src) {
  if (!src || !slides?.length) return 0;
  const i = slides.findIndex((s) => s.src === src);
  return i >= 0 ? i : 0;
}
