const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXERCISE_POOL_ORDER_BY,
  EXERCISE_POOL_SELECT,
  ExercisePoolServiceError,
  buildExercisePoolForUser,
} = require('../../services/exercisePoolService');

function createProfile(overrides = {}) {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: 'chest',
      secondaryFocuses: ['back'],
      deprioritizedArea: 'quadriceps',
    },
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 75,
    },
    environment: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'treadmill'],
    },
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation',
          affectedArea: 'shoulder',
          painSeverity: 'moderate',
          trainingRule: 'modify',
          analysisStatus: 'analyzed',
          detectedSignals: [{ type: 'movementPattern', value: 'vertical_push' }],
          confirmedSignals: [
            { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
          ],
        },
      ],
      manualBlockedExerciseIds: [],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
    cardioProfile: {
      cardioRole: 'finisher',
      preferredModalities: ['treadmill_walk'],
    },
    physicalNotes: null,
    ...overrides,
  };
}

test('buildExercisePoolForUser builds a pool from onboardingSnapshot and reconstructs derived context when needed', async () => {
  const calls = {
    profileQuery: null,
    exerciseQuery: null,
  };
  const prisma = {
    userProfile: {
      findUnique: async (args) => {
        calls.profileQuery = args;
        return {
          onboardingSnapshot: {
            schemaVersion: 2,
            profile: createProfile(),
          },
        };
      },
    },
    exercise: {
      findMany: async (args) => {
        calls.exerciseQuery = args;
        return [
          {
            exerciseId: 'ex_draft_strength',
            name: 'Draft Incline Press',
            status: 'draft',
            trainingType: 'strength',
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells'],
            movementPattern: 'incline_push',
            bodyParts: ['chest'],
            muscleFocus: ['upper_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps_long_head'],
            overview: 'draft example',
          },
        ];
      },
    },
  };

  const result = await buildExercisePoolForUser(
    'user_123',
    {
      allowDraftFallback: true,
    },
    {
      prisma,
      now: new Date('2026-05-12T10:00:00.000Z'),
    }
  );

  assert.deepEqual(calls.profileQuery, {
    where: { userId: 'user_123' },
    select: { onboardingSnapshot: true },
  });
  assert.deepEqual(calls.exerciseQuery, {
    select: EXERCISE_POOL_SELECT,
    orderBy: EXERCISE_POOL_ORDER_BY,
  });
  assert.equal(result.meta.generatedAt, '2026-05-12T10:00:00.000Z');
  assert.equal(result.meta.statusPolicy.allowDraftFallback, true);
  assert.equal(result.meta.statusPolicy.draftFallbackApplied, true);
  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), ['ex_draft_strength']);
  assert.equal(result.context.musclePriorityProfile.primaryFocus, 'chest');
  assert.equal(result.context.equipmentContext.equipmentBias, 'machines');
  assert.deepEqual(result.context.equipmentContext.availableEquipment, [
    'dumbbells',
    'treadmill',
  ]);
  assert.deepEqual(result.context.movementConstraints.blockedMovementPatterns, []);
  assert.deepEqual(result.context.movementConstraints.cautionMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.context.movementConstraints.blockedJointStressTags, []);
  assert.deepEqual(result.context.movementConstraints.cautionJointStressTags, []);
  assert.deepEqual(result.context.movementConstraints.blockedExerciseIds, []);
});

test('buildExercisePoolForUser rebuilds equipment context instead of trusting stale derived snapshots', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 2,
          profile: createProfile({
            environment: {
              equipmentSetup: 'limited_gym',
              equipmentList: ['selectorized_shoulder_press'],
            },
          }),
          derived: {
            equipmentContext: {
              equipmentSetup: 'limited_gym',
              equipmentList: ['selectorized_shoulder_press'],
              availableEquipment: [],
            },
          },
        },
      }),
    },
    exercise: {
      findMany: async () => [
        {
          exerciseId: 'ex_machine_shoulder_press',
          name: 'Machine Shoulder Press',
          status: 'approved',
          trainingType: 'strength',
          equipmentCategory: 'selectorized_machine',
          equipmentNeeded: ['selectorized_shoulder_press'],
          movementPattern: 'vertical_push',
          jointStressTags: [],
          bodyParts: ['shoulders'],
          muscleFocus: ['front_delts'],
          targetMuscles: ['front_delts'],
          secondaryMuscles: [],
          overview: 'legacy equipment alias example',
        },
      ],
    },
  };

  const result = await buildExercisePoolForUser('user_123', {}, { prisma });

  assert.deepEqual(result.context.equipmentContext.availableEquipment, [
    'shoulder_press_machine',
  ]);
  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), [
    'ex_machine_shoulder_press',
  ]);
});

test('buildExercisePoolForUser preserves legacy blockedPatterns fallback from derived snapshots', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 2,
          profile: createProfile(),
          derived: {
            movementConstraints: {
              affectedArea: 'shoulders',
              painSeverity: 'moderate',
              trainingRule: 'modify',
              blockedPatterns: ['vertical_push'],
            },
          },
        },
      }),
    },
    exercise: {
      findMany: async () => [
        {
          exerciseId: 'ex_overhead_press',
          name: 'Overhead Press',
          status: 'approved',
          trainingType: 'strength',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells'],
          movementPattern: 'vertical_push',
          jointStressTags: [],
          bodyParts: ['shoulders'],
          muscleFocus: ['front_delts'],
          targetMuscles: ['front_delts'],
          secondaryMuscles: [],
          overview: 'legacy fallback example',
        },
      ],
    },
  };

  const result = await buildExercisePoolForUser('user_123', {}, { prisma });

  assert.deepEqual(result.pool.items, []);
  assert.deepEqual(result.pool.excluded[0].reasons, ['blocked_movement_pattern']);
  assert.deepEqual(result.context.movementConstraints.blockedMovementPatterns, ['vertical_push']);
});

test('buildExercisePoolForUser throws PROFILE_NOT_READY when onboardingSnapshot is missing', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({ onboardingSnapshot: null }),
    },
    exercise: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => buildExercisePoolForUser('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'PROFILE_NOT_READY');
      return true;
    }
  );
});

test('buildExercisePoolForUser throws UNSUPPORTED_PROFILE_SCHEMA_VERSION for unknown profile versions', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 99,
          profile: createProfile(),
        },
      }),
    },
    exercise: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => buildExercisePoolForUser('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'UNSUPPORTED_PROFILE_SCHEMA_VERSION');
      return true;
    }
  );
});
