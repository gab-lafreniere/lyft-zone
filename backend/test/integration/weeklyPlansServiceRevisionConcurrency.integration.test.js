// Real-Postgres proof of the atomic compare-and-swap in updateWeeklyPlanDraft.
//
// Sibling to cyclesServiceRevisionConcurrency.integration.test.js -- see that
// file's header for the full rationale (why a mocked `tx` can't prove this,
// what the local harness is, and that this never touches the shared/live
// Neon database). Kept as a separate file rather than a parameterized shared
// test because the two draft types seed genuinely different model graphs
// (Plan/TrainingCycle/Workout/... vs WeeklyPlanParent/WeeklyPlanVersion/...)
// and updateWeeklyPlanDraft's persistence strategy is a blind delete-all +
// recreate rather than updateCycleDraft's scoped diff/apply, so the
// "only the winner's content survives" assertion is phrased differently
// here (whole-document replace, not a same-id scalar-field update) --
// sharing the seed/orchestration boilerplate would cost more in
// indirection than it would save in duplicated lines.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let createUser;
let createWeeklyPlan;
let publishWeeklyPlanDraft;
let updateWeeklyPlanDraft;
let updateWeeklyPlanWorkoutContent;
let getPrisma;

before(async () => {
  pgHandle = await startLocalPostgres();

  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling (initdb/pg_ctl/postgres) was not found on PATH -- ' +
      'skipping the real-Postgres concurrency proof. Install PostgreSQL locally ' +
      '(e.g. `brew install postgresql@18`) to run this suite.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;

  ({ createUser } = require('../../services/usersService'));
  ({
    createWeeklyPlan,
    publishWeeklyPlanDraft,
    updateWeeklyPlanDraft,
    updateWeeklyPlanWorkoutContent,
  } = require('../../services/weeklyPlansService'));
  ({ getPrisma } = require('../../lib/prisma'));
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

function buildUpdatePayload(userId, { workoutName, targetReps, revision }) {
  return {
    userId,
    revision,
    name: 'Revision CAS Weekly Plan',
    sessionsPerWeek: 1,
    workouts: [
      {
        name: workoutName,
        orderIndex: 1,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            restStrategy: 'AFTER_EXERCISE',
            exercises: [
              {
                exerciseId: 'ex_bench_press_test',
                exerciseName: 'Bench Press',
                orderIndex: 1,
                intensificationMethod: 'NONE',
                setTemplates: [{ setIndex: 1, setType: 'WORKING', targetReps }],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function loadWorkoutPayload(prisma, workoutId, overrides = {}) {
  const workout = await prisma.weeklyPlanWorkout.findUnique({
    where: { id: workoutId },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          exercises: {
            orderBy: { orderIndex: 'asc' },
            include: {
              setTemplates: { orderBy: { setIndex: 'asc' } },
            },
          },
        },
      },
    },
  });

  return {
    id: workout.id,
    name: overrides.name || workout.name,
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
        cardioPrescription: exercise.cardioPrescription,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((set) => ({
          id: set.id,
          setIndex: set.setIndex,
          setType: set.setType,
          targetReps: overrides.targetReps ?? set.targetReps,
          minReps: set.minReps,
          maxReps: set.maxReps,
          targetSeconds: set.targetSeconds,
          targetRir: set.targetRir,
          targetRpe: set.targetRpe,
          tempo: set.tempo,
          restSeconds: set.restSeconds,
          notes: set.notes,
        })),
      })),
    })),
  };
}

async function createWorkoutConcurrencyDraft(email, workoutNames) {
  const prisma = getPrisma();
  const existingExercise = await prisma.exercise.findUnique({
    where: { exerciseId: 'ex_bench_press_test' },
    select: { exerciseId: true },
  });
  if (!existingExercise) {
    await seedExercise(prisma);
  }
  const user = await createUser({ email });
  const created = await createWeeklyPlan(
    {
      userId: user.id,
      name: 'Workout CAS Weekly Plan',
      sessionsPerWeek: workoutNames.length,
      source: 'MANUAL',
      workouts: workoutNames.map((name, index) => ({
        name,
        orderIndex: index + 1,
        blocks: [{
          orderIndex: 1,
          blockType: 'SINGLE',
          restStrategy: 'AFTER_EXERCISE',
          exercises: [{
            exerciseId: 'ex_bench_press_test',
            exerciseName: 'Bench Press',
            orderIndex: 1,
            intensificationMethod: 'NONE',
            setTemplates: [{ setIndex: 1, setType: 'WORKING', targetReps: 8 }],
          }],
        }],
      })),
    },
    { initialStatus: 'DRAFT' }
  );
  return { created, prisma, user };
}

test('two concurrent updateWeeklyPlanDraft calls at the same revision: exactly one commits, one gets 409, revision advances by exactly 1, and the loser writes nothing', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const prisma = getPrisma();
  await seedExercise(prisma);

  const user = await createUser({ email: 'revision-cas-weekly@example.com' });

  const created = await createWeeklyPlan(
    {
      userId: user.id,
      name: 'Revision CAS Weekly Plan',
      sessionsPerWeek: 1,
      source: 'MANUAL',
      workouts: [
        {
          name: 'Original Workout',
          orderIndex: 1,
          blocks: [
            {
              orderIndex: 1,
              blockType: 'SINGLE',
              restStrategy: 'AFTER_EXERCISE',
              exercises: [
                {
                  exerciseId: 'ex_bench_press_test',
                  exerciseName: 'Bench Press',
                  orderIndex: 1,
                  intensificationMethod: 'NONE',
                  setTemplates: [{ setIndex: 1, setType: 'WORKING', targetReps: 8 }],
                },
              ],
            },
          ],
        },
      ],
    },
    { initialStatus: 'DRAFT' }
  );

  // Draft row created at revision N (the schema default).
  assert.equal(created.revision, 1);
  const startingRevision = created.revision;

  // Two real service calls, fired without awaiting between them, both
  // targeting the same starting revision, with genuinely different content
  // (workout name + targetReps) so the winner is identifiable in the final
  // persisted state.
  const payloadA = buildUpdatePayload(user.id, {
    workoutName: 'Writer A Workout',
    targetReps: 8,
    revision: startingRevision,
  });
  const payloadB = buildUpdatePayload(user.id, {
    workoutName: 'Writer B Workout',
    targetReps: 12,
    revision: startingRevision,
  });

  const results = await Promise.allSettled([
    updateWeeklyPlanDraft(created.weeklyPlanParentId, created.weeklyPlanVersionId, payloadA),
    updateWeeklyPlanDraft(created.weeklyPlanParentId, created.weeklyPlanVersionId, payloadB),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  // Exactly one succeeds, exactly one fails with the typed 409.
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, 'DRAFT_REVISION_CONFLICT');

  const winningWorkoutName = fulfilled[0].value.builderPayload.workouts[0].name;
  assert.ok(
    winningWorkoutName === 'Writer A Workout' || winningWorkoutName === 'Writer B Workout'
  );

  // Revision advances by exactly 1, not 2 -- the loser's attempt never
  // claimed (and therefore never bumped) the counter.
  const finalVersion = await prisma.weeklyPlanVersion.findUnique({
    where: { id: created.weeklyPlanVersionId },
    select: { revision: true },
  });
  assert.equal(finalVersion.revision, startingRevision + 1);

  // Only the winner's content exists in the final persisted draft: exactly
  // one workout (the delete-all-then-recreate write only ever ran once,
  // from the winning transaction), with the winner's name and reps.
  const finalWorkouts = await prisma.weeklyPlanWorkout.findMany({
    where: { weeklyPlanVersionId: created.weeklyPlanVersionId },
    include: { blocks: { include: { exercises: { include: { setTemplates: true } } } } },
  });

  assert.equal(finalWorkouts.length, 1);
  assert.equal(finalWorkouts[0].name, winningWorkoutName);

  const finalTargetReps = finalWorkouts[0].blocks[0].exercises[0].setTemplates[0].targetReps;
  assert.equal(finalTargetReps, winningWorkoutName === 'Writer A Workout' ? 8 : 12);

  // The failed writer caused no child/content mutation: the loser's
  // deleteMany+create never ran (it sits after the CAS throw), so there are
  // no orphaned blocks/exercises/set templates left behind from an aborted
  // write, and the block/exercise/set-template counts are exactly what a
  // single successful write would produce.
  assert.equal(finalWorkouts[0].blocks.length, 1);
  assert.equal(finalWorkouts[0].blocks[0].exercises.length, 1);
  assert.equal(finalWorkouts[0].blocks[0].exercises[0].setTemplates.length, 1);
});

test('same-workout concurrent Weekly PATCHes: one commits, one conflicts, and both revisions advance once', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-workout-same-cas@example.com',
    ['Original Workout']
  );
  const initial = created.builderPayload.workouts[0];
  const startingVersionRevision = created.revision;
  const payloadA = await loadWorkoutPayload(prisma, initial.id, {
    name: 'Same Writer A',
    targetReps: 9,
  });
  const payloadB = await loadWorkoutPayload(prisma, initial.id, {
    name: 'Same Writer B',
    targetReps: 12,
  });

  const results = await Promise.allSettled([
    updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      initial.id,
      { userId: user.id, contentRevision: initial.contentRevision, workout: payloadA }
    ),
    updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      initial.id,
      { userId: user.id, contentRevision: initial.contentRevision, workout: payloadB }
    ),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, 'WORKOUT_REVISION_CONFLICT');

  const finalVersion = await prisma.weeklyPlanVersion.findUnique({
    where: { id: created.weeklyPlanVersionId },
    select: { revision: true },
  });
  const finalWorkout = await prisma.weeklyPlanWorkout.findUnique({
    where: { id: initial.id },
    include: { blocks: { include: { exercises: { include: { setTemplates: true } } } } },
  });
  assert.equal(finalVersion.revision, startingVersionRevision + 1);
  assert.equal(finalWorkout.contentRevision, initial.contentRevision + 1);
  assert.equal(finalWorkout.name, fulfilled[0].value.workout.name);
  assert.equal(
    finalWorkout.blocks[0].exercises[0].setTemplates[0].targetReps,
    fulfilled[0].value.workout.blocks[0].sets[0].reps
  );
});

test('different-workout concurrent Weekly PATCHes both commit independently and advance version twice', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-workout-different-cas@example.com',
    ['Workout A', 'Workout B']
  );
  const [workoutA, workoutB] = created.builderPayload.workouts;
  const startingVersionRevision = created.revision;
  const payloadA = await loadWorkoutPayload(prisma, workoutA.id, {
    name: 'Workout A Saved',
    targetReps: 9,
  });
  const payloadB = await loadWorkoutPayload(prisma, workoutB.id, {
    name: 'Workout B Saved',
    targetReps: 12,
  });

  const results = await Promise.all([
    updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      workoutA.id,
      { userId: user.id, contentRevision: workoutA.contentRevision, workout: payloadA }
    ),
    updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      workoutB.id,
      { userId: user.id, contentRevision: workoutB.contentRevision, workout: payloadB }
    ),
  ]);

  const finalVersion = await prisma.weeklyPlanVersion.findUnique({
    where: { id: created.weeklyPlanVersionId },
    select: { revision: true },
  });
  const finalWorkouts = await prisma.weeklyPlanWorkout.findMany({
    where: { id: { in: [workoutA.id, workoutB.id] } },
    orderBy: { orderIndex: 'asc' },
    include: { blocks: { include: { exercises: { include: { setTemplates: true } } } } },
  });

  assert.equal(results.length, 2);
  assert.equal(finalVersion.revision, startingVersionRevision + 2);
  assert.deepEqual(finalWorkouts.map((workout) => workout.contentRevision), [
    workoutA.contentRevision + 1,
    workoutB.contentRevision + 1,
  ]);
  assert.deepEqual(finalWorkouts.map((workout) => workout.name), [
    'Workout A Saved',
    'Workout B Saved',
  ]);
  assert.deepEqual(finalWorkouts.map(
    (workout) => workout.blocks[0].exercises[0].setTemplates[0].targetReps
  ), [9, 12]);
});

test('Weekly structural content/reorder semantics, stale tokens, and row-level ID stability hold in PostgreSQL', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-structural-revisions@example.com',
    ['Workout A', 'Workout B']
  );
  const [workoutA, workoutB] = created.builderPayload.workouts;
  const originalA = await loadWorkoutPayload(prisma, workoutA.id);
  const originalB = await loadWorkoutPayload(prisma, workoutB.id);
  const stableIds = {
    workout: workoutA.id,
    block: originalA.blocks[0].id,
    exercise: originalA.blocks[0].exercises[0].id,
    set: originalA.blocks[0].exercises[0].setTemplates[0].id,
  };

  const structurallyUpdated = await updateWeeklyPlanDraft(
    created.weeklyPlanParentId,
    created.weeklyPlanVersionId,
    {
      userId: user.id,
      revision: created.revision,
      name: 'Workout CAS Weekly Plan',
      sessionsPerWeek: 2,
      workouts: [
        await loadWorkoutPayload(prisma, workoutA.id, { targetReps: 10 }),
        originalB,
      ],
    }
  );
  assert.deepEqual(
    structurallyUpdated.builderPayload.workouts.map((workout) => workout.contentRevision),
    [workoutA.contentRevision + 1, workoutB.contentRevision]
  );

  const currentA = await loadWorkoutPayload(prisma, workoutA.id);
  const currentB = await loadWorkoutPayload(prisma, workoutB.id);
  const reordered = await updateWeeklyPlanDraft(
    created.weeklyPlanParentId,
    created.weeklyPlanVersionId,
    {
      userId: user.id,
      revision: structurallyUpdated.revision,
      name: 'Workout CAS Weekly Plan',
      sessionsPerWeek: 2,
      workouts: [
        { ...currentB, orderIndex: 1 },
        { ...currentA, orderIndex: 2 },
      ],
    }
  );
  assert.deepEqual(
    reordered.builderPayload.workouts.map((workout) => workout.contentRevision),
    [workoutB.contentRevision, workoutA.contentRevision + 1]
  );
  const reorderedA = await loadWorkoutPayload(prisma, workoutA.id);

  await assert.rejects(
    () => updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      workoutA.id,
      {
        userId: user.id,
        contentRevision: workoutA.contentRevision,
        workout: reorderedA,
      }
    ),
    (error) => error?.status === 409 && error?.code === 'WORKOUT_REVISION_CONFLICT'
  );

  const beforeSibling = await prisma.weeklyPlanWorkout.findUnique({
    where: { id: workoutB.id },
    include: { blocks: { include: { exercises: { include: { setTemplates: true } } } } },
  });
  const latestA = await loadWorkoutPayload(prisma, workoutA.id, {
    name: 'Workout A row-level save',
    targetReps: 11,
  });
  const rowLevelResponse = await updateWeeklyPlanWorkoutContent(
    created.weeklyPlanParentId,
    created.weeklyPlanVersionId,
    workoutA.id,
    {
      userId: user.id,
      contentRevision: workoutA.contentRevision + 1,
      workout: latestA,
    }
  );
  const afterA = await loadWorkoutPayload(prisma, workoutA.id);
  const afterSibling = await prisma.weeklyPlanWorkout.findUnique({
    where: { id: workoutB.id },
    include: { blocks: { include: { exercises: { include: { setTemplates: true } } } } },
  });

  assert.equal(rowLevelResponse.contentRevision, workoutA.contentRevision + 2);
  assert.deepEqual({
    workout: afterA.id,
    block: afterA.blocks[0].id,
    exercise: afterA.blocks[0].exercises[0].id,
    set: afterA.blocks[0].exercises[0].setTemplates[0].id,
  }, stableIds);
  assert.deepEqual(afterSibling, beforeSibling);
});

test('a true Weekly structural-name and workout-content race has only atomic merged outcomes', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-structural-workout-race@example.com',
    ['Before content race']
  );
  const workout = created.builderPayload.workouts[0];
  const unchangedWorkout = await loadWorkoutPayload(prisma, workout.id);
  const beforeIds = {
    block: unchangedWorkout.blocks[0].id,
    exercise: unchangedWorkout.blocks[0].exercises[0].id,
    set: unchangedWorkout.blocks[0].exercises[0].setTemplates[0].id,
  };

  const results = await Promise.allSettled([
    updateWeeklyPlanDraft(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      {
        userId: user.id,
        revision: created.revision,
        name: 'After structural race',
        sessionsPerWeek: 1,
        workouts: [unchangedWorkout],
      }
    ),
    updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      workout.id,
      {
        userId: user.id,
        contentRevision: workout.contentRevision,
        workout: {
          ...unchangedWorkout,
          name: 'After content race',
        },
      }
    ),
  ]);

  const structuralResult = results[0];
  const contentResult = results[1];
  assert.equal(contentResult.status, 'fulfilled');
  if (structuralResult.status === 'rejected') {
    assert.equal(structuralResult.reason.status, 409);
    assert.equal(structuralResult.reason.code, 'DRAFT_REVISION_CONFLICT');
  }

  const finalVersion = await prisma.weeklyPlanVersion.findUnique({
    where: { id: created.weeklyPlanVersionId },
  });
  const finalWorkout = await loadWorkoutPayload(prisma, workout.id);
  assert.equal(finalWorkout.name, 'After content race');
  assert.deepEqual({
    block: finalWorkout.blocks[0].id,
    exercise: finalWorkout.blocks[0].exercises[0].id,
    set: finalWorkout.blocks[0].exercises[0].setTemplates[0].id,
  }, beforeIds);
  assert.equal(
    finalVersion.revision,
    created.revision + (structuralResult.status === 'fulfilled' ? 2 : 1)
  );
  assert.equal(
    finalVersion.name,
    structuralResult.status === 'fulfilled'
      ? 'After structural race'
      : 'Workout CAS Weekly Plan'
  );
});

test('publishing the current Weekly version closes the workout endpoint without mutation', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-published-workout-closed@example.com',
    ['Publish Me']
  );
  const workout = created.builderPayload.workouts[0];
  const workoutPayload = await loadWorkoutPayload(prisma, workout.id, {
    name: 'Must not persist',
  });
  await publishWeeklyPlanDraft(created.weeklyPlanParentId, { userId: user.id });

  await assert.rejects(
    () => updateWeeklyPlanWorkoutContent(
      created.weeklyPlanParentId,
      created.weeklyPlanVersionId,
      workout.id,
      {
        userId: user.id,
        contentRevision: workout.contentRevision,
        workout: workoutPayload,
      }
    ),
    (error) =>
      (error?.status === 400 || error?.status === 404) &&
      error?.code !== 'WORKOUT_REVISION_CONFLICT'
  );

  const finalWorkout = await prisma.weeklyPlanWorkout.findUnique({
    where: { id: workout.id },
  });
  assert.equal(finalWorkout.name, 'Publish Me');
  assert.equal(finalWorkout.contentRevision, workout.contentRevision);
});

test('real Weekly workout endpoint rejects wrong scope, unknown exercises, and malformed trees before mutation', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const { created, prisma, user } = await createWorkoutConcurrencyDraft(
    'weekly-real-scope-validation@example.com',
    ['Scoped Workout']
  );
  const otherUser = await createUser({ email: 'weekly-real-scope-other@example.com' });
  const workout = created.builderPayload.workouts[0];
  const validWorkout = await loadWorkoutPayload(prisma, workout.id);
  const before = await prisma.weeklyPlanWorkout.findUnique({ where: { id: workout.id } });

  const cases = [
    {
      args: ['missing_parent', created.weeklyPlanVersionId, workout.id],
      request: { userId: user.id, contentRevision: workout.contentRevision, workout: validWorkout },
      status: 404,
    },
    {
      args: [created.weeklyPlanParentId, created.weeklyPlanVersionId, workout.id],
      request: { userId: otherUser.id, contentRevision: workout.contentRevision, workout: validWorkout },
      status: 404,
    },
    {
      args: [created.weeklyPlanParentId, 'missing_version', workout.id],
      request: { userId: user.id, contentRevision: workout.contentRevision, workout: validWorkout },
      status: 400,
    },
    {
      args: [created.weeklyPlanParentId, created.weeklyPlanVersionId, 'missing_workout'],
      request: {
        userId: user.id,
        contentRevision: workout.contentRevision,
        workout: { ...validWorkout, id: 'missing_workout' },
      },
      status: 404,
    },
    {
      args: [created.weeklyPlanParentId, created.weeklyPlanVersionId, workout.id],
      request: {
        userId: user.id,
        contentRevision: workout.contentRevision,
        workout: {
          ...validWorkout,
          blocks: validWorkout.blocks.map((block) => ({
            ...block,
            exercises: block.exercises.map((exercise) => ({
              ...exercise,
              exerciseId: 'unknown_exercise_id',
            })),
          })),
        },
      },
      status: 400,
    },
    {
      args: [created.weeklyPlanParentId, created.weeklyPlanVersionId, workout.id],
      request: {
        userId: user.id,
        contentRevision: workout.contentRevision,
        workout: { ...validWorkout, blocks: 'malformed' },
      },
      status: 400,
    },
  ];

  for (const scenario of cases) {
    await assert.rejects(
      () => updateWeeklyPlanWorkoutContent(...scenario.args, scenario.request),
      (error) => error?.status === scenario.status
    );
  }

  const after = await prisma.weeklyPlanWorkout.findUnique({ where: { id: workout.id } });
  assert.deepEqual(after, before);
});
