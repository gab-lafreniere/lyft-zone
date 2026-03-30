const express = require('express');
const { getHomeDashboardHandler } = require('../controllers/cyclesController');

const router = express.Router();

router.get('/dashboard', getHomeDashboardHandler);

module.exports = router;
