// Real-Postgres regression coverage for per-Cycle ScheduledSession
// regeneration serialization and its transaction boundaries.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

const START_DATE = '2035-09-03';
const END_DATE = '2035-09-09';
const TIMEZONE = 'UTC';

let pgHandle = null;
let skipReason = null;
let prisma;
let createUser;
let createCycle;
let createPlanForCycle;
let regenerateScheduledSessionsForPublishedCycle;
let synchronizeScheduledSessionsForPublishedCycle;

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping ScheduledSession concurrency tests.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;

  ({ createUser } = require('../../services/usersService'));
  ({ createCycle, createPlanForCycle } = require('../../services/cyclesService'));
  ({
    regenerateScheduledSessionsForPublishedCycle,
    synchronizeScheduledSessionsForPublishedCycle,
  } = require('../../services/scheduledSessionsService'));
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

function buildPlanDocument(name, status = 'PUBLISHED') {
  return {
    name,
    sourceType: 'USER',
    status,
    publishedAt: new Date('2035-08-01T12:00:00.000Z'),
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      label: 'Week 1',
      workouts: [
        buildWorkout(`${name} Monday`, 1, 'MONDAY'),
        buildWorkout(`${name} Wednesday`, 2, 'WEDNESDAY'),
      ],
    }],
  };
}

async function createPublishedCycleFixture(suffix) {
  const user = await createUser({
    email: `scheduled-session-concurrency-${suffix}@example.com`,
  });
  const cycle = await createCycle({
    userId: user.id,
    name: `Concurrent Cycle ${suffix}`,
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: TIMEZONE,
  });
  const plan = await createPlanForCycle(
    cycle.id,
    buildPlanDocument(`Concurrent Cycle ${suffix}`)
  );
  const syncOptions = {
    userId: user.id,
    publishedPlanId: plan.id,
    timezone: TIMEZONE,
    regenerateFromDateKey: START_DATE,
  };
  await regenerateScheduledSessionsForPublishedCycle(cycle.id, syncOptions);
  return { cycle, plan, syncOptions, user };
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
    orderBy: [{ scheduledStartAt: 'asc' }, { workoutId: 'asc' }],
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

function sessionIdentities(sessions) {
  return sessions
    .map((session) => `${session.workoutId}@${session.scheduledStartAt.toISOString()}`)
    .sort();
}

function expectedPlanIdentities(plan) {
  const workouts = plan.weeks[0].workouts;
  return [
    `${workouts[0].id}@2035-09-03T12:00:00.000Z`,
    `${workouts[1].id}@2035-09-05T12:00:00.000Z`,
  ].sort();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function wrapTransactionClient(tx, { onLockAttempt, createMany } = {}) {
  return {
    $queryRaw: (query, ...values) => {
      onLockAttempt?.();
      return tx.$queryRaw(query, ...values);
    },
    trainingCycle: {
      findFirst: (...args) => tx.trainingCycle.findFirst(...args),
    },
    scheduledSession: {
      findMany: (...args) => tx.scheduledSession.findMany(...args),
      deleteMany: (...args) => tx.scheduledSession.deleteMany(...args),
      createMany: createMany || ((...args) => tx.scheduledSession.createMany(...args)),
    },
  };
}

async function lockCycleRow(tx, cycleId) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "training_cycles"
    WHERE "id" = ${cycleId}
    FOR UPDATE
  `;
}

test('two and five concurrent same-Cycle regenerations remain exactly canonical', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createPublishedCycleFixture('same-cycle');
  const expected = expectedPlanIdentities(fixture.plan);

  await regenerateScheduledSessionsForPublishedCycle(
    fixture.cycle.id,
    fixture.syncOptions
  );
  assert.deepEqual(sessionIdentities(await loadSessions(fixture.cycle.id)), expected);

  await Promise.all(
    Array.from({ length: 2 }, () =>
      regenerateScheduledSessionsForPublishedCycle(fixture.cycle.id, fixture.syncOptions)
    )
  );
  assert.deepEqual(sessionIdentities(await loadSessions(fixture.cycle.id)), expected);

  await Promise.all(
    Array.from({ length: 5 }, () =>
      regenerateScheduledSessionsForPublishedCycle(fixture.cycle.id, fixture.syncOptions)
    )
  );
  assert.deepEqual(sessionIdentities(await loadSessions(fixture.cycle.id)), expected);
});

test('different Cycles regenerate concurrently into independent canonical sets', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const [first, second] = await Promise.all([
    createPublishedCycleFixture('cycle-one'),
    createPublishedCycleFixture('cycle-two'),
  ]);
  const firstCycleLocked = createDeferred();
  const releaseFirstCycle = createDeferred();
  const firstLockAttempted = createDeferred();
  const lockHolder = prisma.$transaction(async (tx) => {
    await lockCycleRow(tx, first.cycle.id);
    firstCycleLocked.resolve();
    await releaseFirstCycle.promise;
  });

  await firstCycleLocked.promise;
  const waitingFirstRegeneration = prisma.$transaction((tx) =>
    synchronizeScheduledSessionsForPublishedCycle(
      wrapTransactionClient(tx, {
        onLockAttempt: () => firstLockAttempted.resolve(),
      }),
      first.cycle.id,
      first.syncOptions
    )
  );
  const independentSecondRegeneration = regenerateScheduledSessionsForPublishedCycle(
    second.cycle.id,
    second.syncOptions
  );

  try {
    await firstLockAttempted.promise;
    await independentSecondRegeneration;
  } finally {
    releaseFirstCycle.resolve();
    await lockHolder;
    await waitingFirstRegeneration;
  }

  assert.deepEqual(
    sessionIdentities(await loadSessions(first.cycle.id)),
    expectedPlanIdentities(first.plan)
  );
  assert.deepEqual(
    sessionIdentities(await loadSessions(second.cycle.id)),
    expectedPlanIdentities(second.plan)
  );
});

test('a waiting stale publication is revalidated after the Cycle lock', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createPublishedCycleFixture('stale-publication');
  const replacementPlan = await createPlanForCycle(
    fixture.cycle.id,
    buildPlanDocument('Replacement publication', 'SUPERSEDED')
  );
  const replacementOptions = {
    ...fixture.syncOptions,
    publishedPlanId: replacementPlan.id,
  };
  const replacementReady = createDeferred();
  const releaseReplacement = createDeferred();

  const replacementTransaction = prisma.$transaction(async (tx) => {
    await lockCycleRow(tx, fixture.cycle.id);
    await tx.plan.update({
      where: { id: fixture.plan.id },
      data: { status: 'SUPERSEDED' },
    });
    await tx.plan.update({
      where: { id: replacementPlan.id },
      data: { status: 'PUBLISHED' },
    });
    await synchronizeScheduledSessionsForPublishedCycle(
      tx,
      fixture.cycle.id,
      replacementOptions
    );
    replacementReady.resolve();
    await releaseReplacement.promise;
  });

  await replacementReady.promise;
  const staleLockAttempted = createDeferred();
  const staleRequest = prisma.$transaction((tx) =>
    synchronizeScheduledSessionsForPublishedCycle(
      wrapTransactionClient(tx, {
        onLockAttempt: () => staleLockAttempted.resolve(),
      }),
      fixture.cycle.id,
      fixture.syncOptions
    )
  );
  const staleRejection = assert.rejects(
    staleRequest,
    (error) => error.status === 409 && error.code === 'PUBLISHED_PLAN_NOT_CURRENT'
  );

  await staleLockAttempted.promise;
  releaseReplacement.resolve();
  await replacementTransaction;
  await staleRejection;

  const finalSessions = await loadSessions(fixture.cycle.id);
  assert.deepEqual(sessionIdentities(finalSessions), expectedPlanIdentities(replacementPlan));
  assert.ok(
    finalSessions.every(
      (session) => session.workout.planWeek.plan.id === replacementPlan.id
    )
  );
});

test('a create failure rolls deletion back and preserves the prior canonical schedule', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createPublishedCycleFixture('rollback');
  const before = await loadSessions(fixture.cycle.id);

  await assert.rejects(
    () => prisma.$transaction((tx) =>
      synchronizeScheduledSessionsForPublishedCycle(
        wrapTransactionClient(tx, {
          createMany: async () => {
            throw new Error('injected ScheduledSession creation failure');
          },
        }),
        fixture.cycle.id,
        fixture.syncOptions
      )
    ),
    /injected ScheduledSession creation failure/
  );

  const afterFailure = await loadSessions(fixture.cycle.id);
  assert.deepEqual(
    afterFailure.map((session) => session.id).sort(),
    before.map((session) => session.id).sort()
  );
  assert.deepEqual(sessionIdentities(afterFailure), sessionIdentities(before));
});

test('concurrent regeneration preserves sessions before the canonical cutoff', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createPublishedCycleFixture('history');
  const history = await prisma.scheduledSession.create({
    data: {
      workoutId: fixture.plan.weeks[0].workouts[0].id,
      status: 'COMPLETED',
      scheduledStartAt: new Date('2035-09-02T12:00:00.000Z'),
      completedAt: new Date('2035-09-02T13:00:00.000Z'),
      notes: 'historical session must survive regeneration',
    },
  });

  await Promise.all(
    Array.from({ length: 5 }, () =>
      regenerateScheduledSessionsForPublishedCycle(fixture.cycle.id, fixture.syncOptions)
    )
  );

  const finalSessions = await loadSessions(fixture.cycle.id);
  const preservedHistory = finalSessions.find((session) => session.id === history.id);
  const futureSessions = finalSessions.filter((session) => session.id !== history.id);
  assert.equal(preservedHistory.status, 'COMPLETED');
  assert.equal(preservedHistory.completedAt.toISOString(), '2035-09-02T13:00:00.000Z');
  assert.equal(preservedHistory.notes, 'historical session must survive regeneration');
  assert.deepEqual(sessionIdentities(futureSessions), expectedPlanIdentities(fixture.plan));
});
