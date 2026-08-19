const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOnboardingCycleConflicts,
} = require('../../services/cyclesService');

function storedCycle({
  id = 'cycle_existing',
  userId = 'user_1',
  status = 'PLANNED',
  startDate = '2026-08-24',
  endDate = '2026-10-04',
} = {}) {
  return {
    id,
    userId,
    name: 'Existing Cycle',
    status,
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    timezone: 'America/Toronto',
    updatedAt: new Date('2026-08-10T12:00:00.000Z'),
  };
}

function createPrisma(cycles = []) {
  const calls = [];
  return {
    calls,
    user: {
      findUnique: async () => ({ id: 'user_1', profile: null }),
    },
    trainingCycle: {
      findMany: async (query) => {
        calls.push(query);
        return cycles;
      },
    },
  };
}

test('six-week candidate availability blocks every overlapping Monday and allows Oct 5', async () => {
  const prisma = createPrisma([storedCycle()]);
  const starts = [
    '2026-08-24',
    '2026-08-31',
    '2026-09-07',
    '2026-09-14',
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
  ];

  const result = await getOnboardingCycleConflicts(
    'user_1',
    'America/Toronto',
    {
      prisma,
      candidateStartDates: starts.join(','),
      durationWeeks: '6',
    }
  );

  assert.deepEqual(
    result.candidates.map(({ startDate, hasConflict }) => ({ startDate, hasConflict })),
    starts.map((startDate, index) => ({ startDate, hasConflict: index < 6 }))
  );
  assert.equal(result.candidates.at(-1).endDate, '2026-11-15');
  assert.equal(prisma.calls.length, 1);
});

test('candidate query is user-scoped and excludes archived cycles at the database boundary', async () => {
  const prisma = createPrisma([]);

  await getOnboardingCycleConflicts('user_1', 'America/Toronto', {
    prisma,
    candidateStartDates: '2026-10-05',
    durationWeeks: 6,
  });

  assert.equal(prisma.calls[0].where.userId, 'user_1');
  assert.deepEqual(prisma.calls[0].where.status, { not: 'ARCHIVED' });
  assert.deepEqual(prisma.calls[0].where.startDate, {
    lte: new Date('2026-11-15T00:00:00.000Z'),
  });
  assert.deepEqual(prisma.calls[0].where.endDate, {
    gte: new Date('2026-10-05T00:00:00.000Z'),
  });
});

test('availability uses the full duration-dependent candidate window', async () => {
  const existing = storedCycle({
    startDate: '2026-10-12',
    endDate: '2026-10-18',
  });
  const shortResult = await getOnboardingCycleConflicts(
    'user_1',
    'America/Toronto',
    {
      prisma: createPrisma([existing]),
      candidateStartDates: '2026-09-28',
      durationWeeks: 2,
    }
  );
  const longResult = await getOnboardingCycleConflicts(
    'user_1',
    'America/Toronto',
    {
      prisma: createPrisma([existing]),
      candidateStartDates: '2026-09-28',
      durationWeeks: 3,
    }
  );

  assert.deepEqual(shortResult.candidates[0], {
    startDate: '2026-09-28',
    endDate: '2026-10-11',
    hasConflict: false,
    conflicts: [],
  });
  assert.equal(longResult.candidates[0].endDate, '2026-10-18');
  assert.equal(longResult.candidates[0].hasConflict, true);
});

test('candidate date keys remain canonical across timezone boundaries', async () => {
  const result = await getOnboardingCycleConflicts(
    'user_1',
    'Pacific/Honolulu',
    {
      prisma: createPrisma([]),
      candidateStartDates: '2026-11-02',
      durationWeeks: 1,
    }
  );

  assert.equal(result.timezone, 'Pacific/Honolulu');
  assert.deepEqual(result.candidates[0], {
    startDate: '2026-11-02',
    endDate: '2026-11-08',
    hasConflict: false,
    conflicts: [],
  });
});

test('existing onboarding conflict response remains unchanged when candidate params are absent', async () => {
  const result = await getOnboardingCycleConflicts(
    'user_1',
    'America/Toronto',
    {
      prisma: createPrisma([]),
      now: new Date('2026-08-16T14:00:00.000Z'),
    }
  );

  assert.deepEqual(result, {
    window: {
      timezone: 'America/Toronto',
      startDate: '2026-08-17',
      endDate: '2026-09-27',
      durationWeeks: 6,
    },
    conflicts: [],
  });
});
