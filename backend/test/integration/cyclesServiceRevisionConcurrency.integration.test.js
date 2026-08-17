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
  ({ createCycle, createPlanForCycle, updateCycleDraft } = require('../../services/cyclesService'));
  ({ getPrisma } = require('../../lib/prisma'));
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
  await seedExercise(prisma);

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
