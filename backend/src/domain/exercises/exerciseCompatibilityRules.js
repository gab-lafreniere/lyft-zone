const ALWAYS_AVAILABLE_EQUIPMENT = new Set(['bodyweight']);
const {
  ensureAvailableEquipment,
  normalizeEquipmentArray,
} = require('../trainingProfile/trainingProfileEnvironment');

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeArray(value) {
  return toArray(value).map(normalizeValue).filter(Boolean);
}

function resolveBlockedMovementPatterns(movementContext = {}) {
  if (hasOwn(movementContext, 'blockedMovementPatterns')) {
    return normalizeArray(movementContext.blockedMovementPatterns);
  }

  if (hasOwn(movementContext, 'blockedPatterns')) {
    return normalizeArray(movementContext.blockedPatterns);
  }

  return [];
}

function isExerciseCompatible(exercise = {}, resolvedContext = {}) {
  const reasons = [];
  const equipmentContext = resolvedContext.equipment || resolvedContext;
  const movementContext = resolvedContext.movement || resolvedContext;
  const availableEquipment = ensureAvailableEquipment(equipmentContext.availableEquipment);
  const exerciseEquipment = normalizeEquipmentArray(exercise.equipmentNeeded)
    .filter((requiredEquipment) => !ALWAYS_AVAILABLE_EQUIPMENT.has(requiredEquipment));
  const blockedExerciseIds = normalizeArray(movementContext.blockedExerciseIds);
  const blockedJointStressTags = normalizeArray(movementContext.blockedJointStressTags);
  const blockedPatterns = resolveBlockedMovementPatterns(movementContext);
  const exerciseId = normalizeValue(exercise.exerciseId);
  const movementPattern = normalizeValue(exercise.movementPattern);
  const jointStressTags = normalizeArray(exercise.jointStressTags);

  if (exerciseId && blockedExerciseIds.includes(exerciseId)) {
    return {
      compatible: false,
      reasons: ['blocked_exercise_id'],
    };
  }

  if (
    availableEquipment.length > 0 &&
    exerciseEquipment.length > 0 &&
    !exerciseEquipment.every((requiredEquipment) => availableEquipment.includes(requiredEquipment))
  ) {
    reasons.push('missing_equipment');
  }

  if (movementPattern && blockedPatterns.includes(movementPattern)) {
    reasons.push('blocked_movement_pattern');
  }

  if (
    jointStressTags.length > 0 &&
    blockedJointStressTags.length > 0 &&
    jointStressTags.some((tag) => blockedJointStressTags.includes(tag))
  ) {
    reasons.push('blocked_joint_stress_tag');
  }

  return {
    compatible: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  isExerciseCompatible,
};
