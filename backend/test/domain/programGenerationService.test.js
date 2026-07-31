const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAIWeeklyPlanDraft,
} = require('../../services/programGenerationService');
const {
  createAiOutput,
  createAiExercise,
  clone,
  createContext,
  createPassReview,
} = require('./weeklyPlanAiV4Fixtures');
const {
  WeeklyPlanBackendDurationError,
  evaluateWeeklyPlanDurationGate,
} = require('../../src/domain/programGeneration/weeklyPlanBackendDuration');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');

function createOutputWithSeconds(targetSeconds) {
  const output = createAiOutput();
  output.workouts[0].blocks[0].exercises[0].setTemplates[0] = {
    ...output.workouts[0].blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    minReps: null,
    maxReps: null,
    targetSeconds,
  };
  return output;
}

function createDebugInvalidOutput(targetSeconds = 765) {
  const output = createOutputWithSeconds(targetSeconds);
  output.muscleDistributionDebug.omittedBodyParts.push({
    area: 'chest',
    reasonCode: 'specialization_tradeoff',
    explanation: 'Chest is incorrectly declared omitted despite direct work.',
  });
  return output;
}

function createSmokeRegressionOutput() {
  const output = createAiOutput();
  let noteIndex = 0;
  const createNotedExercise = (overrides = {}) => {
    noteIndex += 1;
    return createAiExercise({
      exerciseId: 'ex_bench',
      notes: `Necessary coaching note ${noteIndex}.`,
      ...overrides,
    });
  };

  output.sessionsPerWeek = 3;
  output.workouts = Array.from({ length: 3 }, (_, workoutIndex) => ({
    name: `Smoke Workout ${workoutIndex + 1}`,
    orderIndex: workoutIndex + 1,
    focus: 'Focused strength work',
    blocks: [
      {
        orderIndex: 1,
        blockType: 'SINGLE',
        exercises: [createNotedExercise()],
      },
      {
        orderIndex: 2,
        blockType: 'SUPERSET',
        exercises: [
          createNotedExercise({ orderIndex: 1 }),
          createNotedExercise({
            orderIndex: 2,
            defaultRestSeconds: null,
          }),
        ],
      },
      {
        orderIndex: 3,
        blockType: 'SINGLE',
        exercises: [createNotedExercise()],
      },
    ],
  }));
  return output;
}

function enableDebugCapture(fixture, writer = null) {
  const payloads = [];
  fixture.deps.env.ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS = 'true';
  fixture.deps.env.NODE_ENV = 'development';
  fixture.deps.writeWeeklyPlanGenerationDebugArtifacts =
    writer ||
    (async (payload) => {
      payloads.push(payload);
      return {
        jsonPath: `/tmp/${payload.stage}.json`,
        textPath: `/tmp/${payload.stage}.txt`,
      };
    });
  return payloads;
}

function createRepairRequiredReview() {
  const review = {
    schemaVersion: 3,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    reviewSummary: 'The plan requires one qualitative repair.',
    issues: [
      {
        issueIndex: 1,
        category: 'EXERCISE_REDUNDANCY',
        severity: 'HIGH',
        path: '/plan/workouts/0',
        message: 'The workout contains a redundant exercise choice.',
        repairability: 'REPAIRABLE',
        suggestedAction: 'Replace the redundant choice.',
      },
    ],
  };
  return {
    enabled: true,
    review,
    provider: {
      type: 'openai',
      model: 'review-model',
      responseId: 'resp_review_required',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        reasoningTokens: 0,
      },
    },
    promptVersion: 'ai-program-review-prompt-v1.3.0',
    contractVersion: 3,
    outputSchemaVersion: 3,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    issueCount: 1,
    severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
    categoryCounts: { EXERCISE_REDUNDANCY: 1 },
    repairIssues: review.issues,
  };
}

function createRepairResult(repairedAIOutput) {
  return {
    repairedAIOutput,
    repairer: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair',
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        reasoningTokens: 0,
      },
    },
    attemptNumber: 1,
    promptVersion: 'ai-weekly-plan-repair-prompt-v1.3.0',
    contractVersion: 4,
    outputSchemaVersion: 4,
  };
}

function createDeps({
  generatedAIOutput = createOutputWithSeconds(765),
  reviewEnabled = true,
  repairEnabled = false,
  runAIProgramReview = async () => createPassReview(),
  runAIProgramRepair,
} = {}) {
  const calls = [];
  let persistedPayload = null;
  let auditPayload = null;
  const deps = {
    env: {
      ENABLE_AI_WEEKLY_PLAN_BUILDER: 'true',
      ENABLE_AI_WEEKLY_PLAN_REVIEW: reviewEnabled ? 'true' : 'false',
      ENABLE_AI_WEEKLY_PLAN_REPAIR: repairEnabled ? 'true' : 'false',
      ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'false',
      NODE_ENV: 'test',
    },
    buildProgramGenerationContext: async () => {
      calls.push('context');
      return createContext({
        availability: {
          sessionsPerWeek: 1,
          durationPerSession: 25,
        },
      });
    },
    loadWeeklyPlanBuilderDoctrine: async () => {
      throw new Error('Doctrine must not be loaded in V4');
    },
    generatedAIOutput,
    prepareAIWeeklyPlanDraftForCreate: async (value) => {
      calls.push('preflight');
      return {
        document: value,
        businessRulesValidation: { ok: true, issueCount: 0 },
      };
    },
    runAIProgramReview: async (input) => {
      calls.push('review');
      return runAIProgramReview(input);
    },
    runAIProgramRepair: runAIProgramRepair
      ? async (input) => {
          calls.push('repair');
          return runAIProgramRepair(input);
        }
      : undefined,
    buildWeeklyPlanGenerationContext: async (input) => {
      calls.push('audit');
      auditPayload = input;
      return { schemaVersion: 9 };
    },
    createWeeklyPlan: async (input) => {
      calls.push('persist');
      persistedPayload = input;
      return { id: 'draft_v4', source: 'ai' };
    },
  };
  return {
    deps,
    calls,
    getPersistedPayload: () => persistedPayload,
    getAuditPayload: () => auditPayload,
  };
}

test('feature flag remains the first pipeline gate', async () => {
  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft(
        { userId: 'user_v4' },
        { env: { ENABLE_AI_WEEKLY_PLAN_BUILDER: 'false' } }
      ),
    (error) => error.code === 'AI_WEEKLY_PLAN_BUILDER_DISABLED'
  );
});

test('empty pool and unsupported profile goals fail before Generation', async (t) => {
  for (const entry of [
    {
      name: 'empty pool',
      context: createContext({
        poolSnapshot: {
          availableExerciseCount: 0,
          allowedExerciseIds: [],
          allowedTrainingTypes: [],
        },
        exercisePoolItems: [],
      }),
      code: 'EMPTY_EXERCISE_POOL',
    },
    {
      name: 'missing primary goal',
      context: createContext({ primaryGoal: null }),
      code: 'PROFILE_NOT_READY',
    },
    {
      name: 'temporarily unsupported primary goal',
      context: createContext({ primaryGoal: 'STRENGTH' }),
      code: 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL',
    },
  ]) {
    await t.test(entry.name, async () => {
      const fixture = createDeps();
      fixture.deps.buildProgramGenerationContext = async () =>
        entry.context;
      let generated = false;
      delete fixture.deps.generatedAIOutput;
      fixture.deps.generateWeeklyPlanAiOutput = async () => {
        generated = true;
      };

      await assert.rejects(
        () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
        (error) => error.code === entry.code
      );
      assert.equal(generated, false);
      assert.equal(fixture.calls.includes('persist'), false);
    });
  }
});

test('real provider path validates its result contract and preserves provider errors', async () => {
  const invalid = createDeps();
  delete invalid.deps.generatedAIOutput;
  invalid.deps.generateWeeklyPlanAiOutput = async () => ({
    generatedAIOutput: createOutputWithSeconds(765),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, invalid.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE'
  );
  assert.equal(invalid.calls.includes('persist'), false);

  const unavailable = createDeps();
  delete unavailable.deps.generatedAIOutput;
  const providerError = new Error('Provider unavailable');
  providerError.code = 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE';
  unavailable.deps.generateWeeklyPlanAiOutput = async () => {
    throw providerError;
  };

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, unavailable.deps),
    (error) => error === providerError
  );
  assert.equal(unavailable.calls.includes('persist'), false);
});

test('prompt and audit failures remain terminal before persistence', async () => {
  const promptFailure = createDeps();
  promptFailure.deps.buildProgramGenerationPrompt = () => {
    throw new Error('prompt sentinel');
  };
  await assert.rejects(
    () =>
      createAIWeeklyPlanDraft({ userId: 'user_v4' }, promptFailure.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_PROMPT_BUILD_FAILED'
  );
  assert.equal(promptFailure.calls.includes('persist'), false);

  const auditFailure = createDeps();
  auditFailure.deps.buildWeeklyPlanGenerationContext = async () => {
    throw new Error('audit sentinel');
  };
  await assert.rejects(() =>
    createAIWeeklyPlanDraft({ userId: 'user_v4' }, auditFailure.deps)
  );
  assert.equal(auditFailure.calls.includes('persist'), false);
});

test('V4 never loads doctrine and applies backend duration before Review and persistence', async () => {
  const fixture = createDeps();
  let reviewDocument;
  fixture.deps.runAIProgramReview = async (input) => {
    fixture.calls.push('review');
    reviewDocument = input.generatedPlanDocument;
    return createPassReview();
  };

  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  assert.equal(reviewDocument.workouts[0].estimatedDurationMinutes, 25);
  assert.equal(
    fixture.getPersistedPayload().workouts[0].estimatedDurationMinutes,
    25
  );
  assert.equal(fixture.calls.indexOf('preflight') < fixture.calls.indexOf('review'), true);
  assert.equal(fixture.calls.indexOf('review') < fixture.calls.indexOf('persist'), true);
  assert.equal(
    fixture.getAuditPayload().analytics.workouts[0].durationCalculation
      .calculatedDurationMinutes,
    25
  );
});

test('duration gate blocks Review and persistence when Repair is disabled', async () => {
  const fixture = createDeps({
    generatedAIOutput: createOutputWithSeconds(100),
    repairEnabled: false,
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED');
      assert.deepEqual(error.details.workouts[0].acceptableDurationMinutes, {
        minimum: 22,
        maximum: 26,
      });
      return true;
    }
  );
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('smoke regression fixture reaches Analytics and real backend duration gate before Review', async () => {
  const generatedAIOutput = createSmokeRegressionOutput();
  const fixture = createDeps({
    generatedAIOutput,
    repairEnabled: false,
  });
  fixture.deps.buildProgramGenerationContext = async () => {
    fixture.calls.push('context');
    return createContext({
      availability: {
        sessionsPerWeek: 3,
        durationPerSession: 15,
      },
    });
  };
  let analyticsResult = null;
  let durationGateInput = null;
  fixture.deps.calculateWeeklyPlanAnalytics = async (input) => {
    fixture.calls.push('analytics');
    analyticsResult = calculateWeeklyPlanAnalytics(input);
    return analyticsResult;
  };
  fixture.deps.evaluateWeeklyPlanDurationGate = (analytics) => {
    fixture.calls.push('duration_gate');
    durationGateInput = analytics;
    return evaluateWeeklyPlanDurationGate(analytics);
  };

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED');
      assert.equal(
        error.details.workouts.every(
          (workout) =>
            Number.isInteger(workout.calculatedDurationMinutes) &&
            workout.calculatedDurationMinutes > 0
        ),
        true
      );
      return true;
    }
  );

  assert.equal(analyticsResult.workouts.length, 3);
  assert.equal(durationGateInput, analyticsResult);
  assert.equal(
    analyticsResult.workouts.every(
      (workout) =>
        Number.isInteger(workout.calculatedDurationMinutes) &&
        workout.calculatedDurationMinutes > 0
    ),
    true
  );
  assert.equal(
    fixture.calls.indexOf('analytics') < fixture.calls.indexOf('duration_gate'),
    true
  );
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('excessive notes do not override the global code for real structural errors', async () => {
  const generatedAIOutput = createSmokeRegressionOutput();
  generatedAIOutput.workouts[0].orderIndex = 2;
  generatedAIOutput.workouts[0].blocks[0].exercises[0].defaultRestSeconds =
    null;
  const fixture = createDeps({ generatedAIOutput });
  fixture.deps.buildProgramGenerationContext = async () =>
    createContext({
      availability: {
        sessionsPerWeek: 3,
        durationPerSession: 15,
      },
    });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_INVALID_OUTPUT');
      assert.equal(
        error.details.issues.some(
          (issue) => issue.code === 'ORDER_INDEX_NOT_SEQUENTIAL'
        ),
        true
      );
      assert.equal(
        error.details.issues.some((issue) => issue.code === 'REQUIRED'),
        true
      );
      assert.equal(
        error.details.issues.some(
          (issue) => issue.code === 'NOTES_POLICY_VIOLATION'
        ),
        false
      );
      return true;
    }
  );
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('Review disabled never disables the duration gate', async () => {
  const fixture = createDeps({
    generatedAIOutput: createOutputWithSeconds(100),
    reviewEnabled: false,
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED'
  );
  assert.equal(fixture.calls.includes('persist'), false);
});

test('DURATION Repair receives true backend values, runs once, recalculates, Reviews, and persists', async () => {
  let repairInput;
  const fixture = createDeps({
    generatedAIOutput: createOutputWithSeconds(100),
    repairEnabled: true,
    runAIProgramRepair: async (input) => {
      repairInput = input;
      return createRepairResult(createOutputWithSeconds(765));
    },
  });

  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  assert.equal(repairInput.trigger, 'DURATION');
  assert.equal(repairInput.initialReview, null);
  assert.equal(repairInput.analytics.workouts[0].calculatedDurationMinutes, 14);
  assert.equal(JSON.stringify(repairInput).includes('203'), false);
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.filter((call) => call === 'review').length, 1);
  assert.equal(
    fixture.getPersistedPayload().workouts[0].estimatedDurationMinutes,
    25
  );
  assert.equal(fixture.getAuditPayload().aiRepair.trigger, 'DURATION');
  assert.equal(fixture.getAuditPayload().aiRepair.initialReviewSummary, null);
});

test('DURATION Repair still invalid fails before Review and persistence', async () => {
  const fixture = createDeps({
    generatedAIOutput: createOutputWithSeconds(100),
    repairEnabled: true,
    runAIProgramRepair: async () =>
      createRepairResult(createOutputWithSeconds(200)),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_DURATION_REPAIR_FAILED'
  );
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('Review cannot consume a second Repair after DURATION Repair', async () => {
  const fixture = createDeps({
    generatedAIOutput: createOutputWithSeconds(100),
    repairEnabled: true,
    runAIProgramRepair: async () =>
      createRepairResult(createOutputWithSeconds(765)),
    runAIProgramReview: async () => createRepairRequiredReview(),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_REPAIR_BUDGET_EXHAUSTED'
  );
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('qualitative REVIEW Repair can consume the free budget and reach final PASS', async () => {
  let reviewCount = 0;
  let repairInput;
  const fixture = createDeps({
    repairEnabled: true,
    runAIProgramReview: async () => {
      reviewCount += 1;
      return reviewCount === 1
        ? createRepairRequiredReview()
        : createPassReview();
    },
    runAIProgramRepair: async (input) => {
      repairInput = input;
      return createRepairResult(createOutputWithSeconds(765));
    },
  });

  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  assert.equal(repairInput.trigger, 'REVIEW');
  assert.equal(repairInput.initialReview.decision, 'REPAIR_REQUIRED');
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.filter((call) => call === 'review').length, 2);
  assert.equal(fixture.calls.includes('persist'), true);
  assert.equal(fixture.getAuditPayload().aiRepair.trigger, 'REVIEW');
});

test('qualitative REVIEW Repair that makes duration invalid fails before final Review', async () => {
  let reviewCount = 0;
  const fixture = createDeps({
    repairEnabled: true,
    runAIProgramReview: async () => {
      reviewCount += 1;
      return createRepairRequiredReview();
    },
    runAIProgramRepair: async () =>
      createRepairResult(createOutputWithSeconds(100)),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => error.code === 'AI_WEEKLY_PLAN_REPAIR_DURATION_INVALID'
  );
  assert.equal(reviewCount, 1);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('Review-disabled valid plans still persist only after the duration gate passes', async () => {
  const fixture = createDeps({ reviewEnabled: false });
  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), true);
  assert.equal(
    fixture.getPersistedPayload().workouts[0].estimatedDurationMinutes,
    25
  );
});

test('every initial early failure writes its real stage and appends artifact paths', async (t) => {
  const cases = [
    {
      name: 'schema',
      stage: 'schema_validation_failed',
      configure(fixture) {
        fixture.deps.generatedAIOutput = {
          ...clone(fixture.deps.generatedAIOutput),
          schemaVersion: 3,
        };
      },
    },
    {
      name: 'semantic',
      stage: 'semantic_validation_failed',
      configure(fixture) {
        fixture.deps.generatedAIOutput.workouts[0].orderIndex = 2;
      },
    },
    {
      name: 'normalization',
      stage: 'normalization_failed',
      configure(fixture) {
        fixture.deps.normalizeInitialWeeklyPlanAiOutput = () => {
          throw new Error('normalization sentinel');
        };
      },
    },
    {
      name: 'pool',
      stage: 'pool_validation_failed',
      configure(fixture) {
        fixture.deps.generatedAIOutput.workouts[0].blocks[0].exercises[0]
          .exerciseId = 'outside_pool';
      },
    },
    {
      name: 'business rules',
      stage: 'business_rules_failed',
      configure(fixture) {
        fixture.deps.prepareAIWeeklyPlanDraftForCreate = async () => {
          const error = new Error('business sentinel');
          error.code = 'BUSINESS_SENTINEL';
          throw error;
        };
      },
    },
    {
      name: 'Analytics',
      stage: 'analytics_failed',
      configure(fixture) {
        fixture.deps.calculateWeeklyPlanAnalytics = async () => {
          const error = new Error('analytics sentinel');
          error.code = 'ANALYTICS_SENTINEL';
          throw error;
        };
      },
    },
    {
      name: 'backend duration application',
      stage: 'backend_duration_application_failed',
      configure(fixture) {
        fixture.deps.applyBackendCalculatedDurationsToPlanDocument = () => {
          throw new WeeklyPlanBackendDurationError(
            'DURATION_SENTINEL',
            'duration sentinel'
          );
        };
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fixture = createDeps();
      const payloads = enableDebugCapture(fixture);
      entry.configure(fixture);

      await assert.rejects(
        () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
        (error) => {
          assert.equal(
            error.details.debugArtifact.jsonPath,
            `/tmp/${entry.stage}.json`
          );
          assert.equal(
            error.details.debugArtifact.textPath,
            `/tmp/${entry.stage}.txt`
          );
          return true;
        }
      );
      assert.equal(payloads.length, 1);
      assert.equal(payloads[0].stage, entry.stage);
      assert.equal(payloads[0].repairAttempted, false);
      assert.equal(fixture.calls.includes('review'), false);
      assert.equal(fixture.calls.includes('persist'), false);
    });
  }
});

test('debug writer failure never changes the original business result', async () => {
  const fixture = createDeps();
  fixture.deps.generatedAIOutput.schemaVersion = 3;
  enableDebugCapture(fixture, async () => {
    throw new Error('writer sentinel');
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_SCHEMA_VALIDATION_FAILED');
      assert.equal(error.details.debugArtifact, undefined);
      return true;
    }
  );
});

test('equivalent Repair candidate failures keep Repair metadata in artifacts', async (t) => {
  const cases = [
    {
      name: 'schema',
      stage: 'schema_validation_failed',
      repairedOutput() {
        return { ...createOutputWithSeconds(765), schemaVersion: 3 };
      },
    },
    {
      name: 'semantic',
      stage: 'semantic_validation_failed',
      repairedOutput() {
        const output = createOutputWithSeconds(765);
        output.workouts[0].orderIndex = 2;
        return output;
      },
    },
    {
      name: 'normalization',
      stage: 'normalization_failed',
      repairedOutput: () => createOutputWithSeconds(765),
      configure(fixture) {
        fixture.deps.normalizeWeeklyPlanAiOutput = () => {
          throw new Error('repair normalization sentinel');
        };
      },
    },
    {
      name: 'pool',
      stage: 'pool_validation_failed',
      repairedOutput() {
        const output = createOutputWithSeconds(765);
        output.workouts[0].blocks[0].exercises[0].exerciseId =
          'outside_pool';
        return output;
      },
    },
    {
      name: 'business rules',
      stage: 'business_rules_failed',
      repairedOutput: () => createOutputWithSeconds(765),
      configure(fixture) {
        let callCount = 0;
        const original = fixture.deps.prepareAIWeeklyPlanDraftForCreate;
        fixture.deps.prepareAIWeeklyPlanDraftForCreate = async (value) => {
          callCount += 1;
          if (callCount === 2) {
            throw new Error('repair business sentinel');
          }
          return original(value);
        };
      },
    },
    {
      name: 'Analytics',
      stage: 'analytics_failed',
      repairedOutput: () => createOutputWithSeconds(765),
      configure(fixture) {
        let callCount = 0;
        const {
          calculateWeeklyPlanAnalytics,
        } = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
        fixture.deps.calculateWeeklyPlanAnalytics = async (input) => {
          callCount += 1;
          if (callCount === 2) {
            throw new Error('repair analytics sentinel');
          }
          return calculateWeeklyPlanAnalytics(input);
        };
      },
    },
    {
      name: 'backend duration application',
      stage: 'backend_duration_application_failed',
      repairedOutput: () => createOutputWithSeconds(765),
      configure(fixture) {
        let callCount = 0;
        const {
          applyBackendCalculatedDurationsToPlanDocument,
        } = require('../../src/domain/programGeneration/weeklyPlanBackendDuration');
        fixture.deps.applyBackendCalculatedDurationsToPlanDocument = (
          document,
          analytics
        ) => {
          callCount += 1;
          if (callCount === 2) {
            throw new WeeklyPlanBackendDurationError(
              'REPAIR_DURATION_SENTINEL',
              'repair duration sentinel'
            );
          }
          return applyBackendCalculatedDurationsToPlanDocument(
            document,
            analytics
          );
        };
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fixture = createDeps({
        generatedAIOutput: createOutputWithSeconds(100),
        repairEnabled: true,
        runAIProgramRepair: async () =>
          createRepairResult(entry.repairedOutput()),
      });
      const payloads = enableDebugCapture(fixture);
      entry.configure?.(fixture);

      await assert.rejects(() =>
        createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps)
      );

      const failurePayload = payloads.at(-1);
      assert.equal(failurePayload.stage, entry.stage);
      assert.equal(failurePayload.repairAttempted, true);
      assert.equal(failurePayload.repairTrigger, 'DURATION');
      assert.equal(failurePayload.repairProvider.responseId, 'resp_repair');
      assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
      assert.equal(fixture.calls.includes('review'), false);
      assert.equal(fixture.calls.includes('persist'), false);
    });
  }
});

test('valid duration plus invalid debug contract fails before Review and persistence', async () => {
  const fixture = createDeps({
    generatedAIOutput: createDebugInvalidOutput(),
  });
  const payloads = enableDebugCapture(fixture);

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(
        error.code,
        'AI_WEEKLY_PLAN_GENERATION_DEBUG_CONTRACT_VALIDATION_FAILED'
      );
      assert.equal(
        error.details.debugArtifact.jsonPath,
        '/tmp/debug_contract_validation_failed.json'
      );
      return true;
    }
  );
  assert.equal(payloads.at(-1).stage, 'debug_contract_validation_failed');
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('invalid duration plus invalid debug contract uses the same DURATION Repair', async () => {
  let repairInput;
  const fixture = createDeps({
    generatedAIOutput: createDebugInvalidOutput(100),
    repairEnabled: true,
    runAIProgramRepair: async (input) => {
      repairInput = input;
      return createRepairResult(createOutputWithSeconds(765));
    },
  });

  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  assert.equal(repairInput.trigger, 'DURATION');
  assert.equal(repairInput.debugContractValidation.ok, false);
  assert.equal(
    repairInput.debugContractValidation.issues.some(
      (issue) => issue.code === 'FALSE_OMISSION_DECLARATION'
    ),
    true
  );
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.filter((call) => call === 'review').length, 1);
  assert.equal(fixture.calls.includes('persist'), true);
});

test('invalid duration without Repair keeps duration error and includes debug issues', async () => {
  const fixture = createDeps({
    generatedAIOutput: createDebugInvalidOutput(100),
    repairEnabled: false,
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED');
      assert.equal(
        error.details.debugContractIssues.some(
          (issue) => issue.code === 'FALSE_OMISSION_DECLARATION'
        ),
        true
      );
      return true;
    }
  );
});

test('DURATION Repair must pass both duration and debug contract gates', async () => {
  const fixture = createDeps({
    generatedAIOutput: createDebugInvalidOutput(100),
    repairEnabled: true,
    runAIProgramRepair: async () =>
      createRepairResult(createDebugInvalidOutput(765)),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) =>
      error.code ===
      'AI_WEEKLY_PLAN_REPAIR_DEBUG_CONTRACT_VALIDATION_FAILED'
  );
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.includes('review'), false);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('REVIEW Repair cannot introduce an invalid debug contract', async () => {
  let reviewCount = 0;
  const fixture = createDeps({
    repairEnabled: true,
    runAIProgramReview: async () => {
      reviewCount += 1;
      return createRepairRequiredReview();
    },
    runAIProgramRepair: async () =>
      createRepairResult(createDebugInvalidOutput(765)),
  });

  await assert.rejects(
    () => createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps),
    (error) =>
      error.code ===
      'AI_WEEKLY_PLAN_REPAIR_DEBUG_CONTRACT_VALIDATION_FAILED'
  );
  assert.equal(reviewCount, 1);
  assert.equal(fixture.calls.filter((call) => call === 'repair').length, 1);
  assert.equal(fixture.calls.includes('persist'), false);
});

test('no-Repair Review-disabled success uses duration_gate_passed coherently', async () => {
  const fixture = createDeps({ reviewEnabled: false });
  const payloads = enableDebugCapture(fixture);

  await createAIWeeklyPlanDraft({ userId: 'user_v4' }, fixture.deps);

  const finalPayload = payloads.at(-1);
  assert.equal(finalPayload.stage, 'duration_gate_passed');
  assert.equal(finalPayload.repairAttempted, false);
  assert.equal(finalPayload.repairTrigger, null);
  assert.equal(finalPayload.repairProvider, null);
});
