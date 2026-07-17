const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAIWeeklyPlanDraft,
} = require('../../services/programGenerationService');
const {
  PROGRAM_GENERATION_PROMPT_VERSION,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
  buildWeeklyPlanAiJsonSchema,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  WeeklyPlanAnalyticsError,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  AIProgramReviewError,
} = require('../../src/domain/programGeneration/aiProgramReview');

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
    promptVersion: 'ai-program-review-prompt-v1.0.0',
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
    schemaVersion: 3,
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
  assert.equal(createPayload.generationContext.schemaVersion, 5);
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
  assert.equal(createPayload.generationContext.schemaVersion, 5);
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
      path: '/analytics/plan/estimatedDurationMinutesAverage',
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
    promptVersion: 'ai-program-review-prompt-v1.0.0',
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
