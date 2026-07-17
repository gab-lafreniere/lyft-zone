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

const { createWeeklyPlan } = require('../../services/weeklyPlansService');

function createPrismaMock() {
  const calls = {
    parentData: null,
    versionData: null,
  };
  const tx = {
    weeklyPlanParent: {
      create: async ({ data }) => {
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
        findUnique: async () => ({ id: 'user_123' }),
      },
      $transaction: async (callback) => callback(tx),
    },
  };
}

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
});
