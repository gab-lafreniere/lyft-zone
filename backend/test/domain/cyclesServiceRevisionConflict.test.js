// Phase 2: proves the atomic compare-and-swap in updateCycleDraft.
//
// The CAS is a single conditional `tx.plan.updateMany({ where: { id, revision },
// data: { revision: { increment: 1 } } })`, not a read-then-compare-in-JS-then-write.
// These tests pin: a matching revision claims successfully and bumps the counter; a
// stale revision is rejected with a typed 409 before any content-mutation statement
// runs; a missing revision (compatibility opt-out) always succeeds; and a retry against
// the latest revision succeeds after a prior conflict.

const test = require('node:test');
const assert = require('node:assert/strict');

let prisma;

const prismaPath = require.resolve('../../lib/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    getPrisma: () => prisma,
  },
};

const { updateCycleDraft } = require('../../services/cyclesService');

const USER_ID = 'user_revision';
const CYCLE_ID = 'cycle_revision';
const PLAN_ID = 'plan_revision';
const TIMEZONE = 'America/Toronto';
const START_DATE = new Date('2026-09-07T00:00:00.000Z');
const END_DATE = new Date('2026-09-20T00:00:00.000Z');
const DURATION_WEEKS = 2;
const STORED_REVISION = 5;

function buildSetTemplate(exerciseKey, setIndex) {
  return {
    id: `${exerciseKey}_set_${setIndex}`,
    setIndex,
    setType: 'WORKING',
    targetReps: 10,
    minReps: 8,
    maxReps: 12,
    targetSeconds: null,
    targetRir: 2,
    targetRpe: null,
    tempo: '3010',
    restSeconds: 90,
    notes: null,
  };
}

function buildStoredPlan() {
  return {
    id: PLAN_ID,
    trainingCycleId: CYCLE_ID,
    name: 'Revision plan',
    versionNumber: 2,
    sourceType: 'USER',
    status: 'DRAFT',
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: DURATION_WEEKS,
    publishedAt: null,
    revision: STORED_REVISION,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    weeks: Array.from({ length: DURATION_WEEKS }, (_, weekIndex) => {
      const weekNumber = weekIndex + 1;
      const weekId = `week_${weekNumber}`;
      return {
        id: weekId,
        planId: PLAN_ID,
        weekNumber,
        orderIndex: weekNumber,
        label: `Week ${weekNumber}`,
        notes: null,
        workouts: Array.from({ length: 1 }, (_, workoutIndex) => {
          const workoutId = `${weekId}_workout_${workoutIndex + 1}`;
          return {
            id: workoutId,
            planWeekId: weekId,
            name: `Day ${workoutIndex + 1}`,
            orderIndex: workoutIndex + 1,
            scheduledDay: null,
            estimatedDurationMinutes: null,
            notes: null,
            blocks: [{
              id: `${workoutId}_block_1`,
              workoutId,
              orderIndex: 1,
              blockType: 'SINGLE',
              label: null,
              roundCount: null,
              restStrategy: 'AFTER_EXERCISE',
              restSeconds: 90,
              notes: null,
              blockExercises: [{
                id: `${workoutId}_exercise_1`,
                workoutBlockId: `${workoutId}_block_1`,
                exerciseId: 'exr_movement_example',
                orderIndex: 1,
                executionNotes: null,
                defaultTempo: '3010',
                defaultRestSeconds: 90,
                defaultTargetRir: 2,
                defaultTargetRpe: null,
                intensificationMethod: 'NONE',
                cardioPrescription: null,
                notes: null,
                exercise: {
                  name: 'Movement Example',
                  bodyParts: ['chest'],
                  muscleFocus: ['chest'],
                },
                setTemplates: [
                  buildSetTemplate(`${workoutId}_exercise_1`, 1),
                  buildSetTemplate(`${workoutId}_exercise_1`, 2),
                ],
              }],
            }],
          };
        }),
      };
    }),
  };
}

// The wire shape the Manual Builder sends (block.exercises, not blockExercises).
function toApiDocument(plan) {
  return {
    name: plan.name,
    weeks: plan.weeks.map((week) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      orderIndex: week.orderIndex,
      label: week.label,
      notes: week.notes,
      workouts: week.workouts.map((workout) => ({
        id: workout.id,
        name: workout.name,
        orderIndex: workout.orderIndex,
        scheduledDay: workout.scheduledDay,
        estimatedDurationMinutes: null,
        notes: null,
        blocks: workout.blocks.map((block) => ({
          id: block.id,
          orderIndex: block.orderIndex,
          blockType: block.blockType,
          label: block.label,
          roundCount: block.roundCount,
          restStrategy: block.restStrategy,
          restSeconds: block.restSeconds,
          notes: block.notes,
          exercises: block.blockExercises.map((exercise) => ({
            id: exercise.id,
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exercise.name,
            bodyParts: exercise.exercise.bodyParts,
            muscleFocus: exercise.exercise.muscleFocus,
            orderIndex: exercise.orderIndex,
            executionNotes: exercise.executionNotes,
            defaultTempo: exercise.defaultTempo,
            defaultRestSeconds: exercise.defaultRestSeconds,
            defaultTargetRir: exercise.defaultTargetRir,
            defaultTargetRpe: exercise.defaultTargetRpe,
            intensificationMethod: exercise.intensificationMethod,
            notes: exercise.notes,
            setTemplates: exercise.setTemplates.map((set) => ({ ...set })),
          })),
        })),
      })),
    })),
  };
}

function createHarness(storedPlan, { updateManyResult = { count: 1 } } = {}) {
  const calls = [];
  const record = (model, op, extra = {}) => calls.push({ model, op, ...extra });

  const cycle = {
    id: CYCLE_ID,
    userId: USER_ID,
    name: 'Revision cycle',
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: DURATION_WEEKS,
    timezone: TIMEZONE,
    status: 'PLANNED',
    plans: [storedPlan],
  };

  const tx = {
    plan: {
      findMany: async () => { record('plan', 'findMany'); return [storedPlan]; },
      findUnique: async () => { record('plan', 'findUnique'); return storedPlan; },
      findFirst: async () => { record('plan', 'findFirst'); return storedPlan; },
      update: async ({ data }) => { record('plan', 'update', { data }); return storedPlan; },
      updateMany: async ({ where, data }) => {
        record('plan', 'updateMany', { where, data });
        return typeof updateManyResult === 'function' ? updateManyResult({ where, data }) : updateManyResult;
      },
      deleteMany: async () => { record('plan', 'deleteMany'); return { count: 0 }; },
    },
    planWeek: {
      create: async ({ data }) => { record('planWeek', 'create', { data }); return { ...data, id: 'new_week' }; },
      delete: async ({ where }) => { record('planWeek', 'delete', { where }); return { id: where.id }; },
      update: async ({ where }) => { record('planWeek', 'update', { where }); return { id: where.id }; },
      deleteMany: async () => { record('planWeek', 'deleteMany'); return { count: 0 }; },
    },
    workout: {
      create: async ({ data }) => { record('workout', 'create', { data }); return { ...data, id: 'new_workout' }; },
      update: async ({ where, data }) => { record('workout', 'update', { where, data }); return { id: where.id }; },
      deleteMany: async ({ where }) => { record('workout', 'deleteMany', { where }); return { count: 0 }; },
      createManyAndReturn: async ({ data }) => { record('workout', 'createManyAndReturn', { count: data.length }); return data.map((entry, index) => ({ ...entry, id: `nw_${index}` })); },
    },
    workoutBlock: {
      deleteMany: async ({ where }) => { record('workoutBlock', 'deleteMany', { where }); return { count: 0 }; },
      createManyAndReturn: async ({ data }) => { record('workoutBlock', 'createManyAndReturn', { count: data.length }); return data.map((entry, index) => ({ ...entry, id: `nb_${index}` })); },
    },
    blockExercise: {
      deleteMany: async () => { record('blockExercise', 'deleteMany'); return { count: 0 }; },
      createManyAndReturn: async ({ data }) => { record('blockExercise', 'createManyAndReturn', { count: data.length }); return data.map((entry, index) => ({ ...entry, id: `ne_${index}` })); },
    },
    exerciseSetTemplate: {
      deleteMany: async () => { record('exerciseSetTemplate', 'deleteMany'); return { count: 0 }; },
      createMany: async ({ data }) => { record('exerciseSetTemplate', 'createMany', { count: data.length }); return { count: data.length }; },
    },
    trainingCycle: {
      findFirst: async () => cycle,
      findUnique: async () => cycle,
      update: async ({ data }) => ({ ...cycle, ...data }),
    },
    scheduledSession: {
      findFirst: async () => null,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    exercise: {
      findMany: async ({ where }) => (where?.exerciseId?.in || []).map((exerciseId) => ({
        exerciseId,
        trainingType: 'strength',
        cardioModality: null,
      })),
    },
    user: { findUnique: async () => ({ id: USER_ID }) },
  };

  prisma = {
    $transaction: async (operation) => operation(tx),
    user: tx.user,
    exercise: tx.exercise,
    trainingCycle: tx.trainingCycle,
    plan: tx.plan,
  };

  return { calls, tx };
}

function mutationWrites(calls) {
  const mutating = new Set(['create', 'update', 'delete', 'deleteMany', 'createMany', 'createManyAndReturn']);
  return calls.filter(
    (call) => mutating.has(call.op) && !(call.model === 'plan' && (call.op === 'deleteMany' || call.op === 'updateMany'))
  );
}

test('a matching revision claims successfully via a single conditional updateMany and increments', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored, { updateManyResult: { count: 1 } });

  const response = await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...toApiDocument(stored),
    userId: USER_ID,
    timezone: TIMEZONE,
    revision: STORED_REVISION,
  });

  assert.ok(response, 'a successful claim must not throw');

  const claimCalls = harness.calls.filter((call) => call.model === 'plan' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1, 'exactly one CAS attempt');
  assert.deepEqual(claimCalls[0].where, { id: PLAN_ID, revision: STORED_REVISION });
  assert.deepEqual(claimCalls[0].data, { revision: { increment: 1 } });
});

test('a stale revision returns 409 DRAFT_REVISION_CONFLICT and writes no content', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored, { updateManyResult: { count: 0 } });

  await assert.rejects(
    () => updateCycleDraft(CYCLE_ID, PLAN_ID, {
      ...toApiDocument(stored),
      userId: USER_ID,
      timezone: TIMEZONE,
      revision: STORED_REVISION - 1, // stale on purpose
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'DRAFT_REVISION_CONFLICT');
      return true;
    }
  );

  // The CAS itself was attempted, but nothing downstream of it ran.
  const claimCalls = harness.calls.filter((call) => call.model === 'plan' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);

  const writes = mutationWrites(harness.calls);
  assert.deepEqual(
    writes.map((call) => `${call.model}.${call.op}`),
    [],
    'a rejected CAS must not reach any content-mutation statement'
  );
});

test('a missing revision omits the predicate and always succeeds (compatibility opt-out)', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored, { updateManyResult: { count: 1 } });

  const document = toApiDocument(stored);
  delete document.revision;

  const response = await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...document,
    userId: USER_ID,
    timezone: TIMEZONE,
    // no `revision` field at all -- old client mid-rollout
  });

  assert.ok(response);

  const claimCalls = harness.calls.filter((call) => call.model === 'plan' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);
  assert.deepEqual(
    claimCalls[0].where,
    { id: PLAN_ID },
    'no revision predicate when the client does not send one'
  );
});

test('retry against the latest revision succeeds after a prior conflict', async () => {
  const stored = buildStoredPlan();

  // First attempt: stale revision, rejected.
  const firstHarness = createHarness(stored, { updateManyResult: { count: 0 } });
  await assert.rejects(
    () => updateCycleDraft(CYCLE_ID, PLAN_ID, {
      ...toApiDocument(stored),
      userId: USER_ID,
      timezone: TIMEZONE,
      revision: STORED_REVISION - 1,
    }),
    (error) => {
      assert.equal(error.code, 'DRAFT_REVISION_CONFLICT');
      return true;
    }
  );
  assert.equal(mutationWrites(firstHarness.calls).length, 0);

  // Second attempt: same document, but now sent with the current stored revision
  // (as if the client reloaded via reloadLatestAfterConflict() first) -- succeeds.
  const secondHarness = createHarness(stored, { updateManyResult: { count: 1 } });
  const response = await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...toApiDocument(stored),
    userId: USER_ID,
    timezone: TIMEZONE,
    revision: STORED_REVISION,
  });

  assert.ok(response);
  const claimCalls = secondHarness.calls.filter((call) => call.model === 'plan' && call.op === 'updateMany');
  assert.equal(claimCalls.length, 1);
  assert.deepEqual(claimCalls[0].where, { id: PLAN_ID, revision: STORED_REVISION });
});
