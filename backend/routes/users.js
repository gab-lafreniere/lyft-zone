const express = require('express');
const {
  createUserHandler,
  getUserSettingsHandler,
  analyzeMovementConstraintSettingsHandler,
  upsertUserProfileHandler,
  updateTrainingProfileSettingsHandler,
} = require('../controllers/usersController');
const {
  movementConstraintAnalyzeRateLimit,
} = require('../middleware/movementConstraintAnalyzeRateLimit');

const router = express.Router();

router.post('/', createUserHandler);
router.get('/:userId/settings', getUserSettingsHandler);
router.put('/:userId/profile', upsertUserProfileHandler);
router.patch('/:userId/settings/training-profile', updateTrainingProfileSettingsHandler);
router.post(
  '/:userId/settings/training-profile/movement-constraints/analyze',
  movementConstraintAnalyzeRateLimit,
  analyzeMovementConstraintSettingsHandler
);

module.exports = router;
