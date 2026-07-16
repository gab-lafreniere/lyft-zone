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
  };
}

function enabledEnv() {
  return {
    ENABLE_AI_WEEKLY_PLAN_BUILDER: 'true',
  };
}

function createContext(overrides = {}) {
  return {
    schemaVersion: 2,
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
  assert.equal(createPayload.generationContext.schemaVersion, 3);
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
  assert.equal(createPayload.generationContext.validationSummary.poolValidation.ok, true);
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
