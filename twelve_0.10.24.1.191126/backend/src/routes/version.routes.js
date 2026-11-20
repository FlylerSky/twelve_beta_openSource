const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/version.controller");

router.get("/", ctrl.getVersion);

module.exports = router;
