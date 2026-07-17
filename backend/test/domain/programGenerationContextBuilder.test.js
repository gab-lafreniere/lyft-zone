const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ExercisePoolServiceError,
} = require('../../services/exercisePoolService');
const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
  attachCoachInputsToProgramGenerationContext,
  buildProgramGenerationContext,
} = require('../../src/domain/programGeneration/programGenerationContextBuilder');

function createProfile(overrides = {}) {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: 'chest',
      secondaryFocuses: ['back'],
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
      manualBlockedExerciseIds: [],
    },
    exercisePreference: {
      equipmentBias: 'no_preference',
    },
    cardioProfile: {
      cardioRole: 'none',
      preferredModalities: [],
    },
    physicalNotes: 'Keep setup changes simple.',
    ...overrides,
  };
}

function createEligibleExercise(overrides = {}) {
  return {
    exerciseId: 'ex_db_bench',
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
    mechanicType: 'compound',
    unilateralType: 'bilateral',
    isSupersetFriendly: true,
    fatigueScore: 3,
    overview: 'Press',
    ...overrides,
  };
}

test('buildProgramGenerationContext throws VALIDATION_ERROR without calling Prisma when userId is missing', async () => {
  let prismaCalled = false;
  const prisma = {
    userProfile: {
      findUnique: async () => {
        prismaCalled = true;
      },
    },
  };

  await assert.rejects(
    () => buildProgramGenerationContext(undefined, {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.message, 'userId is required');
      return true;
    }
  );

  assert.equal(prismaCalled, false);
});

test('buildProgramGenerationContext throws PROFILE_NOT_READY when profile snapshot is missing', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => null,
    },
    exercise: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => buildProgramGenerationContext('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'PROFILE_NOT_READY');
      return true;
    }
  );
});

test('buildProgramGenerationContext throws UNSUPPORTED_PROFILE_SCHEMA_VERSION for unsupported snapshots', async () => {
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
    () => buildProgramGenerationContext('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'UNSUPPORTED_PROFILE_SCHEMA_VERSION');
      return true;
    }
  );
});

test('buildProgramGenerationContext builds profile context, compact pool items, and pool snapshot', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 2,
          profile: createProfile(),
        },
      }),
    },
    exercise: {
      findMany: async () => [
        createEligibleExercise({
          jointStressTags: ['shoulder_load', 'elbow_load', 'shoulder_load', ' '],
        }),
        createEligibleExercise({
          exerciseId: 'ex_advanced_press',
          name: 'Advanced Press',
          difficulty: 'advanced',
        }),
      ],
    },
  };

  const context = await buildProgramGenerationContext(
    'user_123',
    {},
    {
      prisma,
      now: new Date('2026-06-01T12:00:00.000Z'),
    }
  );

  assert.equal(PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION, 3);
  assert.equal(context.schemaVersion, 3);
  assert.equal(context.generationMode, 'weekly_plan_draft');
  assert.equal(context.coachInputs, null);
  assert.equal(context.userId, 'user_123');
  assert.equal(context.createdAt, '2026-06-01T12:00:00.000Z');
  assert.equal(context.profileSchemaVersion, 2);
  assert.deepEqual(context.availability, {
    sessionsPerWeek: 4,
    durationPerSession: 75,
  });
  assert.equal(context.primaryGoal, 'HYPERTROPHY');
  assert.equal(context.experience, 'intermediate');
  assert.equal(context.physicalNotes, 'Keep setup changes simple.');
  assert.deepEqual(context.poolSnapshot.allowedExerciseIds, ['ex_db_bench']);
  assert.equal(context.poolSummary.availableExercises, 1);
  assert.equal(context.poolSummary.excludedExercises, 1);
  assert.deepEqual(
    context.exercisePoolItems.map((item) => item.exerciseId),
    ['ex_db_bench']
  );
  assert.equal(context.exercisePoolItems[0].name, 'Dumbbell Bench Press');
  assert.equal(context.exercisePoolItems[0].movementPattern, 'horizontal_push');
  assert.deepEqual(context.exercisePoolItems[0].jointStressTags, [
    'elbow_load',
    'shoulder_load',
  ]);
  assert.equal(context.exercisePoolItems[0].softSignals.equipmentBias.value, 'no_preference');
});

test('attachCoachInputsToProgramGenerationContext adds compact metadata without doctrine content', () => {
  const baseContext = {
    schemaVersion: 3,
    generationMode: 'weekly_plan_draft',
    primaryGoal: 'HYPERTROPHY',
    coachInputs: null,
  };
  const context = attachCoachInputsToProgramGenerationContext(baseContext, {
    doctrine: {
      id: 'bodybuilding_runtime_classic',
      version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
      derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
      content: 'DOCTRINE_CONTENT_MUST_NOT_BE_COPIED',
    },
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.1',
  });

  assert.equal(baseContext.coachInputs, null);
  assert.equal(context.schemaVersion, 3);
  assert.deepEqual(context.coachInputs, {
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
    derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.1',
  });
  assert.doesNotMatch(JSON.stringify(context), /DOCTRINE_CONTENT_MUST_NOT_BE_COPIED/);
});
