const express = require('express');
const {
  bookmarkWeeklyPlanHandler,
  createAIWeeklyPlanDraftHandler,
  createWeeklyPlanHandler,
  deleteWeeklyPlanHandler,
  getWeeklyPlanDetailsHandler,
  listWeeklyPlansHandler,
  openOrCreateEditDraftHandler,
  publishWeeklyPlanDraftHandler,
  unbookmarkWeeklyPlanHandler,
  updateWeeklyPlanDraftHandler,
} = require('../controllers/weeklyPlansController');

const router = express.Router();

router.post('/ai-drafts', createAIWeeklyPlanDraftHandler);
router.post('/', createWeeklyPlanHandler);
router.get('/', listWeeklyPlansHandler);
router.delete('/:weeklyPlanParentId', deleteWeeklyPlanHandler);
router.get('/:weeklyPlanParentId', getWeeklyPlanDetailsHandler);
router.post('/:weeklyPlanParentId/edit-draft', openOrCreateEditDraftHandler);
router.patch('/:weeklyPlanParentId/drafts/:versionId', updateWeeklyPlanDraftHandler);
router.post('/:weeklyPlanParentId/publish', publishWeeklyPlanDraftHandler);
router.post('/:weeklyPlanParentId/bookmark', bookmarkWeeklyPlanHandler);
router.delete('/:weeklyPlanParentId/bookmark', unbookmarkWeeklyPlanHandler);

module.exports = router;
