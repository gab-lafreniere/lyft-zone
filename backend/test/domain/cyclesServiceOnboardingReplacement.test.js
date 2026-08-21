const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../services/cyclesService');

test('buildOnboardingCycleWindow uses the first Monday on or after local today and six weeks', () => {
  assert.deepEqual(
    _test.buildOnboardingCycleWindow(
      'America/Toronto',
      new Date('2026-08-16T14:00:00.000Z')
    ),
    {
      timezone: 'America/Toronto',
      startDate: '2026-08-17',
      endDate: '2026-09-27',
      durationWeeks: 6,
    }
  );
});

test('conflict snapshots require the same ids, dates, and updated timestamps', () => {
  const confirmed = [
    {
      cycleId: 'cycle_1',
      startDate: '2026-08-17',
      endDate: '2026-09-27',
      updatedAt: '2026-08-10T12:00:00.000Z',
    },
  ];

  assert.equal(_test.conflictSnapshotsMatch(confirmed, [...confirmed]), true);
  assert.equal(
    _test.conflictSnapshotsMatch(confirmed, [
      { ...confirmed[0], updatedAt: '2026-08-10T12:01:00.000Z' },
    ]),
    false
  );
});

test('overlap detection is inclusive and ignores archived cycles', () => {
  const cycles = [
    {
      id: 'touching',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-08-17T00:00:00.000Z'),
      status: 'PLANNED',
    },
    {
      id: 'archived',
      startDate: new Date('2026-08-17T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      status: 'ARCHIVED',
    },
  ];

  assert.deepEqual(
    _test.findOverlappingCycles(cycles, '2026-08-17', '2026-09-27').map((cycle) => cycle.id),
    ['touching']
  );
});

test('default workout assignment maps source order Monday-forward', () => {
  const assignments = _test.resolveWorkoutDayAssignments(
    { workoutDayAssignmentStrategy: 'DEFAULT' },
    { workouts: [{ orderIndex: 3 }, { orderIndex: 1 }, { orderIndex: 2 }] }
  );

  assert.deepEqual([...assignments.entries()], [
    [1, 'MONDAY'],
    [2, 'TUESDAY'],
    [3, 'WEDNESDAY'],
  ]);
});

test('spaced default workout assignment uses the locked defaults for one through seven workouts', () => {
  const expected = {
    1: ['MONDAY'],
    2: ['MONDAY', 'THURSDAY'],
    3: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    4: ['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY'],
    5: ['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    6: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    7: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
  };

  Object.entries(expected).forEach(([count, days]) => {
    const workouts = Array.from({ length: Number(count) }, (_, index) => ({
      orderIndex: index + 1,
    })).reverse();
    const assignments = _test.resolveWorkoutDayAssignments(
      { workoutDayAssignmentStrategy: 'SPACED_DEFAULT' },
      { workouts }
    );
    assert.deepEqual([...assignments.values()], days);
  });
});

test('onboarding replacement honours explicit assignments in workout order', () => {
  const assignments = _test.resolveCycleWorkoutDayAssignments(
    {
      workoutDayAssignmentStrategy: 'DEFAULT',
      workoutDayAssignments: [
        { workoutOrderIndex: 2, scheduledDay: 'FRIDAY' },
        { workoutOrderIndex: 1, scheduledDay: 'TUESDAY' },
      ],
    },
    { workouts: [{ orderIndex: 1 }, { orderIndex: 2 }] },
    true
  );

  assert.deepEqual([...assignments.entries()], [
    [2, 'FRIDAY'],
    [1, 'TUESDAY'],
  ]);
});

test('onboarding replacement falls back to spaced defaults only when assignments are absent', () => {
  const sourceVersion = {
    workouts: [{ orderIndex: 3 }, { orderIndex: 1 }, { orderIndex: 2 }],
  };
  const assignments = _test.resolveCycleWorkoutDayAssignments(
    { workoutDayAssignmentStrategy: 'DEFAULT' },
    sourceVersion,
    true
  );

  assert.deepEqual([...assignments.entries()], [
    [1, 'MONDAY'],
    [2, 'WEDNESDAY'],
    [3, 'FRIDAY'],
  ]);
  assert.throws(
    () => _test.resolveCycleWorkoutDayAssignments(
      { workoutDayAssignments: null },
      sourceVersion,
      true
    ),
    /assigned exactly once/
  );
});

test('explicit workout assignments reject duplicate days and count mismatches', () => {
  const sourceVersion = { workouts: [{ orderIndex: 1 }, { orderIndex: 2 }] };
  assert.throws(
    () => _test.resolveWorkoutDayAssignments(
      {
        workoutDayAssignments: [
          { workoutOrderIndex: 1, scheduledDay: 'MONDAY' },
          { workoutOrderIndex: 2, scheduledDay: 'MONDAY' },
        ],
      },
      sourceVersion
    ),
    /Only one workout/
  );
  assert.throws(
    () => _test.resolveWorkoutDayAssignments(
      {
        workoutDayAssignments: [
          { workoutOrderIndex: 1, scheduledDay: 'MONDAY' },
        ],
      },
      sourceVersion
    ),
    /assigned exactly once/
  );
});

test('archiving conflicts preserves completed history and removes only future planning sessions', async () => {
  const deletedIds = [];
  const archived = [];
  const tx = {
    scheduledSession: {
      findMany: async () => [
        {
          id: 'completed_status',
          status: 'COMPLETED',
          completedAt: null,
          scheduledStartAt: new Date('2026-08-18T16:00:00.000Z'),
        },
        {
          id: 'completed_timestamp',
          status: 'PLANNED',
          completedAt: new Date('2026-08-18T17:00:00.000Z'),
          scheduledStartAt: new Date('2026-08-18T16:00:00.000Z'),
        },
        {
          id: 'past_planning',
          status: 'PLANNED',
          completedAt: null,
          scheduledStartAt: new Date('2026-08-09T16:00:00.000Z'),
        },
        {
          id: 'future_planning',
          status: 'RESCHEDULED',
          completedAt: null,
          scheduledStartAt: new Date('2026-08-18T16:00:00.000Z'),
        },
      ],
      deleteMany: async ({ where }) => {
        deletedIds.push(...where.id.in);
      },
    },
    trainingCycle: {
      update: async (input) => archived.push(input),
    },
  };
  const now = new Date('2026-08-10T14:00:00.000Z');

  const result = await _test.archiveConflictingCycles(
    tx,
    [{ id: 'cycle_1', timezone: 'America/Toronto' }],
    '2026-08-10',
    'America/Toronto',
    now
  );

  assert.deepEqual(deletedIds, ['future_planning']);
  assert.deepEqual(archived, [
    {
      where: { id: 'cycle_1' },
      data: { status: 'ARCHIVED', archivedAt: now },
    },
  ]);
  assert.deepEqual(result, [
    { cycleId: 'cycle_1', removedPlanningSessionCount: 1 },
  ]);
});

test('cycle replacement transactions request serializable isolation', async () => {
  let transactionOptions;
  const prisma = {
    $transaction: async (operation, options) => {
      transactionOptions = options;
      return operation({ marker: 'tx' });
    },
  };

  const result = await _test.runSerializableCycleTransaction(
    prisma,
    async (tx) => tx.marker
  );

  assert.equal(result, 'tx');
  assert.equal(transactionOptions.isolationLevel, 'Serializable');
});
