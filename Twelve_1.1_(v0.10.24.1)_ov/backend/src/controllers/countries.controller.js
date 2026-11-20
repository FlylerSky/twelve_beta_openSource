const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

/**
 * ==== TỐI ƯU v0.8.28 [HIỆU NĂNG] — Cache danh sách quốc gia trong bộ nhớ ====
 * Danh sách quốc gia là DỮ LIỆU THAM CHIẾU TĨNH — gần như không bao giờ đổi
 * (chỉ đổi khi chạy lại `seedCountries.js`). TRƯỚC ĐÂY mỗi lần gọi
 * `GET /api/countries` (mỗi lần load trang Đăng ký) đều quét lại TOÀN BỘ
 * collection từ Firestore — lãng phí không cần thiết cho dữ liệu tĩnh.
 *
 * FIX: cache trong bộ nhớ với TTL (thay vì cache vĩnh viễn) — vẫn tự làm mới
 * nếu admin chạy lại seed trong lúc server đang sống, không cần restart, chỉ
 * cần đợi tối đa `COUNTRIES_CACHE_TTL_MS` là cache tự hết hạn và đọc lại.
 */
const COUNTRIES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 giờ
let _countriesCache = null; // { data: [...], cachedAtMs: number } | null

/**
 * GET /api/countries
 * Trả danh sách quốc gia lấy từ Firestore, luôn xếp "Other / Khác" ở cuối cùng.
 */
async function listCountries(req, res) {
  try {
    if (_countriesCache && Date.now() - _countriesCache.cachedAtMs < COUNTRIES_CACHE_TTL_MS) {
      return res.json({ countries: _countriesCache.data });
    }

    const snap = await db.collection(COLLECTIONS.COUNTRIES).orderBy("order", "asc").get();
    const countries = snap.docs.map((d) => d.data());
    _countriesCache = { data: countries, cachedAtMs: Date.now() };
    return res.json({ countries });
  } catch (err) {
    console.error("listCountries error:", err);
    return res.status(500).json({ error: "Không tải được danh sách quốc gia." });
  }
}

module.exports = { listCountries };
