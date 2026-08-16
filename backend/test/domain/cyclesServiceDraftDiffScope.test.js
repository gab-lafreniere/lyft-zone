// The Manual Builder posts the whole plan document on every autosave so the backend can
// diff it against the stored draft. Raising the request-body limit makes those payloads
// arrive; these tests pin the two properties that make sending a whole document safe:
//
//   1. a one-set edit writes only the touched workout, not the plan;
//   2. a week omitted from the payload is still deleted.
//
// (2) is why "just send the edited week" is not a valid optimization: omission means
// deletion, and any future change to that contract has to break this test first.

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

const USER_ID = 'user_diff_scope';
const CYCLE_ID = 'cycle_diff_scope';
const PLAN_ID = 'plan_diff_scope';
const TIMEZONE = 'America/Toronto';
const START_DATE = new Date('2026-09-07T00:00:00.000Z');
const END_DATE = new Date('2026-09-20T00:00:00.000Z');
const DURATION_WEEKS = 2;

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
    name: 'Diff scope plan',
    versionNumber: 2,
    sourceType: 'USER',
    status: 'DRAFT',
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: DURATION_WEEKS,
    publishedAt: null,
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
        workouts: Array.from({ length: 2 }, (_, workoutIndex) => {
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

function createHarness(storedPlan) {
  const calls = [];
  const record = (model, op, extra = {}) => calls.push({ model, op, ...extra });

  const cycle = {
    id: CYCLE_ID,
    userId: USER_ID,
    name: 'Diff scope cycle',
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
    (call) => mutating.has(call.op) && !(call.model === 'plan' && call.op === 'deleteMany')
  );
}

test('adding one set writes only the touched workout, not the whole plan', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored);

  const incoming = toApiDocument(stored);
  const targetWorkout = incoming.weeks[0].workouts[0];
  const targetExercise = targetWorkout.blocks[0].exercises[0];
  targetExercise.setTemplates.push({
    setIndex: 3,
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
  });

  await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...incoming,
    userId: USER_ID,
    timezone: TIMEZONE,
  });

  const writes = mutationWrites(harness.calls);

  // Nothing may touch the plan-wide collections.
  assert.equal(
    writes.some((call) => call.model === 'planWeek' && call.op === 'delete'),
    false,
    'a set edit must not delete weeks'
  );
  assert.equal(
    writes.some((call) => call.model === 'planWeek' && call.op === 'deleteMany'),
    false,
    'a set edit must not wipe the plan weeks'
  );

  // Only the edited workout's blocks may be replaced.
  const blockDeletes = writes.filter(
    (call) => call.model === 'workoutBlock' && call.op === 'deleteMany'
  );
  assert.equal(blockDeletes.length, 1, 'exactly one workout may be rebuilt');
  assert.equal(
    blockDeletes[0].where?.workoutId,
    targetWorkout.id,
    'the rebuilt workout must be the edited one'
  );

  const touchedWorkoutIds = new Set(
    writes
      .filter((call) => call.model === 'workout' && call.op === 'update')
      .map((call) => call.where?.id)
  );
  assert.deepEqual(
    [...touchedWorkoutIds],
    [targetWorkout.id],
    'no untouched workout may be written'
  );
});

test('an unchanged document performs no mutation at all', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored);

  await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...toApiDocument(stored),
    userId: USER_ID,
    timezone: TIMEZONE,
  });

  assert.deepEqual(
    mutationWrites(harness.calls).map((call) => `${call.model}.${call.op}`),
    [],
    'a no-op save must not write'
  );
});

test('omitting a week is rejected rather than silently deleting it', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored);

  const incoming = toApiDocument(stored);
  incoming.weeks.splice(1, 1);

  // Week count belongs to the timeline endpoint, so the draft save refuses a document
  // whose week count drifted instead of treating the omission as a deletion.
  await assert.rejects(
    () => updateCycleDraft(CYCLE_ID, PLAN_ID, {
      ...incoming,
      userId: USER_ID,
      timezone: TIMEZONE,
    }),
    /week count must match durationWeeks/i
  );

  assert.deepEqual(
    mutationWrites(harness.calls).map((call) => `${call.model}.${call.op}`),
    [],
    'a rejected document must not write anything'
  );
});

test('omitting a workout inside a week deletes it (subtractive semantics)', async () => {
  const stored = buildStoredPlan();
  const harness = createHarness(stored);

  const incoming = toApiDocument(stored);
  const removedWorkout = incoming.weeks[0].workouts.pop();

  await updateCycleDraft(CYCLE_ID, PLAN_ID, {
    ...incoming,
    userId: USER_ID,
    timezone: TIMEZONE,
  });

  const workoutDeletes = harness.calls.filter(
    (call) => call.model === 'workout' && call.op === 'deleteMany'
  );
  assert.equal(
    workoutDeletes.length,
    1,
    'omitting a workout must delete it — this is why partial payloads are unsafe'
  );
  const deletedIds = workoutDeletes[0].where?.id?.in || [];
  assert.deepEqual(
    deletedIds,
    [removedWorkout.id],
    'only the omitted workout may be deleted'
  );
});
