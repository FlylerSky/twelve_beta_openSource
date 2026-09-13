const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

/**
 * GET /api/version
 * Trả về phiên bản Backend lấy từ Firestore (config/version).
 * Phiên bản Frontend được lấy trực tiếp từ file version.json của chính frontend
 * (không qua API này) như yêu cầu trong thiết kế Menu ở trang INDEX.
 */
async function getVersion(req, res) {
  try {
    const snap = await db.collection(COLLECTIONS.CONFIG).doc("version").get();
    const backendVersion = snap.exists ? snap.data().backend : process.env.BACKEND_VERSION || "0.1.0";
    return res.json({ backend: backendVersion });
  } catch (err) {
    console.error("getVersion error:", err);
    return res.status(500).json({ error: "Không lấy được phiên bản backend." });
  }
}

module.exports = { getVersion };
