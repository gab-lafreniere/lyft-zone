const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIReviewAuditMetadata,
  buildWeeklyPlanGenerationContext,
} = require('../../src/domain/programGeneration/weeklyPlanGenerationAudit');
const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/programGenerationContextBuilder');
const {
  PROGRAM_GENERATION_PROMPT_VERSION,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
  WeeklyPlanAnalyticsError,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext(overrides = {}) {
  return {
    schemaVersion: 4,
    generationMode: 'weekly_plan_draft',
    createdAt: '2026-06-01T12:00:00.000Z',
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
    coachInputs: {
      doctrineId: 'bodybuilding_runtime_classic',
      doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
      derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
      promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
    },
    ...overrides,
  };
}

function createAnalytics(overrides = {}) {
  return {
    schemaVersion: 2,
    status: 'partial',
    evaluationPolicy: {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    },
    plan: {
      workoutCount: 1,
      blockCount: 1,
      exerciseCount: 1,
      strengthExerciseCount: 1,
      cardioExerciseCount: 0,
      uniqueExerciseCount: 1,
      workingSetCount: 3,
      totalSetTemplateCount: 3,
      singleBlockCount: 1,
      supersetBlockCount: 0,
      cardioBlockCount: 0,
      requestedDurationMinutesPerWorkout: 60,
      requestedDurationMinutesTotal: 60,
      calculatedDurationMinutesTotal: 42,
      calculatedDurationMinutesAverage: 42,
      estimatedDurationMinutesTotal: 42,
      estimatedDurationMinutesAverage: 42,
      declaredEstimatedDurationMinutesTotal: 60,
      durationDifferenceMinutesTotal: -18,
      declaredDurationDifferenceMinutesTotal: -18,
      durationAlignmentStatusCounts: {
        [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 1,
        [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.PREFERRED]: 0,
        [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.UNAVAILABLE]: 0,
      },
      correctionRequiredWorkoutCount: 1,
      minWorkoutDurationMinutes: 42,
      maxWorkoutDurationMinutes: 42,
      cardioDurationMinutes: 0,
      bodyPartDistribution: [{ key: 'PRIVATE_BODY_PART_DISTRIBUTION_SENTINEL' }],
      muscleDistribution: [{ key: 'PRIVATE_MUSCLE_DISTRIBUTION_SENTINEL' }],
    },
    workouts: [{ name: 'PRIVATE_WORKOUT_NAME_SENTINEL' }],
    muscleMetrics: [{ exerciseName: 'PRIVATE_EXERCISE_NAME_SENTINEL' }],
    metadataCoverage: {
      totalStrengthWorkingSets: 3,
      attributedStrengthWorkingSets: 0,
      coverageRatio: 0,
      unresolvedExerciseIds: ['PRIVATE_UNRESOLVED_EXERCISE_ID_SENTINEL'],
    },
    targetComparisons: {
      volume: {
        summary: {
          targetCount: 2,
          belowTargetCount: 1,
          withinTargetCount: 0,
          aboveTargetCount: 1,
          unavailableCount: 0,
        },
        items: [{ rationale: 'PRIVATE_TARGET_RATIONALE_SENTINEL' }],
      },
      frequency: {
        summary: {
          targetCount: 1,
          belowTargetCount: 0,
          withinTargetCount: 1,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
        items: [],
      },
    },
    ...overrides,
  };
}

test('buildWeeklyPlanGenerationContext persists compact doctrine and prompt metadata only', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: createContext({
      profileSchemaVersion: 2,
      primaryGoal: 'HYPERTROPHY',
      experience: 'intermediate',
      availability: { sessionsPerWeek: 4, durationPerSession: 60 },
      equipmentContext: {},
      movementConstraints: {},
      cardioProfile: {},
      physicalNotes: 'PRIVATE_PROFILE_NOTE_SENTINEL',
      coachInputs: {
        doctrineId: 'bodybuilding_runtime_classic',
        doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
        derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
        promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
      },
      doctrineContent: 'FULL_DOCTRINE_CONTENT_SENTINEL',
      systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
      userMessage: 'USER_MESSAGE_SENTINEL',
      poolSnapshot: {
        checksum: 'checksum',
      },
    }),
    generatedPlanDocument: {
      strategySummary: 'Static hypertrophy plan.',
    },
    validation: {
      ok: true,
      issues: [],
      uniqueExerciseIds: ['ex_db_bench'],
    },
    analytics: createAnalytics(),
    generator: {
      type: 'mock',
      model: null,
      rawResponse: 'RAW_PROVIDER_RESPONSE_SENTINEL',
      requestId: 'req_http_private_123',
    },
  });

  assert.equal(GENERATION_CONTEXT_SCHEMA_VERSION, 6);
  assert.equal(generationContext.schemaVersion, 6);
  assert.deepEqual(generationContext.evaluationPolicy, {
    id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
    version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  });
  assert.deepEqual(Object.keys(generationContext.evaluationPolicy), ['id', 'version']);
  [
    'generator',
    'aiContractVersion',
    'aiOutputSchemaVersion',
    'poolSnapshot',
    'profileSnapshotSummary',
    'strategySummary',
    'splitType',
    'volumeTargets',
    'frequencyTargets',
    'progressionModel',
    'cautionHandling',
    'notesPolicy',
    'aiReview',
    'repairAttempts',
  ].forEach((field) => {
    assert.equal(Object.prototype.hasOwnProperty.call(generationContext, field), true);
  });
  assert.equal(generationContext.doctrineId, 'bodybuilding_runtime_classic');
  assert.equal(
    generationContext.doctrineVersion,
    'bodybuilding-hypertrophy-runtime-classic-v1.0.0'
  );
  assert.equal(
    generationContext.derivedFromDoctrineVersion,
    'bodybuilding-hypertrophy-v1.0.0'
  );
  assert.equal(
    generationContext.promptVersion,
    PROGRAM_GENERATION_PROMPT_VERSION
  );
  assert.equal(generationContext.profileSnapshotSummary.hasPhysicalNotes, true);
  assert.deepEqual(generationContext.generator, {
    type: 'mock',
    model: null,
    responseId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });

  const serialized = JSON.stringify(generationContext);
  assert.doesNotMatch(serialized, /FULL_DOCTRINE_CONTENT_SENTINEL/);
  assert.doesNotMatch(serialized, /SYSTEM_MESSAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /USER_MESSAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_PROFILE_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_PROVIDER_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /req_http_private_123/);
  assert.equal(generationContext.systemMessage, undefined);
  assert.equal(generationContext.userMessage, undefined);
  assert.equal(generationContext.validationSummary.poolValidation.uniqueExerciseCount, 1);
  assert.equal(generationContext.validationSummary.businessRulesValidation, null);
  assert.equal(generationContext.validationSummary.analytics.schemaVersion, 2);
  assert.equal(generationContext.repairAttempts, 0);
  assert.deepEqual(generationContext.aiReview, {
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

  assert.doesNotMatch(serialized, /historical_weekly_plan_metrics_v1/);
  assert.doesNotMatch(serialized, /differenceOperation|ratioOperation|classificationRatio/);
  assert.doesNotMatch(serialized, /minInclusive|maxInclusive|minExclusive|maxExclusive/);
});

test('buildWeeklyPlanGenerationContext creates deterministic V6 audit with allowlisted Analytics V2', () => {
  const analytics = createAnalytics();
  const input = {
    context: createContext({
      coachInputs: {},
      poolSnapshot: { checksum: 'checksum' },
    }),
    generatedAIOutput: {
      schemaVersion: 1,
      strategySummary: 'Provider strategy summary.',
    },
    validation: {
      schemaValidation: { ok: true, issues: [] },
      semanticValidation: { ok: true, issues: [], summary: {} },
      poolValidation: {
        ok: true,
        issues: [],
        uniqueExerciseIds: ['ex_db_bench', 'ex_row'],
      },
    },
    businessRulesValidation: { ok: true, issueCount: 0 },
    analytics,
    generator: {
      type: 'openai',
      model: 'gpt-program-model',
      responseId: 'resp_audit_123',
      usage: {
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        reasoningTokens: 250,
        rawUsage: 'RAW_USAGE_SENTINEL',
      },
      rawResponse: 'RAW_RESPONSE_SENTINEL',
      outputText: 'RAW_OUTPUT_TEXT_SENTINEL',
      requestId: 'req_http_private_456',
    },
  };
  const originalInput = clone(input);
  const generationContext = buildWeeklyPlanGenerationContext(input);
  const repeatedGenerationContext = buildWeeklyPlanGenerationContext(input);

  assert.equal(generationContext.schemaVersion, 6);
  assert.deepEqual(generationContext.evaluationPolicy, {
    id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
    version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  });
  assert.deepEqual(generationContext.generator, {
    type: 'openai',
    model: 'gpt-program-model',
    responseId: 'resp_audit_123',
    usage: {
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      reasoningTokens: 250,
    },
  });
  assert.equal(generationContext.strategySummary, 'Provider strategy summary.');
  assert.deepEqual(generationContext.validationSummary.poolValidation, {
    ok: true,
    issueCount: 0,
    uniqueExerciseIds: ['ex_db_bench', 'ex_row'],
    uniqueExerciseCount: 2,
  });
  assert.deepEqual(generationContext.validationSummary.businessRulesValidation, {
    ok: true,
    issueCount: 0,
  });
  assert.deepEqual(generationContext.validationSummary.analytics, {
    schemaVersion: 2,
    status: 'partial',
    evaluationPolicy: {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    },
    counts: {
      workoutCount: 1,
      blockCount: 1,
      exerciseCount: 1,
      strengthExerciseCount: 1,
      cardioExerciseCount: 0,
      uniqueExerciseCount: 1,
      workingSetCount: 3,
      totalSetTemplateCount: 3,
      singleBlockCount: 1,
      supersetBlockCount: 0,
      cardioBlockCount: 0,
    },
    duration: {
      requestedDurationMinutesPerWorkout: 60,
      requestedDurationMinutesTotal: 60,
      calculatedDurationMinutesTotal: 42,
      calculatedDurationMinutesAverage: 42,
      declaredEstimatedDurationMinutesTotal: 60,
      durationDifferenceMinutesTotal: -18,
      declaredDurationDifferenceMinutesTotal: -18,
      estimatedDurationMinutesTotal: 42,
      estimatedDurationMinutesAverage: 42,
      minWorkoutDurationMinutes: 42,
      maxWorkoutDurationMinutes: 42,
      cardioDurationMinutes: 0,
      durationAlignmentStatusCounts: {
        [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET]: 1,
        [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.PREFERRED]: 0,
        [DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET]: 0,
        [DURATION_ALIGNMENT_STATUS.UNAVAILABLE]: 0,
      },
      correctionRequiredWorkoutCount: 1,
    },
    muscleMetadata: {
      totalStrengthWorkingSets: 3,
      attributedStrengthWorkingSets: 0,
      coverageRatio: 0,
      unresolvedExerciseCount: 1,
    },
    targetComparisons: {
      volume: {
        targetCount: 2,
        belowTargetCount: 1,
        withinTargetCount: 0,
        aboveTargetCount: 1,
        unavailableCount: 0,
      },
      frequency: {
        targetCount: 1,
        belowTargetCount: 0,
        withinTargetCount: 1,
        aboveTargetCount: 0,
        unavailableCount: 0,
      },
    },
  });
  assert.equal(generationContext.validationSummary.analytics.workouts, undefined);
  assert.equal(generationContext.validationSummary.analytics.muscleMetrics, undefined);
  assert.equal(
    generationContext.validationSummary.analytics.targetComparisons.volume.items,
    undefined
  );
  assert.equal(generationContext.repairAttempts, 0);
  assert.deepEqual(repeatedGenerationContext, generationContext);
  assert.deepEqual(input, originalInput);

  const serialized = JSON.stringify(generationContext);
  assert.doesNotMatch(serialized, /RAW_USAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_OUTPUT_TEXT_SENTINEL/);
  assert.doesNotMatch(serialized, /req_http_private_456/);
  assert.doesNotMatch(serialized, /PRIVATE_WORKOUT_NAME_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_EXERCISE_NAME_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_UNRESOLVED_EXERCISE_ID_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_TARGET_RATIONALE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_BODY_PART_DISTRIBUTION_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_MUSCLE_DISTRIBUTION_SENTINEL/);
  assert.doesNotMatch(serialized, /bodyPartDistribution|muscleDistribution/);
  assert.doesNotMatch(serialized, /historical_weekly_plan_metrics_v1/);
  assert.doesNotMatch(serialized, /differenceOperation|ratioOperation|classificationRatio/);
});

test('buildWeeklyPlanGenerationContext normalizes absent OpenAI metadata to null', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: createContext(),
    generatedPlanDocument: {},
    validation: { ok: true, issues: [] },
    analytics: createAnalytics(),
    generator: {
      type: 'openai',
      model: ' ',
      responseId: '',
      usage: {
        inputTokens: -1,
        outputTokens: 1.5,
        totalTokens: '20',
      },
    },
  });

  assert.deepEqual(generationContext.generator, {
    type: 'openai',
    model: null,
    responseId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
  assert.equal(generationContext.validationSummary.businessRulesValidation, null);
  assert.equal(generationContext.validationSummary.analytics.schemaVersion, 2);
});

test('buildWeeklyPlanGenerationContext requires canonical policy identity and Analytics V2', () => {
  const baseInput = () => ({
    context: createContext(),
    generatedPlanDocument: {},
    validation: { ok: true, issues: [] },
    analytics: createAnalytics(),
  });
  const invalidInputs = [];

  {
    const input = baseInput();
    input.context.evaluationPolicy = undefined;
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.context.evaluationPolicy = {
      ...WEEKLY_PLAN_EVALUATION_POLICY,
      id: 'wrong_policy',
    };
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.context.evaluationPolicy = {
      ...WEEKLY_PLAN_EVALUATION_POLICY,
      version: 999,
    };
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.analytics = undefined;
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.analytics.schemaVersion = 1;
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.analytics.evaluationPolicy = undefined;
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.analytics.evaluationPolicy = {
      id: 'wrong_policy',
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    };
    invalidInputs.push(input);
  }
  {
    const input = baseInput();
    input.analytics.evaluationPolicy = {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: 999,
    };
    invalidInputs.push(input);
  }

  invalidInputs.forEach((input) => {
    assert.throws(
      () => buildWeeklyPlanGenerationContext(input),
      (error) => {
        assert.equal(error instanceof WeeklyPlanAnalyticsError, true);
        assert.equal(error.code, 'INVALID_WEEKLY_PLAN_ANALYTICS');
        assert.equal(error.message, 'A valid weekly plan analytics result is required');
        return true;
      }
    );
  });
});

test('buildWeeklyPlanGenerationContext accepts only ProgramGenerationContext V4 without mutation', () => {
  const createInput = (schemaVersion) => ({
    context: createContext({ schemaVersion }),
    generatedPlanDocument: {},
    validation: { ok: true, issues: [] },
    analytics: createAnalytics(),
  });
  const validInput = createInput(PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION);
  const originalValidInput = clone(validInput);
  const generationContext = buildWeeklyPlanGenerationContext(validInput);

  assert.equal(PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION, 4);
  assert.equal(validInput.context.schemaVersion, 4);
  assert.equal(generationContext.schemaVersion, 6);
  assert.deepEqual(validInput, originalValidInput);

  [3, undefined, 5].forEach((schemaVersion) => {
    const input = createInput(schemaVersion);
    if (schemaVersion === undefined) {
      delete input.context.schemaVersion;
    }
    const originalInput = clone(input);

    assert.throws(
      () => buildWeeklyPlanGenerationContext(input),
      (error) => {
        assert.equal(error instanceof WeeklyPlanAnalyticsError, true);
        assert.equal(error.code, 'INVALID_WEEKLY_PLAN_ANALYTICS');
        assert.equal(error.message, 'A valid weekly plan analytics result is required');
        return true;
      }
    );
    assert.deepEqual(input, originalInput);
  });
});

test('buildAIReviewAuditMetadata persists only allowlisted PASS review data', () => {
  const metadata = buildAIReviewAuditMetadata({
    enabled: true,
    promptVersion: 'ai-program-review-prompt-v1.1.0',
    contractVersion: 1,
    outputSchemaVersion: 1,
    reviewInput: {
      schemaVersion: 2,
      evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
      private: 'PRIVATE_REVIEW_INPUT_SENTINEL',
    },
    provider: {
      type: 'openai',
      model: 'review-model',
      responseId: 'resp_review_123',
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        reasoningTokens: 10,
        rawUsage: 'RAW_REVIEW_USAGE_SENTINEL',
      },
      rawResponse: 'RAW_REVIEW_RESPONSE_SENTINEL',
      rawProviderMetadata: 'RAW_REVIEW_PROVIDER_METADATA_SENTINEL',
    },
    review: {
      schemaVersion: 1,
      decision: 'PASS',
      requiresRepair: false,
      reviewSummary: 'Plan review passed.',
      issues: [
        {
          category: 'NOTES_POLICY',
          severity: 'LOW',
          path: '/plan/notesSummary',
          message: 'PRIVATE_REVIEW_MESSAGE_SENTINEL',
          suggestedAction: 'PRIVATE_REVIEW_ACTION_SENTINEL',
        },
      ],
    },
  });

  assert.deepEqual(metadata, {
    enabled: true,
    outcome: 'PASSED',
    reviewAttempts: 1,
    schemaVersion: 1,
    contractVersion: 1,
    outputSchemaVersion: 1,
    promptVersion: 'ai-program-review-prompt-v1.1.0',
    decision: 'PASS',
    requiresRepair: false,
    issueCount: 1,
    severityCounts: { INFO: 0, LOW: 1, MEDIUM: 0, HIGH: 0 },
    categoryCounts: { NOTES_POLICY: 1 },
    reviewSummary: 'Plan review passed.',
    provider: {
      type: 'openai',
      model: 'review-model',
      responseId: 'resp_review_123',
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        reasoningTokens: 10,
      },
    },
  });

  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /RAW_REVIEW_USAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_REVIEW_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_REVIEW_MESSAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_REVIEW_ACTION_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_REVIEW_INPUT_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_REVIEW_PROVIDER_METADATA_SENTINEL/);
  assert.doesNotMatch(serialized, /historical_weekly_plan_metrics_v1/);
  assert.doesNotMatch(serialized, /\/plan\/notesSummary/);
});
