const assetsService = require("../services/assets.service");

/**
 * GET /api/admin/assets/stats  (chỉ SA — router admin đã áp requireSA)
 * ?refresh=1 để bỏ qua cache 60 giây.
 * Trả về: số lượng/dung lượng asset theo loại (sổ `assets`), top người upload nhiều
 * nhất, và dung lượng thật của tài khoản Cloudinary — để so khớp, phát hiện rò rỉ sớm.
 */
async function getAssetStats(req, res) {
  try {
    const data = await assetsService.getAssetStats({ force: req.query.refresh === "1" });
    return res.json(data);
  } catch (err) {
    console.error("getAssetStats error:", err);
    return res.status(500).json({ error: "Không lấy được thống kê tài nguyên." });
  }
}

module.exports = { getAssetStats };
