const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/countries.controller");

router.get("/", ctrl.listCountries);

module.exports = router;
