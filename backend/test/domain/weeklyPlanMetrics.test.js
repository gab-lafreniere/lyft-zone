const test = require('node:test');
const assert = require('node:assert/strict');

let prisma;

require.cache[require.resolve('../../lib/prisma')] = {
  id: require.resolve('../../lib/prisma'),
  filename: require.resolve('../../lib/prisma'),
  loaded: true,
  exports: {
    getPrisma: () => prisma,
  },
};

const {
  aggregateWeeklyPlanMetrics,
  computeWeeklyPlanWorkoutMetrics,
} = require('../../src/domain/weeklyPlans/weeklyPlanMetrics');
const {
  getWeeklyPlanDetails,
  listVisibleWeeklyPlans,
} = require('../../services/weeklyPlansService');

const BODY_PART_KEYS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

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

function createSingleWorkout(overrides = {}) {
  return {
    id: 'workout_single',
    name: 'Manual Chest',
    orderIndex: 1,
    blocks: [
      {
        id: 'block_single',
        orderIndex: 1,
        blockType: 'SINGLE',
        restSeconds: 120,
        exercises: [
          {
            id: 'block_exercise_bench',
            exerciseId: 'ex_bench',
            exerciseName: 'Bench Press',
            orderIndex: 1,
            bodyParts: ['chest', 'triceps'],
            muscleFocus: ['mid_chest'],
            defaultTempo: '3010',
            defaultRestSeconds: 120,
            notes: null,
            setTemplates: [
              createSetTemplate({ setIndex: 1 }),
              createSetTemplate({ setIndex: 2 }),
              createSetTemplate({ setIndex: 3 }),
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createSupersetWorkout(overrides = {}) {
  return {
    id: 'workout_superset',
    name: 'Manual Superset',
    orderIndex: 2,
    blocks: [
      {
        id: 'block_superset',
        orderIndex: 1,
        blockType: 'SUPERSET',
        roundCount: 3,
        restSeconds: 90,
        exercises: [
          {
            exerciseId: 'ex_bench',
            exerciseName: 'Bench Press',
            bodyParts: ['chest'],
            defaultTempo: '3010',
            setTemplates: [
              createSetTemplate({ setIndex: 1 }),
              createSetTemplate({ setIndex: 2 }),
              createSetTemplate({ setIndex: 3 }),
            ],
          },
          {
            exerciseId: 'ex_row',
            exerciseName: 'Cable Row',
            bodyParts: ['back'],
            defaultTempo: '2010',
            setTemplates: [
              createSetTemplate({ setIndex: 1, targetReps: 12, tempo: '2010' }),
              createSetTemplate({ setIndex: 2, targetReps: 12, tempo: '2010' }),
              createSetTemplate({ setIndex: 3, targetReps: 12, tempo: '2010' }),
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createCardioWorkout(overrides = {}) {
  return {
    id: 'workout_cardio',
    name: 'Manual Cardio',
    orderIndex: 3,
    blocks: [
      {
        id: 'block_cardio',
        orderIndex: 1,
        blockType: 'CARDIO',
        exercises: [
          {
            exerciseId: 'ex_bike',
            exerciseName: 'Stationary Bike',
            bodyParts: ['quadriceps'],
            setTemplates: [createSetTemplate()],
            cardioPrescription: {
              durationMinutes: 20,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function distributionByKey(metrics) {
  return Object.fromEntries(metrics.muscleDistribution.map((entry) => [entry.key, entry]));
}

test('computeWeeklyPlanWorkoutMetrics preserves SINGLE tempo, setup, rest multiplier, and distribution', () => {
  const workout = createSingleWorkout();
  const before = structuredClone(workout);
  const metrics = computeWeeklyPlanWorkoutMetrics(workout);
  const distribution = distributionByKey(metrics);

  assert.deepEqual(metrics, {
    exerciseCount: 1,
    setCount: 3,
    estimatedDurationMinutes: 8,
    totalTUTMinutes: 2,
    totalTUTSeconds: 120,
    hasContent: true,
    muscleDistribution: metrics.muscleDistribution,
  });
  assert.deepEqual(distribution.chest, {
    key: 'chest',
    label: 'Chest',
    rawSets: 3,
    normalizedShare: 1.5,
    percentageOfWorkout: 50,
  });
  assert.deepEqual(distribution.triceps, {
    key: 'triceps',
    label: 'Triceps',
    rawSets: 3,
    normalizedShare: 1.5,
    percentageOfWorkout: 50,
  });
  assert.deepEqual(workout, before);
});

test('computeWeeklyPlanWorkoutMetrics preserves targetReps and maxReps fallback behavior', () => {
  const workout = createSingleWorkout({
    blocks: [
      {
        blockType: 'SINGLE',
        restSeconds: 60,
        exercises: [
          {
            exerciseId: 'ex_curl',
            exerciseName: 'Cable Curl',
            bodyParts: ['biceps'],
            defaultTempo: null,
            setTemplates: [
              createSetTemplate({ setIndex: 1, targetReps: 10, tempo: '2010' }),
              createSetTemplate({
                setIndex: 2,
                targetReps: null,
                minReps: 8,
                maxReps: 12,
                tempo: '9999',
              }),
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(computeWeeklyPlanWorkoutMetrics(workout), {
    exerciseCount: 1,
    setCount: 2,
    estimatedDurationMinutes: 4,
    totalTUTMinutes: 1,
    totalTUTSeconds: 66,
    hasContent: true,
    muscleDistribution: computeWeeklyPlanWorkoutMetrics(workout).muscleDistribution,
  });
});

test('computeWeeklyPlanWorkoutMetrics preserves SUPERSET rounds, rest, setup, TUT, and sets', () => {
  const metrics = computeWeeklyPlanWorkoutMetrics(createSupersetWorkout());
  const distribution = distributionByKey(metrics);

  assert.equal(metrics.exerciseCount, 2);
  assert.equal(metrics.setCount, 6);
  assert.equal(metrics.estimatedDurationMinutes, 9);
  assert.equal(metrics.totalTUTMinutes, 4);
  assert.equal(metrics.totalTUTSeconds, 228);
  assert.equal(distribution.chest.rawSets, 3);
  assert.equal(distribution.chest.percentageOfWorkout, 50);
  assert.equal(distribution.back.rawSets, 3);
  assert.equal(distribution.back.percentageOfWorkout, 50);
});

test('computeWeeklyPlanWorkoutMetrics excludes CARDIO sets and includes its duration', () => {
  const metrics = computeWeeklyPlanWorkoutMetrics(createCardioWorkout());

  assert.equal(metrics.exerciseCount, 1);
  assert.equal(metrics.setCount, 0);
  assert.equal(metrics.estimatedDurationMinutes, 20);
  assert.equal(metrics.totalTUTSeconds, 0);
  assert.equal(metrics.hasContent, true);
  metrics.muscleDistribution.forEach((entry) => {
    assert.equal(entry.rawSets, 0);
    assert.equal(entry.percentageOfWorkout, 0);
  });
});

test('computeWeeklyPlanWorkoutMetrics preserves mixed SINGLE, SUPERSET, and CARDIO rounding', () => {
  const workout = {
    blocks: [
      ...createSingleWorkout().blocks,
      ...createSupersetWorkout().blocks,
      ...createCardioWorkout().blocks,
    ],
  };
  const metrics = computeWeeklyPlanWorkoutMetrics(workout);

  assert.equal(metrics.exerciseCount, 4);
  assert.equal(metrics.setCount, 9);
  assert.equal(metrics.estimatedDurationMinutes, 37);
  assert.equal(metrics.totalTUTMinutes, 6);
  assert.equal(metrics.totalTUTSeconds, 348);
});

test('aggregateWeeklyPlanMetrics preserves totals, averages, and weekly distribution', () => {
  const workouts = [createSingleWorkout(), createSupersetWorkout(), createCardioWorkout()];
  const before = structuredClone(workouts);
  const metrics = aggregateWeeklyPlanMetrics(workouts);
  const distribution = distributionByKey(metrics);

  assert.equal(metrics.totalExerciseCount, 4);
  assert.equal(metrics.totalSetCount, 9);
  assert.equal(metrics.averageDurationMinutes, 12);
  assert.equal(metrics.averageTUTMinutes, 2);
  assert.equal(distribution.chest.rawSets, 6);
  assert.equal(distribution.back.rawSets, 3);
  assert.equal(distribution.triceps.rawSets, 3);
  assert.deepEqual(workouts, before);
});

test('GIANT_SET and CIRCUIT retain their historical ignored behavior', () => {
  for (const blockType of ['GIANT_SET', 'CIRCUIT']) {
    const metrics = computeWeeklyPlanWorkoutMetrics({
      blocks: [
        {
          blockType,
          exercises: createSupersetWorkout().blocks[0].exercises,
        },
      ],
    });

    assert.equal(metrics.exerciseCount, 0);
    assert.equal(metrics.setCount, 0);
    assert.equal(metrics.estimatedDurationMinutes, 0);
    assert.equal(metrics.totalTUTSeconds, 0);
    assert.equal(metrics.hasContent, false);
  }
});

test('manual weekly plan list and details responses retain their public metric shapes', async () => {
  const workout = createSingleWorkout();
  const version = {
    id: 'version_manual',
    name: 'Manual Plan',
    status: 'DRAFT',
    sessionsPerWeek: 1,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-02T12:00:00.000Z',
    workouts: [workout],
  };
  const parent = {
    id: 'parent_manual',
    sourceType: 'MANUAL',
    latestPublishedVersion: null,
    latestDraftVersion: version,
    bookmarks: [{ userId: 'user_manual' }],
  };
  prisma = {
    user: {
      findUnique: async () => ({ id: 'user_manual' }),
    },
    weeklyPlanParent: {
      findMany: async () => [parent],
      findFirst: async () => parent,
    },
  };

  const list = await listVisibleWeeklyPlans('user_manual');
  const details = await getWeeklyPlanDetails('parent_manual', 'user_manual');

  assert.deepEqual(list, [
    {
      id: 'parent_manual',
      weeklyPlanParentId: 'parent_manual',
      visibleVersionId: 'version_manual',
      name: 'Manual Plan',
      status: 'DRAFT',
      source: 'manual',
      frequencyPerWeek: 1,
      totalWeeklySets: 3,
      createdAt: '2026-07-01T12:00:00.000Z',
      isBookmarked: true,
    },
  ]);
  assert.deepEqual(details, {
    id: 'parent_manual',
    weeklyPlanParentId: 'parent_manual',
    visibleVersionId: 'version_manual',
    name: 'Manual Plan',
    status: 'DRAFT',
    source: 'manual',
    isBookmarked: true,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-02T12:00:00.000Z',
    summary: {
      frequencyPerWeek: 1,
      workoutCount: 1,
      totalWeeklySets: 3,
      totalExercises: 1,
      averageWorkoutDurationMinutes: 8,
      averageWorkoutTUTMinutes: 2,
      weeklyTotals: Object.fromEntries(BODY_PART_KEYS.map((key) => [key, ['chest', 'triceps'].includes(key) ? 3 : 0])),
    },
    workouts: [
      {
        id: 'workout_single',
        name: 'Manual Chest',
        orderIndex: 1,
        metrics: {
          exerciseCount: 1,
          setCount: 3,
          estimatedDurationMinutes: 8,
          totalTUTMinutes: 2,
        },
        blocks: [
          {
            id: 'block_single',
            type: 'single',
            orderIndex: 1,
            exercise: {
              exerciseId: 'ex_bench',
              name: 'Bench Press',
              imageUrl: null,
            },
            prescription: {
              setCount: 3,
              repsLabel: '10',
              tempoLabel: '3-0-1-0',
              restLabel: '120s',
            },
            notes: null,
          },
        ],
      },
    ],
  });
});
