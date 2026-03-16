const express = require('express');
const {
  createCycleHandler,
  createPlanForCycleHandler,
  getCycleFullHandler,
} = require('../controllers/cyclesController');

const router = express.Router();

router.post('/', createCycleHandler);
router.post('/:cycleId/plans', createPlanForCycleHandler);
router.get('/:cycleId/full', getCycleFullHandler);

module.exports = router;
