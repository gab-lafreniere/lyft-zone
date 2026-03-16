const express = require('express');
const {
  createUserHandler,
  upsertUserProfileHandler,
} = require('../controllers/usersController');

const router = express.Router();

router.post('/', createUserHandler);
router.put('/:userId/profile', upsertUserProfileHandler);

module.exports = router;
