const express = require('express');
const { getCanonicalHomeDashboardHandler } = require('../controllers/cyclesController');

const router = express.Router();

router.get('/dashboard', getCanonicalHomeDashboardHandler);

module.exports = router;
