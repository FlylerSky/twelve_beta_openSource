const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/embedDomains.controller");
const assetsCtrl = require("../controllers/assets.controller");
const { requireAuth, requireActive } = require("../middleware/auth");
const { requireSA } = require("../middleware/roles");

// v0.10.15 — tab "Quản trị" (Settings, chỉ SA). Mọi route trong file này bắt
// buộc SA — áp router.use() để route thêm sau này không lỡ quên gắn quyền.
router.use(requireAuth, requireActive, requireSA);

router.get("/embed-domains", ctrl.getEmbedDomainsSettings);
router.put("/embed-domains", ctrl.updateEmbedDomainsSettings);

// v0.10.20 — giám sát tài nguyên Cloudinary do người dùng upload.
router.get("/assets/stats", assetsCtrl.getAssetStats);

module.exports = router;
