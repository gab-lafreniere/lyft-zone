const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectGeneratedExerciseIds,
  validateWeeklyPlanAiOutputSemantics,
  validateGeneratedExerciseIdsAgainstPool,
} = require('../../src/domain/programGeneration/weeklyPlanAiValidation');

function createGeneratedDocument(exerciseIds = []) {
  return {
    name: 'AI Draft',
    sessionsPerWeek: 1,
    workouts: [
      {
        name: 'Upper',
        orderIndex: 1,
        blocks: exerciseIds.map((exerciseId, index) => ({
          orderIndex: index + 1,
          blockType: 'SINGLE',
          exercises: [
            {
              exerciseId,
              exerciseName: `Exercise ${index + 1}`,
              orderIndex: 1,
              setTemplates: [],
            },
          ],
        })),
      },
    ],
  };
}

function createSetTemplate(overrides = {}) {
  return {
    setIndex: 1,
    setType: 'WORKING',
    targetReps: 10,
    minReps: null,
    maxReps: null,
    targetRir: 2,
    tempo: '3010',
    restSeconds: 120,
    ...overrides,
  };
}

function createAiExercise(exerciseId = 'ex_bench', overrides = {}) {
  return {
    exerciseId,
    exerciseName: 'Dumbbell Bench Press',
    orderIndex: 1,
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    setTemplates: [createSetTemplate()],
    cardioPrescription: null,
    notes: null,
    ...overrides,
  };
}

function createAiWorkout(index = 1, blockOverrides = {}) {
  return {
    name: `Workout ${index}`,
    orderIndex: index,
    estimatedDurationMinutes: 60,
    focus: 'Upper push',
    blocks: [
      {
        orderIndex: 1,
        blockType: 'SINGLE',
        exercises: [createAiExercise()],
        ...blockOverrides,
      },
    ],
  };
}

function createAiOutput(overrides = {}) {
  return {
    schemaVersion: 1,
    planName: 'AI Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Simple full body plan.',
    splitType: 'full_body',
    workouts: [createAiWorkout()],
    volumeTargets: {
      perMuscle: [],
    },
    frequencyTargets: {
      perMuscle: [],
    },
    progressionModel: {
      type: 'double_progression',
      summary: 'Add reps before load.',
    },
    cautionHandling: {
      summary: 'Respect blocked constraints and keep cautions soft.',
    },
    notesPolicy: {
      summary: 'Use notes only when useful.',
    },
    ...overrides,
  };
}

test('validateGeneratedExerciseIdsAgainstPool passes when every generated ID is in the pool snapshot', () => {
  const document = createGeneratedDocument(['ex_bench', 'ex_row', 'ex_bench']);
  const result = validateGeneratedExerciseIdsAgainstPool(document, {
    allowedExerciseIds: ['ex_bench', 'ex_row'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.exerciseIds, ['ex_bench', 'ex_row', 'ex_bench']);
  assert.deepEqual(result.uniqueExerciseIds, ['ex_bench', 'ex_row']);
});

test('validateGeneratedExerciseIdsAgainstPool rejects IDs outside the generation pool snapshot', () => {
  const document = createGeneratedDocument(['ex_bench', 'ex_known_but_outside_pool']);
  const result = validateGeneratedExerciseIdsAgainstPool(document, {
    allowedExerciseIds: ['ex_bench'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      code: 'EXERCISE_OUTSIDE_POOL',
      path: 'workouts[0].blocks[1].exercises[0].exerciseId',
      exerciseId: 'ex_known_but_outside_pool',
    },
  ]);
});

test('collectGeneratedExerciseIds ignores empty exerciseId slots', () => {
  const entries = collectGeneratedExerciseIds(createGeneratedDocument(['ex_bench', null, '']));

  assert.deepEqual(entries, [
    {
      exerciseId: 'ex_bench',
      path: 'workouts[0].blocks[0].exercises[0].exerciseId',
    },
  ]);
});

test('validateWeeklyPlanAiOutputSemantics rejects sessionsPerWeek mismatch', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      sessionsPerWeek: 2,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'SESSIONS_PER_WEEK_MISMATCH'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects non-sequential orderIndex values', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      sessionsPerWeek: 2,
      workouts: [
        createAiWorkout(1),
        createAiWorkout(3),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'ORDER_INDEX_NOT_SEQUENTIAL'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects duplicate setIndex values', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', {
              setTemplates: [
                createSetTemplate({ setIndex: 1 }),
                createSetTemplate({ setIndex: 1 }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'DUPLICATE_ORDER_INDEX'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects SINGLE blocks without exactly one exercise', () => {
  const emptyResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [],
        }),
      ],
    })
  );
  const twoExerciseResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', { orderIndex: 1 }),
            createAiExercise('ex_row', { orderIndex: 2 }),
          ],
        }),
      ],
    })
  );

  assert.equal(emptyResult.ok, false);
  assert.equal(twoExerciseResult.ok, false);
  assert.equal(emptyResult.issues.some((issue) => issue.code === 'INVALID_SINGLE_BLOCK'), true);
  assert.equal(twoExerciseResult.issues.some((issue) => issue.code === 'INVALID_SINGLE_BLOCK'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects SUPERSET blocks without exactly two exercises', () => {
  const oneExerciseResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'SUPERSET',
          exercises: [createAiExercise('ex_bench')],
        }),
      ],
    })
  );
  const threeExerciseResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'SUPERSET',
          exercises: [
            createAiExercise('ex_bench', { orderIndex: 1 }),
            createAiExercise('ex_row', { orderIndex: 2 }),
            createAiExercise('ex_fly', { orderIndex: 3 }),
          ],
        }),
      ],
    })
  );

  assert.equal(oneExerciseResult.ok, false);
  assert.equal(threeExerciseResult.ok, false);
  assert.equal(oneExerciseResult.issues.some((issue) => issue.code === 'INVALID_SUPERSET_BLOCK'), true);
  assert.equal(threeExerciseResult.issues.some((issue) => issue.code === 'INVALID_SUPERSET_BLOCK'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects CARDIO blocks without exactly one exercise', () => {
  const emptyResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'CARDIO',
          exercises: [],
        }),
      ],
    })
  );
  const twoExerciseResult = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'CARDIO',
          exercises: [
            createAiExercise('ex_bike', {
              orderIndex: 1,
              setTemplates: [],
              cardioPrescription: {
                durationMinutes: 20,
                heartRateTargetMode: 'none',
                heartRateTargetValue: null,
                machineSettings: [],
                notes: null,
              },
            }),
            createAiExercise('ex_treadmill', {
              orderIndex: 2,
              setTemplates: [],
              cardioPrescription: {
                durationMinutes: 20,
                heartRateTargetMode: 'none',
                heartRateTargetValue: null,
                machineSettings: [],
                notes: null,
              },
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(emptyResult.ok, false);
  assert.equal(twoExerciseResult.ok, false);
  assert.equal(emptyResult.issues.some((issue) => issue.code === 'INVALID_CARDIO_BLOCK'), true);
  assert.equal(twoExerciseResult.issues.some((issue) => issue.code === 'INVALID_CARDIO_BLOCK'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects cardio with setTemplates', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'CARDIO',
          exercises: [
            createAiExercise('ex_bike', {
              setTemplates: [createSetTemplate()],
              cardioPrescription: {
                durationMinutes: 20,
                heartRateTargetMode: 'none',
                heartRateTargetValue: null,
                machineSettings: [],
                notes: null,
              },
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_CARDIO_BLOCK'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects strength exercises without setTemplates', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', {
              setTemplates: [],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'MIN_ITEMS_REQUIRED'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects ambiguous reps contract', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', {
              setTemplates: [
                createSetTemplate({
                  targetReps: 10,
                  minReps: 8,
                  maxReps: 12,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'AMBIGUOUS_REP_TARGET'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects incomplete reps contract', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', {
              setTemplates: [
                createSetTemplate({
                  targetReps: null,
                  minReps: 8,
                  maxReps: null,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'MISSING_REP_TARGET'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects inverted repetition ranges', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          exercises: [
            createAiExercise('ex_bench', {
              setTemplates: [
                createSetTemplate({
                  targetReps: null,
                  minReps: 12,
                  maxReps: 8,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_REP_RANGE'), true);
});

test('validateWeeklyPlanAiOutputSemantics rejects mismatched superset set counts', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      workouts: [
        createAiWorkout(1, {
          blockType: 'SUPERSET',
          exercises: [
            createAiExercise('ex_bench', {
              orderIndex: 1,
              setTemplates: [createSetTemplate({ setIndex: 1 })],
            }),
            createAiExercise('ex_row', {
              orderIndex: 2,
              setTemplates: [
                createSetTemplate({ setIndex: 1 }),
                createSetTemplate({ setIndex: 2 }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === 'SUPERSET_SET_COUNT_MISMATCH'),
    true
  );
});

test('validateWeeklyPlanAiOutputSemantics applies bounded strength exercise notes policy', () => {
  const workouts = Array.from({ length: 4 }, (_, index) =>
    createAiWorkout(index + 1, {
      exercises: [
        createAiExercise(`ex_${index + 1}`, {
          notes: index < 3 ? `Note ${index + 1}` : null,
        }),
      ],
    })
  );

  const result = validateWeeklyPlanAiOutputSemantics(
    createAiOutput({
      sessionsPerWeek: 4,
      workouts,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.summary.notesPolicy.allowedExerciseNotes, 2);
  assert.equal(result.issues.some((issue) => issue.code === 'NOTES_POLICY_VIOLATION'), true);
});
