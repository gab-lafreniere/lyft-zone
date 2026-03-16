const express = require('express');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesValue(values, expected) {
  return toArray(values).some((value) => norm(value) === expected);
}

function buildSearchText(exercise) {
  return [
    exercise.name,
    ...toArray(exercise.aliases),
    ...toArray(exercise.keywords),
    ...toArray(exercise.targetMuscles),
    ...toArray(exercise.secondaryMuscles),
    ...toArray(exercise.bodyParts),
    ...toArray(exercise.equipmentNeeded),
    exercise.equipmentCategory,
    exercise.trainingType,
    exercise.movementPattern,
    exercise.mechanicType,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

async function listExercises() {
  const prisma = getPrisma();

  return prisma.exercise.findMany({
    orderBy: { exerciseId: 'asc' },
  });
}

router.get('/filters', async (req, res) => {
  try {
    const exercises = await listExercises();
    const bodyParts = new Set();
    const equipments = new Set();
    const types = new Set();
    const muscles = new Set();

    for (const exercise of exercises) {
      for (const value of toArray(exercise.bodyParts)) bodyParts.add(value);
      for (const value of toArray(exercise.equipmentNeeded)) equipments.add(value);
      for (const value of toArray(exercise.targetMuscles)) muscles.add(value);
      for (const value of toArray(exercise.secondaryMuscles)) muscles.add(value);
      if (exercise.trainingType) types.add(exercise.trainingType);
    }

    res.json({
      bodyParts: Array.from(bodyParts).sort(),
      equipments: Array.from(equipments).sort(),
      exerciseTypes: Array.from(types).sort(),
      muscles: Array.from(muscles).sort(),
    });
  } catch (error) {
    console.error('Error fetching exercise filters:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exercise filters',
      error: error.message,
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const exercise = await prisma.exercise.findUnique({
      where: { exerciseId: req.params.id },
    });

    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: `Exercise with ID ${req.params.id} not found`,
      });
    }

    res.json(exercise);
  } catch (error) {
    console.error('Error fetching exercise:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exercise',
      error: error.message,
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const q = norm(req.query.q);
    const bodyPart = norm(req.query.bodyPart);
    const equipment = norm(req.query.equipment);
    const type = norm(req.query.type);
    const muscle = norm(req.query.muscle);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 50);
    const cursor = Math.max(parseInt(req.query.cursor || '0', 10), 0);

    let results = await listExercises();

    if (bodyPart) {
      results = results.filter((exercise) => includesValue(exercise.bodyParts, bodyPart));
    }

    if (equipment) {
      results = results.filter(
        (exercise) =>
          includesValue(exercise.equipmentNeeded, equipment) ||
          norm(exercise.equipmentCategory) === equipment
      );
    }

    if (type) {
      results = results.filter((exercise) => norm(exercise.trainingType) === type);
    }

    if (muscle) {
      results = results.filter(
        (exercise) =>
          includesValue(exercise.targetMuscles, muscle) ||
          includesValue(exercise.secondaryMuscles, muscle)
      );
    }

    if (q) {
      results = results.filter((exercise) => buildSearchText(exercise).includes(q));
    }

    const items = results.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length < results.length ? String(cursor + items.length) : null;

    res.json({
      items,
      nextCursor,
      total: results.length,
    });
  } catch (error) {
    console.error('Error fetching exercises:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exercises',
      error: error.message,
    });
  }
});

module.exports = router;
