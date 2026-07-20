const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAIWeeklyPlanDraft,
  isAIWeeklyPlanRepairEnabled,
} = require('../../services/programGenerationService');
const {
  PROGRAM_GENERATION_PROMPT_VERSION,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  buildWeeklyPlanAiJsonSchema,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  WeeklyPlanAnalyticsError,
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  buildWeeklyPlanGenerationContext,
} = require('../../src/domain/programGeneration/weeklyPlanGenerationAudit');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');
const {
  AIProgramReviewError,
} = require('../../src/domain/programGeneration/aiProgramReview');
const {
  AIProgramRepairError,
} = require('../../src/domain/programGeneration/aiProgramRepair');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
} = require('../../src/domain/programGeneration/prompts/programRepairPrompt');

const MOCK_CLASSIC_DOCTRINE = Object.freeze({
  id: 'bodybuilding_runtime_classic',
  version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
  derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
  content: 'MOCK_CLASSIC_DOCTRINE_CONTENT_SENTINEL',
});

function createMockPromptDescriptor() {
  return {
    promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
    systemMessage: 'MOCK_SYSTEM_MESSAGE_SENTINEL',
    userMessage: 'MOCK_USER_MESSAGE_SENTINEL',
  };
}

function createPhase3Deps() {
  return {
    loadWeeklyPlanBuilderDoctrine: () => MOCK_CLASSIC_DOCTRINE,
    buildProgramGenerationPrompt: () => createMockPromptDescriptor(),
    prepareAIWeeklyPlanDraftForCreate: async (payload) => ({
      document: {
        name: payload.name,
        sessionsPerWeek: payload.sessionsPerWeek,
        workouts: payload.workouts,
      },
      businessRulesValidation: {
        ok: true,
        issueCount: 0,
      },
    }),
  };
}

function enabledEnv() {
  return {
    ENABLE_AI_WEEKLY_PLAN_BUILDER: 'true',
  };
}

function reviewEnabledEnv() {
  return {
    ...enabledEnv(),
    ENABLE_AI_WEEKLY_PLAN_REVIEW: 'true',
  };
}

function repairEnabledEnv() {
  return {
    ...reviewEnabledEnv(),
    ENABLE_AI_WEEKLY_PLAN_REPAIR: 'true',
  };
}

function createReviewIssue(overrides = {}) {
  return {
    issueIndex: 1,
    category: 'EXERCISE_REDUNDANCY',
    severity: 'LOW',
    path: '/plan/workouts/0',
    message: 'The repeated exercise can be monitored for redundancy.',
    repairability: 'NOT_APPLICABLE',
    suggestedAction: null,
    ...overrides,
  };
}

function createReviewResult({
  decision = 'PASS',
  requiresRepair = false,
  issues = [],
  reviewSummary = 'The structured plan review passed.',
  provider = {
    type: 'openai',
    model: 'review-model',
    responseId: 'resp_review_123',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 10,
    },
  },
} = {}) {
  const severityCounts = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
  const categoryCounts = {};

  issues.forEach((issue) => {
    if (Object.prototype.hasOwnProperty.call(severityCounts, issue.severity)) {
      severityCounts[issue.severity] += 1;
    }
    categoryCounts[issue.category] = (categoryCounts[issue.category] || 0) + 1;
  });

  return {
    enabled: true,
    review: {
      schemaVersion: 1,
      decision,
      requiresRepair,
      reviewSummary,
      issues,
    },
    provider,
    promptVersion: 'ai-program-review-prompt-v1.1.0',
    contractVersion: 1,
    outputSchemaVersion: 1,
    decision,
    requiresRepair,
    issueCount: issues.length,
    severityCounts,
    categoryCounts,
    repairIssues: issues.filter(
      (issue) => issue.severity === 'HIGH' && issue.repairability === 'REPAIRABLE'
    ),
  };
}

function createContext(overrides = {}) {
  return {
    schemaVersion: 4,
    generationMode: 'weekly_plan_draft',
    coachInputs: null,
    userId: 'user_123',
    createdAt: '2026-06-01T12:00:00.000Z',
    profileSchemaVersion: 2,
    primaryGoal: 'HYPERTROPHY',
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 1,
      durationPerSession: 60,
    },
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
    musclePriorityProfile: {},
    equipmentContext: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells'],
      equipmentBias: 'no_preference',
    },
    movementConstraints: {
      blockedExerciseIds: [],
      blockedMovementPatterns: [],
      blockedJointStressTags: [],
      cautionMovementPatterns: [],
      cautionJointStressTags: [],
    },
    cardioProfile: {
      cardioRole: 'none',
      preferredModalities: [],
    },
    physicalNotes: null,
    poolSummary: {
      totalExercises: 1,
      availableExercises: 1,
      excludedExercises: 0,
      excludedByReason: {},
    },
    poolSnapshot: {
      schemaVersion: 1,
      source: 'user_exercise_pool',
      profileSchemaVersion: 2,
      generatedAt: '2026-06-01T12:00:00.000Z',
      userId: 'user_123',
      allowedExerciseIds: ['ex_bench'],
      availableExerciseCount: 1,
      excludedExerciseCount: 0,
      hardConstraints: {},
      poolSummary: {
        totalExercises: 1,
        availableExercises: 1,
        excludedExercises: 0,
        excludedByReason: {},
      },
      checksum: 'checksum',
    },
    exercisePoolItems: [],
    ...overrides,
  };
}

function createGeneratedPlanDocument(overrides = {}) {
  return {
    name: 'AI Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Simple upper session.',
    workouts: [
      {
        name: 'Upper',
        orderIndex: 1,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [
              {
                exerciseId: 'ex_bench',
                exerciseName: 'Dumbbell Bench Press',
                orderIndex: 1,
                setTemplates: [],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createGeneratedAIOutput(overrides = {}) {
  return {
    schemaVersion: 1,
    planName: 'AI Output Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Simple upper session generated from AI output.',
    splitType: 'full_body',
    workouts: [
      {
        name: 'Upper',
        orderIndex: 1,
        estimatedDurationMinutes: 60,
        focus: 'Upper body strength',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [
              {
                exerciseId: 'ex_bench',
                exerciseName: 'Dumbbell Bench Press',
                orderIndex: 1,
                bodyParts: ['chest'],
                muscleFocus: ['upper_chest'],
                defaultTempo: '3010',
                defaultRestSeconds: 120,
                defaultTargetRir: 2,
                setTemplates: [
                  {
                    setIndex: 1,
                    setType: 'WORKING',
                    targetReps: 10,
                    minReps: null,
                    maxReps: null,
                    targetRir: 2,
                    tempo: '3010',
                    restSeconds: 120,
                  },
                ],
                cardioPrescription: null,
                notes: null,
              },
            ],
          },
        ],
      },
    ],
    volumeTargets: {
      perMuscle: [],
    },
    frequencyTargets: {
      perMuscle: [],
    },
    progressionModel: {
      type: 'double_progression',
      summary: 'Add reps before load.',
    },
    cautionHandling: {
      summary: 'Respect blocked constraints and keep cautions soft.',
    },
    notesPolicy: {
      summary: 'Use notes only when useful.',
    },
    ...overrides,
  };
}

function createOpenAIGeneratorResult(generatedAIOutput = createGeneratedAIOutput()) {
  return {
    generatedAIOutput,
    generator: {
      type: 'openai',
      model: 'provider-program-model',
      responseId: 'resp_program_generation_123',
      usage: {
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        reasoningTokens: 250,
      },
    },
  };
}

function createRepairResult(
  repairedAIOutput = createGeneratedAIOutput({
    planName: 'Repaired AI Draft',
    strategySummary: 'Repaired strategy summary.',
  })
) {
  return {
    repairedAIOutput,
    repairer: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair_123',
      usage: {
        inputTokens: 300,
        outputTokens: 200,
        totalTokens: 500,
        reasoningTokens: 40,
      },
    },
    attemptNumber: 1,
    promptVersion: PROGRAM_REPAIR_PROMPT_VERSION,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  };
}

test('createAIWeeklyPlanDraft returns 503 when feature flag is off', async () => {
  let contextCalled = false;
  let generatorCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: {
            ENABLE_AI_WEEKLY_PLAN_BUILDER: 'false',
          },
          buildProgramGenerationContext: async () => {
            contextCalled = true;
          },
          generateWeeklyPlanAiOutput: async () => {
            generatorCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_BUILDER_DISABLED');
      return true;
    }
  );

  assert.equal(contextCalled, false);
  assert.equal(generatorCalled, false);
});

test('createAIWeeklyPlanDraft rejects an empty exercise pool before generation', async () => {
  let generatorCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () =>
            createContext({
              poolSnapshot: {
                allowedExerciseIds: [],
                availableExerciseCount: 0,
              },
            }),
          generateWeeklyPlanAiOutput: async () => {
            generatorCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'EMPTY_EXERCISE_POOL');
      return true;
    }
  );

  assert.equal(generatorCalled, false);
});

test('createAIWeeklyPlanDraft uses real generation path when no artifact is injected', async () => {
  let doctrineLoadCount = 0;
  let promptInput = null;
  let generatorInput = null;
  let createPayload = null;
  const promptDescriptor = createMockPromptDescriptor();

  const response = await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      loadWeeklyPlanBuilderDoctrine: () => {
        doctrineLoadCount += 1;
        return MOCK_CLASSIC_DOCTRINE;
      },
      buildProgramGenerationPrompt: (input) => {
        promptInput = input;
        return promptDescriptor;
      },
      generateWeeklyPlanAiOutput: async (input) => {
        generatorInput = input;
        return {
          ...createOpenAIGeneratorResult(),
          rawResponse: 'RAW_PROVIDER_RESPONSE_SENTINEL',
        };
      },
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return {
          weeklyPlanParentId: 'parent_123',
          weeklyPlanVersionId: 'version_123',
          status: 'DRAFT',
          source: 'ai',
          builderPayload: {
            programName: payload.name,
          },
        };
      },
    }
  );

  assert.equal(response.source, 'ai');
  assert.equal(doctrineLoadCount, 1);
  assert.equal(promptInput.doctrine, MOCK_CLASSIC_DOCTRINE);
  assert.deepEqual(promptInput.context.coachInputs, {
    doctrineId: 'bodybuilding_runtime_classic',
    doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
    derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
    promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
  });
  assert.equal(generatorInput.promptDescriptor, promptDescriptor);
  assert.deepEqual(generatorInput.schema, buildWeeklyPlanAiJsonSchema());
  assert.equal(createPayload.name, 'AI Output Draft');
  assert.equal(createPayload.generationContext.generator.type, 'openai');
  assert.equal(createPayload.generationContext.generator.model, 'provider-program-model');
  assert.equal(
    createPayload.generationContext.generator.responseId,
    'resp_program_generation_123'
  );
  assert.deepEqual(createPayload.generationContext.generator.usage, {
    inputTokens: 1200,
    outputTokens: 800,
    totalTokens: 2000,
    reasoningTokens: 250,
  });
  assert.equal(createPayload.generationContext.validationSummary.aiOutputSchemaValidation.ok, true);
  assert.equal(createPayload.generationContext.validationSummary.aiOutputSemanticValidation.ok, true);
  assert.equal(createPayload.generationContext.validationSummary.poolValidation.ok, true);
  const persistedAudit = JSON.stringify(createPayload.generationContext);
  assert.doesNotMatch(persistedAudit, /RAW_PROVIDER_RESPONSE_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /MOCK_CLASSIC_DOCTRINE_CONTENT_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /MOCK_SYSTEM_MESSAGE_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /MOCK_USER_MESSAGE_SENTINEL/);
});

test('createAIWeeklyPlanDraft keeps schema, semantic, and pool validation on provider output', async (t) => {
  const outsidePoolOutput = clone(createGeneratedAIOutput());
  outsidePoolOutput.workouts[0].blocks[0].exercises[0].exerciseId = 'ex_outside_pool';
  const cases = [
    {
      name: 'schema validation',
      generatedAIOutput: createGeneratedAIOutput({ unexpected: true }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_SCHEMA_VALIDATION_FAILED',
      stage: 'schema',
    },
    {
      name: 'semantic validation',
      generatedAIOutput: createGeneratedAIOutput({ sessionsPerWeek: 2 }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_OUTPUT',
      stage: 'semantic',
    },
    {
      name: 'pool validation',
      generatedAIOutput: outsidePoolOutput,
      status: 422,
      code: 'AI_WEEKLY_PLAN_POOL_VIOLATION',
      stage: 'pool',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let createCalled = false;
      let generatorCalled = false;
      let preflightCalled = false;

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: enabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generateWeeklyPlanAiOutput: async () => {
                generatorCalled = true;
                return createOpenAIGeneratorResult(entry.generatedAIOutput);
              },
              prepareAIWeeklyPlanDraftForCreate: async () => {
                preflightCalled = true;
              },
              createWeeklyPlan: async () => {
                createCalled = true;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.equal(error.details.stage, entry.stage);
          return true;
        }
      );

      assert.equal(generatorCalled, true);
      assert.equal(preflightCalled, false);
      assert.equal(createCalled, false);
    });
  }
});

test('createAIWeeklyPlanDraft propagates controlled provider errors without persistence', async () => {
  let createCalled = false;
  const providerError = new Error('AI weekly plan generation timed out');
  providerError.status = 504;
  providerError.code = 'AI_WEEKLY_PLAN_GENERATION_TIMEOUT';

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generateWeeklyPlanAiOutput: async () => {
            throw providerError;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error, providerError);
      assert.equal(error.status, 504);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_GENERATION_TIMEOUT');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft rejects an invalid provider result contract', async () => {
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generateWeeklyPlanAiOutput: async () => ({
            generatedAIOutput: createGeneratedAIOutput(),
            generator: { type: 'mock' },
          }),
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft keeps an absent primaryGoal on the profile-not-ready path', async () => {
  let doctrineCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext({ primaryGoal: null }),
          loadWeeklyPlanBuilderDoctrine: () => {
            doctrineCalled = true;
            return MOCK_CLASSIC_DOCTRINE;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'PROFILE_NOT_READY');
      assert.notEqual(error.code, 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL');
      return true;
    }
  );

  assert.equal(doctrineCalled, false);
});

['STRENGTH', 'MIXED'].forEach((primaryGoal) => {
  test(`createAIWeeklyPlanDraft rejects temporarily unsupported ${primaryGoal}`, async () => {
    let doctrineCalled = false;
    let generatorCalled = false;

    await assert.rejects(
      () =>
        createAIWeeklyPlanDraft(
          { userId: 'user_123' },
          {
            ...createPhase3Deps(),
            env: enabledEnv(),
            buildProgramGenerationContext: async () => createContext({ primaryGoal }),
            loadWeeklyPlanBuilderDoctrine: () => {
              doctrineCalled = true;
              return MOCK_CLASSIC_DOCTRINE;
            },
            generateWeeklyPlanAiOutput: async () => {
              generatorCalled = true;
            },
          }
        ),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL');
        assert.deepEqual(error.details, {
          primaryGoal,
          supportedPrimaryGoals: ['HYPERTROPHY'],
        });
        return true;
      }
    );

    assert.equal(doctrineCalled, false);
    assert.equal(generatorCalled, false);
  });
});

test('createAIWeeklyPlanDraft routes an unknown primaryGoal through validation', async () => {
  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () =>
            createContext({ primaryGoal: 'CORRUPTED_GOAL' }),
        }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.notEqual(error.code, 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL');
      assert.deepEqual(error.details, [
        {
          path: 'primaryGoal',
          code: 'INVALID_ENUM',
          message: 'primaryGoal is invalid',
        },
      ]);
      return true;
    }
  );
});

test('createAIWeeklyPlanDraft maps doctrine failures without leaking internals', async () => {
  let promptCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          loadWeeklyPlanBuilderDoctrine: () => {
            throw new Error('/private/secret/doctrine.md');
          },
          buildProgramGenerationPrompt: () => {
            promptCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_DOCTRINE_UNAVAILABLE');
      assert.doesNotMatch(error.message, /private|doctrine\.md/i);
      assert.equal(error.details, undefined);
      return true;
    }
  );

  assert.equal(promptCalled, false);
});

test('createAIWeeklyPlanDraft rejects an injected longitudinal runtime descriptor', async () => {
  let promptCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          loadWeeklyPlanBuilderDoctrine: () => ({
            id: 'bodybuilding_runtime_longitudinal',
            version: 'bodybuilding-hypertrophy-runtime-longitudinal-v1.0.0',
            derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
            content: '# Lyft Zone Longitudinal Bodybuilding Runtime Doctrine',
          }),
          buildProgramGenerationPrompt: () => {
            promptCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_DOCTRINE_UNAVAILABLE');
      return true;
    }
  );

  assert.equal(promptCalled, false);
});

test('createAIWeeklyPlanDraft maps prompt construction failures before persistence', async () => {
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          buildProgramGenerationPrompt: () => {
            throw new Error('sensitive prompt implementation failure');
          },
          generatedPlanDocument: createGeneratedPlanDocument(),
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_PROMPT_BUILD_FAILED');
      assert.doesNotMatch(error.message, /sensitive/i);
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft creates an AI draft from a valid mock generated document', async () => {
  let createPayload = null;
  let generatorCalled = false;
  const response = await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      generatedPlanDocument: createGeneratedPlanDocument(),
      generateWeeklyPlanAiOutput: async () => {
        generatorCalled = true;
      },
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return {
          weeklyPlanParentId: 'parent_123',
          weeklyPlanVersionId: 'version_123',
          status: 'DRAFT',
          source: 'ai',
          builderPayload: {
            programName: payload.name,
          },
        };
      },
    }
  );

  assert.equal(response.source, 'ai');
  assert.equal(createPayload.userId, 'user_123');
  assert.equal(createPayload.source, 'ai');
  assert.equal(createPayload.name, 'AI Draft');
  assert.equal(createPayload.generationContext.generationType, 'ai_weekly_plan_builder_v1');
  assert.equal(createPayload.generationContext.schemaVersion, 7);
  assert.deepEqual(createPayload.generationContext.evaluationPolicy, {
    id: WEEKLY_PLAN_EVALUATION_POLICY.id,
    version: WEEKLY_PLAN_EVALUATION_POLICY.version,
  });
  assert.deepEqual(Object.keys(createPayload.generationContext.evaluationPolicy), [
    'id',
    'version',
  ]);
  assert.equal(
    createPayload.generationContext.doctrineId,
    'bodybuilding_runtime_classic'
  );
  assert.equal(
    createPayload.generationContext.doctrineVersion,
    'bodybuilding-hypertrophy-runtime-classic-v1.0.0'
  );
  assert.equal(
    createPayload.generationContext.derivedFromDoctrineVersion,
    'bodybuilding-hypertrophy-v1.0.0'
  );
  assert.equal(
    createPayload.generationContext.promptVersion,
    PROGRAM_GENERATION_PROMPT_VERSION
  );
  assert.equal(createPayload.generationContext.generator.type, 'mock');
  assert.equal(createPayload.generationContext.poolSnapshot.checksum, 'checksum');
  assert.equal(
    createPayload.generationContext.strategySummary,
    'Simple upper session.'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(createPayload, 'strategySummary'),
    false
  );
  assert.equal(createPayload.generationContext.validationSummary.poolValidation.ok, true);
  assert.deepEqual(
    createPayload.generationContext.validationSummary.businessRulesValidation,
    { ok: true, issueCount: 0 }
  );
  assert.equal(createPayload.generationContext.validationSummary.analytics.status, 'complete');
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.schemaVersion,
    2
  );
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.duration
      .requestedDurationMinutesPerWorkout,
    60
  );
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.targetComparisons.volume
      .targetCount,
    0
  );
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.targetComparisons.frequency
      .targetCount,
    0
  );
  const persistedAudit = JSON.stringify(createPayload.generationContext);
  assert.doesNotMatch(persistedAudit, /MOCK_CLASSIC_DOCTRINE_CONTENT_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /MOCK_SYSTEM_MESSAGE_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /MOCK_USER_MESSAGE_SENTINEL/);
  assert.doesNotMatch(persistedAudit, /historical_weekly_plan_metrics_v1/);
  assert.doesNotMatch(persistedAudit, /differenceOperation|ratioOperation|classificationRatio/);
  assert.doesNotMatch(persistedAudit, /"workouts"|"muscleMetrics"|bodyPartDistribution/);
  assert.equal(createPayload.generationContext.repairAttempts, 0);
  assert.equal(generatorCalled, false);
});

test('createAIWeeklyPlanDraft creates an AI draft from valid generatedAIOutput', async () => {
  let createPayload = null;
  let generatorCalled = false;
  const response = await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      generatedAIOutput: createGeneratedAIOutput(),
      generateWeeklyPlanAiOutput: async () => {
        generatorCalled = true;
      },
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return {
          weeklyPlanParentId: 'parent_123',
          weeklyPlanVersionId: 'version_123',
          status: 'DRAFT',
          source: 'ai',
          builderPayload: {
            programName: payload.name,
          },
        };
      },
    }
  );

  assert.equal(response.source, 'ai');
  assert.equal(createPayload.name, 'AI Output Draft');
  assert.equal(createPayload.source, 'ai');
  assert.equal(createPayload.workouts[0].blocks[0].blockType, 'SINGLE');
  assert.equal(createPayload.generationContext.aiContractVersion, 1);
  assert.equal(createPayload.generationContext.aiOutputSchemaVersion, 1);
  assert.equal(
    createPayload.generationContext.strategySummary,
    'Simple upper session generated from AI output.'
  );
  assert.equal(createPayload.generationContext.splitType, 'full_body');
  assert.equal(createPayload.generationContext.validationSummary.aiOutputSchemaValidation.ok, true);
  assert.equal(createPayload.generationContext.validationSummary.aiOutputSemanticValidation.ok, true);
  assert.equal(createPayload.generationContext.validationSummary.poolValidation.ok, true);
  assert.deepEqual(
    createPayload.generationContext.validationSummary.businessRulesValidation,
    { ok: true, issueCount: 0 }
  );
  assert.equal(createPayload.generationContext.validationSummary.analytics.status, 'partial');
  assert.equal(createPayload.generationContext.workouts, undefined);
  assert.equal(createPayload.generationContext.generator.type, 'mock');
  assert.equal(generatorCalled, false);
});

test('createAIWeeklyPlanDraft prefers generatedAIOutput over legacy generatedPlanDocument', async () => {
  let createPayload = null;

  await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      generatedAIOutput: createGeneratedAIOutput(),
      generatedPlanDocument: createGeneratedPlanDocument({
        name: 'Legacy Plan Document',
      }),
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return {
          weeklyPlanParentId: 'parent_123',
          weeklyPlanVersionId: 'version_123',
          status: 'DRAFT',
          source: 'ai',
          builderPayload: {
            programName: payload.name,
          },
        };
      },
    }
  );

  assert.equal(createPayload.name, 'AI Output Draft');
});

test('createAIWeeklyPlanDraft rejects generatedAIOutput schema errors before createWeeklyPlan', async () => {
  let createCalled = false;
  const generatedAIOutput = createGeneratedAIOutput({
    unexpected: true,
  });

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedAIOutput,
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_SCHEMA_VALIDATION_FAILED');
      assert.equal(error.details.stage, 'schema');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft rejects generatedAIOutput semantic errors before normalization', async () => {
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedAIOutput: createGeneratedAIOutput({
            sessionsPerWeek: 2,
          }),
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_INVALID_OUTPUT');
      assert.equal(error.details.stage, 'semantic');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft rejects normalized generatedAIOutput outside the pool snapshot', async () => {
  let createCalled = false;
  const generatedAIOutput = clone(createGeneratedAIOutput());
  generatedAIOutput.workouts[0].blocks[0].exercises[0].exerciseId = 'ex_outside_pool';

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedAIOutput,
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_POOL_VIOLATION');
      assert.equal(error.details.stage, 'pool');
      assert.equal(error.details.issues[0].exerciseId, 'ex_outside_pool');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft rejects mock documents with exercises outside the pool snapshot', async () => {
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument({
            workouts: [
              {
                name: 'Upper',
                orderIndex: 1,
                blocks: [
                  {
                    orderIndex: 1,
                    blockType: 'SINGLE',
                    exercises: [
                      {
                        exerciseId: 'ex_known_but_outside_pool',
                        exerciseName: 'Known Outside Pool',
                        orderIndex: 1,
                        setTemplates: [],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_POOL_VIOLATION');
      assert.equal(error.details[0].exerciseId, 'ex_known_but_outside_pool');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft orders provider pool, preflight, analytics, review, audit, and create', async () => {
  const order = [];
  const context = createContext();
  const allowedExerciseIds = context.poolSnapshot.allowedExerciseIds;
  let poolValidationRecorded = false;
  Object.defineProperty(context.poolSnapshot, 'allowedExerciseIds', {
    configurable: true,
    enumerable: true,
    get() {
      if (!poolValidationRecorded) {
        order.push('pool');
        poolValidationRecorded = true;
      }
      return allowedExerciseIds;
    },
  });
  const generatedAIOutput = createGeneratedAIOutput();
  const preparedDocument = {
    name: 'Business Prepared Draft',
    sessionsPerWeek: 1,
    workouts: [{ name: 'Prepared Workout', orderIndex: 1, blocks: [] }],
  };
  const businessRulesValidation = { ok: true, issueCount: 0 };
  const analytics = { analyticsResult: 'memory-only' };
  const generationContext = { schemaVersion: 5, audit: 'allowlisted' };
  let preflightPayload;
  let analyticsInput;
  let reviewInput;
  let auditInput;
  let createPayload;

  await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: reviewEnabledEnv(),
      buildProgramGenerationContext: async () => context,
      generatedAIOutput,
      prepareAIWeeklyPlanDraftForCreate: async (payload) => {
        order.push('preflight');
        preflightPayload = payload;
        return { document: preparedDocument, businessRulesValidation };
      },
      calculateWeeklyPlanAnalytics: async (input) => {
        order.push('analytics');
        analyticsInput = input;
        return analytics;
      },
      runAIProgramReview: async (input) => {
        order.push('review');
        reviewInput = input;
        return createReviewResult();
      },
      buildWeeklyPlanGenerationContext: async (input) => {
        order.push('audit');
        auditInput = input;
        return generationContext;
      },
      createWeeklyPlan: async (payload) => {
        order.push('create');
        createPayload = payload;
        return { source: 'ai' };
      },
    }
  );

  assert.deepEqual(order, ['pool', 'preflight', 'analytics', 'review', 'audit', 'create']);
  assert.deepEqual(Object.keys(preflightPayload).sort(), [
    'name',
    'sessionsPerWeek',
    'source',
    'userId',
    'workouts',
  ]);
  assert.equal(preflightPayload.name, 'AI Output Draft');
  assert.equal(preflightPayload.source, 'ai');
  assert.equal(preflightPayload.userId, 'user_123');
  assert.equal(preflightPayload.workouts[0].blocks[0].blockType, 'SINGLE');
  assert.strictEqual(analyticsInput.generatedAIOutput, generatedAIOutput);
  assert.strictEqual(analyticsInput.generatedPlanDocument, preparedDocument);
  assert.strictEqual(reviewInput.analytics, analytics);
  assert.strictEqual(reviewInput.generatedAIOutput, generatedAIOutput);
  assert.strictEqual(reviewInput.generatedPlanDocument, preparedDocument);
  assert.strictEqual(auditInput.generatedPlanDocument, preparedDocument);
  assert.strictEqual(auditInput.generatedAIOutput, generatedAIOutput);
  assert.strictEqual(auditInput.analytics, analytics);
  assert.strictEqual(auditInput.businessRulesValidation, businessRulesValidation);
  assert.strictEqual(analyticsInput.context, auditInput.context);
  assert.equal(auditInput.validation.schemaValidation.ok, true);
  assert.equal(auditInput.validation.semanticValidation.ok, true);
  assert.equal(auditInput.validation.poolValidation.ok, true);
  assert.equal(auditInput.aiReview.decision, 'PASS');
  assert.deepEqual(createPayload, {
    ...preparedDocument,
    userId: 'user_123',
    source: 'ai',
    generationContext,
  });
});

test('createAIWeeklyPlanDraft sends null AI output to legacy analytics', async () => {
  const generatedPlanDocument = createGeneratedPlanDocument();
  const preparedDocument = {
    name: 'Prepared Legacy Draft',
    sessionsPerWeek: 1,
    workouts: generatedPlanDocument.workouts,
  };
  let analyticsInput;
  let auditInput;
  let createPayload;

  await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      generatedPlanDocument,
      prepareAIWeeklyPlanDraftForCreate: async () => ({
        document: preparedDocument,
        businessRulesValidation: { ok: true, issueCount: 0 },
      }),
      calculateWeeklyPlanAnalytics: async (input) => {
        analyticsInput = input;
        return { analyticsResult: 'legacy' };
      },
      buildWeeklyPlanGenerationContext: async (input) => {
        auditInput = input;
        return { schemaVersion: 4 };
      },
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return { source: 'ai' };
      },
    }
  );

  assert.equal(analyticsInput.generatedAIOutput, null);
  assert.strictEqual(analyticsInput.generatedPlanDocument, preparedDocument);
  assert.strictEqual(auditInput.generatedAIOutput, null);
  assert.deepEqual(auditInput.generatedPlanDocument, {
    ...preparedDocument,
    strategySummary: 'Simple upper session.',
  });
  assert.notStrictEqual(auditInput.generatedPlanDocument, preparedDocument);
  assert.equal(
    Object.prototype.hasOwnProperty.call(createPayload, 'strategySummary'),
    false
  );
  assert.deepEqual(createPayload.workouts, preparedDocument.workouts);
  assert.equal(createPayload.name, preparedDocument.name);
  assert.equal(createPayload.sessionsPerWeek, preparedDocument.sessionsPerWeek);
  assert.equal(auditInput.validation.schemaValidation, null);
  assert.equal(auditInput.validation.semanticValidation, null);
  assert.equal(auditInput.validation.poolValidation.ok, true);
});

test('createAIWeeklyPlanDraft propagates preflight ApiError before analytics or persistence', async () => {
  const preflightError = new Error('Unknown exerciseId: ex_missing');
  preflightError.status = 400;
  preflightError.code = 'VALIDATION_ERROR';
  let analyticsCalled = false;
  let auditCalled = false;
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          prepareAIWeeklyPlanDraftForCreate: async () => {
            throw preflightError;
          },
          calculateWeeklyPlanAnalytics: async () => {
            analyticsCalled = true;
          },
          buildWeeklyPlanGenerationContext: async () => {
            auditCalled = true;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => error === preflightError
  );

  assert.equal(analyticsCalled, false);
  assert.equal(auditCalled, false);
  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft maps analytics failures without audit or persistence', async () => {
  let auditCalled = false;
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          calculateWeeklyPlanAnalytics: async () => {
            throw new WeeklyPlanAnalyticsError(
              'PRIVATE_ANALYTICS_CODE',
              'PRIVATE_PLAN_CONTENT_SENTINEL',
              { pool: 'PRIVATE_POOL_SENTINEL' }
            );
          },
          buildWeeklyPlanGenerationContext: async () => {
            auditCalled = true;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_ANALYTICS_FAILED');
      assert.equal(error.message, 'AI weekly plan analytics could not be calculated');
      assert.equal(error.details, undefined);
      assert.doesNotMatch(error.message, /PRIVATE_/);
      return true;
    }
  );

  assert.equal(auditCalled, false);
  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft does not persist when audit construction fails', async () => {
  const auditError = new Error('audit construction failed');
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          calculateWeeklyPlanAnalytics: async () => ({ status: 'complete' }),
          buildWeeklyPlanGenerationContext: async () => {
            throw auditError;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => error === auditError
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft maps Audit V7 policy identity failures before persistence', async () => {
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: enabledEnv(),
          buildProgramGenerationContext: async () =>
            createContext({
              evaluationPolicy: {
                ...WEEKLY_PLAN_EVALUATION_POLICY,
                version: 999,
              },
            }),
          generatedPlanDocument: createGeneratedPlanDocument(),
          calculateWeeklyPlanAnalytics: async () => ({
            schemaVersion: 2,
            evaluationPolicy: {
              id: WEEKLY_PLAN_EVALUATION_POLICY.id,
              version: WEEKLY_PLAN_EVALUATION_POLICY.version,
            },
          }),
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_ANALYTICS_FAILED');
      assert.equal(error.message, 'AI weekly plan analytics could not be calculated');
      return true;
    }
  );

  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft persists below and above target analytics', async () => {
  const generatedAIOutput = createGeneratedAIOutput({
    volumeTargets: {
      perMuscle: [
        {
          area: 'upper_chest',
          targetSetsPerWeek: 2,
          priority: 'primary',
          rationale: null,
        },
        {
          area: 'chest',
          targetSetsPerWeek: 0,
          priority: 'secondary',
          rationale: 'Comparison coverage.',
        },
      ],
    },
  });
  let createPayload;

  const response = await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: enabledEnv(),
      buildProgramGenerationContext: async () =>
        createContext({
          exercisePoolItems: [
            {
              exerciseId: 'ex_bench',
              targetMuscles: [],
              muscleFocus: ['upper_chest'],
              bodyParts: ['chest'],
              secondaryMuscles: [],
            },
          ],
        }),
      generatedAIOutput,
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return { source: 'ai' };
      },
    }
  );

  assert.equal(response.source, 'ai');
  assert.equal(createPayload.generationContext.schemaVersion, 7);
  assert.equal(createPayload.generationContext.validationSummary.analytics.status, 'complete');
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.targetComparisons.volume
      .belowTargetCount,
    1
  );
  assert.equal(
    createPayload.generationContext.validationSummary.analytics.targetComparisons.volume
      .aboveTargetCount,
    1
  );
});

test('createAIWeeklyPlanDraft explicitly bypasses review when the review flag is absent or false', async (t) => {
  for (const [name, env] of [
    ['absent', enabledEnv()],
    ['false', { ...enabledEnv(), ENABLE_AI_WEEKLY_PLAN_REVIEW: 'false' }],
  ]) {
    await t.test(name, async () => {
      let reviewCalled = false;
      let createPayload;

      await createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env,
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          runAIProgramReview: async () => {
            reviewCalled = true;
            return createReviewResult();
          },
          createWeeklyPlan: async (payload) => {
            createPayload = payload;
            return { source: 'ai' };
          },
        }
      );

      assert.equal(reviewCalled, false);
      assert.deepEqual(createPayload.generationContext.aiReview, {
        enabled: false,
        outcome: 'BYPASSED',
        reviewAttempts: 0,
        schemaVersion: 1,
        contractVersion: 1,
        outputSchemaVersion: 1,
        promptVersion: null,
        decision: null,
        requiresRepair: false,
        issueCount: 0,
        severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
        categoryCounts: {},
        reviewSummary: null,
        provider: null,
      });
    });
  }
});

test('createAIWeeklyPlanDraft persists a PASS review with informational repairable issues only', async () => {
  const issues = [
    createReviewIssue({
      issueIndex: 1,
      category: 'NOTES_POLICY',
      severity: 'LOW',
      path: '/plan/notesSummary',
      message: 'PRIVATE_LOW_REVIEW_MESSAGE',
      repairability: 'REPAIRABLE',
      suggestedAction: 'PRIVATE_LOW_REVIEW_ACTION',
    }),
    createReviewIssue({
      issueIndex: 2,
      category: 'SPLIT_DURATION_COHERENCE',
      severity: 'MEDIUM',
      path: '/analytics/plan/calculatedDurationMinutesAverage',
      message: 'PRIVATE_MEDIUM_REVIEW_MESSAGE',
      repairability: 'REPAIRABLE',
      suggestedAction: 'PRIVATE_MEDIUM_REVIEW_ACTION',
    }),
  ];
  let reviewCalled = false;
  let createPayload;

  await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...createPhase3Deps(),
      env: reviewEnabledEnv(),
      buildProgramGenerationContext: async () => createContext(),
      generatedPlanDocument: createGeneratedPlanDocument(),
      runAIProgramReview: async () => {
        reviewCalled = true;
        return createReviewResult({
          issues,
          provider: {
            type: 'openai',
            model: 'review-model',
            responseId: 'resp_review_123',
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              reasoningTokens: 10,
            },
            rawResponse: 'PRIVATE_REVIEW_RAW_RESPONSE',
          },
        });
      },
      createWeeklyPlan: async (payload) => {
        createPayload = payload;
        return { source: 'ai' };
      },
    }
  );

  assert.equal(reviewCalled, true);
  assert.deepEqual(createPayload.generationContext.aiReview, {
    enabled: true,
    outcome: 'PASSED',
    reviewAttempts: 1,
    schemaVersion: 1,
    contractVersion: 1,
    outputSchemaVersion: 1,
    promptVersion: 'ai-program-review-prompt-v1.1.0',
    decision: 'PASS',
    requiresRepair: false,
    issueCount: 2,
    severityCounts: { INFO: 0, LOW: 1, MEDIUM: 1, HIGH: 0 },
    categoryCounts: { NOTES_POLICY: 1, SPLIT_DURATION_COHERENCE: 1 },
    reviewSummary: 'The structured plan review passed.',
    provider: {
      type: 'openai',
      model: 'review-model',
      responseId: 'resp_review_123',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        reasoningTokens: 10,
      },
    },
  });
  const persistedAudit = JSON.stringify(createPayload.generationContext.aiReview);
  assert.doesNotMatch(persistedAudit, /PRIVATE_(?:LOW|MEDIUM)_REVIEW_(?:MESSAGE|ACTION)/);
  assert.doesNotMatch(persistedAudit, /PRIVATE_REVIEW_RAW_RESPONSE/);
  assert.doesNotMatch(persistedAudit, /\/plan\/|\/analytics\//);
});

test('createAIWeeklyPlanDraft blocks REPAIR_REQUIRED and FAIL before audit or persistence', async (t) => {
  const cases = [
    {
      name: 'REPAIR_REQUIRED',
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      code: 'AI_WEEKLY_PLAN_REVIEW_REQUIRES_REPAIR',
      issue: createReviewIssue({
        severity: 'HIGH',
        path: '/plan/workouts/0',
        message: 'PRIVATE_REPAIR_MESSAGE',
        repairability: 'REPAIRABLE',
        suggestedAction: 'PRIVATE_REPAIR_ACTION',
      }),
    },
    {
      name: 'FAIL',
      decision: 'FAIL',
      requiresRepair: false,
      code: 'AI_WEEKLY_PLAN_REVIEW_FAILED',
      issue: createReviewIssue({
        severity: 'HIGH',
        path: '/plan/workouts/0',
        message: 'PRIVATE_FAIL_MESSAGE',
        repairability: 'NON_REPAIRABLE',
        suggestedAction: null,
      }),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let analyticsCalled = false;
      let reviewCalled = false;
      let auditCalled = false;
      let createCalled = false;

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: reviewEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedPlanDocument: createGeneratedPlanDocument(),
              calculateWeeklyPlanAnalytics: async () => {
                analyticsCalled = true;
                return { status: 'complete' };
              },
              runAIProgramReview: async () => {
                reviewCalled = true;
                return createReviewResult({
                  decision: entry.decision,
                  requiresRepair: entry.requiresRepair,
                  issues: [entry.issue],
                });
              },
              buildWeeklyPlanGenerationContext: async () => {
                auditCalled = true;
              },
              createWeeklyPlan: async () => {
                createCalled = true;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, 422);
          assert.equal(error.code, entry.code);
          assert.deepEqual(Object.keys(error.details).sort(), [
            'categoryCounts',
            'decision',
            'issueCount',
            'severityCounts',
          ]);
          assert.equal(error.details.decision, entry.decision);
          assert.equal(error.details.issueCount, 1);
          assert.doesNotMatch(JSON.stringify(error.details), /PRIVATE_|\/plan\//);
          return true;
        }
      );

      assert.equal(analyticsCalled, true);
      assert.equal(reviewCalled, true);
      assert.equal(auditCalled, false);
      assert.equal(createCalled, false);
    });
  }
});

test('createAIWeeklyPlanDraft rejects an implicit review bypass when review is enabled', async () => {
  let auditCalled = false;
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: reviewEnabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          runAIProgramReview: async () => ({
            enabled: false,
            decision: 'PASS',
            requiresRepair: false,
          }),
          buildWeeklyPlanGenerationContext: async () => {
            auditCalled = true;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE');
      assert.equal(error.details, undefined);
      return true;
    }
  );

  assert.equal(auditCalled, false);
  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft rejects incomplete PASS review metadata before audit', async () => {
  let auditCalled = false;
  let createCalled = false;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          env: reviewEnabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedPlanDocument: createGeneratedPlanDocument(),
          runAIProgramReview: async () => ({ ...createReviewResult(), provider: null }),
          buildWeeklyPlanGenerationContext: async () => {
            auditCalled = true;
          },
          createWeeklyPlan: async () => {
            createCalled = true;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE');
      return true;
    }
  );

  assert.equal(auditCalled, false);
  assert.equal(createCalled, false);
});

test('createAIWeeklyPlanDraft fails closed for review provider, validation, and input failures', async (t) => {
  const providerError = Object.assign(
    new Error('AI weekly plan review provider is unavailable'),
    {
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    }
  );
  const cases = [
    {
      name: 'provider',
      error: providerError,
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
    {
      name: 'schema',
      error: new AIProgramReviewError(
        'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
        'private schema response'
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
    },
    {
      name: 'semantic',
      error: new AIProgramReviewError(
        'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED',
        'private semantic response'
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED',
    },
    {
      name: 'input incomplete',
      error: new AIProgramReviewError(
        'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE',
        'private pool detail'
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE',
    },
    {
      name: 'input too large',
      error: new AIProgramReviewError(
        'AI_WEEKLY_PLAN_REVIEW_INPUT_TOO_LARGE',
        'private input detail'
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_INPUT_TOO_LARGE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let auditCalled = false;
      let createCalled = false;

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: reviewEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedPlanDocument: createGeneratedPlanDocument(),
              runAIProgramReview: async () => {
                throw entry.error;
              },
              buildWeeklyPlanGenerationContext: async () => {
                auditCalled = true;
              },
              createWeeklyPlan: async () => {
                createCalled = true;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.equal(error.details, undefined);
          assert.doesNotMatch(error.message, /private/i);
          return true;
        }
      );

      assert.equal(auditCalled, false);
      assert.equal(createCalled, false);
    });
  }
});

test('createAIWeeklyPlanDraft reviews legacy, mock AI output, and provider AI output paths', async (t) => {
  const providerOutput = createGeneratedAIOutput();
  const cases = [
    {
      name: 'legacy document',
      artifactDeps: { generatedPlanDocument: createGeneratedPlanDocument() },
      expectedAIOutput: null,
      expectedPlanName: 'AI Draft',
    },
    {
      name: 'mock AI output',
      artifactDeps: { generatedAIOutput: createGeneratedAIOutput() },
      expectedAIOutput: 'mock',
      expectedPlanName: 'AI Output Draft',
    },
    {
      name: 'provider AI output',
      artifactDeps: {
        generateWeeklyPlanAiOutput: async () => createOpenAIGeneratorResult(providerOutput),
      },
      expectedAIOutput: providerOutput,
      expectedPlanName: 'AI Output Draft',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let reviewInput;
      let createCalled = false;

      await createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...createPhase3Deps(),
          ...entry.artifactDeps,
          env: reviewEnabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          runAIProgramReview: async (input) => {
            reviewInput = input;
            return createReviewResult();
          },
          createWeeklyPlan: async () => {
            createCalled = true;
            return { source: 'ai' };
          },
        }
      );

      assert.equal(createCalled, true);
      assert.ok(reviewInput);
      if (entry.expectedAIOutput === 'mock') {
        assert.equal(reviewInput.generatedAIOutput.schemaVersion, 1);
      } else {
        assert.strictEqual(reviewInput.generatedAIOutput, entry.expectedAIOutput);
      }
      assert.equal(reviewInput.generatedPlanDocument.name, entry.expectedPlanName);
    });
  }
});

test('isAIWeeklyPlanRepairEnabled accepts only case-insensitive true', () => {
  ['true', 'TRUE', 'TrUe'].forEach((value) => {
    assert.equal(isAIWeeklyPlanRepairEnabled({ ENABLE_AI_WEEKLY_PLAN_REPAIR: value }), true);
  });
  [undefined, '', 'false', '1', ' true '].forEach((value) => {
    assert.equal(isAIWeeklyPlanRepairEnabled({ ENABLE_AI_WEEKLY_PLAN_REPAIR: value }), false);
  });
});

test('repair feature flag preserves bypass, PASS, FAIL, and disabled repair branches', async (t) => {
  await t.test('repair disabled preserves REPAIR_REQUIRED blocking', async () => {
    let repairCalls = 0;

    await assert.rejects(
      () =>
        createAIWeeklyPlanDraft(
          { userId: 'user_123' },
          {
            ...createPhase3Deps(),
            env: {
              ...reviewEnabledEnv(),
              ENABLE_AI_WEEKLY_PLAN_REPAIR: 'false',
            },
            buildProgramGenerationContext: async () => createContext(),
            generatedAIOutput: createGeneratedAIOutput(),
            runAIProgramReview: async () =>
              createReviewResult({
                decision: 'REPAIR_REQUIRED',
                requiresRepair: true,
                issues: [
                  createReviewIssue({
                    severity: 'HIGH',
                    repairability: 'REPAIRABLE',
                  }),
                ],
              }),
            runAIProgramRepair: async () => {
              repairCalls += 1;
            },
          }
        ),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_REQUIRES_REPAIR');
        return true;
      }
    );

    assert.equal(repairCalls, 0);
  });

  await t.test('review bypass never repairs even when repair is enabled', async () => {
    let reviewCalls = 0;
    let repairCalls = 0;
    let createPayload;

    await createAIWeeklyPlanDraft(
      { userId: 'user_123' },
      {
        ...createPhase3Deps(),
        env: {
          ...enabledEnv(),
          ENABLE_AI_WEEKLY_PLAN_REPAIR: 'true',
        },
        buildProgramGenerationContext: async () => createContext(),
        generatedAIOutput: createGeneratedAIOutput(),
        runAIProgramReview: async () => {
          reviewCalls += 1;
        },
        runAIProgramRepair: async () => {
          repairCalls += 1;
        },
        createWeeklyPlan: async (payload) => {
          createPayload = payload;
          return { source: 'ai' };
        },
      }
    );

    assert.equal(reviewCalls, 0);
    assert.equal(repairCalls, 0);
    assert.equal(createPayload.generationContext.aiRepair.outcome, 'BYPASSED');
    assert.equal(createPayload.generationContext.aiRepair.enabled, true);
  });

  for (const entry of [
    { decision: 'PASS', requiresRepair: false, code: null },
    { decision: 'FAIL', requiresRepair: false, code: 'AI_WEEKLY_PLAN_REVIEW_FAILED' },
  ]) {
    await t.test(`initial ${entry.decision} never repairs`, async () => {
      let repairCalls = 0;
      let createPayload;
      const execute = () =>
        createAIWeeklyPlanDraft(
          { userId: 'user_123' },
          {
            ...createPhase3Deps(),
            env: repairEnabledEnv(),
            buildProgramGenerationContext: async () => createContext(),
            generatedAIOutput: createGeneratedAIOutput(),
            runAIProgramReview: async () => createReviewResult(entry),
            runAIProgramRepair: async () => {
              repairCalls += 1;
            },
            createWeeklyPlan: async (payload) => {
              createPayload = payload;
              return { source: 'ai' };
            },
          }
        );

      if (entry.code) {
        await assert.rejects(execute, (error) => {
          assert.equal(error.code, entry.code);
          return true;
        });
        assert.equal(createPayload, undefined);
      } else {
        await execute();
        assert.equal(createPayload.generationContext.aiRepair.outcome, 'NOT_REQUIRED');
        assert.equal(createPayload.generationContext.repairAttempts, 0);
      }

      assert.equal(repairCalls, 0);
    });
  }
});

test('createAIWeeklyPlanDraft executes one repair and persists only the repaired final state', async () => {
  const order = [];
  const baseDeps = createPhase3Deps();
  const initialAIOutput = createGeneratedAIOutput({
    planName: 'Initial AI Draft',
    strategySummary: 'PRIVATE_INITIAL_STRATEGY_SENTINEL',
  });
  const repairedAIOutput = createGeneratedAIOutput({
    planName: 'Repaired AI Draft',
    strategySummary: 'Final repaired strategy.',
  });
  const initialIssue = createReviewIssue({
    severity: 'HIGH',
    repairability: 'REPAIRABLE',
    message: 'PRIVATE_INITIAL_REVIEW_MESSAGE',
    path: '/plan/workouts/0',
    suggestedAction: 'PRIVATE_INITIAL_REVIEW_ACTION',
  });
  const initialReview = createReviewResult({
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    issues: [initialIssue],
  });
  const finalReview = createReviewResult();
  const repairResult = createRepairResult(repairedAIOutput);
  const sourceContext = createContext();
  const originals = {
    sourceContext: clone(sourceContext),
    initialAIOutput: clone(initialAIOutput),
    repairedAIOutput: clone(repairedAIOutput),
    initialReview: clone(initialReview),
    finalReview: clone(finalReview),
    repairResult: clone(repairResult),
  };
  const preparedResults = [];
  const preparedOriginals = [];
  const analyticsInputs = [];
  const analyticsResults = [];
  const analyticsOriginals = [];
  const reviewInputs = [];
  let repairInput;
  let auditInput;
  let createPayload;
  let repairCalls = 0;
  let reviewCalls = 0;

  const response = await createAIWeeklyPlanDraft(
    { userId: 'user_123' },
    {
      ...baseDeps,
      env: repairEnabledEnv(),
      buildProgramGenerationContext: async () => sourceContext,
      generatedAIOutput: initialAIOutput,
      prepareAIWeeklyPlanDraftForCreate: async (payload) => {
        order.push(preparedResults.length === 0 ? 'preflight_initial' : 'preflight_repaired');
        const result = await baseDeps.prepareAIWeeklyPlanDraftForCreate(payload);
        preparedResults.push(result);
        preparedOriginals.push(clone(result));
        return result;
      },
      calculateWeeklyPlanAnalytics: async (input) => {
        order.push(analyticsInputs.length === 0 ? 'analytics_initial' : 'analytics_repaired');
        analyticsInputs.push(input);
        const result = calculateWeeklyPlanAnalytics(input);
        analyticsResults.push(result);
        analyticsOriginals.push(clone(result));
        return result;
      },
      runAIProgramReview: async (input) => {
        reviewCalls += 1;
        order.push(reviewCalls === 1 ? 'review_initial' : 'review_final');
        reviewInputs.push(input);
        return reviewCalls === 1 ? initialReview : finalReview;
      },
      runAIProgramRepair: async (input) => {
        repairCalls += 1;
        order.push('repair');
        repairInput = input;
        return repairResult;
      },
      buildWeeklyPlanGenerationContext: (input) => {
        order.push('audit');
        auditInput = input;
        return buildWeeklyPlanGenerationContext(input);
      },
      createWeeklyPlan: async (payload) => {
        order.push('create');
        createPayload = payload;
        return { source: 'ai', status: 'DRAFT' };
      },
    }
  );

  assert.deepEqual(order, [
    'preflight_initial',
    'analytics_initial',
    'review_initial',
    'repair',
    'preflight_repaired',
    'analytics_repaired',
    'review_final',
    'audit',
    'create',
  ]);
  assert.equal(repairCalls, 1);
  assert.equal(reviewCalls, 2);
  assert.strictEqual(repairInput.doctrine, MOCK_CLASSIC_DOCTRINE);
  assert.equal(repairInput.context.schemaVersion, 4);
  assert.equal(repairInput.context.coachInputs.promptVersion, PROGRAM_GENERATION_PROMPT_VERSION);
  assert.strictEqual(repairInput.generatedAIOutput, initialAIOutput);
  assert.strictEqual(repairInput.generatedPlanDocument, preparedResults[0].document);
  assert.strictEqual(repairInput.analytics, analyticsResults[0]);
  assert.strictEqual(repairInput.initialReview, initialReview);
  assert.strictEqual(reviewInputs[1].generatedAIOutput, repairedAIOutput);
  assert.strictEqual(reviewInputs[1].generatedPlanDocument, preparedResults[1].document);
  assert.strictEqual(reviewInputs[1].analytics, analyticsResults[1]);
  assert.strictEqual(auditInput.generatedAIOutput, repairedAIOutput);
  assert.strictEqual(auditInput.generatedPlanDocument, preparedResults[1].document);
  assert.strictEqual(auditInput.analytics, analyticsResults[1]);
  assert.strictEqual(
    auditInput.businessRulesValidation,
    preparedResults[1].businessRulesValidation
  );
  assert.equal(auditInput.aiReview.reviewAttempts, 2);
  assert.equal(auditInput.aiRepair.attempts, 1);
  assert.equal(createPayload.name, 'Repaired AI Draft');
  assert.notEqual(createPayload.name, 'Initial AI Draft');
  assert.equal(createPayload.generationContext.strategySummary, 'Final repaired strategy.');
  assert.equal(createPayload.generationContext.repairAttempts, 1);
  assert.equal(createPayload.generationContext.aiReview.reviewAttempts, 2);
  assert.equal(createPayload.generationContext.generator.type, 'mock');
  assert.deepEqual(createPayload.generationContext.aiRepair.provider, repairResult.repairer);
  assert.equal(response.source, 'ai');
  assert.equal(response.status, 'DRAFT');

  const serializedAudit = JSON.stringify(createPayload.generationContext);
  assert.doesNotMatch(serializedAudit, /PRIVATE_INITIAL_STRATEGY_SENTINEL/);
  assert.doesNotMatch(serializedAudit, /PRIVATE_INITIAL_REVIEW_(?:MESSAGE|ACTION)/);
  assert.deepEqual(sourceContext, originals.sourceContext);
  assert.deepEqual(initialAIOutput, originals.initialAIOutput);
  assert.deepEqual(repairedAIOutput, originals.repairedAIOutput);
  assert.deepEqual(initialReview, originals.initialReview);
  assert.deepEqual(finalReview, originals.finalReview);
  assert.deepEqual(repairResult, originals.repairResult);
  assert.deepEqual(preparedResults, preparedOriginals);
  assert.deepEqual(analyticsResults, analyticsOriginals);
});

test('repaired output validation failures stop every downstream boundary', async (t) => {
  const outsidePoolOutput = clone(createGeneratedAIOutput());
  outsidePoolOutput.workouts[0].blocks[0].exercises[0].exerciseId = 'ex_outside_pool';
  const cases = [
    {
      name: 'schema',
      repairedAIOutput: createGeneratedAIOutput({ unexpected: true }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REPAIR_SCHEMA_VALIDATION_FAILED',
      details: { stage: 'schema', issueCount: 1 },
    },
    {
      name: 'semantic',
      repairedAIOutput: createGeneratedAIOutput({ sessionsPerWeek: 2 }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REPAIR_SEMANTIC_VALIDATION_FAILED',
      details: { stage: 'semantic', issueCount: 1 },
    },
    {
      name: 'pool',
      repairedAIOutput: outsidePoolOutput,
      status: 422,
      code: 'AI_WEEKLY_PLAN_REPAIR_POOL_VIOLATION',
      details: { stage: 'pool', issueCount: 1 },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let preflightCalls = 0;
      let analyticsCalls = 0;
      let reviewCalls = 0;
      let auditCalls = 0;
      let createCalls = 0;
      const baseDeps = createPhase3Deps();

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...baseDeps,
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              prepareAIWeeklyPlanDraftForCreate: async (payload) => {
                preflightCalls += 1;
                return baseDeps.prepareAIWeeklyPlanDraftForCreate(payload);
              },
              calculateWeeklyPlanAnalytics: async (input) => {
                analyticsCalls += 1;
                return calculateWeeklyPlanAnalytics(input);
              },
              runAIProgramReview: async () => {
                reviewCalls += 1;
                return createReviewResult({
                  decision: 'REPAIR_REQUIRED',
                  requiresRepair: true,
                  issues: [
                    createReviewIssue({
                      severity: 'HIGH',
                      repairability: 'REPAIRABLE',
                    }),
                  ],
                });
              },
              runAIProgramRepair: async () => createRepairResult(entry.repairedAIOutput),
              buildWeeklyPlanGenerationContext: async () => {
                auditCalls += 1;
              },
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.deepEqual(error.details, entry.details);
          assert.equal(JSON.stringify(error.details).includes('ex_outside_pool'), false);
          return true;
        }
      );

      assert.equal(preflightCalls, 1);
      assert.equal(analyticsCalls, 1);
      assert.equal(reviewCalls, 1);
      assert.equal(auditCalls, 0);
      assert.equal(createCalls, 0);
    });
  }
});

test('repaired normalization failure stops pool, preflight, final review, audit, and create', async () => {
  const baseDeps = createPhase3Deps();
  let preflightCalls = 0;
  let analyticsCalls = 0;
  let reviewCalls = 0;
  let auditCalls = 0;
  let createCalls = 0;

  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_123' },
        {
          ...baseDeps,
          env: repairEnabledEnv(),
          buildProgramGenerationContext: async () => createContext(),
          generatedAIOutput: createGeneratedAIOutput(),
          prepareAIWeeklyPlanDraftForCreate: async (payload) => {
            preflightCalls += 1;
            return baseDeps.prepareAIWeeklyPlanDraftForCreate(payload);
          },
          calculateWeeklyPlanAnalytics: async (input) => {
            analyticsCalls += 1;
            return calculateWeeklyPlanAnalytics(input);
          },
          runAIProgramReview: async () => {
            reviewCalls += 1;
            return createReviewResult({
              decision: 'REPAIR_REQUIRED',
              requiresRepair: true,
              issues: [
                createReviewIssue({
                  severity: 'HIGH',
                  repairability: 'REPAIRABLE',
                }),
              ],
            });
          },
          runAIProgramRepair: async () => createRepairResult(),
          normalizeWeeklyPlanAiOutput: () => {
            throw new Error('PRIVATE_NORMALIZATION_DETAIL');
          },
          buildWeeklyPlanGenerationContext: async () => {
            auditCalls += 1;
          },
          createWeeklyPlan: async () => {
            createCalls += 1;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_NORMALIZATION_FAILED');
      assert.equal(error.details, undefined);
      assert.doesNotMatch(error.message, /PRIVATE_/);
      return true;
    }
  );

  assert.equal(preflightCalls, 1);
  assert.equal(analyticsCalls, 1);
  assert.equal(reviewCalls, 1);
  assert.equal(auditCalls, 0);
  assert.equal(createCalls, 0);
});

test('repaired business and analytics failures use dedicated safe errors', async (t) => {
  for (const entry of [
    {
      name: 'business rules',
      code: 'AI_WEEKLY_PLAN_REPAIR_BUSINESS_RULES_FAILED',
      status: 422,
      details: { stage: 'business_rules' },
    },
    {
      name: 'analytics',
      code: 'AI_WEEKLY_PLAN_REPAIR_ANALYTICS_FAILED',
      status: 500,
      details: undefined,
    },
  ]) {
    await t.test(entry.name, async () => {
      const baseDeps = createPhase3Deps();
      let preflightCalls = 0;
      let analyticsCalls = 0;
      let reviewCalls = 0;
      let auditCalls = 0;
      let createCalls = 0;

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...baseDeps,
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              prepareAIWeeklyPlanDraftForCreate: async (payload) => {
                preflightCalls += 1;
                if (preflightCalls === 2 && entry.name === 'business rules') {
                  const error = new Error('PRIVATE_BUSINESS_RULE_DETAIL');
                  error.status = 400;
                  error.code = 'VALIDATION_ERROR';
                  error.details = { exerciseId: 'PRIVATE_EXERCISE_ID' };
                  throw error;
                }
                return baseDeps.prepareAIWeeklyPlanDraftForCreate(payload);
              },
              calculateWeeklyPlanAnalytics: async (input) => {
                analyticsCalls += 1;
                if (analyticsCalls === 2 && entry.name === 'analytics') {
                  throw new Error('PRIVATE_ANALYTICS_DETAIL');
                }
                return calculateWeeklyPlanAnalytics(input);
              },
              runAIProgramReview: async () => {
                reviewCalls += 1;
                return createReviewResult({
                  decision: 'REPAIR_REQUIRED',
                  requiresRepair: true,
                  issues: [
                    createReviewIssue({
                      severity: 'HIGH',
                      repairability: 'REPAIRABLE',
                    }),
                  ],
                });
              },
              runAIProgramRepair: async () => createRepairResult(),
              buildWeeklyPlanGenerationContext: async () => {
                auditCalls += 1;
              },
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.deepEqual(error.details, entry.details);
          assert.doesNotMatch(error.message, /PRIVATE_/);
          return true;
        }
      );

      assert.equal(reviewCalls, 1);
      assert.equal(auditCalls, 0);
      assert.equal(createCalls, 0);
    });
  }
});

test('repair domain errors are safely mapped and provider ApiErrors pass through', async (t) => {
  const publicCodes = [
    'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID',
    'AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED',
    'AI_WEEKLY_PLAN_REPAIR_INPUT_TOO_LARGE',
    'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
  ];

  for (const code of publicCodes) {
    await t.test(code, async () => {
      let auditCalls = 0;
      let createCalls = 0;
      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              runAIProgramReview: async () =>
                createReviewResult({
                  decision: 'REPAIR_REQUIRED',
                  requiresRepair: true,
                  issues: [
                    createReviewIssue({
                      severity: 'HIGH',
                      repairability: 'REPAIRABLE',
                    }),
                  ],
                }),
              runAIProgramRepair: async () => {
                throw new AIProgramRepairError(code, 'PRIVATE_REPAIR_DETAIL');
              },
              buildWeeklyPlanGenerationContext: async () => {
                auditCalls += 1;
              },
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, 502);
          assert.equal(error.code, code);
          assert.equal(error.details, undefined);
          assert.doesNotMatch(error.message, /PRIVATE_/);
          return true;
        }
      );
      assert.equal(auditCalls, 0);
      assert.equal(createCalls, 0);
    });
  }

  await t.test('provider ApiError passes through unchanged', async () => {
    const providerError = Object.assign(new Error('provider unavailable'), {
      status: 503,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE',
    });

    await assert.rejects(
      () =>
        createAIWeeklyPlanDraft(
          { userId: 'user_123' },
          {
            ...createPhase3Deps(),
            env: repairEnabledEnv(),
            buildProgramGenerationContext: async () => createContext(),
            generatedAIOutput: createGeneratedAIOutput(),
            runAIProgramReview: async () =>
              createReviewResult({
                decision: 'REPAIR_REQUIRED',
                requiresRepair: true,
                issues: [
                  createReviewIssue({
                    severity: 'HIGH',
                    repairability: 'REPAIRABLE',
                  }),
                ],
              }),
            runAIProgramRepair: async () => {
              throw providerError;
            },
          }
        ),
      (error) => error === providerError
    );
  });
});

test('malformed repair results fail before repaired validation and persistence', async (t) => {
  const cases = [
    null,
    { ...createRepairResult(), attemptNumber: 2 },
    { ...createRepairResult(), promptVersion: 'wrong-prompt' },
    { ...createRepairResult(), contractVersion: 2 },
    { ...createRepairResult(), outputSchemaVersion: 2 },
    { ...createRepairResult(), repairedAIOutput: null },
    {
      ...createRepairResult(),
      repairer: { ...createRepairResult().repairer, rawResponse: 'PRIVATE_RAW' },
    },
  ];

  for (const [index, repairResult] of cases.entries()) {
    await t.test(`case ${index + 1}`, async () => {
      let preflightCalls = 0;
      let analyticsCalls = 0;
      let reviewCalls = 0;
      let createCalls = 0;
      const baseDeps = createPhase3Deps();

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...baseDeps,
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              prepareAIWeeklyPlanDraftForCreate: async (payload) => {
                preflightCalls += 1;
                return baseDeps.prepareAIWeeklyPlanDraftForCreate(payload);
              },
              calculateWeeklyPlanAnalytics: async (input) => {
                analyticsCalls += 1;
                return calculateWeeklyPlanAnalytics(input);
              },
              runAIProgramReview: async () => {
                reviewCalls += 1;
                return createReviewResult({
                  decision: 'REPAIR_REQUIRED',
                  requiresRepair: true,
                  issues: [
                    createReviewIssue({
                      severity: 'HIGH',
                      repairability: 'REPAIRABLE',
                    }),
                  ],
                });
              },
              runAIProgramRepair: async () => repairResult,
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, 502);
          assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE');
          return true;
        }
      );

      assert.equal(preflightCalls, 1);
      assert.equal(analyticsCalls, 1);
      assert.equal(reviewCalls, 1);
      assert.equal(createCalls, 0);
    });
  }
});

test('final non-PASS review never triggers a second repair, audit, or persistence', async (t) => {
  for (const entry of [
    { decision: 'REPAIR_REQUIRED', requiresRepair: true, repairability: 'REPAIRABLE' },
    { decision: 'FAIL', requiresRepair: false, repairability: 'NON_REPAIRABLE' },
  ]) {
    await t.test(entry.decision, async () => {
      let repairCalls = 0;
      let reviewCalls = 0;
      let auditCalls = 0;
      let createCalls = 0;
      const privateIssue = createReviewIssue({
        severity: 'HIGH',
        repairability: entry.repairability,
        message: 'PRIVATE_FINAL_REVIEW_MESSAGE',
        path: '/plan/workouts/0',
        suggestedAction: 'PRIVATE_FINAL_REVIEW_ACTION',
      });

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              runAIProgramReview: async () => {
                reviewCalls += 1;
                if (reviewCalls === 1) {
                  return createReviewResult({
                    decision: 'REPAIR_REQUIRED',
                    requiresRepair: true,
                    issues: [
                      createReviewIssue({
                        severity: 'HIGH',
                        repairability: 'REPAIRABLE',
                      }),
                    ],
                  });
                }
                return createReviewResult({
                  decision: entry.decision,
                  requiresRepair: entry.requiresRepair,
                  issues: [privateIssue],
                });
              },
              runAIProgramRepair: async () => {
                repairCalls += 1;
                return createRepairResult();
              },
              buildWeeklyPlanGenerationContext: async () => {
                auditCalls += 1;
              },
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, 422);
          assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_FAILED');
          assert.deepEqual(Object.keys(error.details).sort(), [
            'categoryCounts',
            'finalDecision',
            'issueCount',
            'severityCounts',
          ]);
          assert.equal(error.details.finalDecision, entry.decision);
          assert.equal(error.details.issueCount, 1);
          assert.doesNotMatch(JSON.stringify(error.details), /PRIVATE_|\/plan\//);
          return true;
        }
      );

      assert.equal(repairCalls, 1);
      assert.equal(reviewCalls, 2);
      assert.equal(auditCalls, 0);
      assert.equal(createCalls, 0);
    });
  }
});

test('final review invalid and provider failures retain controlled review mappings', async (t) => {
  const providerError = Object.assign(new Error('final review unavailable'), {
    status: 503,
    code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
  });
  const cases = [
    {
      name: 'invalid result',
      final: { enabled: false, decision: 'PASS', requiresRepair: false },
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
    {
      name: 'domain validation error',
      error: new AIProgramReviewError(
        'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
        'PRIVATE_FINAL_REVIEW_SCHEMA_DETAIL'
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
    },
    {
      name: 'provider error',
      error: providerError,
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let reviewCalls = 0;
      let repairCalls = 0;
      let auditCalls = 0;
      let createCalls = 0;

      await assert.rejects(
        () =>
          createAIWeeklyPlanDraft(
            { userId: 'user_123' },
            {
              ...createPhase3Deps(),
              env: repairEnabledEnv(),
              buildProgramGenerationContext: async () => createContext(),
              generatedAIOutput: createGeneratedAIOutput(),
              runAIProgramReview: async () => {
                reviewCalls += 1;
                if (reviewCalls === 1) {
                  return createReviewResult({
                    decision: 'REPAIR_REQUIRED',
                    requiresRepair: true,
                    issues: [
                      createReviewIssue({
                        severity: 'HIGH',
                        repairability: 'REPAIRABLE',
                      }),
                    ],
                  });
                }
                if (entry.error) {
                  throw entry.error;
                }
                return entry.final;
              },
              runAIProgramRepair: async () => {
                repairCalls += 1;
                return createRepairResult();
              },
              buildWeeklyPlanGenerationContext: async () => {
                auditCalls += 1;
              },
              createWeeklyPlan: async () => {
                createCalls += 1;
              },
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.equal(error.details, undefined);
          if (entry.error === providerError) {
            assert.equal(error, providerError);
          } else {
            assert.doesNotMatch(error.message, /PRIVATE_/);
          }
          return true;
        }
      );

      assert.equal(reviewCalls, 2);
      assert.equal(repairCalls, 1);
      assert.equal(auditCalls, 0);
      assert.equal(createCalls, 0);
    });
  }
});

test('legacy REPAIR_REQUIRED cannot call repair while legacy PASS remains supported', async (t) => {
  await t.test('REPAIR_REQUIRED fails with repair input invalid', async () => {
    let repairCalls = 0;
    let createCalls = 0;
    await assert.rejects(
      () =>
        createAIWeeklyPlanDraft(
          { userId: 'user_123' },
          {
            ...createPhase3Deps(),
            env: repairEnabledEnv(),
            buildProgramGenerationContext: async () => createContext(),
            generatedPlanDocument: createGeneratedPlanDocument(),
            runAIProgramReview: async () =>
              createReviewResult({
                decision: 'REPAIR_REQUIRED',
                requiresRepair: true,
                issues: [
                  createReviewIssue({
                    severity: 'HIGH',
                    repairability: 'REPAIRABLE',
                  }),
                ],
              }),
            runAIProgramRepair: async () => {
              repairCalls += 1;
            },
            createWeeklyPlan: async () => {
              createCalls += 1;
            },
          }
        ),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID');
        assert.equal(error.details, undefined);
        return true;
      }
    );
    assert.equal(repairCalls, 0);
    assert.equal(createCalls, 0);
  });

  await t.test('PASS persists without repair', async () => {
    let repairCalls = 0;
    let createCalls = 0;
    await createAIWeeklyPlanDraft(
      { userId: 'user_123' },
      {
        ...createPhase3Deps(),
        env: repairEnabledEnv(),
        buildProgramGenerationContext: async () => createContext(),
        generatedPlanDocument: createGeneratedPlanDocument(),
        runAIProgramReview: async () => createReviewResult(),
        runAIProgramRepair: async () => {
          repairCalls += 1;
        },
        createWeeklyPlan: async () => {
          createCalls += 1;
          return { source: 'ai' };
        },
      }
    );
    assert.equal(repairCalls, 0);
    assert.equal(createCalls, 1);
  });
});
