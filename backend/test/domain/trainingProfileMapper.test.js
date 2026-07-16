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
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'shoulder_press_machine'],
    },
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation',
          affectedArea: 'shoulder',
          painSeverity: 'moderate',
          trainingRule: 'modify',
          analysisStatus: 'analyzed',
          detectedSignals: [
            { type: 'movementPattern', value: 'vertical_push' },
            { type: 'jointStressTag', value: 'overhead_shoulder_position' },
          ],
          confirmedSignals: [
            { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
            { type: 'jointStressTag', value: 'overhead_shoulder_position', decision: 'blocked' },
          ],
        },
      ],
      manualBlockedExerciseIds: ['ex_barbell_press'],
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
  assert.equal(mapped.equipmentContext.equipmentPreset, 'full_gym');
  assert.deepEqual(mapped.equipmentContext.availableEquipment, [
    'dumbbells',
    'shoulder_press_machine',
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(mapped.equipmentContext, 'equipmentList'), false);
  assert.deepEqual(mapped.constraints.cautionMovementPatterns, ['vertical_push']);
  assert.deepEqual(mapped.constraints.blockedMovementPatterns, []);
  assert.deepEqual(mapped.constraints.cautionJointStressTags, []);
  assert.deepEqual(mapped.constraints.blockedJointStressTags, ['overhead_shoulder_position']);
  assert.deepEqual(mapped.constraints.manualBlockedExerciseIds, ['ex_barbell_press']);
  assert.deepEqual(mapped.constraints.blockedExerciseIds, ['ex_barbell_press']);
  assert.deepEqual(mapped.constraints.debug, {
    manualBlockedExerciseCount: 1,
    ruleDerivedBlockedExerciseCount: null,
  });
  assert.deepEqual(
    mapped.onboardingSnapshot.derived.movementConstraints.blockedMovementPatterns,
    []
  );
  assert.deepEqual(mapped.onboardingSnapshot.derived.movementConstraints, mapped.constraints);
  assert.equal(mapped.musclePriorities.weights.primary, 1);
  assert.equal(mapped.musclePriorities.perAreaWeights.upper_chest, 1);
  assert.equal(mapped.musclePriorities.perAreaWeights.quadriceps, 0.35);
});

test('mapTrainingProfileToUserProfileUpdate preserves MIXED canonically without the incompatible Prisma mirror', () => {
  const validation = validateTrainingProfileInput({
    ...createValidPayload(),
    primaryGoal: 'MIXED',
  });
  assert.equal(validation.ok, true);

  const mapped = mapTrainingProfileToUserProfileUpdate(validation.value);

  assert.equal(
    Object.prototype.hasOwnProperty.call(mapped, 'primaryGoal'),
    false
  );
  assert.equal(mapped.onboardingSnapshot.profile.primaryGoal, 'MIXED');
});

test('mapTrainingProfileToUserProfileUpdate continues to mirror Prisma-compatible goals', () => {
  const validation = validateTrainingProfileInput({
    ...createValidPayload(),
    primaryGoal: 'STRENGTH',
  });
  assert.equal(validation.ok, true);

  const mapped = mapTrainingProfileToUserProfileUpdate(validation.value);

  assert.equal(mapped.primaryGoal, 'STRENGTH');
  assert.equal(mapped.onboardingSnapshot.profile.primaryGoal, 'STRENGTH');
});
