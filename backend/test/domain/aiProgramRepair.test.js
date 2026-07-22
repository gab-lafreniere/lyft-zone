const test = require('node:test');
const assert = require('node:assert/strict');

const { ApiError } = require('../../services/usersService');
const {
  WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
  WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
  WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
  loadWeeklyPlanBuilderDoctrine,
} = require('../../src/ai/doctrines/bodybuildingDoctrineLoader');
const {
  AIProgramRepairError,
  MAX_PROGRAM_REPAIR_INPUT_CHARACTERS,
  runAIProgramRepair,
} = require('../../src/domain/programGeneration/aiProgramRepair');
const {
  buildProgramRepairContext,
} = require('../../src/domain/programGeneration/programRepairContextBuilder');
const {
  PROGRAM_REVIEW_CONTRACT_VERSION,
  PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/programReviewSchema');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
  buildProgramRepairPrompt,
} = require('../../src/domain/programGeneration/prompts/programRepairPrompt');
const {
  AI_WEEKLY_PLAN_MUSCLE_FOCUS_TARGET_AREAS,
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  buildWeeklyPlanAiJsonSchema,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

function clone(value) {
  return structuredClone(value);
}

function createDoctrine(overrides = {}) {
  return {
    id: WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
    version: WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
    derivedFromDoctrineVersion:
      WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
    content: 'Complete classic runtime doctrine fixture.',
    ...overrides,
  };
}

function createInitialReview(issues = null) {
  return {
    enabled: true,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    contractVersion: PROGRAM_REVIEW_CONTRACT_VERSION,
    outputSchemaVersion: PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
    provider: {
      rawMetadata: 'PRIVATE_INITIAL_REVIEW_PROVIDER_METADATA',
    },
    reviewInput: {
      privateValue: 'PRIVATE_INITIAL_REVIEW_INPUT',
    },
    review: {
      schemaVersion: PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      reviewSummary: 'The source plan requires one bounded repair.',
      issues:
        issues ||
        [
          {
            issueIndex: 1,
            category: 'SPLIT_DURATION_COHERENCE',
            severity: 'HIGH',
            path: '/analytics/workouts/0/durationAlignmentStatus',
            message: 'The workout is too short.',
            repairability: 'REPAIRABLE',
            suggestedAction: 'Increase useful training work.',
          },
          {
            issueIndex: 2,
            category: 'GOAL_PRIORITY_ALIGNMENT',
            severity: 'MEDIUM',
            path: '/analytics/targetComparisons/frequency',
            message: 'A priority can be aligned more closely.',
            repairability: 'REPAIRABLE',
            suggestedAction: 'Improve alignment if it does not conflict.',
          },
        ],
    },
  };
}

function createRepairOptions(overrides = {}) {
  return {
    doctrine: createDoctrine(),
    context: {
      schemaVersion: 4,
      evaluationPolicy: clone(WEEKLY_PLAN_EVALUATION_POLICY),
      availability: { sessionsPerWeek: 1, durationPerSession: 60 },
      poolSnapshot: { allowedExerciseIds: ['ex_press'] },
      exercisePoolItems: [
        {
          exerciseId: 'ex_press',
          name: 'Machine Press',
          bodyParts: ['chest'],
          muscleFocus: ['upper_chest'],
        },
      ],
    },
    generatedAIOutput: {
      schemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
      planName: 'Source AI plan',
      workouts: [{ orderIndex: 1, blocks: [] }],
    },
    generatedPlanDocument: {
      name: 'Prepared source plan',
      workouts: [{ orderIndex: 1, blocks: [] }],
    },
    analytics: {
      schemaVersion: 2,
      evaluationPolicy: {
        id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
        version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
      },
      plan: { workoutCount: 1 },
      workouts: [
        {
          workoutOrderIndex: 1,
          durationDifferenceMinutes: -20,
          durationAlignmentStatus: 'correction_required_under_target',
        },
      ],
    },
    initialReview: createInitialReview(),
    ...overrides,
  };
}

function createProviderResult(overrides = {}) {
  return {
    repairedAIOutput: {
      schemaVersion: 2,
      planName: 'Repaired plan',
      workouts: [],
    },
    repairer: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair_123',
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        reasoningTokens: 50,
      },
    },
    ...overrides,
  };
}

test('runAIProgramRepair builds context, prompt, and Weekly Plan AI Schema V2 before one provider call', async () => {
  const options = createRepairOptions();
  const capture = {
    contextBuildCount: 0,
    promptBuildCount: 0,
    schemaBuildCount: 0,
    providerCallCount: 0,
  };

  const result = await runAIProgramRepair(options, {
    buildProgramRepairContext: (input) => {
      capture.contextBuildCount += 1;
      capture.contextInput = input;
      capture.repairContext = buildProgramRepairContext(input);
      return capture.repairContext;
    },
    buildProgramRepairPrompt: (input) => {
      capture.promptBuildCount += 1;
      capture.promptInput = input;
      return buildProgramRepairPrompt(input);
    },
    buildWeeklyPlanAiJsonSchema: () => {
      capture.schemaBuildCount += 1;
      return buildWeeklyPlanAiJsonSchema();
    },
    repairWeeklyPlanAi: async (input) => {
      capture.providerCallCount += 1;
      capture.providerInput = input;
      return createProviderResult();
    },
  });

  assert.equal(capture.contextBuildCount, 1);
  assert.equal(capture.promptBuildCount, 1);
  assert.equal(capture.schemaBuildCount, 1);
  assert.equal(capture.providerCallCount, 1);
  assert.deepEqual(capture.contextInput, {
    context: options.context,
    generatedAIOutput: options.generatedAIOutput,
    generatedPlanDocument: options.generatedPlanDocument,
    analytics: options.analytics,
    initialReview: options.initialReview,
  });
  assert.strictEqual(
    capture.promptInput.repairContext,
    capture.repairContext
  );
  assert.equal(
    capture.providerInput.promptDescriptor.promptVersion,
    'ai-weekly-plan-repair-prompt-v1.0.0'
  );
  assert.deepEqual(
    capture.providerInput.schema,
    buildWeeklyPlanAiJsonSchema()
  );
  assert.equal(
    capture.providerInput.schema.properties.schemaVersion.enum[0],
    AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION
  );

  assert.deepEqual(Object.keys(result), [
    'repairedAIOutput',
    'repairer',
    'attemptNumber',
    'promptVersion',
    'contractVersion',
    'outputSchemaVersion',
  ]);
  assert.deepEqual(result, {
    repairedAIOutput: createProviderResult().repairedAIOutput,
    repairer: createProviderResult().repairer,
    attemptNumber: 1,
    promptVersion: PROGRAM_REPAIR_PROMPT_VERSION,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  });
  assert.equal(Object.hasOwn(result, 'repairContext'), false);
  assert.equal(Object.hasOwn(result, 'promptDescriptor'), false);
  assert.equal(Object.hasOwn(result, 'doctrine'), false);
  assert.equal(Object.hasOwn(result, 'generatedPlanDocument'), false);
  assert.equal(Object.hasOwn(result, 'analytics'), false);
  assert.equal(Object.hasOwn(result, 'initialReview'), false);
  assert.equal(Object.hasOwn(result, 'schema'), false);
});

test('runAIProgramRepair returns raw object output without validators, normalization, or persistence', async () => {
  const rawInvalidWeeklyPlanObject = {
    schemaVersion: 'not-locally-validated',
    workouts: 'not-normalized',
    privateProviderField: 'preserved-raw-object',
  };
  const forbiddenCalls = {
    validators: 0,
    normalizer: 0,
    persistence: 0,
  };

  const result = await runAIProgramRepair(createRepairOptions(), {
    repairWeeklyPlanAi: async () => ({
      ...createProviderResult(),
      repairedAIOutput: rawInvalidWeeklyPlanObject,
    }),
    validateWeeklyPlanAiOutputSchema: () => {
      forbiddenCalls.validators += 1;
      throw new Error('must not run');
    },
    validateWeeklyPlanAiOutputSemantics: () => {
      forbiddenCalls.validators += 1;
      throw new Error('must not run');
    },
    normalizeWeeklyPlanAiOutput: () => {
      forbiddenCalls.normalizer += 1;
      throw new Error('must not run');
    },
    validateGeneratedExerciseIdsAgainstPool: () => {
      forbiddenCalls.validators += 1;
      throw new Error('must not run');
    },
    createWeeklyPlan: () => {
      forbiddenCalls.persistence += 1;
      throw new Error('must not run');
    },
  });

  assert.strictEqual(result.repairedAIOutput, rawInvalidWeeklyPlanObject);
  assert.deepEqual(forbiddenCalls, {
    validators: 0,
    normalizer: 0,
    persistence: 0,
  });
});

test('runAIProgramRepair allowlists repairer metadata without mutating the provider object', async () => {
  const providerRepairer = {
    type: 'openai',
    model: '  returned-repair-model  ',
    responseId: '   ',
    usage: {
      inputTokens: 0,
      outputTokens: -1,
      totalTokens: '300',
      reasoningTokens: 1.5,
      rawUsage: 'PRIVATE_RAW_USAGE',
    },
    rawResponse: 'PRIVATE_RAW_RESPONSE',
    outputText: 'PRIVATE_OUTPUT_TEXT',
    prompt: 'PRIVATE_PROMPT',
    request: 'PRIVATE_REQUEST',
    response: 'PRIVATE_RESPONSE',
    privateMetadata: 'PRIVATE_METADATA',
    reasoningContent: 'PRIVATE_REASONING',
  };
  const before = clone(providerRepairer);

  const result = await runAIProgramRepair(createRepairOptions(), {
    repairWeeklyPlanAi: async () => ({
      repairedAIOutput: createProviderResult().repairedAIOutput,
      repairer: providerRepairer,
    }),
  });

  assert.deepEqual(result.repairer, {
    type: 'openai',
    model: 'returned-repair-model',
    responseId: null,
    usage: {
      inputTokens: 0,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
  assert.notStrictEqual(result.repairer, providerRepairer);
  assert.notStrictEqual(result.repairer.usage, providerRepairer.usage);
  assert.deepEqual(providerRepairer, before);
  assert.equal(Object.isFrozen(providerRepairer), false);
  assert.equal(Object.isFrozen(providerRepairer.usage), false);

  const serialized = JSON.stringify(result.repairer);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_RAW|PRIVATE_OUTPUT|PRIVATE_PROMPT|PRIVATE_REQUEST|PRIVATE_RESPONSE|PRIVATE_METADATA|PRIVATE_REASONING/
  );
  assert.deepEqual(Object.keys(result.repairer), [
    'type',
    'model',
    'responseId',
    'usage',
  ]);
  assert.deepEqual(Object.keys(result.repairer.usage), [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'reasoningTokens',
  ]);
});

test('runAIProgramRepair maps context and prompt preparation failures without private data', async () => {
  await assert.rejects(
    () => runAIProgramRepair(createRepairOptions({ context: null }), {}),
    (error) => {
      assert.equal(error instanceof AIProgramRepairError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID');
      assert.doesNotMatch(error.message, /Machine Press|ex_press/);
      return true;
    }
  );

  await assert.rejects(
    () =>
      runAIProgramRepair(createRepairOptions(), {
        buildProgramRepairContext: () => {
          throw new Error('PRIVATE_CONTEXT_ERROR_SENTINEL');
        },
      }),
    (error) => {
      assert.equal(error instanceof AIProgramRepairError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID');
      assert.doesNotMatch(error.message, /PRIVATE_CONTEXT_ERROR_SENTINEL/);
      return true;
    }
  );

  await assert.rejects(
    () =>
      runAIProgramRepair(
        createRepairOptions({ doctrine: createDoctrine({ content: '' }) }),
        {}
      ),
    (error) => {
      assert.equal(error instanceof AIProgramRepairError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED');
      return true;
    }
  );

  await assert.rejects(
    () =>
      runAIProgramRepair(createRepairOptions(), {
        buildProgramRepairPrompt: () => ({
          promptVersion: 'wrong-version',
          systemMessage: 'system',
          userMessage: 'user',
        }),
      }),
    (error) => {
      assert.equal(error instanceof AIProgramRepairError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED');
      return true;
    }
  );
});

test('runAIProgramRepair rejects oversized input before schema construction or provider access', async () => {
  const capture = { schemaBuildCount: 0, providerCallCount: 0 };
  const oversizedUserMessage = 'x'.repeat(
    MAX_PROGRAM_REPAIR_INPUT_CHARACTERS + 1
  );

  await assert.rejects(
    () =>
      runAIProgramRepair(createRepairOptions(), {
        buildProgramRepairPrompt: () => ({
          promptVersion: PROGRAM_REPAIR_PROMPT_VERSION,
          systemMessage: 'system',
          userMessage: oversizedUserMessage,
        }),
        buildWeeklyPlanAiJsonSchema: () => {
          capture.schemaBuildCount += 1;
          return {};
        },
        repairWeeklyPlanAi: async () => {
          capture.providerCallCount += 1;
          return createProviderResult();
        },
      }),
    (error) => {
      assert.equal(error instanceof AIProgramRepairError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_INPUT_TOO_LARGE');
      assert.doesNotMatch(error.message, /xxxxxxxx/);
      return true;
    }
  );

  assert.equal(capture.schemaBuildCount, 0);
  assert.equal(capture.providerCallCount, 0);
});

test('runAIProgramRepair rejects invalid provider result shapes and preserves provider ApiError', async () => {
  const invalidResults = [
    null,
    {},
    { repairedAIOutput: [], repairer: {} },
    { repairedAIOutput: {}, repairer: null },
    {
      repairedAIOutput: {},
      repairer: { ...createProviderResult().repairer, type: 'mock' },
    },
    {
      repairedAIOutput: {},
      repairer: { ...createProviderResult().repairer, model: undefined },
    },
    {
      repairedAIOutput: {},
      repairer: { ...createProviderResult().repairer, model: '   ' },
    },
    {
      repairedAIOutput: {},
      repairer: { ...createProviderResult().repairer, usage: undefined },
    },
    {
      repairedAIOutput: {},
      repairer: { ...createProviderResult().repairer, usage: [] },
    },
  ];

  for (const invalidResult of invalidResults) {
    await assert.rejects(
      () =>
        runAIProgramRepair(createRepairOptions(), {
          repairWeeklyPlanAi: async () => invalidResult,
        }),
      (error) => {
        assert.equal(error instanceof AIProgramRepairError, true);
        assert.equal(
          error.code,
          'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE'
        );
        return true;
      }
    );
  }

  const providerError = new ApiError(
    503,
    'AI_WEEKLY_PLAN_REPAIR_PROVIDER_RATE_LIMITED',
    'AI weekly plan repair provider is temporarily rate limited'
  );
  await assert.rejects(
    () =>
      runAIProgramRepair(createRepairOptions(), {
        repairWeeklyPlanAi: async () => {
          throw providerError;
        },
      }),
    (error) => error === providerError
  );
});

test('runAIProgramRepair is deterministic and does not mutate inputs', async () => {
  const options = createRepairOptions();
  const before = clone(options);
  const deps = {
    repairWeeklyPlanAi: async () => createProviderResult(),
  };

  const first = await runAIProgramRepair(options, deps);
  const second = await runAIProgramRepair(options, deps);

  assert.deepEqual(first, second);
  assert.deepEqual(options, before);
});

function createHeavyPoolItem(index) {
  return {
    exerciseId: `heavy_exercise_${String(index).padStart(3, '0')}`,
    name: `Heavy Fixture Exercise ${index}`,
    trainingType: index === 59 ? 'cardio' : 'strength',
    movementPattern: index === 59 ? 'cyclical_cardio' : `movement_${index % 12}`,
    jointStressTags: [`joint_tag_${index % 8}`],
    equipmentCategory: `equipment_${index % 10}`,
    bodyParts: [`body_part_${index % 8}`],
    muscleFocus: [`muscle_focus_${index % 20}`],
    targetMuscles: [`target_muscle_${index % 20}`],
    secondaryMuscles: [`secondary_muscle_${index % 20}`],
    cardioModality: index === 59 ? 'bike' : null,
    metadataDescription:
      `Realistic compact exercise metadata ${index} for repair input sizing. `.repeat(2),
  };
}

function createHeavySetTemplate(setIndex) {
  return {
    setIndex,
    setType: 'WORKING',
    targetReps: null,
    minReps: 8,
    maxReps: 12,
    targetRir: 2,
    tempo: '3010',
    restSeconds: 90,
  };
}

function createHeavyGeneratedExercise(index) {
  const isCardio = index === 59;
  return {
    exerciseId: `heavy_exercise_${String(index).padStart(3, '0')}`,
    exerciseName: `Heavy Fixture Exercise ${index}`,
    orderIndex: 1,
    bodyParts: [`body_part_${index % 8}`],
    muscleFocus: [`muscle_focus_${index % 20}`],
    defaultTempo: isCardio ? null : '3010',
    defaultRestSeconds: isCardio ? null : 90,
    defaultTargetRir: isCardio ? null : 2,
    setTemplates: isCardio
      ? []
      : [1, 2, 3].map(createHeavySetTemplate),
    cardioPrescription: isCardio
      ? {
          durationMinutes: 20,
          heartRateTargetMode: 'zone',
          heartRateTargetValue: 2,
          machineSettings: [],
          notes: null,
        }
      : null,
    notes: index === 0 ? 'Controlled execution.' : null,
  };
}

function createHeavyWorkouts() {
  return Array.from({ length: 6 }, (_, workoutIndex) => ({
    name: `Heavy Workout ${workoutIndex + 1}`,
    orderIndex: workoutIndex + 1,
    estimatedDurationMinutes: 60,
    focus: `Heavy realistic workout focus ${workoutIndex + 1}`,
    blocks: Array.from({ length: 10 }, (_, blockIndex) => {
      const exerciseIndex = workoutIndex * 10 + blockIndex;
      return {
        orderIndex: blockIndex + 1,
        blockType: exerciseIndex === 59 ? 'CARDIO' : 'SINGLE',
        exercises: [createHeavyGeneratedExercise(exerciseIndex)],
      };
    }),
  }));
}

function createHeavyRepairOptions() {
  const exercisePoolItems = Array.from(
    { length: 600 },
    (_, index) => createHeavyPoolItem(index)
  );
  const workouts = createHeavyWorkouts();
  const generatedAIOutput = {
    schemaVersion: 2,
    planName: 'HEAVY_SOURCE_OUTPUT_SENTINEL',
    sessionsPerWeek: 6,
    strategySummary: 'Six-session realistic heavy repair source fixture.',
    splitType: 'custom',
    workouts,
    volumeTargets: {
      bodyParts: [],
      muscleFocuses: AI_WEEKLY_PLAN_MUSCLE_FOCUS_TARGET_AREAS
        .slice(0, 20)
        .map((area, index) => ({
        area,
        targetSetsPerWeek: 9,
        priority: index < 2 ? 'primary' : 'maintenance',
        rationale: `Target rationale ${index}.`,
      })),
    },
    frequencyTargets: {
      bodyParts: [],
      muscleFocuses: AI_WEEKLY_PLAN_MUSCLE_FOCUS_TARGET_AREAS
        .slice(0, 20)
        .map((area) => ({
        area,
        targetSessionsPerWeek: 2,
      })),
    },
    progressionModel: {
      type: 'double_progression',
      summary: 'Progress within the supplied ranges.',
    },
    cautionHandling: { summary: 'Respect supplied cautions.' },
    notesPolicy: { summary: 'Use notes sparingly.' },
  };
  const generatedPlanDocument = {
    name: 'HEAVY_PREPARED_DOCUMENT_SENTINEL',
    sessionsPerWeek: 6,
    strategySummary: generatedAIOutput.strategySummary,
    workouts: clone(workouts),
  };

  return {
    doctrine: loadWeeklyPlanBuilderDoctrine(),
    context: {
      schemaVersion: 4,
      generationMode: 'weekly_plan_draft',
      primaryGoal: 'HYPERTROPHY',
      experience: 'advanced',
      availability: { sessionsPerWeek: 6, durationPerSession: 60 },
      evaluationPolicy: clone(WEEKLY_PLAN_EVALUATION_POLICY),
      movementConstraints: {
        blockedMovementPatterns: [],
        blockedJointStressTags: [],
        cautionMovementPatterns: ['movement_5'],
        cautionJointStressTags: ['joint_tag_3'],
      },
      musclePriorityProfile: {
        primaryFocus: 'muscle_focus_0',
        secondaryFocuses: ['muscle_focus_1'],
      },
      poolSnapshot: {
        allowedExerciseIds: exercisePoolItems.map((item) => item.exerciseId),
        checksum: 'heavy-realistic-pool-checksum',
      },
      exercisePoolItems,
    },
    generatedAIOutput,
    generatedPlanDocument,
    analytics: {
      schemaVersion: 2,
      status: 'complete',
      analyticsMarker: 'HEAVY_ANALYTICS_SENTINEL',
      evaluationPolicy: {
        id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
        version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
      },
      plan: {
        workoutCount: 6,
        exerciseCount: 60,
        workingSetCount: 177,
        cardioExerciseCount: 1,
        correctionRequiredWorkoutCount: 1,
      },
      workouts: Array.from({ length: 6 }, (_, index) => ({
        workoutOrderIndex: index + 1,
        strengthExerciseCount: index === 5 ? 9 : 10,
        cardioExerciseCount: index === 5 ? 1 : 0,
        workingSetCount: index === 5 ? 27 : 30,
        requestedDurationMinutes: 60,
        calculatedDurationMinutes: index === 0 ? 44 : 58,
        durationDifferenceMinutes: index === 0 ? -16 : -2,
        durationAlignmentStatus:
          index === 0
            ? 'correction_required_under_target'
            : 'preferred',
        durationRequiresCorrection: index === 0,
        muscleProjections: Array.from({ length: 10 }, (_, projectionIndex) => ({
          taxonomy: 'muscle_focus',
          key: `muscle_focus_${(index * 10 + projectionIndex) % 20}`,
          directWorkingSets: 3,
          indirectWorkingSets: 0,
        })),
      })),
      muscleMetrics: Array.from({ length: 20 }, (_, index) => ({
        taxonomy: 'muscle_focus',
        key: `muscle_focus_${index}`,
        directWorkingSets: 9,
        indirectWorkingSets: 0,
        directWorkoutCount: 2,
        indirectWorkoutCount: 0,
      })),
      targetComparisons: {
        volume: { summary: { targetCount: 20 }, items: [] },
        frequency: { summary: { targetCount: 20 }, items: [] },
      },
    },
    initialReview: createInitialReview(),
  };
}

test('realistic heavy repair input remains complete and below the deterministic limit', async (t) => {
  const options = createHeavyRepairOptions();
  const capture = { providerCallCount: 0 };

  await runAIProgramRepair(options, {
    repairWeeklyPlanAi: async ({ promptDescriptor }) => {
      capture.providerCallCount += 1;
      capture.userMessage = promptDescriptor.userMessage;
      return createProviderResult();
    },
  });

  const size = capture.userMessage.length;
  const utilization = (size / MAX_PROGRAM_REPAIR_INPUT_CHARACTERS) * 100;
  const remaining = MAX_PROGRAM_REPAIR_INPUT_CHARACTERS - size;
  const strengthExercises = options.generatedAIOutput.workouts
    .flatMap((workout) => workout.blocks)
    .flatMap((block) => block.exercises)
    .filter((exercise) => exercise.setTemplates.length > 0);
  const setTemplateCount = strengthExercises.reduce(
    (total, exercise) => total + exercise.setTemplates.length,
    0
  );

  assert.equal(capture.providerCallCount, 1);
  assert.ok(size <= MAX_PROGRAM_REPAIR_INPUT_CHARACTERS);
  assert.equal(options.context.exercisePoolItems.length, 600);
  assert.equal(options.generatedAIOutput.workouts.length, 6);
  assert.equal(
    options.generatedAIOutput.workouts.flatMap((workout) => workout.blocks)
      .length,
    60
  );
  assert.equal(setTemplateCount, 177);
  assert.equal(
    options.generatedAIOutput.workouts
      .flatMap((workout) => workout.blocks)
      .some((block) => block.blockType === 'CARDIO'),
    true
  );
  assert.equal(
    capture.userMessage.split('"scope": "ai_weekly_plan_builder_v1"').length -
      1,
    1
  );
  assert.match(capture.userMessage, /HEAVY_SOURCE_OUTPUT_SENTINEL/);
  assert.match(capture.userMessage, /HEAVY_PREPARED_DOCUMENT_SENTINEL/);
  assert.match(capture.userMessage, /HEAVY_ANALYTICS_SENTINEL/);
  assert.doesNotMatch(
    capture.userMessage,
    /PRIVATE_INITIAL_REVIEW_PROVIDER_METADATA|PRIVATE_INITIAL_REVIEW_INPUT/
  );
  assert.ok(capture.userMessage.endsWith('}'));

  t.diagnostic(`repair userMessage characters: ${size}`);
  t.diagnostic(`repair input limit utilization: ${utilization.toFixed(4)}%`);
  t.diagnostic(`repair input characters remaining: ${remaining}`);
});
