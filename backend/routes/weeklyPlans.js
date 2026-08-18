const express = require('express');
const {
  bookmarkWeeklyPlanHandler,
  createAIWeeklyPlanDraftHandler,
  createWeeklyPlanHandler,
  deleteWeeklyPlanHandler,
  getAIWeeklyPlanDraftProgressHandler,
  getWeeklyPlanDetailsHandler,
  listWeeklyPlansHandler,
  openOrCreateEditDraftHandler,
  publishWeeklyPlanDraftHandler,
  unbookmarkWeeklyPlanHandler,
  updateWeeklyPlanDraftHandler,
  updateWeeklyPlanWorkoutContentHandler,
} = require('../controllers/weeklyPlansController');

const router = express.Router();

router.post('/ai-drafts', createAIWeeklyPlanDraftHandler);
router.get('/ai-drafts/:generationId/progress', getAIWeeklyPlanDraftProgressHandler);
router.post('/', createWeeklyPlanHandler);
router.get('/', listWeeklyPlansHandler);
router.delete('/:weeklyPlanParentId', deleteWeeklyPlanHandler);
router.get('/:weeklyPlanParentId', getWeeklyPlanDetailsHandler);
router.post('/:weeklyPlanParentId/edit-draft', openOrCreateEditDraftHandler);
router.patch(
  '/:weeklyPlanParentId/drafts/:versionId/workouts/:workoutId',
  updateWeeklyPlanWorkoutContentHandler
);
router.patch('/:weeklyPlanParentId/drafts/:versionId', updateWeeklyPlanDraftHandler);
router.post('/:weeklyPlanParentId/publish', publishWeeklyPlanDraftHandler);
router.post('/:weeklyPlanParentId/bookmark', bookmarkWeeklyPlanHandler);
router.delete('/:weeklyPlanParentId/bookmark', unbookmarkWeeklyPlanHandler);

module.exports = router;
