// Plan Routes
// Defines endpoints for training plan operations
// POST /api/plans - Create a new plan
// GET /api/plans/:userId - Get all plans for a user

const express = require('express');
const router = express.Router();
const { createPlan, getPlansByUserId } = require('../controllers/planController');

// Create a new plan
router.post('/', createPlan);

// Get all plans for a user
router.get('/:userId', getPlansByUserId);

module.exports = router;
