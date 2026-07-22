const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
  WeeklyPlanAnalyticsError,
  buildWeeklyPlanAnalyticsAuditSummary,
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

function createSetTemplate(index, overrides = {}) {
  return {
    setIndex: index,
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

function createStrengthExercise(exerciseId, orderIndex, overrides = {}) {
  return {
    exerciseId,
    exerciseName: `Exercise ${exerciseId}`,
    orderIndex,
    bodyParts: [],
    muscleFocus: [],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    setTemplates: [createSetTemplate(1)],
    cardioPrescription: null,
    ...overrides,
  };
}

function createCardioExercise(overrides = {}) {
  return {
    exerciseId: 'ex_bike',
    exerciseName: 'Stationary Bike',
    orderIndex: 1,
    setTemplates: [],
    cardioPrescription: {
      durationMinutes: 15,
    },
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    availability: {
      sessionsPerWeek: 2,
      durationPerSession: 60,
    },
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
    exercisePoolItems: [
      {
        exerciseId: 'ex_bench',
        targetMuscles: [
          ' Pectoralis_Major ',
          'pectoralis_major',
          'shared_key',
        ],
        muscleFocus: ['Upper_Chest', 'shared_key'],
        bodyParts: ['Chest', 'shared_key'],
        secondaryMuscles: ['triceps', 'shared_key'],
      },
      {
        exerciseId: 'ex_row',
        targetMuscles: ['latissimus_dorsi'],
        muscleFocus: ['lats'],
        bodyParts: ['back'],
        secondaryMuscles: ['biceps'],
      },
      {
        exerciseId: 'ex_curl',
        targetMuscles: ['biceps_brachii', 'brachialis'],
        muscleFocus: ['biceps_long_head'],
        bodyParts: ['biceps'],
        secondaryMuscles: ['forearms'],
      },
      {
        exerciseId: 'ex_bike',
        targetMuscles: [],
        muscleFocus: [],
        bodyParts: [],
        secondaryMuscles: [],
      },
    ],
    ...overrides,
  };
}

function createGeneratedPlanDocument(overrides = {}) {
  return {
    name: 'Analytics fixture',
    sessionsPerWeek: 2,
    workouts: [
      {
        name: 'First workout',
        orderIndex: 1,
        estimatedDurationMinutes: 40,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            restSeconds: 120,
            exercises: [
              createStrengthExercise('ex_bench', 1, {
                bodyParts: ['chest'],
                muscleFocus: ['upper_chest'],
                setTemplates: [
                  createSetTemplate(1),
                  createSetTemplate(2),
                  createSetTemplate(3, { setType: 'WARMUP' }),
                ],
              }),
            ],
          },
          {
            orderIndex: 2,
            blockType: 'SUPERSET',
            roundCount: 2,
            restSeconds: 90,
            exercises: [
              createStrengthExercise('ex_row', 1, {
                bodyParts: ['back'],
                muscleFocus: ['lats'],
                setTemplates: [createSetTemplate(1), createSetTemplate(2)],
              }),
              createStrengthExercise('ex_curl', 2, {
                bodyParts: ['biceps'],
                muscleFocus: ['biceps_long_head'],
                defaultTempo: '2010',
                setTemplates: [
                  createSetTemplate(1, { targetReps: 12, tempo: '2010' }),
                  createSetTemplate(2, { targetReps: 12, tempo: '2010' }),
                ],
              }),
            ],
          },
          {
            orderIndex: 3,
            blockType: 'CARDIO',
            exercises: [createCardioExercise()],
          },
        ],
      },
      {
        name: 'Second workout',
        orderIndex: 2,
        estimatedDurationMinutes: 30,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            restSeconds: 120,
            exercises: [createStrengthExercise('ex_bench', 1, { bodyParts: ['chest'] })],
          },
          {
            orderIndex: 2,
            blockType: 'SINGLE',
            restSeconds: 120,
            exercises: [createStrengthExercise('ex_row', 1, { bodyParts: ['back'] })],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createGeneratedAIOutput(overrides = {}) {
  return {
    splitType: 'upper_lower',
    volumeTargets: {
      bodyParts: [
        { area: 'chest', targetSetsPerWeek: 5 },
        { area: 'shoulders', targetSetsPerWeek: 4 },
      ],
      muscleFocuses: [
        { area: 'upper_chest', targetSetsPerWeek: 3 },
        { area: 'lats', targetSetsPerWeek: 0 },
        { area: 'rear_delts', targetSetsPerWeek: 4 },
      ],
    },
    frequencyTargets: {
      bodyParts: [
        { area: 'back', targetSessionsPerWeek: 2 },
        { area: 'biceps', targetSessionsPerWeek: 2 },
      ],
      muscleFocuses: [
        { area: 'upper_chest', targetSessionsPerWeek: 1 },
        { area: 'rear_delts', targetSessionsPerWeek: 1 },
      ],
    },
    ...overrides,
  };
}

function createCardioDurationDocument(
  calculatedDurations,
  declaredDurations = calculatedDurations
) {
  return {
    name: 'Duration analytics fixture',
    sessionsPerWeek: calculatedDurations.length,
    workouts: calculatedDurations.map((durationMinutes, index) => ({
      name: `Cardio ${index + 1}`,
      orderIndex: index + 1,
      estimatedDurationMinutes: declaredDurations[index],
      blocks: [
        {
          orderIndex: 1,
          blockType: 'CARDIO',
          exercises: [
            createCardioExercise({
              exerciseId: `ex_cardio_${index + 1}`,
              cardioPrescription: { durationMinutes },
            }),
          ],
        },
      ],
    })),
  };
}

function createDurationAlignmentStatusCounts(overrides = {}) {
  return {
    [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 0,
    [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET]: 0,
    [DURATION_ALIGNMENT_STATUS.PREFERRED]: 0,
    [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET]: 0,
    [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET]: 0,
    [DURATION_ALIGNMENT_STATUS.UNAVAILABLE]: 0,
    ...overrides,
  };
}

function calculate(overrides = {}) {
  return calculateWeeklyPlanAnalytics({
    generatedAIOutput: createGeneratedAIOutput(),
    generatedPlanDocument: createGeneratedPlanDocument(),
    context: createContext(),
    ...overrides,
  });
}

function findMetric(analytics, taxonomy, key) {
  return analytics.muscleMetrics.find(
    (entry) => entry.taxonomy === taxonomy && entry.key === key
  );
}

function comparisonByArea(comparison) {
  return Object.fromEntries(comparison.items.map((item) => [item.area, item]));
}

test('calculateWeeklyPlanAnalytics returns versioned plan and workout counters', () => {
  const analytics = calculate();

  assert.equal(WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION, 2);
  assert.equal(analytics.schemaVersion, 2);
  assert.equal(analytics.status, 'complete');
  assert.deepEqual(analytics.evaluationPolicy, {
    id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
    version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  });
  assert.deepEqual(
    {
      workoutCount: analytics.plan.workoutCount,
      blockCount: analytics.plan.blockCount,
      exerciseCount: analytics.plan.exerciseCount,
      strengthExerciseCount: analytics.plan.strengthExerciseCount,
      cardioExerciseCount: analytics.plan.cardioExerciseCount,
      uniqueExerciseCount: analytics.plan.uniqueExerciseCount,
      workingSetCount: analytics.plan.workingSetCount,
      totalSetTemplateCount: analytics.plan.totalSetTemplateCount,
      singleBlockCount: analytics.plan.singleBlockCount,
      supersetBlockCount: analytics.plan.supersetBlockCount,
      cardioBlockCount: analytics.plan.cardioBlockCount,
    },
    {
      workoutCount: 2,
      blockCount: 5,
      exerciseCount: 6,
      strengthExerciseCount: 5,
      cardioExerciseCount: 1,
      uniqueExerciseCount: 4,
      workingSetCount: 8,
      totalSetTemplateCount: 9,
      singleBlockCount: 3,
      supersetBlockCount: 1,
      cardioBlockCount: 1,
    }
  );
  assert.deepEqual(
    analytics.workouts.map((workout) => ({
      workoutOrderIndex: workout.workoutOrderIndex,
      blockCount: workout.blockCount,
      strengthExerciseCount: workout.strengthExerciseCount,
      cardioExerciseCount: workout.cardioExerciseCount,
      workingSetCount: workout.workingSetCount,
      totalSetTemplateCount: workout.totalSetTemplateCount,
      supersetCount: workout.supersetCount,
      cardioDurationMinutes: workout.cardioDurationMinutes,
    })),
    [
      {
        workoutOrderIndex: 1,
        blockCount: 3,
        strengthExerciseCount: 3,
        cardioExerciseCount: 1,
        workingSetCount: 6,
        totalSetTemplateCount: 7,
        supersetCount: 1,
        cardioDurationMinutes: 15,
      },
      {
        workoutOrderIndex: 2,
        blockCount: 2,
        strengthExerciseCount: 2,
        cardioExerciseCount: 0,
        workingSetCount: 2,
        totalSetTemplateCount: 2,
        supersetCount: 0,
        cardioDurationMinutes: 0,
      },
    ]
  );
});

test('duration analytics reuse historical metrics and separate requested from declared duration', () => {
  const analytics = calculate();

  assert.deepEqual(
    analytics.workouts.map((workout) => ({
      requested: workout.requestedDurationMinutes,
      calculated: workout.calculatedDurationMinutes,
      calculatedAlias: workout.estimatedDurationMinutes,
      declared: workout.declaredEstimatedDurationMinutes,
      requestedDifference: workout.durationDifferenceMinutes,
      declaredDifference: workout.declaredDurationDifferenceMinutes,
      ratio: workout.durationUtilizationRatio,
      status: workout.durationAlignmentStatus,
      requiresCorrection: workout.durationRequiresCorrection,
    })),
    [
      {
        requested: 60,
        calculated: 29,
        calculatedAlias: 29,
        declared: 40,
        requestedDifference: -31,
        declaredDifference: -11,
        ratio: 0.4833,
        status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET,
        requiresCorrection: true,
      },
      {
        requested: 60,
        calculated: 4,
        calculatedAlias: 4,
        declared: 30,
        requestedDifference: -56,
        declaredDifference: -26,
        ratio: 0.0667,
        status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET,
        requiresCorrection: true,
      },
    ]
  );
  assert.equal(analytics.plan.requestedDurationMinutesPerWorkout, 60);
  assert.equal(analytics.plan.requestedDurationMinutesTotal, 120);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 33);
  assert.equal(analytics.plan.calculatedDurationMinutesAverage, 17);
  assert.equal(analytics.plan.estimatedDurationMinutesTotal, 33);
  assert.equal(analytics.plan.estimatedDurationMinutesAverage, 17);
  assert.equal(analytics.plan.declaredEstimatedDurationMinutesTotal, 70);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, -87);
  assert.equal(analytics.plan.declaredDurationDifferenceMinutesTotal, -37);
  assert.deepEqual(
    analytics.plan.durationAlignmentStatusCounts,
    createDurationAlignmentStatusCounts({
      [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 2,
    })
  );
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 2);
  assert.equal(analytics.plan.minWorkoutDurationMinutes, 4);
  assert.equal(analytics.plan.maxWorkoutDurationMinutes, 29);
  assert.equal(analytics.plan.cardioDurationMinutes, 15);
  assert.equal(analytics.plan.declaredSessionsPerWeek, 2);
  assert.equal(analytics.plan.sessionsMatchWorkoutCount, true);
  assert.equal(analytics.plan.splitType, 'upper_lower');
  const bodyPartDistribution = Object.fromEntries(
    analytics.plan.bodyPartDistribution.map((entry) => [entry.key, entry.rawSets])
  );
  assert.equal(bodyPartDistribution.chest, 4);
  assert.equal(bodyPartDistribution.back, 3);
  assert.equal(bodyPartDistribution.biceps, 2);
});

test('requested 60 and calculated 58 is preferred while declared duration stays independent', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: createCardioDurationDocument([58], [45]),
    context: createContext({
      availability: { sessionsPerWeek: 1, durationPerSession: 60 },
    }),
  });
  const workout = analytics.workouts[0];

  assert.deepEqual(
    {
      requestedDurationMinutes: workout.requestedDurationMinutes,
      calculatedDurationMinutes: workout.calculatedDurationMinutes,
      durationDifferenceMinutes: workout.durationDifferenceMinutes,
      durationUtilizationRatio: workout.durationUtilizationRatio,
      durationAlignmentStatus: workout.durationAlignmentStatus,
      durationRequiresCorrection: workout.durationRequiresCorrection,
      declaredEstimatedDurationMinutes: workout.declaredEstimatedDurationMinutes,
      declaredDurationDifferenceMinutes: workout.declaredDurationDifferenceMinutes,
      estimatedDurationMinutes: workout.estimatedDurationMinutes,
    },
    {
      requestedDurationMinutes: 60,
      calculatedDurationMinutes: 58,
      durationDifferenceMinutes: -2,
      durationUtilizationRatio: 0.9667,
      durationAlignmentStatus: DURATION_ALIGNMENT_STATUS.PREFERRED,
      durationRequiresCorrection: false,
      declaredEstimatedDurationMinutes: 45,
      declaredDurationDifferenceMinutes: 13,
      estimatedDurationMinutes: 58,
    }
  );
  assert.equal(analytics.plan.requestedDurationMinutesTotal, 60);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 58);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, -2);
  assert.equal(analytics.plan.declaredEstimatedDurationMinutesTotal, 45);
  assert.equal(analytics.plan.declaredDurationDifferenceMinutesTotal, 13);
});

test('duration alignment preserves exact boundaries and correction bands', () => {
  const cases = [
    [50, DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET, true],
    [51, DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET, false],
    [54, DURATION_ALIGNMENT_STATUS.PREFERRED, false],
    [60, DURATION_ALIGNMENT_STATUS.PREFERRED, false],
    [63, DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET, false],
    [64, DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET, true],
  ];

  cases.forEach(([calculatedDurationMinutes, status, requiresCorrection]) => {
    const analytics = calculateWeeklyPlanAnalytics({
      generatedAIOutput: null,
      generatedPlanDocument: createCardioDurationDocument([
        calculatedDurationMinutes,
      ]),
      context: createContext({
        availability: { sessionsPerWeek: 1, durationPerSession: 60 },
      }),
    });

    assert.equal(analytics.workouts[0].durationAlignmentStatus, status);
    assert.equal(
      analytics.workouts[0].durationRequiresCorrection,
      requiresCorrection
    );
  });
});

test('invalid requested duration is unavailable and never requires correction', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: createCardioDurationDocument([20]),
    context: createContext({
      availability: { sessionsPerWeek: 1, durationPerSession: 0 },
    }),
  });

  assert.equal(analytics.workouts[0].requestedDurationMinutes, 0);
  assert.equal(
    analytics.workouts[0].durationAlignmentStatus,
    DURATION_ALIGNMENT_STATUS.UNAVAILABLE
  );
  assert.equal(analytics.workouts[0].durationRequiresCorrection, false);
  assert.equal(analytics.workouts[0].durationDifferenceMinutes, null);
  assert.equal(analytics.workouts[0].durationUtilizationRatio, null);
  assert.equal(analytics.plan.requestedDurationMinutesTotal, null);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, null);
  assert.deepEqual(
    analytics.plan.durationAlignmentStatusCounts,
    createDurationAlignmentStatusCounts({
      [DURATION_ALIGNMENT_STATUS.UNAVAILABLE]: 1,
    })
  );
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 0);
});

test('missing declared duration nulls only declared totals and differences', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: createCardioDurationDocument([58, 60], [58, undefined]),
    context: createContext(),
  });

  assert.equal(analytics.workouts[1].declaredEstimatedDurationMinutes, null);
  assert.equal(analytics.workouts[1].declaredDurationDifferenceMinutes, null);
  assert.equal(analytics.plan.declaredEstimatedDurationMinutesTotal, null);
  assert.equal(analytics.plan.declaredDurationDifferenceMinutesTotal, null);
  assert.equal(analytics.plan.requestedDurationMinutesTotal, 120);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 118);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, -2);
});

test('opposing correction workouts never cancel their per-workout failures', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: createCardioDurationDocument([50, 64]),
    context: createContext(),
  });

  assert.equal(analytics.plan.requestedDurationMinutesTotal, 120);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 114);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, -6);
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 2);
  assert.deepEqual(
    analytics.plan.durationAlignmentStatusCounts,
    createDurationAlignmentStatusCounts({
      [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 1,
      [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET]: 1,
    })
  );
});

test('an empty plan returns zero duration totals and every status counter', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: {
      name: 'Empty analytics fixture',
      sessionsPerWeek: 0,
      workouts: [],
    },
    context: createContext(),
  });

  assert.equal(analytics.plan.requestedDurationMinutesPerWorkout, 60);
  assert.equal(analytics.plan.requestedDurationMinutesTotal, 0);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 0);
  assert.equal(analytics.plan.calculatedDurationMinutesAverage, 0);
  assert.equal(analytics.plan.declaredEstimatedDurationMinutesTotal, 0);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, 0);
  assert.equal(analytics.plan.declaredDurationDifferenceMinutesTotal, 0);
  assert.deepEqual(
    analytics.plan.durationAlignmentStatusCounts,
    createDurationAlignmentStatusCounts()
  );
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 0);
});

test('CARDIO is excluded from working sets and muscle projections but included in duration', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: {
      sessionsPerWeek: 1,
      workouts: [
        {
          orderIndex: 1,
          estimatedDurationMinutes: 25,
          blocks: [
            {
              blockType: 'CARDIO',
              exercises: [
                createCardioExercise({
                  setTemplates: [createSetTemplate(1)],
                  cardioPrescription: { durationMinutes: 20 },
                }),
              ],
            },
          ],
        },
      ],
    },
    context: createContext(),
  });

  assert.equal(analytics.status, 'complete');
  assert.equal(analytics.plan.strengthExerciseCount, 0);
  assert.equal(analytics.plan.cardioExerciseCount, 1);
  assert.equal(analytics.plan.workingSetCount, 0);
  assert.equal(analytics.plan.totalSetTemplateCount, 0);
  assert.equal(analytics.plan.requestedDurationMinutesTotal, 60);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 20);
  assert.equal(analytics.plan.estimatedDurationMinutesTotal, 20);
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 1);
  assert.equal(analytics.plan.cardioDurationMinutes, 20);
  assert.deepEqual(analytics.muscleMetrics, []);
  assert.deepEqual(analytics.metadataCoverage, {
    totalStrengthWorkingSets: 0,
    attributedStrengthWorkingSets: 0,
    coverageRatio: 1,
    unresolvedExerciseIds: [],
  });
});

test('a plan without cardio keeps cardio counters and duration at zero', () => {
  const document = createGeneratedPlanDocument({
    sessionsPerWeek: 1,
    workouts: [createGeneratedPlanDocument().workouts[1]],
  });
  const analytics = calculate({ generatedPlanDocument: document });

  assert.equal(analytics.plan.cardioBlockCount, 0);
  assert.equal(analytics.plan.cardioExerciseCount, 0);
  assert.equal(analytics.plan.cardioDurationMinutes, 0);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 4);
  assert.equal(analytics.plan.estimatedDurationMinutesTotal, 4);
});

test('direct taxonomies remain separate and indirect contributions have no coefficient', () => {
  const analytics = calculate();
  const pectoralis = findMetric(analytics, 'target_muscle', 'pectoralis_major');
  const upperChest = findMetric(analytics, 'muscle_focus', 'upper_chest');
  const chest = findMetric(analytics, 'body_part', 'chest');
  const triceps = findMetric(analytics, 'secondary_muscle', 'triceps');

  assert.deepEqual(pectoralis, {
    taxonomy: 'target_muscle',
    key: 'pectoralis_major',
    directWorkingSets: 3,
    indirectWorkingSets: 0,
    directWorkoutCount: 2,
    indirectWorkoutCount: 0,
  });
  assert.equal(upperChest.directWorkingSets, 3);
  assert.equal(chest.directWorkingSets, 3);
  assert.equal(triceps.indirectWorkingSets, 3);
  assert.equal(triceps.directWorkingSets, 0);

  const sharedTaxonomies = analytics.muscleMetrics
    .filter((entry) => entry.key === 'shared_key')
    .map((entry) => entry.taxonomy);
  assert.deepEqual(sharedTaxonomies, ['target_muscle', 'muscle_focus', 'body_part']);
  assert.equal(findMetric(analytics, 'secondary_muscle', 'shared_key'), undefined);

  const curlTargets = ['biceps_brachii', 'brachialis'].map(
    (key) => findMetric(analytics, 'target_muscle', key).directWorkingSets
  );
  assert.deepEqual(curlTargets, [2, 2]);
});

test('muscle projection keys are deduplicated per exercise without multiplying coverage', () => {
  const analytics = calculate();

  assert.equal(
    analytics.muscleMetrics.filter(
      (entry) => entry.taxonomy === 'target_muscle' && entry.key === 'pectoralis_major'
    ).length,
    1
  );
  assert.deepEqual(analytics.metadataCoverage, {
    totalStrengthWorkingSets: 8,
    attributedStrengthWorkingSets: 8,
    coverageRatio: 1,
    unresolvedExerciseIds: [],
  });
});

test('canonical target fixture counts full direct sets per lane and deduplicates frequency by workout', () => {
  const context = createContext({
    availability: { sessionsPerWeek: 2, durationPerSession: 60 },
    exercisePoolItems: [
      {
        exerciseId: 'ex_chest',
        bodyParts: ['chest'],
        muscleFocus: ['upper_chest'],
        targetMuscles: ['pectoralis_major'],
        secondaryMuscles: [],
      },
      {
        exerciseId: 'ex_back',
        bodyParts: ['back'],
        muscleFocus: ['lats'],
        targetMuscles: ['latissimus_dorsi'],
        secondaryMuscles: ['biceps_brachii'],
      },
      {
        exerciseId: 'ex_rear',
        bodyParts: ['shoulders', 'back'],
        muscleFocus: ['rear_delts'],
        targetMuscles: ['posterior_deltoid'],
        secondaryMuscles: ['trapezius_middle'],
      },
      {
        exerciseId: 'ex_abs',
        bodyParts: ['abs'],
        muscleFocus: ['upper_abs'],
        targetMuscles: ['rectus_abdominis'],
        secondaryMuscles: [],
      },
    ],
  });
  const threeSets = [
    createSetTemplate(1),
    createSetTemplate(2),
    createSetTemplate(3),
  ];
  const twoSets = [createSetTemplate(1), createSetTemplate(2)];
  const generatedPlanDocument = {
    name: 'Canonical target fixture',
    sessionsPerWeek: 2,
    workouts: [
      {
        name: 'Upper',
        orderIndex: 1,
        estimatedDurationMinutes: 60,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [
              createStrengthExercise('ex_chest', 1, {
                setTemplates: threeSets,
              }),
            ],
          },
          {
            orderIndex: 2,
            blockType: 'SUPERSET',
            roundCount: 2,
            exercises: [
              createStrengthExercise('ex_back', 1, {
                setTemplates: twoSets,
              }),
              createStrengthExercise('ex_rear', 2, {
                setTemplates: twoSets,
              }),
            ],
          },
        ],
      },
      {
        name: 'Core',
        orderIndex: 2,
        estimatedDurationMinutes: 30,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [createStrengthExercise('ex_abs', 1)],
          },
        ],
      },
    ],
  };
  const generatedAIOutput = {
    volumeTargets: {
      bodyParts: [
        { area: 'chest', targetSetsPerWeek: 3 },
        { area: 'back', targetSetsPerWeek: 4 },
        { area: 'shoulders', targetSetsPerWeek: 2 },
      ],
      muscleFocuses: [
        { area: 'upper_chest', targetSetsPerWeek: 3 },
        { area: 'lats', targetSetsPerWeek: 2 },
        { area: 'rear_delts', targetSetsPerWeek: 2 },
      ],
    },
    frequencyTargets: {
      bodyParts: [
        { area: 'chest', targetSessionsPerWeek: 1 },
        { area: 'back', targetSessionsPerWeek: 1 },
        { area: 'shoulders', targetSessionsPerWeek: 1 },
      ],
      muscleFocuses: [
        { area: 'upper_chest', targetSessionsPerWeek: 1 },
        { area: 'lats', targetSessionsPerWeek: 1 },
        { area: 'rear_delts', targetSessionsPerWeek: 1 },
      ],
    },
  };
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context,
  });

  assert.equal(findMetric(analytics, 'body_part', 'chest').directWorkingSets, 3);
  assert.equal(findMetric(analytics, 'body_part', 'back').directWorkingSets, 4);
  assert.equal(findMetric(analytics, 'body_part', 'shoulders').directWorkingSets, 2);
  assert.equal(findMetric(analytics, 'muscle_focus', 'rear_delts').directWorkingSets, 2);
  assert.equal(findMetric(analytics, 'body_part', 'back').directWorkoutCount, 1);
  assert.equal(findMetric(analytics, 'target_muscle', 'posterior_deltoid').directWorkingSets, 2);
  assert.equal(findMetric(analytics, 'secondary_muscle', 'trapezius_middle').indirectWorkingSets, 2);
  assert.deepEqual(analytics.targetComparisons.volume.overallSummary, {
    targetCount: 6,
    belowTargetCount: 0,
    withinTargetCount: 6,
    aboveTargetCount: 0,
    unavailableCount: 0,
  });
  assert.deepEqual(analytics.targetComparisons.frequency.overallSummary, {
    targetCount: 6,
    belowTargetCount: 0,
    withinTargetCount: 6,
    aboveTargetCount: 0,
    unavailableCount: 0,
  });
  assert.equal(
    JSON.stringify(analytics.targetComparisons).includes('target_muscle'),
    false
  );
  assert.equal(
    JSON.stringify(analytics.targetComparisons).includes('secondary_muscle'),
    false
  );
});

test('frequency is deduplicated by workout and secondary exposure does not drive targets', () => {
  const analytics = calculate();
  const bicepsDirect = findMetric(analytics, 'body_part', 'biceps');
  const bicepsIndirect = findMetric(analytics, 'secondary_muscle', 'biceps');
  const frequency = comparisonByArea(
    analytics.targetComparisons.frequency.bodyParts
  );

  assert.equal(findMetric(analytics, 'target_muscle', 'pectoralis_major').directWorkoutCount, 2);
  assert.equal(bicepsDirect.directWorkoutCount, 1);
  assert.equal(bicepsIndirect.indirectWorkoutCount, 2);
  assert.equal(frequency.biceps.generatedDirectValue, 1);
  assert.equal(frequency.biceps.resolvedTaxonomy, 'body_part');
  assert.equal(frequency.biceps.status, 'below_target');
});

test('target comparisons use explicit parent taxonomies and all informative statuses', () => {
  const analytics = calculate();
  const volumeBodyParts = comparisonByArea(
    analytics.targetComparisons.volume.bodyParts
  );
  const volumeMuscleFocuses = comparisonByArea(
    analytics.targetComparisons.volume.muscleFocuses
  );
  const frequencyBodyParts = comparisonByArea(
    analytics.targetComparisons.frequency.bodyParts
  );
  const frequencyMuscleFocuses = comparisonByArea(
    analytics.targetComparisons.frequency.muscleFocuses
  );

  assert.deepEqual(
    {
      taxonomy: volumeMuscleFocuses.upper_chest.resolvedTaxonomy,
      value: volumeMuscleFocuses.upper_chest.generatedDirectValue,
      status: volumeMuscleFocuses.upper_chest.status,
      difference: volumeMuscleFocuses.upper_chest.difference,
    },
    { taxonomy: 'muscle_focus', value: 3, status: 'within_target', difference: 0 }
  );
  assert.equal(volumeBodyParts.chest.resolvedTaxonomy, 'body_part');
  assert.equal(volumeBodyParts.chest.status, 'below_target');
  assert.equal(volumeBodyParts.chest.difference, -2);
  assert.equal(volumeBodyParts.chest.absoluteDifference, 2);
  assert.equal(volumeBodyParts.chest.relativeDifference, -0.4);
  assert.equal(volumeMuscleFocuses.lats.status, 'above_target');
  assert.equal(volumeMuscleFocuses.lats.targetValue, 0);
  assert.equal(volumeMuscleFocuses.lats.relativeDifference, null);
  assert.deepEqual(volumeBodyParts.shoulders, {
    targetIndex: 1,
    area: 'shoulders',
    resolvedTaxonomy: 'body_part',
    targetValue: 4,
    generatedDirectValue: null,
    difference: null,
    absoluteDifference: null,
    relativeDifference: null,
    status: 'unavailable',
  });

  assert.equal(frequencyMuscleFocuses.upper_chest.status, 'above_target');
  assert.equal(frequencyBodyParts.back.status, 'within_target');
  assert.equal(frequencyBodyParts.biceps.status, 'below_target');
  assert.equal(frequencyBodyParts.biceps.relativeDifference, -0.5);
  assert.equal(frequencyMuscleFocuses.rear_delts.status, 'unavailable');
  assert.deepEqual(analytics.targetComparisons.volume.overallSummary, {
    targetCount: 5,
    belowTargetCount: 1,
    withinTargetCount: 1,
    aboveTargetCount: 1,
    unavailableCount: 2,
  });
});

test('target comparisons never resolve through target_muscle or secondary_muscle', () => {
  const analytics = calculate({
    generatedAIOutput: createGeneratedAIOutput({
      volumeTargets: {
        bodyParts: [{ area: 'chest', targetSetsPerWeek: 3 }],
        muscleFocuses: [{ area: 'upper_chest', targetSetsPerWeek: 3 }],
      },
      frequencyTargets: {
        bodyParts: [],
        muscleFocuses: [],
      },
    }),
  });

  const items = [
    ...analytics.targetComparisons.volume.bodyParts.items,
    ...analytics.targetComparisons.volume.muscleFocuses.items,
  ];
  assert.deepEqual(
    items.map((item) => item.resolvedTaxonomy),
    ['body_part', 'muscle_focus']
  );
  assert.equal(
    items.some((item) =>
      ['target_muscle', 'secondary_muscle'].includes(item.resolvedTaxonomy)
    ),
    false
  );
});

test('absent targets and null generatedAIOutput produce empty comparisons', () => {
  for (const generatedAIOutput of [null, {}, { volumeTargets: {}, frequencyTargets: {} }]) {
    const analytics = calculate({ generatedAIOutput });

    assert.deepEqual(analytics.targetComparisons.volume.bodyParts.items, []);
    assert.deepEqual(analytics.targetComparisons.volume.muscleFocuses.items, []);
    assert.deepEqual(analytics.targetComparisons.frequency.bodyParts.items, []);
    assert.deepEqual(analytics.targetComparisons.frequency.muscleFocuses.items, []);
    assert.equal(analytics.targetComparisons.volume.overallSummary.targetCount, 0);
    assert.equal(analytics.targetComparisons.frequency.overallSummary.targetCount, 0);
  }
});

test('missing or incomplete pool metadata produces partial analytics and deduplicated unresolved IDs', () => {
  const document = {
    sessionsPerWeek: 1,
    workouts: [
      {
        orderIndex: 1,
        estimatedDurationMinutes: 20,
        blocks: [
          {
            blockType: 'SUPERSET',
            roundCount: 1,
            exercises: [
              createStrengthExercise('ex_missing', 1),
              createStrengthExercise('ex_missing', 2),
              createStrengthExercise('ex_secondary_only', 3),
            ],
          },
        ],
      },
    ],
  };
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: null,
    generatedPlanDocument: document,
    context: {
      availability: {
        sessionsPerWeek: 1,
        durationPerSession: 60,
      },
      evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
      exercisePoolItems: [
        {
          exerciseId: 'ex_secondary_only',
          targetMuscles: [],
          muscleFocus: [],
          bodyParts: [],
          secondaryMuscles: ['helper'],
        },
      ],
    },
  });

  assert.equal(analytics.status, 'partial');
  assert.deepEqual(analytics.metadataCoverage, {
    totalStrengthWorkingSets: 3,
    attributedStrengthWorkingSets: 0,
    coverageRatio: 0,
    unresolvedExerciseIds: ['ex_missing', 'ex_secondary_only'],
  });
  assert.equal(findMetric(analytics, 'secondary_muscle', 'helper').indirectWorkingSets, 1);
});

test('analytics are deterministic and do not mutate any input', () => {
  const input = {
    generatedAIOutput: createGeneratedAIOutput(),
    generatedPlanDocument: createGeneratedPlanDocument({
      workouts: [...createGeneratedPlanDocument().workouts].reverse(),
    }),
    context: createContext(),
  };
  const before = structuredClone(input);
  const first = calculateWeeklyPlanAnalytics(input);
  const second = calculateWeeklyPlanAnalytics(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(first.workouts.map((workout) => workout.workoutOrderIndex), [1, 2]);
  assert.deepEqual(first.metadataCoverage.unresolvedExerciseIds, []);
});

test('buildWeeklyPlanAnalyticsAuditSummary is strictly allowlisted', () => {
  const analytics = calculate();
  analytics.workouts[0].privateSentinel = 'WORKOUT_DETAIL_SENTINEL';
  analytics.muscleMetrics[0].privateSentinel = 'MUSCLE_DETAIL_SENTINEL';
  analytics.metadataCoverage.unresolvedExerciseIds.push('UNRESOLVED_ID_SENTINEL');
  analytics.plan.durationAlignmentStatusCounts.privateSentinel =
    'DURATION_STATUS_SENTINEL';
  analytics.rawOutput = 'RAW_OUTPUT_SENTINEL';

  const summary = buildWeeklyPlanAnalyticsAuditSummary(analytics);
  const serialized = JSON.stringify(summary);

  assert.deepEqual(Object.keys(summary), [
    'schemaVersion',
    'status',
    'evaluationPolicy',
    'counts',
    'duration',
    'muscleMetadata',
    'targetComparisons',
  ]);
  assert.equal(summary.schemaVersion, 2);
  assert.deepEqual(summary.evaluationPolicy, {
    id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
    version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  });
  assert.equal(summary.counts.workingSetCount, 8);
  assert.deepEqual(summary.duration, {
    requestedDurationMinutesPerWorkout: 60,
    requestedDurationMinutesTotal: 120,
    calculatedDurationMinutesTotal: 33,
    calculatedDurationMinutesAverage: 17,
    declaredEstimatedDurationMinutesTotal: 70,
    durationDifferenceMinutesTotal: -87,
    declaredDurationDifferenceMinutesTotal: -37,
    estimatedDurationMinutesTotal: 33,
    estimatedDurationMinutesAverage: 17,
    minWorkoutDurationMinutes: 4,
    maxWorkoutDurationMinutes: 29,
    cardioDurationMinutes: 15,
    durationAlignmentStatusCounts: createDurationAlignmentStatusCounts({
      [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 2,
    }),
    correctionRequiredWorkoutCount: 2,
  });
  assert.equal(summary.muscleMetadata.unresolvedExerciseCount, 1);
  assert.equal(summary.workouts, undefined);
  assert.equal(summary.muscleMetrics, undefined);
  assert.doesNotMatch(serialized, /WORKOUT_DETAIL_SENTINEL/);
  assert.doesNotMatch(serialized, /MUSCLE_DETAIL_SENTINEL/);
  assert.doesNotMatch(serialized, /UNRESOLVED_ID_SENTINEL/);
  assert.doesNotMatch(serialized, /DURATION_STATUS_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_OUTPUT_SENTINEL/);
});

test('Analytics V2 requires the canonical evaluation policy identity without reference equality', () => {
  const clonedIdentity = {
    id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
    version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  };
  const analytics = calculate({
    context: createContext({ evaluationPolicy: clonedIdentity }),
  });

  assert.notStrictEqual(clonedIdentity, WEEKLY_PLAN_EVALUATION_POLICY);
  assert.deepEqual(analytics.evaluationPolicy, clonedIdentity);

  const invalidPolicies = [
    undefined,
    {
      id: 'wrong_policy',
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    },
    {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION + 1,
    },
  ];

  invalidPolicies.forEach((evaluationPolicy) => {
    assert.throws(
      () =>
        calculate({
          context: createContext({ evaluationPolicy }),
        }),
      (error) => {
        assert.equal(error instanceof WeeklyPlanAnalyticsError, true);
        assert.equal(error.code, 'INVALID_WEEKLY_PLAN_EVALUATION_POLICY');
        return true;
      }
    );
  });
});

test('invalid generated plan documents raise WeeklyPlanAnalyticsError', () => {
  assert.throws(
    () => calculateWeeklyPlanAnalytics({ generatedPlanDocument: null, context: {} }),
    (error) => {
      assert.equal(error instanceof WeeklyPlanAnalyticsError, true);
      assert.equal(error.code, 'INVALID_GENERATED_PLAN_DOCUMENT');
      return true;
    }
  );
});
