// Real-Postgres proof that Cycle publication and the canonical post-commit
// ScheduledSession regeneration agree on the newly committed Plan identity.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let prisma;
let createUser;
let createCycle;
let createPlanForCycle;
let openOrCreateCycleEditDraft;
let publishCycleDraft;

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping Cycle publish schedule-sync integration tests.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;

  ({ createUser } = require('../../services/usersService'));
  ({
    createCycle,
    createPlanForCycle,
    openOrCreateCycleEditDraft,
    publishCycleDraft,
  } = require('../../services/cyclesService'));
  prisma = require('../../lib/prisma').getPrisma();
  await seedExercise(prisma);
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

function buildWorkout(name, orderIndex, scheduledDay) {
  return {
    name,
    orderIndex,
    scheduledDay,
    estimatedDurationMinutes: 60,
    blocks: [{
      orderIndex: 1,
      blockType: 'SINGLE',
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 90,
      exercises: [{
        exerciseId: 'ex_bench_press_test',
        exerciseName: 'Bench Press',
        orderIndex: 1,
        defaultTempo: '3010',
        defaultRestSeconds: 90,
        defaultTargetRir: 2,
        intensificationMethod: 'NONE',
        setTemplates: [{
          setIndex: 1,
          setType: 'WORKING',
          targetReps: 8,
          targetRir: 2,
          tempo: '3010',
          restSeconds: 90,
        }],
      }],
    }],
  };
}

async function loadSessions(cycleId) {
  return prisma.scheduledSession.findMany({
    where: {
      workout: {
        planWeek: {
          plan: { trainingCycleId: cycleId },
        },
      },
    },
    orderBy: { scheduledStartAt: 'asc' },
    include: {
      workout: {
        include: {
          planWeek: {
            include: { plan: true },
          },
        },
      },
    },
  });
}

test('publish regenerates sessions for the new Plan and no-change republish replaces them once', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const user = await createUser({ email: 'cycle-publish-schedule-sync@example.com' });
  const cycle = await createCycle({
    userId: user.id,
    name: 'Scheduled Cycle',
    startDate: '2035-09-03',
    endDate: '2035-09-09',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'UTC',
  });
  const draft = await createPlanForCycle(cycle.id, {
    name: 'Scheduled Cycle',
    sourceType: 'USER',
    status: 'DRAFT',
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      label: 'Week 1',
      workouts: [
        buildWorkout('Monday workout', 1, 'MONDAY'),
        buildWorkout('Wednesday workout', 2, 'WEDNESDAY'),
      ],
    }],
  });

  const firstPublish = await publishCycleDraft(cycle.id, {
    userId: user.id,
    planId: draft.id,
    timezone: 'UTC',
  });
  const firstSessions = await loadSessions(cycle.id);

  assert.equal(firstPublish.status, 'PUBLISHED');
  assert.equal(firstSessions.length, 2);
  assert.deepEqual(
    firstSessions.map((session) => session.scheduledStartAt.toISOString()),
    ['2035-09-03T12:00:00.000Z', '2035-09-05T12:00:00.000Z']
  );
  assert.ok(
    firstSessions.every(
      (session) => session.workout.planWeek.plan.id === firstPublish.publishedPlanId
    )
  );
  assert.ok(firstSessions.every((session) => session.workout.planWeek.plan.status === 'PUBLISHED'));
  assert.equal(
    firstSessions.some((session) => session.workout.planWeek.plan.id === draft.id),
    false
  );

  const unchangedDraft = await openOrCreateCycleEditDraft(cycle.id, {
    userId: user.id,
    timezone: 'UTC',
  });
  const secondPublish = await publishCycleDraft(cycle.id, {
    userId: user.id,
    planId: unchangedDraft.planId,
    timezone: 'UTC',
  });
  const secondSessions = await loadSessions(cycle.id);
  const plans = await prisma.plan.findMany({
    where: { trainingCycleId: cycle.id },
    orderBy: { versionNumber: 'asc' },
  });

  assert.notEqual(secondPublish.publishedPlanId, firstPublish.publishedPlanId);
  assert.equal(secondSessions.length, 2);
  assert.ok(
    secondSessions.every(
      (session) => session.workout.planWeek.plan.id === secondPublish.publishedPlanId
    )
  );
  assert.equal(
    secondSessions.some(
      (session) => session.workout.planWeek.plan.id === firstPublish.publishedPlanId
    ),
    false,
    'future sessions from the superseded publication must be replaced'
  );
  assert.equal(plans.filter((plan) => plan.status === 'PUBLISHED').length, 1);
  assert.equal(plans.filter((plan) => plan.status === 'SUPERSEDED').length, 1);
  assert.equal(plans.filter((plan) => plan.status === 'DRAFT').length, 0);
  assert.equal(
    plans.find((plan) => plan.status === 'PUBLISHED').id,
    secondPublish.publishedPlanId
  );
});
