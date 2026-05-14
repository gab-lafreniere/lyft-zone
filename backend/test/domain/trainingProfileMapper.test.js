const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTrainingProfileInput,
} = require('../../src/domain/trainingProfile/trainingProfileValidation');
const {
  TRAINING_PROFILE_SCHEMA_VERSION,
  mapTrainingProfileToUserProfileUpdate,
} = require('../../src/domain/trainingProfile/trainingProfileMapper');

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
      painDescription: 'Shoulder irritation',
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

test('mapTrainingProfileToUserProfileUpdate writes the canonical snapshot and mirror fields', () => {
  const validation = validateTrainingProfileInput(createValidPayload());
  assert.equal(validation.ok, true);

  const mapped = mapTrainingProfileToUserProfileUpdate(validation.value);

  assert.equal(mapped.primaryGoal, 'HYPERTROPHY');
  assert.equal(mapped.availableSessionsPerWeek, 4);
  assert.equal(mapped.sessionDurationMinutes, 75);
  assert.equal(mapped.onboardingSnapshot.schemaVersion, TRAINING_PROFILE_SCHEMA_VERSION);
  assert.deepEqual(mapped.onboardingSnapshot.profile, validation.value);
  assert.equal(mapped.trainingPreferences.experience, 'intermediate');
  assert.equal(mapped.equipmentContext.equipmentBias, 'machines');
  assert.equal(mapped.constraints.trainingRule, 'modify');
  assert.deepEqual(mapped.constraints.cautionMovementPatterns, ['horizontal_press']);
  assert.deepEqual(mapped.constraints.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(mapped.constraints.cautionJointStressTags, ['shoulder_rotation']);
  assert.deepEqual(mapped.constraints.blockedJointStressTags, ['shoulder_compression']);
  assert.deepEqual(mapped.constraints.blockedExerciseIds, ['ex_barbell_press']);
  assert.deepEqual(
    mapped.onboardingSnapshot.derived.movementConstraints.blockedMovementPatterns,
    ['vertical_push']
  );
  assert.equal(mapped.musclePriorities.weights.primary, 1);
  assert.equal(mapped.musclePriorities.perAreaWeights.upper_chest, 1);
  assert.equal(mapped.musclePriorities.perAreaWeights.quadriceps, 0.35);
});
