// Phase 3: Weekly Plan's autosave used to blindly delete every workout and
// recreate the whole document on every save, regardless of what actually
// changed. This suite is the weekly-plan analogue of
// cyclesServiceDraftDiffScope.test.js, which already proves the same
// contract for Cycle's (separately implemented, week-nested) draft. It
// pins the properties that make posting the whole document on every
// autosave safe now that Weekly Plan shares Cycle's diff/apply engine
// (draftDocumentDiff.js):
//
//   1. a one-set edit writes only the touched workout, not the whole draft;
//   2. a workout omitted from the payload is still deleted (subtractive
//      semantics -- "just send the edited workout" is not a valid
//      optimization);
//   3. an unchanged document performs no mutation at all;
//   4. a no-op save still increments `revision` by exactly 1 -- the CAS
//      claim and the content diff are deliberately independent (Phase 2's
//      unconditional-on-claim increment rule), so this confirms Phase 3's
//      diff/apply refactor didn't accidentally couple them.

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

const { updateWeeklyPlanDraft } = require('../../services/weeklyPlansService');

const USER_ID = 'user_diff_scope';
const PARENT_ID = 'parent_diff_scope';
const VERSION_ID = 'version_diff_scope';
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

function buildStoredVersion() {
  return {
    id: VERSION_ID,
    weeklyPlanParentId: PARENT_ID,
    versionNumber: 2,
    name: 'Diff scope plan',
    sessionsPerWeek: 2,
    status: 'DRAFT',
    revision: STORED_REVISION,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    workouts: Array.from({ length: 2 }, (_, workoutIndex) => {
      const workoutId = `workout_${workoutIndex + 1}`;
      return {
        id: workoutId,
        weeklyPlanVersionId: VERSION_ID,
        name: `Day ${workoutIndex + 1}`,
        orderIndex: workoutIndex + 1,
        estimatedDurationMinutes: null,
        notes: null,
        blocks: [{
          id: `${workoutId}_block_1`,
          weeklyPlanWorkoutId: workoutId,
          orderIndex: 1,
          blockType: 'SINGLE',
          label: null,
          roundCount: null,
          restStrategy: 'AFTER_EXERCISE',
          restSeconds: 90,
          notes: null,
          exercises: [{
            id: `${workoutId}_exercise_1`,
            weeklyPlanWorkoutBlockId: `${workoutId}_block_1`,
            exerciseId: 'exr_movement_example',
            exerciseName: 'Movement Example',
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
              buildSetTemplate(`${workoutId}_exercise_1`, 1),
              buildSetTemplate(`${workoutId}_exercise_1`, 2),
            ],
          }],
        }],
      };
    }),
  };
}

// The wire shape the Weekly Plan Manual Builder sends.
function toApiDocument(version) {
  return {
    name: version.name,
    sessionsPerWeek: version.sessionsPerWeek,
    workouts: version.workouts.map((workout) => ({
      id: workout.id,
      name: workout.name,
      orderIndex: workout.orderIndex,
      estimatedDurationMinutes: workout.estimatedDurationMinutes,
      notes: workout.notes,
      blocks: workout.blocks.map((block) => ({
        id: block.id,
        orderIndex: block.orderIndex,
        blockType: block.blockType,
        label: block.label,
        roundCount: block.roundCount,
        restStrategy: block.restStrategy,
        restSeconds: block.restSeconds,
        notes: block.notes,
        exercises: block.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          bodyParts: exercise.bodyParts,
          muscleFocus: exercise.muscleFocus,
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
  };
}

function createHarness(storedVersion, { updateManyResult = { count: 1 } } = {}) {
  const calls = [];
  const record = (model, op, extra = {}) => calls.push({ model, op, ...extra });

  const tx = {
    weeklyPlanVersion: {
      findFirst: async () => { record('weeklyPlanVersion', 'findFirst'); return storedVersion; },
      // Phase 2's revision CAS runs before the diff/apply logic these tests
      // exercise. None of these payloads send `revision`, so the CAS always
      // takes the no-predicate compatibility-opt-out path regardless of what
      // this returns -- it only needs to exist so the CAS statement itself
      // doesn't throw.
      updateMany: async ({ where, data }) => {
        record('weeklyPlanVersion', 'updateMany', { where, data });
        return typeof updateManyResult === 'function' ? updateManyResult({ where, data }) : updateManyResult;
      },
      update: async ({ where, data }) => { record('weeklyPlanVersion', 'update', { where, data }); return { ...storedVersion, ...data }; },
    },
    weeklyPlanWorkout: {
      create: async ({ data }) => { record('weeklyPlanWorkout', 'create', { data }); return { ...data, id: 'new_workout' }; },
      update: async ({ where, data }) => { record('weeklyPlanWorkout', 'update', { where, data }); return { id: where.id, ...data }; },
      deleteMany: async ({ where }) => { record('weeklyPlanWorkout', 'deleteMany', { where }); return { count: 0 }; },
    },
    weeklyPlanWorkoutBlock: {
      deleteMany: async ({ where }) => { record('weeklyPlanWorkoutBlock', 'deleteMany', { where }); return { count: 0 }; },
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
    weeklyPlanParent: {
      findFirst: async () => {
        record('weeklyPlanParent', 'findFirst');
        return { id: PARENT_ID, sourceType: 'MANUAL', latestDraftVersionId: VERSION_ID };
      },
    },
  };

  return { calls, tx };
}

function mutationWrites(calls) {
  const mutating = new Set(['create', 'update', 'delete', 'deleteMany', 'createMany']);
  return calls.filter((call) => mutating.has(call.op));
}

test('adding one set writes only the touched workout, not the whole draft', async () => {
  const stored = buildStoredVersion();
  const harness = createHarness(stored);

  const incoming = toApiDocument(stored);
  const targetWorkout = incoming.workouts[0];
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

  await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...incoming,
    userId: USER_ID,
  });

  const writes = mutationWrites(harness.calls);

  // Only the edited workout's blocks may be replaced.
  const blockDeletes = writes.filter(
    (call) => call.model === 'weeklyPlanWorkoutBlock' && call.op === 'deleteMany'
  );
  assert.equal(blockDeletes.length, 1, 'exactly one workout may be rebuilt');
  assert.equal(
    blockDeletes[0].where?.weeklyPlanWorkoutId,
    targetWorkout.id,
    'the rebuilt workout must be the edited one'
  );

  const touchedWorkoutIds = new Set(
    writes
      .filter((call) => call.model === 'weeklyPlanWorkout' && call.op === 'update')
      .map((call) => call.where?.id)
  );
  assert.deepEqual(
    [...touchedWorkoutIds],
    [targetWorkout.id],
    'no untouched workout may be written'
  );

  assert.equal(
    writes.some((call) => call.model === 'weeklyPlanWorkout' && call.op === 'create'),
    false,
    'a set edit must not create a new workout'
  );
  assert.equal(
    writes.some((call) => call.model === 'weeklyPlanWorkout' && call.op === 'deleteMany'),
    false,
    'a set edit must not delete any workout'
  );
});

test('an unchanged document performs no mutation at all', async () => {
  const stored = buildStoredVersion();
  const harness = createHarness(stored);

  await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...toApiDocument(stored),
    userId: USER_ID,
  });

  assert.deepEqual(
    mutationWrites(harness.calls).map((call) => `${call.model}.${call.op}`),
    [],
    'a no-op save must not write'
  );
});

test('omitting a workout deletes it (subtractive semantics)', async () => {
  const stored = buildStoredVersion();
  const harness = createHarness(stored);

  const incoming = toApiDocument(stored);
  const removedWorkout = incoming.workouts.pop();

  await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...incoming,
    userId: USER_ID,
  });

  const workoutDeletes = harness.calls.filter(
    (call) => call.model === 'weeklyPlanWorkout' && call.op === 'deleteMany'
  );
  assert.equal(
    workoutDeletes.length,
    1,
    'omitting a workout must delete it -- this is why partial payloads are unsafe'
  );
  const deletedIds = workoutDeletes[0].where?.id?.in || [];
  assert.deepEqual(
    deletedIds,
    [removedWorkout.id],
    'only the omitted workout may be deleted'
  );
});

test('a no-op content save still increments revision by exactly 1', async () => {
  const stored = buildStoredVersion();
  const harness = createHarness(stored);

  await updateWeeklyPlanDraft(PARENT_ID, VERSION_ID, {
    ...toApiDocument(stored),
    userId: USER_ID,
    revision: STORED_REVISION,
  });

  const claimCalls = harness.calls.filter(
    (call) => call.model === 'weeklyPlanVersion' && call.op === 'updateMany'
  );
  assert.equal(claimCalls.length, 1, 'the CAS claim still runs for a no-op save');
  assert.deepEqual(claimCalls[0].where, { id: VERSION_ID, revision: STORED_REVISION });
  assert.deepEqual(
    claimCalls[0].data,
    { revision: { increment: 1 } },
    'revision increments by exactly 1 even though the content diff is a no-op -- ' +
      'the claim and the content diff are independent (Phase 2\'s unconditional-on-claim rule)'
  );

  assert.deepEqual(
    mutationWrites(harness.calls).map((call) => `${call.model}.${call.op}`),
    [],
    'the no-op content still performs no content mutation -- only the CAS ran'
  );
});
