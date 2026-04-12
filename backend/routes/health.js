const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');

router.get('/', async (req, res) => {
  const startedAt = Date.now();

  try {
    const prisma = getPrisma();

    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      ok: true,
      db: 'up',
      uptime: process.uptime(),
      responseTimeMs: Date.now() - startedAt,
      timestamp: Date.now(),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      db: 'down',
      uptime: process.uptime(),
      responseTimeMs: Date.now() - startedAt,
      timestamp: Date.now(),
      error: error?.message || 'database not ready',
    });
  }
});

module.exports = router;