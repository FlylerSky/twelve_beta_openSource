/**
 * ==== v0.10.0 — MÃ TUẦN cho trang Xu hướng (Trending) ====
 *
 * Định dạng: "N.K.MM.YYYY"
 *   - N: số tuần TỔNG, tăng dần vô hạn kể từ tuần đầu tiên hệ thống hiệu lực
 *        (không reset theo tháng/năm).
 *   - K: số tuần TRONG THÁNG đó, từ 1 đến 4 — mỗi tháng luôn được chia
 *        thành đúng 4 "tuần" theo NGÀY TRONG THÁNG (không phải tuần lịch
 *        ISO): ngày 1-7 = tuần 1, 8-14 = tuần 2, 15-21 = tuần 3, 22 đến hết
 *        tháng = tuần 4 (tuần 4 dài ngắn khác nhau tuỳ tháng có 28-31 ngày —
 *        đây là đánh đổi có chủ đích để giữ đúng quy tắc "mỗi tháng 4 tuần").
 *   - MM.YYYY: tháng/năm dương lịch của tuần đó.
 *
 * Ví dụ "1.3.09.2026": tuần tổng thứ 1 của hệ thống, đúng vào tuần 3 của
 * tháng 9/2026 — nghĩa là hệ thống bắt đầu hiệu lực (N=1) vào 1 ngày nằm
 * trong khoảng 15-21/09/2026, KHÔNG nhất thiết là đầu tháng.
 *
 * MỐC HIỆU LỰC (epoch — ngày mà tuần đó được tính là N=1): cấu hình qua biến
 * môi trường `TRENDING_EPOCH_DATE` (định dạng YYYY-MM-DD). Đây là 1 hằng số
 * CẤU HÌNH, không phải dữ liệu lịch sử đã ghi — có thể chỉnh sửa AN TOÀN bất
 * cứ lúc nào TRƯỚC KHI có tuần nào thực sự được chốt/lưu vào
 * `weeklyLeaderboards` (xem trending.controller.js). Mặc định dùng NGÀY
 * TRIỂN KHAI tính năng này (xem DEFAULT_EPOCH bên dưới) nếu chưa cấu hình —
 * nếu Twelve thực ra đã "hiệu lực" từ trước đó, hãy đặt
 * `TRENDING_EPOCH_DATE` cho đúng rồi deploy TRƯỚC khi tuần đầu tiên kết
 * thúc, để tránh phải sửa lại dữ liệu đã lưu vĩnh viễn.
 */
const DEFAULT_EPOCH = "2026-09-19";

function weekOfMonth(day) {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function parseEpoch() {
  const raw = process.env.TRENDING_EPOCH_DATE || DEFAULT_EPOCH;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) {
    console.error(`TRENDING_EPOCH_DATE không hợp lệ ("${raw}"), dùng mặc định ${DEFAULT_EPOCH}.`);
    const [y, mo, d] = DEFAULT_EPOCH.split("-").map(Number);
    return { year: y, month: mo, K: weekOfMonth(d) };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return { year, month, K: weekOfMonth(day) };
}

/**
 * @param {Date} [date] mặc định thời điểm hiện tại
 * @returns {{ code: string, N: number, K: number, month: number, year: number }}
 */
function getWeekInfo(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const K = weekOfMonth(date.getDate());

  const epoch = parseEpoch();
  const monthsElapsed = (year - epoch.year) * 12 + (month - epoch.month);
  const N = monthsElapsed * 4 + (K - epoch.K) + 1;

  const code = `${N}.${K}.${String(month).padStart(2, "0")}.${year}`;
  return { code, N, K, month, year };
}

module.exports = { getWeekInfo };
