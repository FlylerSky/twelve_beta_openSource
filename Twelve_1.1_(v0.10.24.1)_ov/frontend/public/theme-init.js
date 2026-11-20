/*
 * v0.10.18 — script chống "nháy sáng" (flash of wrong theme), TÁCH RA từ script
 * inline trong index.html để CSP không cần 'unsafe-inline' cho script (báo cáo
 * bảo mật M-3). Nội dung/hành vi GIỮ NGUYÊN so với bản inline v0.9.0:
 * đọc lựa chọn giao diện đã lưu và set màu nền NGAY, TRƯỚC khi React chạy.
 *
 * QUAN TRỌNG:
 *  - Khoá localStorage "twelve_theme_mode" PHẢI khớp `STORAGE_KEY` trong
 *    src/context/ThemeModeContext.jsx.
 *  - 2 màu nền PHẢI khớp `background.default` (light/dark) ở src/theme/theme.js.
 *  - index.html nạp file này bằng thẻ <script> ĐỒNG BỘ (không async/defer)
 *    đặt trong <head> — đồng bộ mới chạy trước lần vẽ đầu tiên.
 */
(function () {
  try {
    var stored = localStorage.getItem("twelve_theme_mode");
    var isDark =
      stored === "dark" ||
      ((!stored || stored === "system") &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.style.backgroundColor = isDark ? "#141218" : "#FFFBFE";
  } catch (e) {
    // localStorage bị chặn hoặc lỗi khác — bỏ qua, để React tự set màu nền
    // như bình thường (chỉ mất phần chống-nháy, không ảnh hưởng gì khác).
  }
})();
