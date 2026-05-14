const express = require('express');
const {
  createUserHandler,
  getUserSettingsHandler,
  upsertUserProfileHandler,
  updateTrainingProfileSettingsHandler,
} = require('../controllers/usersController');

const router = express.Router();

router.post('/', createUserHandler);
router.get('/:userId/settings', getUserSettingsHandler);
router.put('/:userId/profile', upsertUserProfileHandler);
router.patch('/:userId/settings/training-profile', updateTrainingProfileSettingsHandler);

module.exports = router;
