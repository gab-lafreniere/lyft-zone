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
let updateWeeklyPlanDraft;
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
  ({ createWeeklyPlan, updateWeeklyPlanDraft } = require('../../services/weeklyPlansService'));
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
