const express = require('express');
const {
  createScheduledSessionsHandler,
  listScheduledSessionsHandler,
} = require('../controllers/scheduledSessionsController');

const router = express.Router();

router.post('/', createScheduledSessionsHandler);
router.get('/', listScheduledSessionsHandler);

module.exports = router;
