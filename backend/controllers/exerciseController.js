// Exercise Controller
// Handles business logic for exercises
// Functions: getAllExercises, getExerciseById, populateExercisesFromJSON

const Exercise = require('../models/Exercise');
const fs = require('fs');
const path = require('path');

// Get all exercises from database
const getAllExercises = async (req, res) => {
  try {
    const exercises = await Exercise.findAll();
    res.status(200).json({
      success: true,
      count: exercises.length,
      data: exercises,
    });
  } catch (error) {
    console.error('Error fetching exercises:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exercises',
      error: error.message,
    });
  }
};

// Get single exercise by ID
const getExerciseById = async (req, res) => {
  try {
    const { id } = req.params;
    const exercise = await Exercise.findByPk(id);

    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: `Exercise with ID ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: exercise,
    });
  } catch (error) {
    console.error('Error fetching exercise:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exercise',
      error: error.message,
    });
  }
};

// Populate exercises from JSON file if database is empty
const populateExercisesFromJSON = async () => {
  try {
    const count = await Exercise.count();
    
    if (count > 0) {
      console.log(`✓ Database already has ${count} exercises`);
      return;
    }

    const dataPath = path.join(__dirname, '../data/exercises.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const exercises = JSON.parse(rawData);

    await Exercise.bulkCreate(exercises);
    console.log(`✓ Populated ${exercises.length} exercises from JSON`);
  } catch (error) {
    console.error('Error populating exercises:', error);
  }
};

module.exports = {
  getAllExercises,
  getExerciseById,
  populateExercisesFromJSON,
};
