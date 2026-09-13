const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

/**
 * GET /api/countries
 * Trả danh sách quốc gia lấy từ Firestore, luôn xếp "Other / Khác" ở cuối cùng.
 */
async function listCountries(req, res) {
  try {
    const snap = await db.collection(COLLECTIONS.COUNTRIES).orderBy("order", "asc").get();
    const countries = snap.docs.map((d) => d.data());
    return res.json({ countries });
  } catch (err) {
    console.error("listCountries error:", err);
    return res.status(500).json({ error: "Không tải được danh sách quốc gia." });
  }
}

module.exports = { listCountries };
