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
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

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
  let profileQueryCount = 0;
  let exerciseQueryCount = 0;
  const prisma = {
    userProfile: {
      findUnique: async () => {
        profileQueryCount += 1;
        return {
          onboardingSnapshot: {
            schemaVersion: 2,
            profile: createProfile(),
          },
        };
      },
    },
    exercise: {
      findMany: async () => {
        exerciseQueryCount += 1;
        return [
          createEligibleExercise({
            jointStressTags: ['shoulder_load', 'elbow_load', 'shoulder_load', ' '],
          }),
          createEligibleExercise({
            exerciseId: 'ex_advanced_press',
            name: 'Advanced Press',
            difficulty: 'advanced',
          }),
        ];
      },
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

  assert.equal(PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION, 4);
  assert.equal(context.schemaVersion, 4);
  assert.equal(context.generationMode, 'weekly_plan_draft');
  assert.equal(context.coachInputs, null);
  assert.equal(context.userId, 'user_123');
  assert.equal(context.createdAt, '2026-06-01T12:00:00.000Z');
  assert.equal(context.profileSchemaVersion, 2);
  assert.deepEqual(context.availability, {
    sessionsPerWeek: 4,
    durationPerSession: 75,
  });
  assert.strictEqual(context.evaluationPolicy, WEEKLY_PLAN_EVALUATION_POLICY);
  assert.equal(context.evaluationPolicy.id, WEEKLY_PLAN_EVALUATION_POLICY_ID);
  assert.equal(
    context.evaluationPolicy.version,
    WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  );
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
  assert.deepEqual(Object.keys(context).sort(), [
    'availability',
    'cardioProfile',
    'coachInputs',
    'createdAt',
    'equipmentContext',
    'evaluationPolicy',
    'exercisePoolItems',
    'experience',
    'generationMode',
    'movementConstraints',
    'musclePriorityProfile',
    'physicalNotes',
    'poolSnapshot',
    'poolSummary',
    'primaryGoal',
    'profileSchemaVersion',
    'schemaVersion',
    'userId',
  ]);
  assert.equal(
    JSON.stringify(context).split(WEEKLY_PLAN_EVALUATION_POLICY_ID).length - 1,
    1
  );
  assert.equal(profileQueryCount, 1);
  assert.equal(exerciseQueryCount, 1);

  const secondContext = await buildProgramGenerationContext(
    'user_123',
    {},
    {
      prisma,
      now: new Date('2026-06-01T12:00:00.000Z'),
    }
  );

  assert.deepEqual(secondContext, context);
  assert.strictEqual(secondContext.evaluationPolicy, WEEKLY_PLAN_EVALUATION_POLICY);
  assert.equal(profileQueryCount, 2);
  assert.equal(exerciseQueryCount, 2);
});

test('attachCoachInputsToProgramGenerationContext adds compact metadata without doctrine content', () => {
  const baseContext = Object.freeze({
    schemaVersion: 4,
    generationMode: 'weekly_plan_draft',
    primaryGoal: 'HYPERTROPHY',
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
    coachInputs: null,
  });
  const context = attachCoachInputsToProgramGenerationContext(baseContext, {
    doctrine: {
      id: 'bodybuilding_runtime_classic',
      version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
      derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
      content: 'DOCTRINE_CONTENT_MUST_NOT_BE_COPIED',
    },
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.1.0',
  });

  assert.equal(baseContext.coachInputs, null);
  assert.equal(baseContext.schemaVersion, 4);
  assert.strictEqual(
    baseContext.evaluationPolicy,
    WEEKLY_PLAN_EVALUATION_POLICY
  );
  assert.equal(context.schemaVersion, 4);
  assert.strictEqual(context.evaluationPolicy, WEEKLY_PLAN_EVALUATION_POLICY);
  assert.notStrictEqual(context, baseContext);
  assert.deepEqual(context.coachInputs, {
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
    derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.1.0',
  });
  assert.doesNotMatch(JSON.stringify(context), /DOCTRINE_CONTENT_MUST_NOT_BE_COPIED/);
});

test('attachCoachInputsToProgramGenerationContext never disguises a legacy V3 context as V4', () => {
  const baseContext = Object.freeze({
    schemaVersion: 3,
    generationMode: 'weekly_plan_draft',
    primaryGoal: 'HYPERTROPHY',
    coachInputs: null,
  });
  const context = attachCoachInputsToProgramGenerationContext(baseContext, {
    doctrine: {
      id: 'bodybuilding_runtime_classic',
      version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
      derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
      content: 'DOCTRINE_CONTENT_MUST_NOT_BE_COPIED',
    },
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.1.0',
  });

  assert.equal(baseContext.schemaVersion, 3);
  assert.equal(Object.hasOwn(baseContext, 'evaluationPolicy'), false);
  assert.equal(baseContext.coachInputs, null);
  assert.notStrictEqual(context, baseContext);
  assert.equal(context.schemaVersion, 3);
  assert.equal(Object.hasOwn(context, 'evaluationPolicy'), false);
  assert.deepEqual(context.coachInputs, {
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
    derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.1.0',
  });
  assert.doesNotMatch(JSON.stringify(context), /DOCTRINE_CONTENT_MUST_NOT_BE_COPIED/);
});
