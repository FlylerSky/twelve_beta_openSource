/**
 * Phân loại 1 URL người dùng dán vào để biết nên nhúng vào bài viết dưới
 * dạng gì: ảnh (<img>), video/audio file trực tiếp kể cả URL Cloudinary
 * không có đuôi file (<video>/<audio>), YouTube/Vimeo/Twitch/SoundCloud/
 * Spotify (<iframe> đúng embed URL), hay trang web bất kỳ (fallback
 * <iframe> chung — xem cảnh báo ở cuối hàm).
 *
 * Đây là gốc rễ của việc "trang POST không co giãn đúng" ở bản trước: nút
 * video của Quill.js mặc định LUÔN bọc mọi URL vào 1 <iframe>, kể cả URL ảnh
 * hay file video trực tiếp — trình duyệt hiển thị nội dung đó ở kích thước
 * gốc bên trong khung, gây tràn/scroll. Phân loại theo URL trước khi chèn
 * giải quyết tận gốc vấn đề này.
 *
 * ==== v0.10.13 — mở rộng danh sách nền tảng media trực tiếp được NHẬN DIỆN
 * ĐÚNG (Twitch/SoundCloud/Spotify) ====
 * Trước bản này, các URL này rơi vào nhánh "webpage" chung — hiển thị BÌNH
 * THƯỜNG ở đây (trình soạn thảo, chưa qua sanitize) nhưng bị BACKEND XOÁ
 * SẠCH khi lưu bài (`sanitizeHtml` chỉ cho iframe từ domain đã allowlist —
 * xem backend/src/services/sanitize.service.js) — bug im lặng, khó phát
 * hiện. Danh sách domain ở ĐÂY và ở `ALLOWED_IFRAME_SRC` (backend) PHẢI
 * khớp nhau — thêm 1 nền tảng mới thì sửa CẢ 2 nơi.
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

  // Twitch: parent PHẢI khớp domain đang chạy trang (yêu cầu bảo mật riêng
  // của Twitch, không liên quan CSP/sanitize ở trên) — dùng
  // window.location.hostname, đúng cho mọi môi trường (dev/prod) tự động.
  const twitchParent = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const twitchClipMatch = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)|twitch\.tv\/\w+\/clip\/([a-zA-Z0-9_-]+)/i);
  if (twitchClipMatch) {
    const slug = twitchClipMatch[1] || twitchClipMatch[2];
    return { type: "twitch-clip", embedUrl: `https://clips.twitch.tv/embed?clip=${slug}&parent=${twitchParent}` };
  }
  const twitchVodMatch = url.match(/twitch\.tv\/(?:videos|\w+\/video)\/(\d+)/i);
  if (twitchVodMatch) {
    return { type: "twitch-vod", embedUrl: `https://player.twitch.tv/?video=${twitchVodMatch[1]}&parent=${twitchParent}` };
  }
  const twitchChannelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]{3,25})\/?$/i);
  if (twitchChannelMatch) {
    return { type: "twitch-live", embedUrl: `https://player.twitch.tv/?channel=${twitchChannelMatch[1]}&parent=${twitchParent}` };
  }

  // SoundCloud: chấp nhận mọi URL soundcloud.com hợp lệ (track/playlist/live
  // set...), bọc nguyên văn qua player chính thức của SoundCloud.
  if (/^https?:\/\/(www\.)?soundcloud\.com\//i.test(url)) {
    return {
      type: "soundcloud",
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&show_comments=false`,
    };
  }

  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i);
  if (spotifyMatch) {
    return { type: "spotify", embedUrl: `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}` };
  }

  if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
    return { type: "image", url };
  }

  if (/\.(mp4|webm|ogv|mov|m4v)(\?.*)?$/i.test(url)) {
    return { type: "video-file", url };
  }

  // v0.10.13: file âm thanh trực tiếp (link CDN .mp3/.wav/...) — trước đây
  // KHÔNG có nhánh riêng, rơi vào "webpage" rồi bị xoá sạch khi lưu (thẻ
  // <audio> còn chưa từng nằm trong allowlist backend, xem sanitize.service.js).
  if (/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)(\?.*)?$/i.test(url)) {
    return { type: "audio-file", url };
  }

  // ==== v0.10.16 — URL Cloudinary KHÔNG có phần mở rộng file ====
  // `secure_url` Cloudinary trả về thường KHÔNG có đuôi file (`.mp4`,
  // `.mp3`...) khi upload không ép `format` cụ thể hoặc dùng biến đổi
  // `f_auto` — 2 nhánh extension ở trên bỏ lỡ hoàn toàn các URL này, khiến
  // chúng rơi xuống nhánh "webpage" chung bên dưới. Khác với lỗi domain-list
  // (xem docblock đầu file): đây KHÔNG PHẢI vấn đề domain có được SA cho
  // phép hay không — đây là 1 file media THẬT, chỉ là chưa được NHẬN DIỆN
  // đúng loại trước khi tới bước domain-check. Nhận diện theo CẤU TRÚC
  // ĐƯỜNG DẪN đặc trưng của Cloudinary (`/image/upload/` hay `/video/upload/`,
  // áp dụng luôn cho domain riêng dạng CNAME nếu path vẫn giữ nguyên cấu
  // trúc chuẩn) để dựng thẳng <img>/<video> — HOÀN TOÀN không qua iframe,
  // nên không còn phụ thuộc danh sách domain SA quản lý nữa (giống cách xử
  // lý Twitch/SoundCloud/Spotify ở trên, chỉ khác là dùng thẻ media trực
  // tiếp thay vì iframe của bên thứ 3).
  //
  // Cloudinary xem file âm thanh là resource_type "video" (không có path
  // "/audio/upload/" riêng) nên không thể phân biệt chắc chắn video/audio
  // chỉ từ URL khi thiếu đuôi file — ưu tiên trả về "video-file": trình
  // duyệt vẫn phát ĐƯỢC file audio-only qua thẻ <video> (hiện control,
  // không có khung hình) nên không mất tính năng, chỉ hơi kém đẹp so với
  // <audio> ở giao diện. Nếu người dùng dán URL có đuôi .mp3/.wav/... thì 2
  // nhánh extension ở trên đã xử lý đúng thành "audio-file" trước khi tới
  // đây rồi, không bị nhánh này đè lên.
  const cloudinaryMatch = url.match(/^https?:\/\/[^/]*\bcloudinary\.com\/[^/]+\/(image|video)\/upload\//i);
  if (cloudinaryMatch) {
    return cloudinaryMatch[1] === "image" ? { type: "image", url } : { type: "video-file", url };
  }

  // Không nhận diện được -> nhúng như 1 trang web chung (giới hạn kép: (1)
  // nội dung bên trong 1 trang web cross-origin không thể ép co giãn/ẩn
  // scrollbar từ bên ngoài do chính sách same-origin của trình duyệt; (2)
  // TRỪ trường hợp trang đó nằm trong danh sách domain được backend cho
  // phép nhúng ở trên, iframe này sẽ BỊ XOÁ SẠCH khi lưu bài — xem cảnh báo
  // ở MediaUrlDialog.jsx).
  return { type: "webpage", url };
}

/**
 * Các loại media render bằng <iframe> — dùng chung 1 nhánh dựng HTML trong
 * `buildMediaHtml` bên dưới (chỉ khác `embedUrl`). Tách riêng nhóm "video"
 * (tỉ lệ khung hình 16:9 hợp lý — YouTube/Vimeo/Twitch) khỏi nhóm "audio"
 * (SoundCloud/Spotify — player gốc vốn THẤP, ép 16:9 sẽ bị kéo dãn xấu, xem
 * CSS tương ứng ở PostContent.jsx).
 */
const IFRAME_VIDEO_TYPES = new Set(["youtube", "vimeo", "twitch-live", "twitch-vod", "twitch-clip"]);
const IFRAME_AUDIO_TYPES = new Set(["soundcloud", "spotify"]);

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
  } else if (media.type === "audio-file") {
    const audio = document.createElement("audio");
    audio.src = media.url;
    audio.setAttribute("controls", "");
    wrapper.appendChild(audio);
  } else if (IFRAME_VIDEO_TYPES.has(media.type)) {
    const iframe = document.createElement("iframe");
    iframe.src = media.embedUrl;
    iframe.className = "ql-video";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allowfullscreen", "true");
    wrapper.appendChild(iframe);
  } else if (IFRAME_AUDIO_TYPES.has(media.type)) {
    const iframe = document.createElement("iframe");
    iframe.src = media.embedUrl;
    iframe.className = "ql-audio-embed";
    iframe.setAttribute("frameborder", "0");
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
