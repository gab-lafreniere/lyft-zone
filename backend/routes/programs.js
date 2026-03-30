const express = require('express');
const { getProgramsOverviewHandler } = require('../controllers/cyclesController');

const router = express.Router();

router.get('/overview', getProgramsOverviewHandler);

module.exports = router;
