const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
  WeeklyPlanAnalyticsError,
  buildWeeklyPlanAnalyticsAuditSummary,
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');

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
      perMuscle: [
        { area: 'upper_chest', targetSetsPerWeek: 3 },
        { area: 'chest', targetSetsPerWeek: 5 },
        { area: 'pectoralis_major', targetSetsPerWeek: 2 },
        { area: 'lats', targetSetsPerWeek: 0 },
        { area: 'missing_area', targetSetsPerWeek: 4 },
      ],
    },
    frequencyTargets: {
      perMuscle: [
        { area: 'upper_chest', targetSessionsPerWeek: 1 },
        { area: 'back', targetSessionsPerWeek: 2 },
        { area: 'latissimus_dorsi', targetSessionsPerWeek: 3 },
        { area: 'biceps', targetSessionsPerWeek: 2 },
        { area: 'missing_area', targetSessionsPerWeek: 1 },
      ],
    },
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

  assert.equal(WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION, 1);
  assert.equal(analytics.schemaVersion, 1);
  assert.equal(analytics.status, 'complete');
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

test('duration analytics reuse historical metrics and preserve declared duration separately', () => {
  const analytics = calculate();

  assert.deepEqual(
    analytics.workouts.map((workout) => ({
      calculated: workout.estimatedDurationMinutes,
      declared: workout.declaredEstimatedDurationMinutes,
      difference: workout.durationDifferenceMinutes,
    })),
    [
      { calculated: 29, declared: 40, difference: -11 },
      { calculated: 4, declared: 30, difference: -26 },
    ]
  );
  assert.equal(analytics.plan.estimatedDurationMinutesTotal, 33);
  assert.equal(analytics.plan.estimatedDurationMinutesAverage, 17);
  assert.equal(analytics.plan.declaredEstimatedDurationMinutesTotal, 70);
  assert.equal(analytics.plan.durationDifferenceMinutesTotal, -37);
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
  assert.equal(analytics.plan.estimatedDurationMinutesTotal, 20);
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

test('frequency is deduplicated by workout and secondary exposure does not drive targets', () => {
  const analytics = calculate();
  const bicepsDirect = findMetric(analytics, 'body_part', 'biceps');
  const bicepsIndirect = findMetric(analytics, 'secondary_muscle', 'biceps');
  const frequency = comparisonByArea(analytics.targetComparisons.frequency);

  assert.equal(findMetric(analytics, 'target_muscle', 'pectoralis_major').directWorkoutCount, 2);
  assert.equal(bicepsDirect.directWorkoutCount, 1);
  assert.equal(bicepsIndirect.indirectWorkoutCount, 2);
  assert.equal(frequency.biceps.generatedDirectValue, 1);
  assert.equal(frequency.biceps.resolvedTaxonomy, 'body_part');
  assert.equal(frequency.biceps.status, 'below_target');
});

test('target comparisons use locked resolution order and all informative statuses', () => {
  const analytics = calculate();
  const volume = comparisonByArea(analytics.targetComparisons.volume);
  const frequency = comparisonByArea(analytics.targetComparisons.frequency);

  assert.deepEqual(
    {
      taxonomy: volume.upper_chest.resolvedTaxonomy,
      value: volume.upper_chest.generatedDirectValue,
      status: volume.upper_chest.status,
      difference: volume.upper_chest.difference,
    },
    { taxonomy: 'muscle_focus', value: 3, status: 'within_target', difference: 0 }
  );
  assert.equal(volume.chest.resolvedTaxonomy, 'body_part');
  assert.equal(volume.chest.status, 'below_target');
  assert.equal(volume.chest.difference, -2);
  assert.equal(volume.chest.absoluteDifference, 2);
  assert.equal(volume.chest.relativeDifference, -0.4);
  assert.equal(volume.pectoralis_major.resolvedTaxonomy, 'target_muscle');
  assert.equal(volume.pectoralis_major.status, 'above_target');
  assert.equal(volume.pectoralis_major.relativeDifference, 0.5);
  assert.equal(volume.lats.status, 'above_target');
  assert.equal(volume.lats.targetValue, 0);
  assert.equal(volume.lats.relativeDifference, null);
  assert.deepEqual(volume.missing_area, {
    targetIndex: 4,
    area: 'missing_area',
    resolvedTaxonomy: null,
    targetValue: 4,
    generatedDirectValue: null,
    difference: null,
    absoluteDifference: null,
    relativeDifference: null,
    status: 'unavailable',
  });

  assert.equal(frequency.upper_chest.status, 'above_target');
  assert.equal(frequency.back.status, 'within_target');
  assert.equal(frequency.latissimus_dorsi.status, 'below_target');
  assert.equal(frequency.latissimus_dorsi.relativeDifference, -0.3333);
  assert.equal(frequency.missing_area.status, 'unavailable');
  assert.deepEqual(analytics.targetComparisons.volume.summary, {
    targetCount: 5,
    belowTargetCount: 1,
    withinTargetCount: 1,
    aboveTargetCount: 2,
    unavailableCount: 1,
  });
});

test('muscle_focus wins target resolution when the same key exists in multiple taxonomies', () => {
  const analytics = calculate({
    generatedAIOutput: createGeneratedAIOutput({
      volumeTargets: {
        perMuscle: [{ area: 'shared_key', targetSetsPerWeek: 3 }],
      },
      frequencyTargets: { perMuscle: [] },
    }),
  });

  assert.equal(
    analytics.targetComparisons.volume.items[0].resolvedTaxonomy,
    'muscle_focus'
  );
});

test('absent targets and null generatedAIOutput produce empty comparisons', () => {
  for (const generatedAIOutput of [null, {}, { volumeTargets: {}, frequencyTargets: {} }]) {
    const analytics = calculate({ generatedAIOutput });

    assert.deepEqual(analytics.targetComparisons.volume.items, []);
    assert.deepEqual(analytics.targetComparisons.frequency.items, []);
    assert.equal(analytics.targetComparisons.volume.summary.targetCount, 0);
    assert.equal(analytics.targetComparisons.frequency.summary.targetCount, 0);
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
  analytics.rawOutput = 'RAW_OUTPUT_SENTINEL';

  const summary = buildWeeklyPlanAnalyticsAuditSummary(analytics);
  const serialized = JSON.stringify(summary);

  assert.deepEqual(Object.keys(summary), [
    'schemaVersion',
    'status',
    'counts',
    'duration',
    'muscleMetadata',
    'targetComparisons',
  ]);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.counts.workingSetCount, 8);
  assert.equal(summary.muscleMetadata.unresolvedExerciseCount, 1);
  assert.equal(summary.workouts, undefined);
  assert.equal(summary.muscleMetrics, undefined);
  assert.doesNotMatch(serialized, /WORKOUT_DETAIL_SENTINEL/);
  assert.doesNotMatch(serialized, /MUSCLE_DETAIL_SENTINEL/);
  assert.doesNotMatch(serialized, /UNRESOLVED_ID_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_OUTPUT_SENTINEL/);
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
