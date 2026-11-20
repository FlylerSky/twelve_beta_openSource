import dayjs from "dayjs";
import "dayjs/locale/vi";

dayjs.locale("vi");

// Firestore Timestamp (từ serverTimestamp) khi trả qua JSON có dạng { _seconds, _nanoseconds }
function toDayjs(value) {
  if (!value) return null;
  if (typeof value === "object" && value._seconds !== undefined) {
    return dayjs.unix(value._seconds);
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return dayjs(value.toDate());
  }
  return dayjs(value);
}

/**
 * Hiển thị thời gian đăng bài:
 * - Dưới 1 phút  → "Vài giây trước"
 * - Dưới 1 giờ   → "N phút trước"
 * - Dưới 1 ngày  → "N giờ trước"
 * - Từ 1 ngày trở lên → "H:mm:ss D/M/YYYY" (giờ:phút:giây ngày/tháng/năm)
 */
export function formatRelativeTime(value) {
  const date = toDayjs(value);
  if (!date || !date.isValid()) return "";

  const now = dayjs();
  const diffSec = now.diff(date, "second");
  const diffMin = now.diff(date, "minute");
  const diffHour = now.diff(date, "hour");

  // Tương lai (lệch đồng hồ) → hiện tuyệt đối
  if (diffSec < 0) return date.format("H:mm:ss D/M/YYYY");

  if (diffSec < 60) return "Vài giây trước";
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHour < 24) return `${diffHour} giờ trước`;

  // ≥ 1 ngày
  return date.format("H:mm:ss D/M/YYYY");
}
