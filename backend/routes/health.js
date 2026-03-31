const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

module.exports = router;