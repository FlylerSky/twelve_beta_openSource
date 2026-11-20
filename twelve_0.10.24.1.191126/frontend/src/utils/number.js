/**
 * Định dạng số đếm (like / dislike / comment / …) cho giao diện Twelve.
 *
 * Quy ước:
 * - < 1000          → số nguyên đầy đủ (0 … 999)
 * - ≥ 1_000         → K (nghìn)
 * - ≥ 1_000_000     → M (triệu)
 * - ≥ 1_000_000_000 → B (tỷ)
 * - ≥ 1e12          → T (nghìn tỷ)
 *
 * Chỉ dùng ở frontend để hiển thị. Backend / Firestore giữ nguyên số đầy đủ
 * phục vụ tính toán. Có thể tái sử dụng cho mọi chỉ số tăng/giảm không xác định.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 *
 * @example
 * formatCount(42)           // "42"
 * formatCount(999)          // "999"
 * formatCount(1000)         // "1K"
 * formatCount(1500)         // "1.5K"
 * formatCount(12097e12)     // rất lớn → "T"
 * formatCount(1209748383894838300) // "1.2E" không — dùng B/T
 */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.floor(n));

  const units = [
    { threshold: 1e12, suffix: "T" },
    { threshold: 1e9, suffix: "B" },
    { threshold: 1e6, suffix: "M" },
    { threshold: 1e3, suffix: "K" },
  ];

  for (const { threshold, suffix } of units) {
    if (n >= threshold) {
      const scaled = n / threshold;
      // ≥ 100 đơn vị: không lấy thập phân (100K, 999M)
      // 10–99.9: tối đa 1 chữ số thập phân
      // < 10: tối đa 1 chữ số thập phân
      let text;
      if (scaled >= 100) {
        text = String(Math.floor(scaled));
      } else {
        text = (Math.round(scaled * 10) / 10).toString();
        if (text.endsWith(".0")) text = text.slice(0, -2);
      }
      return text + suffix;
    }
  }

  return String(Math.floor(n));
}

/**
 * Định dạng số CÓ THỂ ÂM (hiện chỉ dùng cho Điểm bài viết — `postScore`).
 *
 * `formatCount` ở trên cố tình clamp mọi giá trị ≤ 0 về "0" vì nó được thiết
 * kế cho các bộ đếm luôn không âm (view/like/dislike/comment/share — không
 * có khái niệm "âm 5 lượt xem"). Nhưng postScore có trọng số âm (1 dislike =
 * -2 điểm) nên CÓ THỂ âm hợp lệ — dùng thẳng formatCount cho nó sẽ hiển thị
 * sai thành "0" thay vì "-2" (bug đã gặp ở v0.8.6).
 *
 * `formatScore` tái dùng logic quy đổi K/M/B/T của formatCount trên trị
 * tuyệt đối, rồi thêm dấu "-" nếu giá trị gốc âm.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 *
 * @example
 * formatScore(-2)     // "-2"
 * formatScore(0)      // "0"
 * formatScore(143)    // "143"
 * formatScore(-12000) // "-12K"
 */
export function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  return sign + formatCount(Math.abs(n));
}
