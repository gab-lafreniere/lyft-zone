const test = require('node:test');
const assert = require('node:assert/strict');

const {
  synchronizeScheduledSessionsForPublishedCycle,
} = require('../../services/scheduledSessionsService');

const CYCLE_ID = 'cycle_schedule_sync';
const USER_ID = 'user_schedule_sync';
const PUBLISHED_PLAN_ID = 'plan_published_exact';

function buildCycle(workouts) {
  return {
    id: CYCLE_ID,
    userId: USER_ID,
    startDate: new Date('2035-09-03T00:00:00.000Z'),
    endDate: new Date('2035-09-09T00:00:00.000Z'),
    timezone: 'UTC',
    plans: [{
      id: PUBLISHED_PLAN_ID,
      versionNumber: 4,
      weeks: [{
        id: 'week_published_exact',
        weekNumber: 1,
        orderIndex: 1,
        workouts,
      }],
    }],
  };
}

function createDb({ workouts, existingSessions = [] }) {
  const calls = [];
  const cycle = buildCycle(workouts);
  const db = {
    $queryRaw: async (query, ...values) => {
      calls.push({ model: 'trainingCycle', op: 'lock', query, values });
      return [{ id: CYCLE_ID }];
    },
    trainingCycle: {
      findFirst: async (query) => {
        calls.push({ model: 'trainingCycle', op: 'findFirst', query });
        return cycle;
      },
    },
    scheduledSession: {
      findMany: async (query) => {
        calls.push({ model: 'scheduledSession', op: 'findMany', query });
        return existingSessions;
      },
      deleteMany: async (query) => {
        calls.push({ model: 'scheduledSession', op: 'deleteMany', query });
        return { count: query.where.id.in.length };
      },
      createMany: async ({ data }) => {
        calls.push({ model: 'scheduledSession', op: 'createMany', data });
        return { count: data.length };
      },
    },
  };
  return { db, calls, cycle };
}

test('canonical publish sync pins the exact published Plan and uses only its Workout IDs', async () => {
  const workouts = [
    {
      id: 'workout_published_monday',
      name: 'Monday',
      orderIndex: 1,
      scheduledDay: 'MONDAY',
    },
    {
      id: 'workout_published_wednesday',
      name: 'Wednesday',
      orderIndex: 2,
      scheduledDay: 'WEDNESDAY',
    },
  ];
  const { db, calls } = createDb({
    workouts,
    existingSessions: [
      {
        id: 'past_session_kept',
        scheduledStartAt: new Date('2035-09-02T12:00:00.000Z'),
      },
      {
        id: 'future_session_replaced',
        scheduledStartAt: new Date('2035-09-04T12:00:00.000Z'),
      },
    ],
  });

  const result = await synchronizeScheduledSessionsForPublishedCycle(db, CYCLE_ID, {
    userId: USER_ID,
    publishedPlanId: PUBLISHED_PLAN_ID,
    timezone: 'UTC',
    regenerateFromDateKey: '2035-09-03',
  });

  const cycleRead = calls.find(
    (call) => call.model === 'trainingCycle' && call.op === 'findFirst'
  );
  const cycleLockIndex = calls.findIndex(
    (call) => call.model === 'trainingCycle' && call.op === 'lock'
  );
  const cycleReadIndex = calls.findIndex(
    (call) => call.model === 'trainingCycle' && call.op === 'findFirst'
  );
  const cycleLock = calls[cycleLockIndex];
  assert.ok(cycleLockIndex >= 0);
  assert.ok(cycleLockIndex < cycleReadIndex);
  assert.equal(cycleLock.values[0], CYCLE_ID);
  assert.match(cycleLock.query.join(''), /training_cycles[\s\S]*FOR UPDATE/);
  assert.deepEqual(cycleRead.query.where, {
    id: CYCLE_ID,
    userId: USER_ID,
    status: { not: 'ARCHIVED' },
  });
  assert.deepEqual(cycleRead.query.select.plans.where, {
    status: 'PUBLISHED',
    id: PUBLISHED_PLAN_ID,
  });

  const deletion = calls.find(
    (call) => call.model === 'scheduledSession' && call.op === 'deleteMany'
  );
  assert.deepEqual(deletion.query.where.id.in, ['future_session_replaced']);

  const insertion = calls.find(
    (call) => call.model === 'scheduledSession' && call.op === 'createMany'
  );
  assert.deepEqual(
    insertion.data.map((session) => session.workoutId),
    ['workout_published_monday', 'workout_published_wednesday']
  );
  assert.deepEqual(
    insertion.data.map((session) => session.scheduledStartAt.toISOString()),
    ['2035-09-03T12:00:00.000Z', '2035-09-05T12:00:00.000Z']
  );
  assert.equal(result.publishedPlanId, PUBLISHED_PLAN_ID);
  assert.equal(result.deletedCount, 1);
  assert.equal(result.createdCount, 2);
});

test('an empty published Plan clears replaceable sessions and creates none', async () => {
  const { db, calls } = createDb({
    workouts: [],
    existingSessions: [{
      id: 'future_session_for_old_content',
      scheduledStartAt: new Date('2035-09-04T12:00:00.000Z'),
    }],
  });

  const result = await synchronizeScheduledSessionsForPublishedCycle(db, CYCLE_ID, {
    userId: USER_ID,
    publishedPlanId: PUBLISHED_PLAN_ID,
    timezone: 'UTC',
    regenerateFromDateKey: '2035-09-03',
  });

  assert.equal(result.createdCount, 0);
  assert.equal(result.deletedCount, 1);
  assert.equal(
    calls.some((call) => call.model === 'scheduledSession' && call.op === 'createMany'),
    false
  );
});

test('an unavailable requested publication fails before replacing any sessions', async () => {
  const { db, calls, cycle } = createDb({ workouts: [] });
  cycle.plans = [];

  await assert.rejects(
    () => synchronizeScheduledSessionsForPublishedCycle(db, CYCLE_ID, {
      userId: USER_ID,
      publishedPlanId: 'plan_not_current',
      timezone: 'UTC',
      regenerateFromDateKey: '2035-09-03',
    }),
    (error) => error.status === 409 && error.code === 'PUBLISHED_PLAN_NOT_CURRENT'
  );
  assert.equal(
    calls.some((call) => call.model === 'scheduledSession'),
    false
  );
});
