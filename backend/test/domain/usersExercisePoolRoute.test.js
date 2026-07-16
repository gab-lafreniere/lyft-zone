const test = require('node:test');
const assert = require('node:assert/strict');

let prisma;

require.cache[require.resolve('../../lib/prisma')] = {
  id: require.resolve('../../lib/prisma'),
  filename: require.resolve('../../lib/prisma'),
  loaded: true,
  exports: {
    getPrisma: () => prisma,
  },
};

const usersRouter = require('../../routes/users');

function findRoute(path, method) {
  return usersRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  );
}

async function invokeExercisePoolRoute(reqOverrides = {}) {
  const route = findRoute('/:userId/exercise-pool', 'get');
  assert.ok(route);

  const req = {
    params: { userId: 'user_123' },
    query: {},
    ...reqOverrides,
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await route.route.stack[0].handle(req, res);
  return res;
}

function createSnapshot(overrides = {}) {
  return {
    schemaVersion: 2,
    profile: {
      primaryGoal: 'HYPERTROPHY',
      musclePriorities: {
        primaryFocus: 'chest',
        secondaryFocuses: [],
        deprioritizedArea: null,
      },
      experience: 'intermediate',
      availability: {
        sessionsPerWeek: 4,
        durationPerSession: 75,
      },
      environment: {
        equipmentPreset: 'full_gym',
        availableEquipment: ['dumbbells', 'bench'],
      },
      movementConstraints: {
        painIssues: [],
        manualBlockedExerciseIds: ['ex_blocked'],
      },
      exercisePreference: {
        equipmentBias: 'no_preference',
      },
      cardioProfile: {
        cardioRole: 'none',
        preferredModalities: [],
      },
      physicalNotes: null,
      ...overrides,
    },
  };
}

test('GET /api/users/:userId/exercise-pool returns eligible searched page and counts', async () => {
  prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: createSnapshot(),
      }),
    },
    exercise: {
      findMany: async () => [
        {
          exerciseId: 'ex_bench_1',
          name: 'Dumbbell Bench Press',
          aliases: ['DB Bench'],
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'beginner',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells', 'bench'],
          movementPattern: 'horizontal_push',
          jointStressTags: [],
          bodyParts: ['chest'],
          muscleFocus: ['upper_chest'],
          targetMuscles: ['pectoralis_major'],
          secondaryMuscles: ['triceps'],
          overview: 'Press',
        },
        {
          exerciseId: 'ex_row_1',
          name: 'Dumbbell Row',
          aliases: [],
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'intermediate',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells'],
          movementPattern: 'horizontal_pull',
          jointStressTags: [],
          bodyParts: ['back'],
          muscleFocus: ['lats'],
          targetMuscles: ['latissimus_dorsi'],
          secondaryMuscles: ['biceps'],
          overview: 'Row',
        },
        {
          exerciseId: 'ex_advanced',
          name: 'Advanced Press',
          aliases: [],
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'advanced',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells'],
          movementPattern: 'horizontal_push',
          jointStressTags: [],
          bodyParts: ['chest'],
          muscleFocus: ['upper_chest'],
          targetMuscles: ['pectoralis_major'],
          secondaryMuscles: ['triceps'],
          overview: 'Advanced',
        },
        {
          exerciseId: 'ex_blocked',
          name: 'Blocked Press',
          aliases: [],
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'beginner',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells'],
          movementPattern: 'horizontal_push',
          jointStressTags: [],
          bodyParts: ['chest'],
          muscleFocus: ['upper_chest'],
          targetMuscles: ['pectoralis_major'],
          secondaryMuscles: ['triceps'],
          overview: 'Blocked',
        },
      ],
    },
  };

  const res = await invokeExercisePoolRoute({
    query: {
      q: 'press',
      bodyParts: 'chest',
      muscleFocus: 'upper_chest',
      limit: '1',
      cursor: '0',
      includeExcluded: 'true',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.items.map((item) => item.exerciseId),
    ['ex_bench_1']
  );
  assert.equal(res.body.nextCursor, null);
  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.poolSummary, {
    totalExercises: 4,
    availableExercises: 2,
    excludedExercises: 2,
  });
  assert.deepEqual(res.body.hardConstraints.allowedDifficulties, [
    'beginner',
    'intermediate',
  ]);
  assert.equal(res.body.excludedByReason.difficulty_not_allowed, 1);
  assert.equal(res.body.excludedByReason.blocked_exercise_id, 1);
});

test('GET /api/users/:userId/exercise-pool maps missing profile to 409', async () => {
  prisma = {
    userProfile: {
      findUnique: async () => null,
    },
    exercise: {
      findMany: async () => [],
    },
  };

  const res = await invokeExercisePoolRoute();

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'PROFILE_NOT_READY');
});
