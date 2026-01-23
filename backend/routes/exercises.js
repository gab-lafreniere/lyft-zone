// Exercise Routes
// Defines endpoints for exercise operations
// GET /api/exercises - List all exercises
// GET /api/exercises/:id - Get single exercise

const express = require('express');
const router = express.Router();
const { getAllExercises, getExerciseById } = require('../controllers/exerciseController');

// Get all exercises
router.get('/', getAllExercises);

// Get single exercise by ID
router.get('/:id', getExerciseById);

module.exports = router;
