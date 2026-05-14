const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTrainingProfileInput,
} = require('../../src/domain/trainingProfile/trainingProfileValidation');

function createValidPayload() {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: 'upper_chest',
      secondaryFocuses: ['lats', 'rear_delts'],
      deprioritizedArea: 'quadriceps',
    },
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 75,
    },
    environment: {
      trainingEnvironment: 'commercial_gym',
      equipmentSetup: 'full_gym',
      equipmentList: ['dumbbells', 'selectorized_machine'],
    },
    movementConstraints: {
      painDescription: 'Shoulder irritation on some overhead work',
      affectedArea: 'shoulder',
      painSeverity: 'moderate',
      trainingRule: 'modify',
      aiDetectedPatterns: ['overhead_press'],
      confirmedPatterns: ['overhead_press'],
      cautionMovementPatterns: ['horizontal_press'],
      blockedMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['shoulder_rotation'],
      blockedJointStressTags: ['shoulder_compression'],
      blockedExerciseIds: ['ex_barbell_press'],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
    cardioProfile: {
      cardioRole: 'warm_up_only',
      preferredModalities: ['treadmill_walk'],
    },
    physicalNotes: 'Prefers stable pressing variations.',
  };
}

test('validateTrainingProfileInput accepts a valid canonical onboarding payload', () => {
  const result = validateTrainingProfileInput(createValidPayload());

  assert.equal(result.ok, true);
  assert.equal(result.value.primaryGoal, 'HYPERTROPHY');
  assert.equal(result.value.musclePriorities.primaryFocus, 'upper_chest');
  assert.deepEqual(result.value.musclePriorities.secondaryFocuses, ['lats', 'rear_delts']);
  assert.equal(result.value.exercisePreference.equipmentBias, 'machines');
  assert.deepEqual(result.value.movementConstraints.cautionMovementPatterns, ['horizontal_press']);
  assert.deepEqual(result.value.movementConstraints.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.value.movementConstraints.cautionJointStressTags, ['shoulder_rotation']);
  assert.deepEqual(result.value.movementConstraints.blockedJointStressTags, ['shoulder_compression']);
  assert.deepEqual(result.value.movementConstraints.blockedExerciseIds, ['ex_barbell_press']);
});

test('validateTrainingProfileInput rejects more than two secondary focuses', () => {
  const payload = createValidPayload();
  payload.musclePriorities.secondaryFocuses = ['lats', 'rear_delts', 'glute_max'];

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /secondaryFocuses must contain at most two values/
  );
});

test('validateTrainingProfileInput rejects parent-child deprioritization conflicts', () => {
  const payload = createValidPayload();
  payload.musclePriorities.deprioritizedArea = 'chest';

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /Cannot deprioritize a parent area/);
});

test('validateTrainingProfileInput rejects deprioritized micro-focus areas', () => {
  const payload = createValidPayload();
  payload.musclePriorities.deprioritizedArea = 'lower_abs';

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /cannot target a micro-focus/);
});

test('validateTrainingProfileInput rejects invalid sibling combinations from the biomechanical matrix', () => {
  const payload = createValidPayload();
  payload.musclePriorities.primaryFocus = 'chest';
  payload.musclePriorities.secondaryFocuses = [];
  payload.musclePriorities.deprioritizedArea = 'shoulders';

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /biomechanical matrix/);
});

test('validateTrainingProfileInput rejects invalid equipment bias values', () => {
  const payload = createValidPayload();
  payload.exercisePreference.equipmentBias = 'plates_only';

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /equipmentBias is invalid/);
});

test('validateTrainingProfileInput rejects incomplete onboarding payloads', () => {
  const payload = {
    primaryGoal: 'HYPERTROPHY',
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 60,
    },
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /experience is required/);
  assert.match(JSON.stringify(result.issues), /trainingEnvironment is required/);
  assert.match(JSON.stringify(result.issues), /equipmentSetup is required/);
});
