const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  validateSimpleWeeklyPlanFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillValidation');
const {
  materializeSimpleWeeklyPlan,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillMaterializer');

const strengthLookup = {
  ex_strength: {
    exerciseId: 'ex_strength',
    name: 'Strength Exercise',
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    trainingType: 'strength',
    cardioModality: null,
  },
  ex_cardio: {
    exerciseId: 'ex_cardio',
    name: 'Treadmill Walk',
    bodyParts: [],
    muscleFocus: [],
    trainingType: 'cardio',
    cardioModality: 'treadmill_walk',
  },
};

function createStrengthSkeleton(setCount = 3) {
  return buildSimpleWeeklyPlanSkeleton({
    schemaVersion: 1,
    planName: 'Fill plan',
    workouts: [
      {
        name: 'Workout',
        blocks: [
          { blockType: 'SINGLE', roundCount: null, setCounts: [setCount] },
        ],
      },
    ],
  });
}

function createValidStrengthFills(skeleton) {
  return {
    schemaVersion: 1,
    geometryHash: skeleton.geometryHash,
    fills: {
      'w1.b1.e1.id': 'ex_strength',
      'w1.b1.e1.defaults': {
        tempo: '3110',
        restSeconds: 120,
        targetRir: 2,
        targetRpe: null,
      },
      'w1.b1.e1.notes': 'Useful note',
      'w1.b1.e1.s1': {
        mode: 'reps',
        targetReps: 10,
        targetRir: 2,
        notes: null,
      },
      'w1.b1.e1.s2': {
        mode: 'repRange',
        minReps: 8,
        maxReps: 12,
        targetRir: 2,
        notes: 'per side',
      },
      'w1.b1.e1.s3': {
        mode: 'seconds',
        targetSeconds: 45,
        targetRir: 2,
        notes: null,
      },
    },
  };
}

test('valid fills materialize enrichment, exact reps, range, seconds, per-side, and defaults', () => {
  const skeleton = createStrengthSkeleton();
  const fillOutput = createValidStrengthFills(skeleton);
  const validation = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput,
    eligibleExerciseLookup: strengthLookup,
  });
  assert.equal(validation.valid, true);

  const materialized = materializeSimpleWeeklyPlan({
    skeleton,
    normalizedFills: validation.normalizedFills,
    eligibleExerciseLookup: strengthLookup,
  });
  assert.equal(materialized.valid, true);
  const exercise =
    materialized.document.workouts[0].blocks[0].exercises[0];
  assert.equal(exercise.exerciseName, 'Strength Exercise');
  assert.deepEqual(exercise.bodyParts, ['chest']);
  assert.deepEqual(exercise.muscleFocus, ['upper_chest']);
  assert.equal(exercise.defaultTempo, '3110');
  assert.equal(exercise.defaultRestSeconds, 120);
  assert.equal(exercise.setTemplates[0].targetReps, 10);
  assert.equal(exercise.setTemplates[1].minReps, 8);
  assert.equal(exercise.setTemplates[1].maxReps, 12);
  assert.equal(exercise.setTemplates[1].notes, 'per side');
  assert.equal(exercise.setTemplates[2].targetSeconds, 45);
  assert.equal(exercise.setTemplates[2].targetReps, null);
});

for (const [name, mutate, expectedCode] of [
  ['missing slot', (value) => { delete value.fills['w1.b1.e1.s1']; }, 'MISSING_REQUIRED_FILL'],
  ['unknown slot', (value) => { value.fills.unknown = 1; }, 'UNKNOWN_FILL_SLOT'],
  ['wrong hash', (value) => { value.geometryHash = 'sha256:bad'; }, 'FILL_GEOMETRY_HASH_MISMATCH'],
  ['invalid tempo', (value) => { value.fills['w1.b1.e1.defaults'].tempo = '31X0'; }, 'INVALID_TEMPO'],
  ['invalid rest', (value) => { value.fills['w1.b1.e1.defaults'].restSeconds = 601; }, 'INVALID_DEFAULT_REST_SECONDS'],
  ['invalid RIR', (value) => { value.fills['w1.b1.e1.s1'].targetRir = 5; }, 'INVALID_SET_TARGET_RIR'],
  ['inverted range', (value) => {
    value.fills['w1.b1.e1.s2'].minReps = 13;
    value.fills['w1.b1.e1.s2'].maxReps = 8;
  }, 'INVALID_REP_RANGE'],
  ['multiple targets', (value) => {
    value.fills['w1.b1.e1.s1'].targetSeconds = 30;
  }, 'MULTIPLE_OR_UNKNOWN_STRENGTH_TARGETS'],
  ['outside lookup', (value) => { value.fills['w1.b1.e1.id'] = 'unknown'; }, 'EXERCISE_ID_OUTSIDE_ELIGIBLE_LOOKUP'],
  ['wrong training type', (value) => { value.fills['w1.b1.e1.id'] = 'ex_cardio'; }, 'EXERCISE_TRAINING_TYPE_MISMATCH'],
]) {
  test(`fill validation rejects ${name}`, () => {
    const skeleton = createStrengthSkeleton();
    const fillOutput = createValidStrengthFills(skeleton);
    mutate(fillOutput);
    const result = validateSimpleWeeklyPlanFills({
      skeleton,
      fillOutput,
      eligibleExerciseLookup: strengthLookup,
    });

    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some((error) => error.code === expectedCode),
      true
    );
  });
}

test('SUPERSET rest is materialized at block level while lane defaults remain null', () => {
  const skeleton = buildSimpleWeeklyPlanSkeleton({
    schemaVersion: 1,
    planName: 'Superset',
    workouts: [
      {
        name: 'Workout',
        blocks: [
          { blockType: 'SUPERSET', roundCount: 1, setCounts: [1, 1] },
        ],
      },
    ],
  });
  const fills = {
    schemaVersion: 1,
    geometryHash: skeleton.geometryHash,
    fills: {
      'w1.b1.e1.id': 'ex_strength',
      'w1.b1.e1.defaults': {
        tempo: '3010', restSeconds: null, targetRir: 2, targetRpe: null,
      },
      'w1.b1.e1.s1': {
        mode: 'reps', targetReps: 10, targetRir: 2, notes: null,
      },
      'w1.b1.e2.id': 'ex_strength',
      'w1.b1.e2.defaults': {
        tempo: '3010', restSeconds: null, targetRir: 2, targetRpe: null,
      },
      'w1.b1.e2.s1': {
        mode: 'reps', targetReps: 12, targetRir: 2, notes: null,
      },
      'w1.b1.rest': 90,
    },
  };
  const validation = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput: fills,
    eligibleExerciseLookup: strengthLookup,
  });
  const result = materializeSimpleWeeklyPlan({
    skeleton,
    normalizedFills: validation.normalizedFills,
    eligibleExerciseLookup: strengthLookup,
  });

  assert.equal(validation.valid, true);
  assert.equal(result.document.workouts[0].blocks[0].restSeconds, 90);
  assert.deepEqual(
    result.document.workouts[0].blocks[0].exercises.map(
      (exercise) => exercise.defaultRestSeconds
    ),
    [null, null]
  );
});

test('CARDIO accepts a cardio lookup item, normalizes its prescription, and creates no sets', () => {
  const skeleton = buildSimpleWeeklyPlanSkeleton({
    schemaVersion: 1,
    planName: 'Cardio',
    workouts: [
      {
        name: 'Cardio',
        blocks: [
          { blockType: 'CARDIO', roundCount: null, setCounts: [0] },
        ],
      },
    ],
  });
  const fillOutput = {
    schemaVersion: 1,
    geometryHash: skeleton.geometryHash,
    fills: {
      'w1.b1.e1.id': 'ex_cardio',
      'w1.b1.e1.cardio': {
        durationMinutes: 20,
        heartRateTargetMode: 'zone',
        heartRateTargetValue: 2,
        machineSettings: [
          { key: 'speed', value: 3.2 },
          { key: 'incline', value: 4 },
        ],
        notes: null,
      },
    },
  };
  const validation = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput,
    eligibleExerciseLookup: strengthLookup,
  });
  const materialized = materializeSimpleWeeklyPlan({
    skeleton,
    normalizedFills: validation.normalizedFills,
    eligibleExerciseLookup: strengthLookup,
  });
  const exercise =
    materialized.document.workouts[0].blocks[0].exercises[0];

  assert.equal(validation.valid, true);
  assert.equal(exercise.exerciseName, 'Treadmill Walk');
  assert.deepEqual(exercise.setTemplates, []);
  assert.deepEqual(exercise.cardioPrescription, {
    durationMinutes: 20,
    heartRateTargetMode: 'zone',
    heartRateTargetValue: 2,
    machineSettings: [
      { key: 'speed', value: 3.2 },
      { key: 'incline', value: 4 },
    ],
    notes: null,
  });
});

test('CARDIO rejects a strength exercise and invalid shared cardio prescription', () => {
  const skeleton = buildSimpleWeeklyPlanSkeleton({
    schemaVersion: 1,
    planName: 'Cardio',
    workouts: [
      {
        name: 'Cardio',
        blocks: [
          { blockType: 'CARDIO', roundCount: null, setCounts: [0] },
        ],
      },
    ],
  });
  const fillOutput = {
    schemaVersion: 1,
    geometryHash: skeleton.geometryHash,
    fills: {
      'w1.b1.e1.id': 'ex_strength',
      'w1.b1.e1.cardio': {
        durationMinutes: 0,
        heartRateTargetMode: 'none',
        heartRateTargetValue: null,
        machineSettings: [],
        notes: null,
      },
    },
  };
  const result = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput,
    eligibleExerciseLookup: strengthLookup,
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some(
      (error) => error.code === 'EXERCISE_TRAINING_TYPE_MISMATCH'
    ),
    true
  );
  assert.equal(
    result.errors.some(
      (error) => error.code === 'INVALID_CARDIO_PRESCRIPTION'
    ),
    true
  );
});
