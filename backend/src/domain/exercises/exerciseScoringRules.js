/**
 * IMPORTANT:
 * This module is NOT a decision engine.
 * It only provides optional scoring hints for ranking or explanation.
 *
 * The AI Coach remains responsible for final exercise selection.
 */

const { isExerciseCompatible } = require('./exerciseCompatibilityRules');

const MACHINE_CATEGORIES = new Set([
  'selectorized_machine',
  'plate_loaded_machine',
  'assisted_machine',
  'smith_machine',
  'cardio_machine',
]);
const FREE_WEIGHT_CATEGORIES = new Set([
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function scoreExercise(exercise = {}, context = {}) {
  const compatibility = isExerciseCompatible(exercise, context);
  const breakdown = {
    musclePriority: 0,
    equipmentBias: 0,
    movementFit: 0,
  };

  if (!compatibility.compatible) {
    return {
      score: 0,
      breakdown,
    };
  }

  const musclePriorityProfile = context.musclePriorityProfile || {};
  const perAreaWeights = musclePriorityProfile.perAreaWeights || {};
  const targetAreas = toArray(exercise.muscleFocus || exercise.targetMuscles)
    .map(normalizeValue)
    .filter(Boolean);

  if (targetAreas.length > 0) {
    breakdown.musclePriority = Math.max(
      0,
      ...targetAreas.map((area) => Number(perAreaWeights[area]) || 0)
    );
  }

  const equipmentBias = normalizeValue(
    context?.equipment?.equipmentBias || context?.equipmentBias
  );
  const equipmentCategory = normalizeValue(exercise.equipmentCategory);

  if (equipmentBias === 'machines' && MACHINE_CATEGORIES.has(equipmentCategory)) {
    breakdown.equipmentBias = 0.1;
  } else if (
    equipmentBias === 'free_weights' &&
    FREE_WEIGHT_CATEGORIES.has(equipmentCategory)
  ) {
    breakdown.equipmentBias = 0.1;
  }

  const movementPattern = normalizeValue(exercise.movementPattern);
  const cautionPatterns = toArray(context?.movement?.cautionPatterns || context?.cautionPatterns)
    .map(normalizeValue)
    .filter(Boolean);

  if (movementPattern && !cautionPatterns.includes(movementPattern)) {
    breakdown.movementFit = 0.1;
  }

  const score = Number(
    (breakdown.musclePriority + breakdown.equipmentBias + breakdown.movementFit).toFixed(2)
  );

  return {
    score,
    breakdown,
  };
}

module.exports = {
  scoreExercise,
};
