const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMuscleDistributionDebugAudit,
  validateGeneratedExerciseIdsAgainstPool,
  validateWeeklyPlanAiDebugContractAgainstAnalytics,
  validateWeeklyPlanAiOutputSemantics,
} = require('../../src/domain/programGeneration/weeklyPlanAiValidation');
const {
  clone,
  createAiExercise,
  createAiOutput,
  createSetTemplate,
} = require('./weeklyPlanAiV4Fixtures');

function validateSet(setTemplate) {
  const output = createAiOutput();
  output.workouts[0].blocks[0].exercises[0].setTemplates = [setTemplate];
  return validateWeeklyPlanAiOutputSemantics(output);
}

function createSupersetOutput({
  laneADefaultRestSeconds = 120,
  laneBDefaultRestSeconds = 60,
  laneBDefaultTempo = '3010',
  laneBDefaultTargetRir = 2,
} = {}) {
  const output = createAiOutput();
  output.workouts[0].blocks[0] = {
    orderIndex: 1,
    blockType: 'SUPERSET',
    exercises: [
      createAiExercise({
        exerciseId: 'ex_lane_a',
        orderIndex: 1,
        defaultRestSeconds: laneADefaultRestSeconds,
      }),
      createAiExercise({
        exerciseId: 'ex_lane_b',
        orderIndex: 2,
        defaultTempo: laneBDefaultTempo,
        defaultRestSeconds: laneBDefaultRestSeconds,
        defaultTargetRir: laneBDefaultTargetRir,
      }),
    ],
  };
  return output;
}

function createTwelveNotedExerciseOutput() {
  const output = createAiOutput();
  output.sessionsPerWeek = 3;
  output.workouts = Array.from({ length: 3 }, (_, workoutIndex) => ({
    name: `Workout ${workoutIndex + 1}`,
    orderIndex: workoutIndex + 1,
    focus: 'Focused strength work',
    blocks: [
      {
        orderIndex: 1,
        blockType: 'SINGLE',
        exercises: [
          createAiExercise({
            exerciseId: `ex_${workoutIndex}_1`,
            notes: `Necessary note ${workoutIndex * 4 + 1}.`,
          }),
        ],
      },
      {
        orderIndex: 2,
        blockType: 'SUPERSET',
        exercises: [
          createAiExercise({
            exerciseId: `ex_${workoutIndex}_2`,
            orderIndex: 1,
            notes: `Necessary note ${workoutIndex * 4 + 2}.`,
          }),
          createAiExercise({
            exerciseId: `ex_${workoutIndex}_3`,
            orderIndex: 2,
            defaultRestSeconds: null,
            notes: `Necessary note ${workoutIndex * 4 + 3}.`,
          }),
        ],
      },
      {
        orderIndex: 3,
        blockType: 'SINGLE',
        exercises: [
          createAiExercise({
            exerciseId: `ex_${workoutIndex}_4`,
            notes: `Necessary note ${workoutIndex * 4 + 4}.`,
          }),
        ],
      },
    ],
  }));
  return output;
}

test('V4 semantics accept fixed, range, and temporal prescriptions', () => {
  const cases = [
    createSetTemplate(),
    createSetTemplate(1, {
      targetReps: null,
      minReps: 8,
      maxReps: 12,
    }),
    createSetTemplate(1, {
      targetReps: null,
      minReps: null,
      maxReps: null,
      targetSeconds: 45,
    }),
  ];

  cases.forEach((setTemplate) => {
    assert.equal(validateSet(setTemplate).ok, true);
  });
});

test('V4 semantics reject combined or missing prescription modes', () => {
  const cases = [
    createSetTemplate(1, { targetSeconds: 45 }),
    createSetTemplate(1, {
      targetReps: null,
      minReps: 8,
      maxReps: 12,
      targetSeconds: 45,
    }),
    createSetTemplate(1, {
      targetReps: null,
      minReps: null,
      maxReps: null,
      targetSeconds: null,
    }),
  ];

  cases.forEach((setTemplate) => {
    assert.equal(validateSet(setTemplate).ok, false);
  });
});

test('V4 semantics reject inverted repetition ranges', () => {
  const result = validateSet(
    createSetTemplate(1, {
      targetReps: null,
      minReps: 12,
      maxReps: 8,
    })
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === 'INVALID_REP_RANGE'),
    true
  );
});

test('SINGLE still requires defaultRestSeconds', () => {
  const output = createAiOutput();
  output.workouts[0].blocks[0].exercises[0].defaultRestSeconds = null;

  const result = validateWeeklyPlanAiOutputSemantics(output);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.path ===
          'workouts[0].blocks[0].exercises[0].defaultRestSeconds' &&
        issue.code === 'REQUIRED'
    ),
    true
  );
});

test('SUPERSET lane A still requires defaultRestSeconds', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createSupersetOutput({ laneADefaultRestSeconds: null })
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.path ===
          'workouts[0].blocks[0].exercises[0].defaultRestSeconds' &&
        issue.code === 'REQUIRED'
    ),
    true
  );
});

test('SUPERSET lane B accepts null defaultRestSeconds', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createSupersetOutput({ laneBDefaultRestSeconds: null })
  );

  assert.equal(result.ok, true);
});

test('SUPERSET lane B accepts a valid defaultRestSeconds value', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createSupersetOutput({ laneBDefaultRestSeconds: 60 })
  );

  assert.equal(result.ok, true);
});

test('SUPERSET lane B still requires defaultTempo', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createSupersetOutput({ laneBDefaultTempo: null })
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.path === 'workouts[0].blocks[0].exercises[1].defaultTempo' &&
        issue.code === 'REQUIRED'
    ),
    true
  );
});

test('SUPERSET lane B still requires defaultTargetRir', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createSupersetOutput({ laneBDefaultTargetRir: null })
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.path ===
          'workouts[0].blocks[0].exercises[1].defaultTargetRir' &&
        issue.code === 'REQUIRED'
    ),
    true
  );
});

test('twelve notes on twelve strength exercises remain semantically valid and are audited', () => {
  const result = validateWeeklyPlanAiOutputSemantics(
    createTwelveNotedExerciseOutput()
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary.notesPolicy, {
    strengthExerciseCount: 12,
    strengthExerciseNoteCount: 12,
    allowedExerciseNotes: 4,
    exceedsRecommendedExerciseNotes: true,
  });
  assert.equal(
    result.issues.some((issue) => issue.code === 'NOTES_POLICY_VIOLATION'),
    false
  );
});

test('a structural error with excessive notes remains a structural failure', () => {
  const output = createTwelveNotedExerciseOutput();
  output.workouts[0].orderIndex = 2;

  const result = validateWeeklyPlanAiOutputSemantics(output);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === 'ORDER_INDEX_NOT_SEQUENTIAL'
    ),
    true
  );
  assert.equal(
    result.issues.some((issue) => issue.code === 'NOTES_POLICY_VIOLATION'),
    false
  );
  assert.equal(
    result.summary.notesPolicy.exceedsRecommendedExerciseNotes,
    true
  );
});

test('sessions, workouts, blocks, exercises, and sets stay sequential', () => {
  const output = createAiOutput();
  output.sessionsPerWeek = 2;
  output.workouts[0].orderIndex = 2;
  output.workouts[0].blocks[0].orderIndex = 2;
  output.workouts[0].blocks[0].exercises[0].orderIndex = 2;
  output.workouts[0].blocks[0].exercises[0].setTemplates[0].setIndex = 2;
  const result = validateWeeklyPlanAiOutputSemantics(output);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === 'SESSIONS_PER_WEEK_MISMATCH'
    ),
    true
  );
  assert.equal(
    result.issues.filter(
      (issue) => issue.code === 'ORDER_INDEX_NOT_SEQUENTIAL'
    ).length >= 4,
    true
  );
});

test('SINGLE, SUPERSET, CARDIO, lane equality, and cardio rules remain enforced', () => {
  const single = createAiOutput();
  single.workouts[0].blocks[0].exercises.push(
    clone(single.workouts[0].blocks[0].exercises[0])
  );

  const superset = createAiOutput();
  superset.workouts[0].blocks[0].blockType = 'SUPERSET';

  const cardio = createAiOutput();
  cardio.workouts[0].blocks[0].blockType = 'CARDIO';

  [single, superset, cardio].forEach((output) => {
    assert.equal(validateWeeklyPlanAiOutputSemantics(output).ok, false);
  });
});

test('generated exercise IDs remain restricted to the pool snapshot', () => {
  const document = {
    workouts: [
      {
        blocks: [
          {
            exercises: [
              { exerciseId: 'ex_bench' },
              { exerciseId: 'ex_outside' },
            ],
          },
        ],
      },
    ],
  };
  const result = validateGeneratedExerciseIdsAgainstPool(document, {
    allowedExerciseIds: ['ex_bench'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.uniqueExerciseIds, ['ex_bench', 'ex_outside']);
  assert.equal(result.issues[0].code, 'EXERCISE_OUTSIDE_POOL');
});

test('debug contract validates omissions and pool claims only, never duration', () => {
  const generatedAIOutput = createAiOutput();
  const analytics = {
    muscleMetrics: [
      {
        taxonomy: 'body_part',
        key: 'chest',
        directWorkingSets: 1,
      },
    ],
  };
  const context = {
    exercisePoolItems: [
      { exerciseId: 'ex_bench', bodyParts: ['chest'] },
    ],
  };
  const result = validateWeeklyPlanAiDebugContractAgainstAnalytics({
    generatedAIOutput,
    analytics,
    context,
  });

  assert.equal(result.ok, true);
  assert.equal(
    JSON.stringify(result).includes('duration'),
    false
  );
});

test('limited_by_eligible_pool uses canonical 0, 1, 2, and 3+ coverage', () => {
  for (const [count, supported] of [
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [5, false],
  ]) {
    const generatedAIOutput = createAiOutput();
    generatedAIOutput.muscleDistributionDebug.omittedBodyParts = [
      {
        area: 'quadriceps',
        reasonCode: 'limited_by_eligible_pool',
        explanation: 'Quadriceps coverage is limited by the pool.',
      },
    ];
    const audit = buildMuscleDistributionDebugAudit({
      generatedAIOutput,
      analytics: {
        muscleMetrics: [],
      },
      context: {
        exercisePoolItems: Array.from({ length: count }, (_, index) => ({
          exerciseId: `quad_${index}`,
          bodyParts: ['quadriceps'],
        })),
      },
    });

    assert.equal(
      audit.unsupportedPoolLimitationClaims.length === 0,
      supported
    );
  }
});
