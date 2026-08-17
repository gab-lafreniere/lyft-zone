// Phase 2: proves the atomic compare-and-swap in updateWeeklyPlanDraft.
//
// The CAS is a single conditional `tx.weeklyPlanVersion.updateMany({ where: { id,
// revision }, data: { revision: { increment: 1 } } })`, not a read-then-compare-in-JS-
// then-write. These tests pin: a matching revision claims successfully and bumps the
// counter; a stale revision is rejected with a typed 409 before the existing
// deleteMany+create content mutation runs; a missing revision (compatibility opt-out)
// always succeeds; and a retry against the latest revision succeeds after a prior
// conflict.

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

const { updateWeeklyPlanDraft } = require('../../services/weeklyPlansService');

const PARENT_ID = 'parent_revision';
const VERSION_ID = 'version_revision';
const USER_ID = 'user_revision';
const STORED_REVISION = 5;

function createDraftPayload(overrides = {}) {
  return {
    userId: USER_ID,
    name: 'Revision Draft',
    sessionsPerWeek: 1,
    workouts: [
      {
        id: 'workout_1',
        name: 'Day 1',
        orderIndex: 1,
        estimatedDurationMinutes: 30,
        notes: null,
        blocks: [
          {
            id: 'block_1',
            orderIndex: 1,
            blockType: 'SINGLE',
            label: null,
            roundCount: null,
            restStrategy: 'AFTER_EXERCISE',
            restSeconds: 90,
            notes: null,
            exercises: [
              {
                id: 'exercise_1',
                exerciseId: 'exr_bench_press',
                exerciseName: 'Bench Press',
                bodyParts: ['chest'],
                muscleFocus: ['chest'],
                orderIndex: 1,
                executionNotes: null,
                defaultTempo: '3010',
                defaultRestSeconds: 90,
                defaultTargetRir: 2,
                defaultTargetRpe: null,
                intensificationMethod: 'NONE',
                cardioPrescription: null,
                notes: null,
                setTemplates: [
                  {
                    id: 'set_1',
                    setIndex: 1,
                    setType: 'WORKING',
                    targetReps: 8,
                    minReps: 8,
                    maxReps: 8,
                    targetSeconds: null,
                    targetRir: 2,
                    targetRpe: null,
                    tempo: '3010',
                    restSeconds: 90,
                    notes: null,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createHarness({ updateManyResult = { count: 1 } } = {}) {
  const calls = [];
  const record = (model, op, extra = {}) => calls.push({ model, op, ...extra });

  const storedVersion = {
    id: VERSION_ID,
    weeklyPlanParentId: PARENT_ID,
    versionNumber: 1,
    name: 'Revision Draft',
    sessionsPerWeek: 1,
    status: 'DRAFT',
    revision: STORED_REVISION,
    publishedAt: null,
    updatedAt: new Date('2026-08-16T12:00:00.000Z'),
    workouts: [],
  };

  const tx = {
    weeklyPlanVersion: {
      findFirst: async () => {
        record('weeklyPlanVersion', 'findFirst');
        return { id: VERSION_ID, revision: STORED_REVISION };
      },
      updateMany: async ({ where, data }) => {
        record('weeklyPlanVersion', 'updateMany', { where, data });
        return typeof updateManyResult === 'function' ? updateManyResult({ where, data }) : updateManyResult;
      },
      update: async ({ data }) => {
        record('weeklyPlanVersion', 'update', { data });
        return { ...storedVersion, ...data };
      },
    },
    weeklyPlanWorkout: {
      deleteMany: async ({ where }) => {
        record('weeklyPlanWorkout', 'deleteMany', { where });
        return { count: 0 };
      },
    },
    weeklyPlanParent: {
      findUnique: async () => {
        record('weeklyPlanParent', 'findUnique');
        return {
          id: PARENT_ID,
          sourceType: 'MANUAL',
          bookmarks: [],
          latestDraftVersion: storedVersion,
          latestPublishedVersion: null,
        };
      },
    },
  };

  prisma = {
    user: {
      findUnique: async () => ({ id: USER_ID }),
    },
    exercise: {
      findMany: async () => [{ exerciseId: 'exr_bench_press', trainingType: 'strength' }],
    },
    weeklyPlanParent: {
      findFirst: async () => {
        record('weeklyPlanParent', 'findFirst');
        return {
          id: PARENT_ID,
          sourceType: 'MANUAL',
          latestDraftVersionId: VERSION_ID,
        };
      },
    },
    $transaction: async (callback) => callback(tx),
  };

  return { calls };
}

function mutationWrites(calls) {
  const mutating = new Set(['create', 'update', 'delete', 'deleteMany', 'createMany']);
  return calls.filter((call) => mutating.has(call.op));
}

test('a matching revision claims successfully via a single conditional updateMany and increments', async () => {
  const harness = createHarness({ updateManyResult: { count: 1 } });

  const response = await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...createDraftPayload(),
    revision: STORED_REVISION,
  });

  assert.ok(response, 'a successful claim must not throw');

  const claimCalls = harness.calls.filter((call) => call.model === 'weeklyPlanVersion' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1, 'exactly one CAS attempt');
  assert.deepEqual(claimCalls[0].where, { id: VERSION_ID, revision: STORED_REVISION });
  assert.deepEqual(claimCalls[0].data, { revision: { increment: 1 } });
});

test('a stale revision returns 409 DRAFT_REVISION_CONFLICT and writes no content', async () => {
  const harness = createHarness({ updateManyResult: { count: 0 } });

  await assert.rejects(
    () => updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
      ...createDraftPayload(),
      revision: STORED_REVISION - 1, // stale on purpose
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'DRAFT_REVISION_CONFLICT');
      return true;
    }
  );

  const claimCalls = harness.calls.filter((call) => call.model === 'weeklyPlanVersion' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);

  const writes = mutationWrites(harness.calls);
  assert.deepEqual(
    writes.map((call) => `${call.model}.${call.op}`),
    [],
    'a rejected CAS must not reach the deleteMany/create content mutation'
  );
});

test('a missing revision omits the predicate and always succeeds (compatibility opt-out)', async () => {
  const harness = createHarness({ updateManyResult: { count: 1 } });

  const response = await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, createDraftPayload());

  assert.ok(response);

  const claimCalls = harness.calls.filter((call) => call.model === 'weeklyPlanVersion' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);
  assert.deepEqual(
    claimCalls[0].where,
    { id: VERSION_ID },
    'no revision predicate when the client does not send one'
  );
});

test('retry against the latest revision succeeds after a prior conflict', async () => {
  const firstHarness = createHarness({ updateManyResult: { count: 0 } });
  await assert.rejects(
    () => updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
      ...createDraftPayload(),
      revision: STORED_REVISION - 1,
    }),
    (error) => {
      assert.equal(error.code, 'DRAFT_REVISION_CONFLICT');
      return true;
    }
  );
  assert.equal(mutationWrites(firstHarness.calls).length, 0);

  const secondHarness = createHarness({ updateManyResult: { count: 1 } });
  const response = await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...createDraftPayload(),
    revision: STORED_REVISION,
  });

  assert.ok(response);
  const claimCalls = secondHarness.calls.filter((call) => call.model === 'weeklyPlanVersion' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);
  assert.deepEqual(claimCalls[0].where, { id: VERSION_ID, revision: STORED_REVISION });
});
