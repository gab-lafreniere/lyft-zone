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
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'shoulder_press_machine'],
    },
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation on some overhead work',
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

test('validateTrainingProfileInput accepts a valid canonical onboarding payload', () => {
  const result = validateTrainingProfileInput(createValidPayload());

  assert.equal(result.ok, true);
  assert.equal(result.value.primaryGoal, 'HYPERTROPHY');
  assert.equal(result.value.environment.equipmentPreset, 'full_gym');
  assert.deepEqual(result.value.environment.availableEquipment, [
    'dumbbells',
    'shoulder_press_machine',
  ]);
  assert.equal(result.value.musclePriorities.primaryFocus, 'upper_chest');
  assert.deepEqual(result.value.musclePriorities.secondaryFocuses, ['lats', 'rear_delts']);
  assert.equal(result.value.exercisePreference.equipmentBias, 'machines');
  assert.deepEqual(result.value.movementConstraints.manualBlockedExerciseIds, [
    'ex_barbell_press',
  ]);
  assert.deepEqual(result.value.movementConstraints.painIssues[0].confirmedSignals, [
    { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
    { type: 'jointStressTag', value: 'overhead_shoulder_position', decision: 'blocked' },
  ]);
});

test('validateTrainingProfileInput defaults omitted movementConstraints to V2 empty constraints', () => {
  const payload = createValidPayload();
  delete payload.movementConstraints;

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.movementConstraints, {
    painIssues: [],
    manualBlockedExerciseIds: [],
  });
});

test('validateTrainingProfileInput accepts empty movementConstraints', () => {
  const payload = createValidPayload();
  payload.movementConstraints = {};

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.movementConstraints, {
    painIssues: [],
    manualBlockedExerciseIds: [],
  });
});

test('validateTrainingProfileInput normalizes and deduplicates V2 signals and manual blocks', () => {
  const payload = createValidPayload();
  payload.movementConstraints = {
    painIssues: [
      {
        id: 'issue_knee',
        description: 'Knee discomfort during deep squats',
        affectedArea: 'KNEE',
        painSeverity: 'HIGH',
        trainingRule: 'AVOID',
        detectedSignals: [
          { type: 'movementPattern', value: ' squat_pattern ' },
          { type: 'movementPattern', value: 'squat_pattern' },
        ],
        confirmedSignals: [
          { type: 'jointStressTag', value: ' deep_knee_flexion ', decision: 'BLOCKED' },
          { type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'blocked' },
        ],
      },
    ],
    manualBlockedExerciseIds: [' EXR_DEADLIFT ', 'exr_deadlift'],
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value.movementConstraints.painIssues[0].analysisStatus, 'draft');
  assert.deepEqual(result.value.movementConstraints.painIssues[0].detectedSignals, [
    { type: 'movementPattern', value: 'squat_pattern' },
  ]);
  assert.deepEqual(result.value.movementConstraints.painIssues[0].confirmedSignals, [
    { type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'blocked' },
  ]);
  assert.deepEqual(result.value.movementConstraints.manualBlockedExerciseIds, ['exr_deadlift']);
});

test('validateTrainingProfileInput rejects invalid pain issue and signal values', () => {
  const payload = createValidPayload();
  payload.movementConstraints = {
    painIssues: [
      {
        id: 'issue_bad',
        description: 'x'.repeat(501),
        affectedArea: 'shoulders',
        painSeverity: 'medium',
        trainingRule: 'skip',
        analysisStatus: 'complete',
        detectedSignals: [{ type: 'exerciseId', value: 'ex_123' }],
        confirmedSignals: [
          { type: 'movementPattern', value: 'not_real', decision: 'caution' },
          { type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'maybe' },
        ],
      },
    ],
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /Pain issue description must be at most 500/);
  assert.match(JSON.stringify(result.issues), /affectedArea is invalid/);
  assert.match(JSON.stringify(result.issues), /painSeverity is invalid/);
  assert.match(JSON.stringify(result.issues), /trainingRule is invalid/);
  assert.match(JSON.stringify(result.issues), /analysisStatus is invalid/);
  assert.match(JSON.stringify(result.issues), /Signal type is invalid/);
  assert.match(JSON.stringify(result.issues), /Signal value is invalid/);
  assert.match(JSON.stringify(result.issues), /Signal decision is invalid/);
});

test('validateTrainingProfileInput rejects too many pain issues and contradictory decisions', () => {
  const payload = createValidPayload();
  payload.movementConstraints = {
    painIssues: Array.from({ length: 6 }, (_, index) => ({
      id: `issue_${index}`,
      description: 'Shoulder issue',
      affectedArea: 'shoulder',
      painSeverity: 'low',
      trainingRule: 'monitor',
      analysisStatus: 'analyzed',
      confirmedSignals:
        index === 0
          ? [
              { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
              { type: 'movementPattern', value: 'vertical_push', decision: 'blocked' },
            ]
          : [],
    })),
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /painIssues must contain at most 5 issues/);
  assert.match(JSON.stringify(result.issues), /Signal cannot be both caution and blocked/);
});

test('validateTrainingProfileInput rejects missing persisted pain issue fields', () => {
  const payload = createValidPayload();
  payload.movementConstraints = {
    painIssues: [{}],
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /Pain issue id is required/);
  assert.match(JSON.stringify(result.issues), /Pain issue description is required/);
  assert.match(JSON.stringify(result.issues), /affectedArea is required/);
  assert.match(JSON.stringify(result.issues), /painSeverity is required/);
  assert.match(JSON.stringify(result.issues), /trainingRule is required/);
});

test('validateTrainingProfileInput accepts backend compatibility pain values', () => {
  const payload = createValidPayload();
  payload.movementConstraints.painIssues[0].painSeverity = 'none';
  payload.movementConstraints.painIssues[0].trainingRule = 'limit';

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value.movementConstraints.painIssues[0].painSeverity, 'none');
  assert.equal(result.value.movementConstraints.painIssues[0].trainingRule, 'limit');
});

test('validateTrainingProfileInput accepts legacy environment fields and normalizes aliases', () => {
  const payload = createValidPayload();
  payload.environment = {
    trainingEnvironment: 'gym',
    equipmentSetup: 'limited_gym',
    equipmentList: ['selectorized_shoulder_press', 'dumbbells'],
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value.environment.equipmentPreset, 'commercial_gym');
  assert.deepEqual(result.value.environment.availableEquipment, [
    'shoulder_press_machine',
    'dumbbells',
  ]);
});

test('validateTrainingProfileInput accepts nullable equipmentPreset and defaults empty equipment to bodyweight', () => {
  const payload = createValidPayload();
  payload.environment = {
    equipmentPreset: null,
    availableEquipment: [],
  };

  const result = validateTrainingProfileInput(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value.environment.equipmentPreset, null);
  assert.deepEqual(result.value.environment.availableEquipment, ['bodyweight']);
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
  assert.doesNotMatch(JSON.stringify(result.issues), /trainingEnvironment is required/);
  assert.doesNotMatch(JSON.stringify(result.issues), /equipmentSetup is required/);
});
