// Real-Postgres proof of the atomic compare-and-swap in updateCycleDraft.
//
// The mocked unit tests in test/domain/cyclesServiceRevisionConflict.test.js
// prove the CAS code is *shaped* correctly (calls updateMany with the right
// predicate, throws 409 on count:0). They cannot prove genuine atomicity --
// a hand-rolled `tx` mock has no row locking, no re-evaluated WHERE clauses,
// no real concurrent transactions. This suite runs the real service function
// against a real, throwaway, local-only Postgres cluster (see
// test/integration/support/localPostgres.js) and fires two updates at the
// same starting revision concurrently, to prove Postgres's row-level locking
// plus its re-check-on-lock-release behavior under READ COMMITTED is what
// actually serializes the two writers -- not application code.
//
// This is never run against the shared/live Neon database referenced by
// backend/.env. It never reads that file. It only ever talks to a
// just-created, just-destroyed local cluster.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let createUser;
let createCycle;
let createPlanForCycle;
let updateCycleDraft;
let updateCycleWorkoutContent;
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
    createCycle,
    createPlanForCycle,
    updateCycleDraft,
    updateCycleWorkoutContent,
  } = require('../../services/cyclesService'));
  ({ getPrisma } = require('../../lib/prisma'));
  await seedExercise(getPrisma());
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

function buildUpdatePayload(createdPlan, userId, { workoutName, targetReps, revision }) {
  const week = createdPlan.weeks[0];
  const workout = week.workouts[0];
  const block = workout.blocks[0];
  const exercise = block.exercises[0];
  const setTemplate = exercise.setTemplates[0];

  return {
    userId,
    revision,
    name: createdPlan.name,
    weeks: [
      {
        id: week.id,
        weekNumber: week.weekNumber,
        orderIndex: week.orderIndex,
        label: week.label,
        notes: week.notes,
        workouts: [
          {
            id: workout.id,
            name: workoutName,
            orderIndex: workout.orderIndex,
            scheduledDay: workout.scheduledDay,
            estimatedDurationMinutes: workout.estimatedDurationMinutes,
            notes: workout.notes,
            blocks: [
              {
                id: block.id,
                orderIndex: block.orderIndex,
                blockType: block.blockType,
                label: block.label,
                roundCount: block.roundCount,
                restStrategy: block.restStrategy,
                restSeconds: block.restSeconds,
                notes: block.notes,
                exercises: [
                  {
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
                    setTemplates: [
                      {
                        id: setTemplate.id,
                        setIndex: setTemplate.setIndex,
                        setType: setTemplate.setType,
                        targetReps,
                        minReps: setTemplate.minReps,
                        maxReps: setTemplate.maxReps,
                        targetSeconds: setTemplate.targetSeconds,
                        targetRir: setTemplate.targetRir,
                        targetRpe: setTemplate.targetRpe,
                        tempo: setTemplate.tempo,
                        restSeconds: setTemplate.restSeconds,
                        notes: setTemplate.notes,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test('two concurrent updateCycleDraft calls at the same revision: exactly one commits, one gets 409, revision advances by exactly 1, and the loser writes nothing', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const prisma = getPrisma();
  const user = await createUser({ email: 'revision-cas-cycle@example.com' });

  const cycle = await createCycle({
    userId: user.id,
    name: 'Revision CAS Cycle',
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'America/Toronto',
  });

  const createdPlan = await createPlanForCycle(cycle.id, {
    name: 'Revision CAS Plan',
    weeks: [
      {
        weekNumber: 1,
        orderIndex: 1,
        label: 'Week 1',
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
    ],
  });

  // Draft row created at revision N (the schema default).
  assert.equal(createdPlan.revision, 1);
  const startingRevision = createdPlan.revision;

  // Two real service calls, fired without awaiting between them, both
  // targeting the same starting revision, with genuinely different content
  // (workout name + targetReps) so the winner is identifiable in the final
  // persisted state.
  const payloadA = buildUpdatePayload(createdPlan, user.id, {
    workoutName: 'Writer A Workout',
    targetReps: 8,
    revision: startingRevision,
  });
  const payloadB = buildUpdatePayload(createdPlan, user.id, {
    workoutName: 'Writer B Workout',
    targetReps: 12,
    revision: startingRevision,
  });

  const results = await Promise.allSettled([
    updateCycleDraft(cycle.id, createdPlan.id, payloadA),
    updateCycleDraft(cycle.id, createdPlan.id, payloadB),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  // Exactly one succeeds, exactly one fails with the typed 409.
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, 'DRAFT_REVISION_CONFLICT');

  const winningWorkoutName = fulfilled[0].value.builderPayload.weeks[0].workouts[0].name;
  assert.ok(
    winningWorkoutName === 'Writer A Workout' || winningWorkoutName === 'Writer B Workout'
  );

  // Revision advances by exactly 1, not 2 -- the loser's attempt never
  // claimed (and therefore never bumped) the counter.
  const finalPlan = await prisma.plan.findUnique({
    where: { id: createdPlan.id },
    select: { revision: true },
  });
  assert.equal(finalPlan.revision, startingRevision + 1);

  // Only the winner's content exists in the final persisted draft.
  const week = createdPlan.weeks[0];
  const workout = week.workouts[0];
  const block = workout.blocks[0];
  const exercise = block.exercises[0];
  const setTemplate = exercise.setTemplates[0];

  const finalWorkout = await prisma.workout.findUnique({ where: { id: workout.id } });
  const finalSetTemplate = await prisma.exerciseSetTemplate.findUnique({
    where: { id: setTemplate.id },
  });

  assert.equal(finalWorkout.name, winningWorkoutName);
  assert.equal(
    finalSetTemplate.targetReps,
    winningWorkoutName === 'Writer A Workout' ? 8 : 12
  );

  // The failed writer caused no child/content mutation: no orphaned or
  // duplicate rows anywhere in the subtree the losing transaction would
  // have touched had it not been aborted before its diff/apply step.
  const workoutCount = await prisma.workout.count({ where: { planWeekId: week.id } });
  const blockCount = await prisma.workoutBlock.count({ where: { workoutId: workout.id } });
  const exerciseCount = await prisma.blockExercise.count({ where: { workoutBlockId: block.id } });
  const setTemplateCount = await prisma.exerciseSetTemplate.count({
    where: { blockExerciseId: exercise.id },
  });

  assert.equal(workoutCount, 1);
  assert.equal(blockCount, 1);
  assert.equal(exerciseCount, 1);
  assert.equal(setTemplateCount, 1);
  // The winning update rewrote this exact row (same ids throughout) rather
  // than deleting and recreating it, confirming the loser never got far
  // enough to interleave a delete against rows the winner also touched.
  assert.equal(finalWorkout.id, workout.id);
});

test('structural saves advance only truly changed workout content revisions and stale workout tokens fail', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const prisma = getPrisma();
  const user = await createUser({ email: 'structural-content-revision@example.com' });
  const cycle = await createCycle({
    userId: user.id,
    name: 'Structural content revision Cycle',
    startDate: '2036-09-01',
    endDate: '2036-09-07',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'UTC',
  });
  const plan = await createPlanForCycle(cycle.id, {
    name: 'Structural content revision Plan',
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      label: 'Week 1',
      workouts: [
        {
          name: 'Touched workout',
          orderIndex: 1,
          scheduledDay: 'MONDAY',
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
        },
        {
          name: 'Unchanged sibling',
          orderIndex: 2,
          scheduledDay: 'WEDNESDAY',
          blocks: [{
            orderIndex: 1,
            blockType: 'SINGLE',
            restStrategy: 'AFTER_EXERCISE',
            exercises: [{
              exerciseId: 'ex_bench_press_test',
              exerciseName: 'Bench Press',
              orderIndex: 1,
              intensificationMethod: 'NONE',
              setTemplates: [{ setIndex: 1, setType: 'WORKING', targetReps: 10 }],
            }],
          }],
        },
      ],
    }],
  });
  const [touched, sibling] = plan.weeks[0].workouts;
  const startingContentRevision = touched.contentRevision;
  const contentPayload = buildUpdatePayload(plan, user.id, {
    workoutName: 'Touched workout renamed',
    targetReps: 12,
    revision: plan.revision,
  });
  contentPayload.weeks[0].workouts.push({
    ...buildUpdatePayload({
      ...plan,
      weeks: [{ ...plan.weeks[0], workouts: [sibling] }],
    }, user.id, {
      workoutName: sibling.name,
      targetReps: 10,
      revision: plan.revision,
    }).weeks[0].workouts[0],
    orderIndex: 2,
    scheduledDay: 'WEDNESDAY',
  });

  const contentResponse = await updateCycleDraft(cycle.id, plan.id, contentPayload);
  assert.equal(
    contentResponse.builderPayload.weeks[0].workouts[0].contentRevision,
    startingContentRevision + 1
  );
  assert.equal(
    contentResponse.builderPayload.weeks[0].workouts[1].contentRevision,
    sibling.contentRevision
  );

  const noOpResponse = await updateCycleDraft(cycle.id, plan.id, {
    ...contentPayload,
    revision: contentResponse.revision,
  });
  assert.deepEqual(
    noOpResponse.builderPayload.weeks[0].workouts.map((workout) => workout.contentRevision),
    [startingContentRevision + 1, sibling.contentRevision]
  );

  const placementPayload = JSON.parse(JSON.stringify(contentPayload));
  placementPayload.revision = noOpResponse.revision;
  placementPayload.weeks[0].workouts[0].scheduledDay = 'TUESDAY';
  const placementResponse = await updateCycleDraft(cycle.id, plan.id, placementPayload);
  assert.deepEqual(
    placementResponse.builderPayload.weeks[0].workouts.map((workout) => workout.contentRevision),
    [startingContentRevision + 1, sibling.contentRevision]
  );

  await assert.rejects(
    () => updateCycleWorkoutContent(cycle.id, plan.id, touched.id, {
      userId: user.id,
      timezone: 'UTC',
      contentRevision: startingContentRevision,
      workout: placementPayload.weeks[0].workouts[0],
    }),
    (error) => error?.status === 409 && error?.code === 'WORKOUT_REVISION_CONFLICT'
  );

  const currentWorkoutResponse = await updateCycleWorkoutContent(
    cycle.id,
    plan.id,
    touched.id,
    {
      userId: user.id,
      timezone: 'UTC',
      contentRevision: startingContentRevision + 1,
      workout: {
        ...placementPayload.weeks[0].workouts[0],
        name: 'Current token succeeds',
      },
    }
  );
  assert.equal(currentWorkoutResponse.contentRevision, startingContentRevision + 2);
});

test('a true same-Plan structural-name and workout-content race has only the two allowed atomic outcomes', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const prisma = getPrisma();
  const user = await createUser({ email: 'structural-workout-race@example.com' });
  const cycle = await createCycle({
    userId: user.id,
    name: 'Structural workout race Cycle',
    startDate: '2035-09-03',
    endDate: '2035-09-09',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'UTC',
  });
  const plan = await createPlanForCycle(cycle.id, {
    name: 'Before structural race',
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      label: 'Week 1',
      workouts: [{
        name: 'Before content race',
        orderIndex: 1,
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
      }],
    }],
  });
  const workout = plan.weeks[0].workouts[0];
  const unchangedWorkoutPayload = buildUpdatePayload(plan, user.id, {
    workoutName: workout.name,
    targetReps: 8,
    revision: plan.revision,
  });
  const structuralPayload = {
    ...unchangedWorkoutPayload,
    name: 'After structural race',
  };
  const contentWorkout = {
    ...unchangedWorkoutPayload.weeks[0].workouts[0],
    name: 'After content race',
  };

  const results = await Promise.allSettled([
    updateCycleDraft(cycle.id, plan.id, structuralPayload),
    updateCycleWorkoutContent(cycle.id, plan.id, workout.id, {
      userId: user.id,
      timezone: 'UTC',
      contentRevision: workout.contentRevision,
      workout: contentWorkout,
    }),
  ]);
  const structuralResult = results[0];
  const contentResult = results[1];
  assert.equal(contentResult.status, 'fulfilled');
  if (structuralResult.status === 'rejected') {
    assert.equal(structuralResult.reason.status, 409);
    assert.equal(structuralResult.reason.code, 'DRAFT_REVISION_CONFLICT');
  }

  const finalPlan = await prisma.plan.findUnique({ where: { id: plan.id } });
  const finalWorkout = await prisma.workout.findUnique({ where: { id: workout.id } });
  const finalSet = await prisma.exerciseSetTemplate.findUnique({
    where: { id: workout.blocks[0].exercises[0].setTemplates[0].id },
  });
  const siblingCount = await prisma.workout.count({
    where: { planWeekId: plan.weeks[0].id },
  });

  assert.equal(finalWorkout.name, 'After content race');
  assert.equal(finalWorkout.contentRevision, workout.contentRevision + 1);
  assert.equal(finalSet.targetReps, 8);
  assert.equal(siblingCount, 1);
  assert.equal(
    finalPlan.revision,
    plan.revision + (structuralResult.status === 'fulfilled' ? 2 : 1)
  );
  assert.equal(
    finalPlan.name,
    structuralResult.status === 'fulfilled'
      ? 'After structural race'
      : 'Before structural race'
  );
});
