/**
 * Phân loại 1 URL người dùng dán vào để biết nên nhúng vào bài viết dưới
 * dạng gì: ảnh (<img>), video file (<video>), YouTube/Vimeo (<iframe> đúng
 * embed URL), hay trang web bất kỳ (fallback <iframe> chung).
 *
 * Đây là gốc rễ của việc "trang POST không co giãn đúng" ở bản trước: nút
 * video của Quill.js mặc định LUÔN bọc mọi URL vào 1 <iframe>, kể cả URL ảnh
 * hay file video trực tiếp — trình duyệt hiển thị nội dung đó ở kích thước
 * gốc bên trong khung, gây tràn/scroll. Phân loại theo URL trước khi chèn
 * giải quyết tận gốc vấn đề này.
 */
export function classifyMediaUrl(rawUrl) {
  const url = (rawUrl || "").trim();

  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i
  );
  if (youtubeMatch) {
    return { type: "youtube", embedUrl: `https://www.youtube.com/embed/${youtubeMatch[1]}` };
  }

  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeoMatch) {
    return { type: "vimeo", embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  }

  if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
    return { type: "image", url };
  }

  if (/\.(mp4|webm|ogv|ogg|mov|m4v)(\?.*)?$/i.test(url)) {
    return { type: "video-file", url };
  }

  // Không nhận diện được -> nhúng như 1 trang web chung (giới hạn: nội dung
  // bên trong 1 trang web cross-origin không thể ép co giãn/ẩn scrollbar từ
  // bên ngoài do chính sách same-origin của trình duyệt).
  return { type: "webpage", url };
}

/**
 * Dựng HTML an toàn (qua DOM API, không nối chuỗi thủ công) tương ứng với
 * loại media đã phân loại, để chèn vào Quill bằng
 * quill.clipboard.dangerouslyPasteHTML().
 */
export function buildMediaHtml(media) {
  const wrapper = document.createElement("div");

  if (media.type === "image") {
    const img = document.createElement("img");
    img.src = media.url;
    wrapper.appendChild(img);
  } else if (media.type === "video-file") {
    const video = document.createElement("video");
    video.src = media.url;
    video.setAttribute("controls", "");
    wrapper.appendChild(video);
  } else if (media.type === "youtube" || media.type === "vimeo") {
    const iframe = document.createElement("iframe");
    iframe.src = media.embedUrl;
    iframe.className = "ql-video";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allowfullscreen", "true");
    wrapper.appendChild(iframe);
  } else {
    const iframe = document.createElement("iframe");
    iframe.src = media.url;
    iframe.className = "ql-video ql-embed-webpage";
    iframe.setAttribute("frameborder", "0");
    // Best-effort ẩn scrollbar nội bộ trang nhúng — không thể can thiệp sâu
    // hơn vào nội dung của 1 trang cross-origin.
    iframe.setAttribute("scrolling", "no");
    wrapper.appendChild(iframe);
  }

  return wrapper.innerHTML;
}
