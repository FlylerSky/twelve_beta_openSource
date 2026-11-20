import { useEffect, useRef, useState } from "react";

/**
 * ==== v0.10.8.2 — tải dần khi cuộn tới (cho dữ liệu ĐÃ có sẵn ở client) ====
 *
 * Khác với IndexPage/BlogPage (mỗi lần "tải thêm" là 1 request API mới,
 * cursor-based), các danh sách ở trang Xu hướng (bảng xếp hạng, danh sách
 * bài viết theo Hashtag, kết quả Tìm kiếm) đã nhận được TOÀN BỘ dữ liệu
 * (tối đa 100/50 phần tử, backend đã giới hạn sẵn) chỉ trong 1 lần gọi API.
 * Vì vậy "tải thêm" ở đây KHÔNG gọi lại API — chỉ tăng dần số phần tử được
 * RENDER ra DOM, để tránh dựng sẵn 100 PostCard/row cùng lúc (nặng, chậm
 * initial paint) — đúng tinh thần "tránh load full kết quả" đã áp dụng ở
 * backend (cache quét + giới hạn số lượng), giờ áp dụng tiếp ở tầng hiển thị.
 *
 * Dùng IntersectionObserver quan sát 1 phần tử "cảm biến" (sentinel) đặt ở
 * cuối danh sách đang hiển thị — khi phần tử này lọt vào viewport (cuộn tới
 * gần cuối), tự động lộ thêm `pageSize` phần tử tiếp theo. Không cần bấm nút.
 *
 * @param {number} totalLength tổng số phần tử đang có sẵn (đã tải xong)
 * @param {number} pageSize số phần tử lộ thêm mỗi lần
 * @returns {{ visibleCount: number, sentinelRef: React.RefObject, hasMore: boolean }}
 */
export default function useIncrementalReveal(totalLength, pageSize = 20) {
  const [visibleCount, setVisibleCount] = useState(Math.min(pageSize, totalLength));
  const sentinelRef = useRef(null);

  // Dữ liệu gốc đổi (vd. đổi mode Cổ điển/Nâng cao, đổi hashtag, tìm kiếm
  // mới) -> reset lại từ đầu, không giữ visibleCount cũ (dễ gây lộ quá số
  // lượng thực tế đang có nếu danh sách mới ngắn hơn).
  useEffect(() => {
    setVisibleCount(Math.min(pageSize, totalLength));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalLength, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= totalLength) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + pageSize, totalLength));
        }
      },
      { rootMargin: "300px" } // lộ thêm SỚM một chút trước khi chạm đáy thật, cuộn mượt hơn
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, totalLength, pageSize]);

  return { visibleCount, sentinelRef, hasMore: visibleCount < totalLength };
}
