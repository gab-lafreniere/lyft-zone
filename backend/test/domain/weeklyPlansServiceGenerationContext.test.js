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
  prepareAIWeeklyPlanDraftForCreate,
} = require('../../services/weeklyPlansService');

function createPrismaMock(options = {}) {
  const calls = {
    parentData: null,
    versionData: null,
    parentCreateCount: 0,
    versionCreateCount: 0,
    transactionCount: 0,
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
      update: async () => ({}),
      findUnique: async () => ({
        id: 'parent_123',
        sourceType: calls.parentData.sourceType,
        bookmarks: [],
        latestDraftVersion: {
          id: 'version_123',
          weeklyPlanParentId: 'parent_123',
          versionNumber: 1,
          name: calls.versionData.name,
          sessionsPerWeek: calls.versionData.sessionsPerWeek,
          status: 'DRAFT',
          updatedAt: new Date('2026-06-01T12:00:00.000Z'),
          workouts: [],
        },
        latestPublishedVersion: null,
      }),
    },
    weeklyPlanVersion: {
      create: async ({ data }) => {
        calls.versionCreateCount += 1;
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
      $transaction: async (callback) => {
        calls.transactionCount += 1;
        return callback(tx);
      },
    },
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
  assert.equal(mock.calls.parentData.sourceType, 'MANUAL');
  assert.equal(Object.prototype.hasOwnProperty.call(mock.calls.versionData, 'generationContext'), false);
  assert.equal(result.builderPayload.programName, 'Manual Draft');
  assert.equal(mock.calls.transactionCount, 1);
  assert.equal(mock.calls.parentCreateCount, 1);
  assert.equal(mock.calls.versionCreateCount, 1);
});

test('createWeeklyPlan AI flow writes generationContext on WeeklyPlanVersion', async () => {
  const mock = createPrismaMock();
  prisma = mock.prisma;
  const generationContext = {
    schemaVersion: 2,
    generationType: 'ai_weekly_plan_builder_v1',
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
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
