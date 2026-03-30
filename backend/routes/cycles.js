const express = require('express');
const {
  createCycleFromWeeklyPlanHandler,
  createCycleHandler,
  createPlanForCycleHandler,
  deleteCycleHandler,
  extendCycleDraftHandler,
  getCycleDetailsHandler,
  getCycleFullHandler,
  getHomeDashboardHandler,
  getProgramsOverviewHandler,
  openOrCreateCycleEditDraftHandler,
  publishCycleDraftHandler,
  rescheduleUpcomingCycleHandler,
  updateCycleDraftHandler,
} = require('../controllers/cyclesController');

const router = express.Router();

router.get('/overview', getProgramsOverviewHandler);
router.get('/home-dashboard', getHomeDashboardHandler);
router.post('/from-weekly-plan', createCycleFromWeeklyPlanHandler);
router.post('/', createCycleHandler);
router.post('/:cycleId/plans', createPlanForCycleHandler);
router.get('/:cycleId/full', getCycleFullHandler);
router.get('/:cycleId', getCycleDetailsHandler);
router.post('/:cycleId/edit-draft', openOrCreateCycleEditDraftHandler);
router.patch('/:cycleId/drafts/:planId', updateCycleDraftHandler);
router.post('/:cycleId/publish', publishCycleDraftHandler);
router.post('/:cycleId/reschedule', rescheduleUpcomingCycleHandler);
router.post('/:cycleId/draft-extension', extendCycleDraftHandler);
router.delete('/:cycleId', deleteCycleHandler);

module.exports = router;
