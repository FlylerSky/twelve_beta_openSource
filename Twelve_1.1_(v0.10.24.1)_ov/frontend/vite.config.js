import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// LƯU Ý (v0.2 — vá lỗi "trang bị reload mỗi khi chuyển tab trình duyệt"):
// Đây là hành vi đặc trưng của Vite dev server: khi tab bị trình duyệt cho vào
// nền (background), các browser hiện đại throttle/tạm ngưng kết nối WebSocket
// dùng cho HMR. Khi quay lại tab, Vite client phát hiện socket đã đóng không
// "sạch" (wasClean=false) và mặc định làm `location.reload()` để đồng bộ lại
// module graph — gây cảm giác "web tự reload khi đổi tab". Lỗi này CHỈ xảy ra
// ở môi trường DEV (npm run dev), KHÔNG xảy ra ở bản build production deploy
// trên Vercel (không còn WebSocket HMR). Cấu hình dưới đây giảm thiểu tình
// trạng rớt kết nối: chỉ định rõ giao thức/host cho HMR (tránh Vite tự đoán
// sai khi chạy sau proxy/tunnel) và bật polling cho file watcher (ổn định hơn
// trong môi trường container/sandbox).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    hmr: {
      overlay: false,
      // Nếu bạn chạy dev server sau 1 proxy/tunnel (vd: Codespaces, ngrok...),
      // hãy khai báo đúng host/port công khai tại đây để tránh rớt kết nối:
      // host: "your-public-host",
      // clientPort: 443,
      // protocol: "wss",
    },
    watch: {
      usePolling: true,
    },
  },
});
