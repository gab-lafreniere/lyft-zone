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
  createWeeklyPlan,
  getWeeklyPlanDetails,
  openOrCreateEditDraft,
  prepareAIWeeklyPlanDraftForCreate,
  publishWeeklyPlanDraft,
  updateWeeklyPlanDraft,
} = require('../../services/weeklyPlansService');

function createPrismaMock(options = {}) {
  const calls = {
    parentData: null,
    versionData: null,
    parentCreateCount: 0,
    parentUpdateData: null,
    versionCreateCount: 0,
    transactionCount: 0,
    transactionOptions: null,
    userFindUniqueArgs: [],
    exerciseFindManyArgs: [],
  };
  const tx = {
    weeklyPlanParent: {
      create: async ({ data }) => {
        calls.parentCreateCount += 1;
        calls.parentData = data;
        return {
          id: 'parent_123',
          userId: data.userId,
          sourceType: data.sourceType,
        };
      },
      update: async ({ data }) => {
        calls.parentUpdateData = data;
        return {};
      },
      findUnique: async () => {
        const storedVersion = {
          id: 'version_123',
          weeklyPlanParentId: 'parent_123',
          versionNumber: 1,
          name: calls.versionData.name,
          sessionsPerWeek: calls.versionData.sessionsPerWeek,
          status: calls.versionData.status,
          publishedAt: calls.versionData.publishedAt || null,
          updatedAt: new Date('2026-06-01T12:00:00.000Z'),
          workouts: options.versionWorkouts || [],
        };

        return {
          id: 'parent_123',
          sourceType: calls.parentData.sourceType,
          bookmarks: [],
          latestDraftVersion:
            calls.versionData.status === 'DRAFT' ? storedVersion : null,
          latestPublishedVersion:
            calls.versionData.status === 'PUBLISHED' ? storedVersion : null,
        };
      },
    },
    weeklyPlanVersion: {
      create: async ({ data }) => {
        calls.versionCreateCount += 1;
        if (options.versionCreateError) {
          throw options.versionCreateError;
        }
        calls.versionData = data;
        return {
          id: 'version_123',
          ...data,
          workouts: [],
        };
      },
    },
  };

  return {
    calls,
    prisma: {
      user: {
        findUnique: async (args) => {
          calls.userFindUniqueArgs.push(args);
          return options.user === undefined ? { id: 'user_123' } : options.user;
        },
      },
      exercise: {
        findMany: async (args) => {
          calls.exerciseFindManyArgs.push(args);
          return options.exercises || [];
        },
      },
      $transaction: async (callback, transactionOptions) => {
        calls.transactionCount += 1;
        calls.transactionOptions = transactionOptions;
        return callback(tx);
      },
    },
  };
}

function createTemporalWorkout() {
  return {
    id: 'workout_temporal',
    name: 'Temporal strength',
    orderIndex: 1,
    estimatedDurationMinutes: 30,
    notes: null,
    blocks: [
      {
        id: 'block_temporal',
        orderIndex: 1,
        blockType: 'SINGLE',
        label: null,
        roundCount: null,
        restStrategy: 'AFTER_EXERCISE',
        restSeconds: 60,
        notes: null,
        exercises: [
          {
            id: 'workout_exercise_temporal',
            exerciseId: 'ex_hold',
            exerciseName: 'Isometric Hold',
            bodyParts: ['core'],
            muscleFocus: [],
            orderIndex: 1,
            executionNotes: null,
            defaultTempo: '1010',
            defaultRestSeconds: 60,
            defaultTargetRir: 2,
            defaultTargetRpe: null,
            intensificationMethod: null,
            cardioPrescription: null,
            notes: null,
            exercise: {
              exerciseId: 'ex_hold',
              name: 'Isometric Hold',
              bodyParts: ['core'],
              muscleFocus: [],
              trainingType: 'strength',
              cardioModality: null,
            },
            setTemplates: [
              {
                id: 'set_temporal',
                setIndex: 1,
                setType: 'WORKING',
                targetReps: null,
                minReps: null,
                maxReps: null,
                targetSeconds: 45,
                targetRir: 2,
                targetRpe: null,
                tempo: '1010',
                restSeconds: 60,
                notes: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

function createTemporalDraftPayload(overrides = {}) {
  return {
    userId: 'user_123',
    source: 'ai',
    name: 'Temporal Draft',
    sessionsPerWeek: 1,
    workouts: [createTemporalWorkout()],
    ...overrides,
  };
}

function createStoredParent({
  latestDraftVersion = null,
  latestPublishedVersion = null,
} = {}) {
  return {
    id: 'parent_123',
    userId: 'user_123',
    sourceType: 'AI',
    bookmarks: [],
    latestDraftVersion,
    latestPublishedVersion,
  };
}

function createStoredVersion({
  id = 'version_123',
  status = 'DRAFT',
  versionNumber = 1,
} = {}) {
  return {
    id,
    weeklyPlanParentId: 'parent_123',
    versionNumber,
    name: 'Temporal Draft',
    sessionsPerWeek: 1,
    status,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    workouts: [createTemporalWorkout()],
  };
}

test('prepareAIWeeklyPlanDraftForCreate validates and normalizes without persistence', async () => {
  const mock = createPrismaMock({
    exercises: [
      {
        exerciseId: 'ex_treadmill',
        trainingType: 'cardio',
        cardioModality: 'treadmill_walk',
      },
    ],
  });
  prisma = mock.prisma;

  const prepared = await prepareAIWeeklyPlanDraftForCreate({
    userId: ' user_123 ',
    source: ' ai ',
    name: ' AI Cardio Draft ',
    sessionsPerWeek: '1',
    workouts: [
      {
        name: 'Cardio',
        orderIndex: 1,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'CARDIO',
            exercises: [
              {
                exerciseId: 'ex_treadmill',
                exerciseName: 'Treadmill',
                orderIndex: 1,
                setTemplates: [],
                cardioPrescription: {
                  durationMinutes: '20',
                  heartRateTargetMode: 'ZONE',
                  heartRateTargetValue: '2',
                  machineSettings: { speed: '3.2' },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(prepared.document.name, 'AI Cardio Draft');
  assert.equal(prepared.document.sessionsPerWeek, 1);
  assert.match(prepared.document.workouts[0].id, /^wpworkout_/);
  assert.deepEqual(
    prepared.document.workouts[0].blocks[0].exercises[0].cardioPrescription,
    {
      durationMinutes: 20,
      heartRateTargetMode: 'zone',
      heartRateTargetValue: 2,
      machineSettings: [{ key: 'speed', value: '3.2' }],
      notes: null,
    }
  );
  assert.deepEqual(prepared.businessRulesValidation, {
    ok: true,
    issueCount: 0,
  });
  assert.deepEqual(mock.calls.userFindUniqueArgs, [
    { where: { id: 'user_123' }, select: { id: true } },
  ]);
  assert.deepEqual(mock.calls.exerciseFindManyArgs[0].where.exerciseId.in, [
    'ex_treadmill',
  ]);
  assert.equal(mock.calls.transactionCount, 0);
  assert.equal(mock.calls.parentCreateCount, 0);
  assert.equal(mock.calls.versionCreateCount, 0);
});

test('prepareAIWeeklyPlanDraftForCreate rejects non-AI source before business access', async () => {
  const mock = createPrismaMock();
  prisma = mock.prisma;

  await assert.rejects(
    () =>
      prepareAIWeeklyPlanDraftForCreate({
        userId: 'user_123',
        source: 'manual',
        name: 'Manual Draft',
        sessionsPerWeek: 1,
        workouts: [],
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      return true;
    }
  );

  assert.equal(mock.calls.userFindUniqueArgs.length, 0);
  assert.equal(mock.calls.transactionCount, 0);
});

test('prepareAIWeeklyPlanDraftForCreate propagates existing business ApiError', async () => {
  const mock = createPrismaMock({ exercises: [] });
  prisma = mock.prisma;

  await assert.rejects(
    () =>
      prepareAIWeeklyPlanDraftForCreate({
        userId: 'user_123',
        source: 'ai',
        name: 'AI Draft',
        sessionsPerWeek: 1,
        workouts: [
          {
            name: 'Upper',
            orderIndex: 1,
            blocks: [
              {
                orderIndex: 1,
                blockType: 'SINGLE',
                exercises: [
                  {
                    exerciseId: 'ex_unknown',
                    exerciseName: 'Unknown',
                    orderIndex: 1,
                    setTemplates: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.message, 'Unknown exerciseId: ex_unknown');
      return true;
    }
  );

  assert.equal(mock.calls.userFindUniqueArgs.length, 1);
  assert.equal(mock.calls.exerciseFindManyArgs.length, 1);
  assert.equal(mock.calls.transactionCount, 0);
  assert.equal(mock.calls.parentCreateCount, 0);
  assert.equal(mock.calls.versionCreateCount, 0);
});

test('createWeeklyPlan manual flow continues without generationContext', async () => {
  const mock = createPrismaMock();
  prisma = mock.prisma;

  const result = await createWeeklyPlan({
    userId: 'user_123',
    source: 'manual',
    name: 'Manual Draft',
    sessionsPerWeek: 3,
    workouts: [],
  });

  assert.equal(result.source, 'manual');
  assert.equal(result.status, 'DRAFT');
  assert.equal(mock.calls.parentData.sourceType, 'MANUAL');
  assert.equal(mock.calls.versionData.status, 'DRAFT');
  assert.deepEqual(mock.calls.parentUpdateData, {
    latestDraftVersionId: 'version_123',
    latestPublishedVersionId: null,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(mock.calls.versionData, 'generationContext'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'aiPresentation'), false);
  assert.equal(result.builderPayload.programName, 'Manual Draft');
  assert.equal(mock.calls.transactionCount, 1);
  assert.equal(mock.calls.parentCreateCount, 1);
  assert.equal(mock.calls.versionCreateCount, 1);
});

test('createWeeklyPlan bounds its interactive transaction at 20 seconds', async () => {
  const mock = createPrismaMock();
  prisma = mock.prisma;

  await createWeeklyPlan({
    userId: 'user_123',
    source: 'manual',
    name: 'Bounded transaction',
    sessionsPerWeek: 1,
    workouts: [],
  });

  assert.equal(mock.calls.transactionCount, 1);
  assert.deepEqual(mock.calls.transactionOptions, {
    timeout: 20000,
  });
  assert.equal(mock.calls.parentCreateCount, 1);
  assert.equal(mock.calls.versionCreateCount, 1);
  assert.deepEqual(mock.calls.parentUpdateData, {
    latestDraftVersionId: 'version_123',
    latestPublishedVersionId: null,
  });
});

test('createWeeklyPlan still propagates transaction errors before parent update', async () => {
  const transactionError = new Error('version create failed');
  const mock = createPrismaMock({ versionCreateError: transactionError });
  prisma = mock.prisma;

  await assert.rejects(
    () => createWeeklyPlan({
      userId: 'user_123',
      source: 'manual',
      name: 'Failed transaction',
      sessionsPerWeek: 1,
      workouts: [],
    }),
    (error) => error === transactionError
  );

  assert.equal(mock.calls.transactionCount, 1);
  assert.deepEqual(mock.calls.transactionOptions, {
    timeout: 20000,
  });
  assert.equal(mock.calls.parentCreateCount, 1);
  assert.equal(mock.calls.versionCreateCount, 1);
  assert.equal(mock.calls.parentUpdateData, null);
});

test('createWeeklyPlan AI flow writes generationContext on WeeklyPlanVersion', async () => {
  const mock = createPrismaMock();
  prisma = mock.prisma;
  const generationContext = {
    schemaVersion: 2,
    generationType: 'ai_weekly_plan_builder_v1',
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.1',
    derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.1',
    poolSnapshot: {
      checksum: 'checksum',
    },
  };

  const result = await createWeeklyPlan({
    userId: 'user_123',
    source: 'ai',
    name: 'AI Draft',
    sessionsPerWeek: 4,
    workouts: [],
    generationContext,
  });

  assert.equal(result.source, 'ai');
  assert.equal(mock.calls.parentData.sourceType, 'AI');
  assert.deepEqual(mock.calls.versionData.generationContext, generationContext);
  assert.equal(result.builderPayload.programName, 'AI Draft');
  assert.equal(mock.calls.transactionCount, 1);
});

test('createWeeklyPlan can atomically create an initial published AI version', async () => {
  const mock = createPrismaMock({
    exercises: [{ exerciseId: 'ex_hold', trainingType: 'strength' }],
    versionWorkouts: [createTemporalWorkout()],
  });
  prisma = mock.prisma;

  const result = await createWeeklyPlan(createTemporalDraftPayload(), {
    initialStatus: 'PUBLISHED',
  });

  assert.equal(result.source, 'ai');
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(mock.calls.transactionCount, 1);
  assert.equal(mock.calls.parentCreateCount, 1);
  assert.equal(mock.calls.versionCreateCount, 1);
  assert.equal(mock.calls.versionData.status, 'PUBLISHED');
  assert.ok(mock.calls.versionData.publishedAt instanceof Date);
  assert.deepEqual(mock.calls.parentUpdateData, {
    latestDraftVersionId: null,
    latestPublishedVersionId: 'version_123',
  });
  assert.match(
    createWeeklyPlan.toString(),
    /mode:\s*isPublished\s*\?\s*'publish'\s*:\s*'draft'/
  );
});

test('targetSeconds survives AI preflight, create persistence input, and builder projection', async () => {
  const storedWorkout = createTemporalWorkout();
  const mock = createPrismaMock({
    exercises: [{ exerciseId: 'ex_hold', trainingType: 'strength' }],
    versionWorkouts: [storedWorkout],
  });
  prisma = mock.prisma;
  const payload = createTemporalDraftPayload();

  const prepared = await prepareAIWeeklyPlanDraftForCreate(payload);
  assert.equal(
    prepared.document.workouts[0].blocks[0].exercises[0].setTemplates[0]
      .targetSeconds,
    45
  );

  const created = await createWeeklyPlan(payload);
  const persistedSet =
    mock.calls.versionData.workouts.create[0].blocks.create[0].exercises
      .create[0].setTemplates.create[0];
  const builderSet =
    created.builderPayload.workouts[0].blocks[0].sets[0];

  assert.equal(persistedSet.targetSeconds, 45);
  assert.equal(persistedSet.targetReps, undefined);
  assert.deepEqual(builderSet, {
    reps: null,
    targetSeconds: 45,
    minReps: null,
    maxReps: null,
    rpe: 2,
  });
});

test('targetSeconds is represented as seconds in weekly-plan details', async () => {
  const version = createStoredVersion({ status: 'PUBLISHED' });
  const parent = createStoredParent({ latestPublishedVersion: version });
  prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    weeklyPlanParent: {
      findFirst: async () => parent,
    },
  };

  const details = await getWeeklyPlanDetails('parent_123', 'user_123');

  assert.equal(details.workouts[0].blocks[0].prescription.repsLabel, '45s');
});

test('targetSeconds survives cloning a published version into an edit draft', async () => {
  const published = createStoredVersion({
    id: 'version_published',
    status: 'PUBLISHED',
  });
  const sourceParent = createStoredParent({
    latestPublishedVersion: published,
  });
  let clonedVersionData;
  const cloned = createStoredVersion({
    id: 'version_cloned',
    status: 'DRAFT',
    versionNumber: 2,
  });

  prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    weeklyPlanParent: {
      findFirst: async () => sourceParent,
    },
    $transaction: async (callback) =>
      callback({
        weeklyPlanVersion: {
          create: async ({ data }) => {
            clonedVersionData = data;
            return cloned;
          },
        },
        weeklyPlanParent: {
          update: async () => ({}),
          findUnique: async () =>
            createStoredParent({
              latestDraftVersion: cloned,
              latestPublishedVersion: published,
            }),
        },
      }),
  };

  const result = await openOrCreateEditDraft('parent_123', 'user_123');
  const clonedSet =
    clonedVersionData.workouts.create[0].blocks.create[0].exercises.create[0]
      .setTemplates.create[0];

  assert.equal(clonedSet.targetSeconds, 45);
  assert.equal(
    result.builderPayload.workouts[0].blocks[0].sets[0].targetSeconds,
    45
  );
});

test('targetSeconds survives draft update persistence input', async () => {
  const updatedVersion = createStoredVersion();
  let updatedVersionData;

  prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    exercise: {
      findMany: async () => [
        { exerciseId: 'ex_hold', trainingType: 'strength' },
      ],
    },
    weeklyPlanParent: {
      findFirst: async () => ({
        id: 'parent_123',
        sourceType: 'AI',
        latestDraftVersionId: 'version_123',
      }),
    },
    $transaction: async (callback) =>
      callback({
        weeklyPlanVersion: {
          findFirst: async () => ({ id: 'version_123' }),
          update: async ({ data }) => {
            updatedVersionData = data;
            return {};
          },
        },
        weeklyPlanWorkout: {
          deleteMany: async () => ({}),
        },
        weeklyPlanParent: {
          findUnique: async () =>
            createStoredParent({ latestDraftVersion: updatedVersion }),
        },
      }),
  };

  const result = await updateWeeklyPlanDraft(
    'parent_123',
    'version_123',
    createTemporalDraftPayload()
  );
  const updatedSet =
    updatedVersionData.workouts.create[0].blocks.create[0].exercises.create[0]
      .setTemplates.create[0];

  assert.equal(updatedSet.targetSeconds, 45);
  assert.equal(
    result.builderPayload.workouts[0].blocks[0].sets[0].targetSeconds,
    45
  );
});

test('targetSeconds remains valid through publish', async () => {
  const draft = createStoredVersion();
  const parent = createStoredParent({ latestDraftVersion: draft });
  const versionUpdates = [];

  prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    exercise: {
      findMany: async () => [
        { exerciseId: 'ex_hold', trainingType: 'strength' },
      ],
    },
    weeklyPlanParent: {
      findFirst: async () => parent,
    },
    $transaction: async (callback) =>
      callback({
        weeklyPlanVersion: {
          update: async (args) => {
            versionUpdates.push(args);
            return {};
          },
        },
        weeklyPlanParent: {
          update: async () => ({}),
        },
      }),
  };

  const result = await publishWeeklyPlanDraft('parent_123', {
    userId: 'user_123',
  });

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(versionUpdates.length, 1);
  assert.equal(draft.workouts[0].blocks[0].exercises[0].setTemplates[0].targetSeconds, 45);
});
