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

const {
  deleteCycle,
  getProgramsOverview,
} = require('../../services/cyclesService');
const { listScheduledSessions } = require('../../services/scheduledSessionsService');

const USER_ID = 'user_delete_safety';
const CYCLE_ID = 'cycle_delete_safety';

function createSession(id, status, completedAt = null) {
  return {
    id,
    status,
    completedAt,
    scheduledStartAt: new Date('2026-08-24T16:00:00.000Z'),
    scheduledEndAt: null,
    workout: {
      id: `workout_${id}`,
      name: `Workout ${id}`,
      scheduledDay: 'MONDAY',
      planWeek: {
        id: 'week_1',
        weekNumber: 1,
        plan: {
          id: 'plan_1',
          versionNumber: 1,
          trainingCycleId: CYCLE_ID,
        },
      },
    },
  };
}

function createHarness(sessions) {
  const graph = {
    id: 'plan_1',
    status: 'PUBLISHED',
    weeks: [
      {
        id: 'week_1',
        workouts: sessions.map((session) => session.workout),
      },
    ],
  };
  const state = {
    cycle: {
      id: CYCLE_ID,
      userId: USER_ID,
      name: 'Delete safety cycle',
      startDate: new Date('2026-08-17T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      durationWeeks: 6,
      timezone: 'America/Toronto',
      status: 'PLANNED',
      archivedAt: null,
      plans: [graph],
    },
    sessions: [...sessions],
    graph,
    calls: {
      cycleDelete: 0,
      cycleUpdate: 0,
      overviewWhere: null,
    },
  };

  const scheduledSession = {
    findMany: async () => [...state.sessions],
    deleteMany: async ({ where }) => {
      if (where?.id?.in) {
        const deletedIds = new Set(where.id.in);
        state.sessions = state.sessions.filter((session) => !deletedIds.has(session.id));
      } else {
        state.sessions = [];
      }
    },
  };
  const trainingCycle = {
    findFirst: async () => state.cycle,
    findUnique: async () => state.cycle,
    findMany: async ({ where }) => {
      state.calls.overviewWhere = where;
      if (!state.cycle || state.cycle.status === 'ARCHIVED') {
        return [];
      }
      return [state.cycle];
    },
    update: async ({ data }) => {
      state.calls.cycleUpdate += 1;
      state.cycle = { ...state.cycle, ...data };
      return state.cycle;
    },
    delete: async () => {
      state.calls.cycleDelete += 1;
      state.cycle = null;
      state.graph = null;
    },
  };
  const tx = { scheduledSession, trainingCycle };

  prisma = {
    user: {
      findUnique: async () => ({
        id: USER_ID,
        profile: { trainingMode: 'FIXED' },
      }),
    },
    scheduledSession,
    trainingCycle,
    $transaction: async (operation) => operation(tx),
  };

  return state;
}

test('deleting a cycle with only planned sessions hard-deletes it', async () => {
  const state = createHarness([
    createSession('planned_1', 'PLANNED'),
    createSession('planned_2', 'RESCHEDULED'),
  ]);

  const response = await deleteCycle(CYCLE_ID, { userId: USER_ID });

  assert.deepEqual(response, {
    deleted: true,
    archived: false,
    cycleId: CYCLE_ID,
  });
  assert.equal(state.calls.cycleDelete, 1);
  assert.equal(state.calls.cycleUpdate, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.cycle, null);
});

test('a COMPLETED session archives the cycle, preserves graph/history, and removes planning', async () => {
  const completed = createSession('completed_1', 'COMPLETED');
  const state = createHarness([
    completed,
    createSession('future_planned', 'PLANNED'),
    createSession('future_rescheduled', 'RESCHEDULED'),
  ]);
  const originalGraph = state.graph;

  const response = await deleteCycle(CYCLE_ID, { userId: USER_ID });

  assert.deepEqual(response, {
    deleted: false,
    archived: true,
    cycleId: CYCLE_ID,
  });
  assert.equal(state.calls.cycleDelete, 0);
  assert.equal(state.calls.cycleUpdate, 1);
  assert.equal(state.cycle.status, 'ARCHIVED');
  assert.ok(state.cycle.archivedAt instanceof Date);
  assert.equal(state.graph, originalGraph);
  assert.deepEqual(state.sessions.map((session) => session.id), ['completed_1']);

  const queryResult = await listScheduledSessions({ cycleId: CYCLE_ID });
  assert.deepEqual(queryResult.map((session) => session.id), ['completed_1']);
});

test('completedAt protects inconsistent execution status from hard deletion', async () => {
  const completedAt = new Date('2026-08-24T17:00:00.000Z');
  const state = createHarness([
    createSession('inconsistent_completion', 'PLANNED', completedAt),
    createSession('future_planned', 'PLANNED'),
  ]);

  const response = await deleteCycle(CYCLE_ID, { userId: USER_ID });

  assert.equal(response.archived, true);
  assert.equal(state.calls.cycleDelete, 0);
  assert.deepEqual(state.sessions.map((session) => session.id), ['inconsistent_completion']);
  assert.equal(state.sessions[0].completedAt, completedAt);
});

test('archived cycles no longer appear in active or upcoming planning', async () => {
  const state = createHarness([createSession('completed_1', 'COMPLETED')]);
  await deleteCycle(CYCLE_ID, { userId: USER_ID });

  const overview = await getProgramsOverview(USER_ID, 'America/Toronto');

  assert.deepEqual(state.calls.overviewWhere, {
    userId: USER_ID,
    status: { not: 'ARCHIVED' },
  });
  assert.equal(overview.currentProgram, null);
  assert.deepEqual(overview.upcomingPrograms, []);
  assert.deepEqual(overview.pastPrograms, []);
});
