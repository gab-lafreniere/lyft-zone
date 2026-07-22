const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIRepairAuditMetadata,
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
        bodyParts: {
          summary: {
            targetCount: 1,
            belowTargetCount: 1,
            withinTargetCount: 0,
            aboveTargetCount: 0,
            unavailableCount: 0,
          },
          items: [{ rationale: 'PRIVATE_TARGET_RATIONALE_SENTINEL' }],
        },
        muscleFocuses: {
          summary: {
            targetCount: 1,
            belowTargetCount: 0,
            withinTargetCount: 0,
            aboveTargetCount: 1,
            unavailableCount: 0,
          },
          items: [],
        },
        overallSummary: {
          targetCount: 2,
          belowTargetCount: 1,
          withinTargetCount: 0,
          aboveTargetCount: 1,
          unavailableCount: 0,
        },
      },
      frequency: {
        bodyParts: {
          summary: {
            targetCount: 1,
            belowTargetCount: 0,
            withinTargetCount: 1,
            aboveTargetCount: 0,
            unavailableCount: 0,
          },
          items: [],
        },
        muscleFocuses: {
          summary: {
            targetCount: 0,
            belowTargetCount: 0,
            withinTargetCount: 0,
            aboveTargetCount: 0,
            unavailableCount: 0,
          },
          items: [],
        },
        overallSummary: {
          targetCount: 1,
          belowTargetCount: 0,
          withinTargetCount: 1,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
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

  assert.equal(GENERATION_CONTEXT_SCHEMA_VERSION, 7);
  assert.equal(generationContext.schemaVersion, 7);
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
    'aiRepair',
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
  assert.deepEqual(generationContext.aiRepair, {
    enabled: false,
    outcome: 'BYPASSED',
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: null,
    provider: null,
  });
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

test('buildWeeklyPlanGenerationContext creates deterministic V7 audit with allowlisted Analytics V2', () => {
  const analytics = createAnalytics();
  const input = {
    context: createContext({
      coachInputs: {},
      poolSnapshot: { checksum: 'checksum' },
    }),
    generatedAIOutput: {
      schemaVersion: 2,
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

  assert.equal(generationContext.schemaVersion, 7);
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
        bodyParts: {
          targetCount: 1,
          belowTargetCount: 1,
          withinTargetCount: 0,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
        muscleFocuses: {
          targetCount: 1,
          belowTargetCount: 0,
          withinTargetCount: 0,
          aboveTargetCount: 1,
          unavailableCount: 0,
        },
        overallSummary: {
          targetCount: 2,
          belowTargetCount: 1,
          withinTargetCount: 0,
          aboveTargetCount: 1,
          unavailableCount: 0,
        },
      },
      frequency: {
        bodyParts: {
          targetCount: 1,
          belowTargetCount: 0,
          withinTargetCount: 1,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
        muscleFocuses: {
          targetCount: 0,
          belowTargetCount: 0,
          withinTargetCount: 0,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
        overallSummary: {
          targetCount: 1,
          belowTargetCount: 0,
          withinTargetCount: 1,
          aboveTargetCount: 0,
          unavailableCount: 0,
        },
      },
    },
  });
  assert.equal(generationContext.validationSummary.analytics.workouts, undefined);
  assert.equal(generationContext.validationSummary.analytics.muscleMetrics, undefined);
  assert.equal(
    generationContext.validationSummary.analytics.targetComparisons.volume.bodyParts.items,
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
  assert.equal(generationContext.schemaVersion, 7);
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

test('Audit V7 persists exact NOT_REQUIRED repair metadata and one review attempt', () => {
  const input = {
    context: createContext(),
    generatedAIOutput: {
      schemaVersion: 2,
      strategySummary: 'Initial strategy.',
    },
    generatedPlanDocument: { name: 'Initial plan' },
    validation: {
      schemaValidation: { ok: true, issues: [] },
      semanticValidation: { ok: true, issues: [], summary: {} },
      poolValidation: { ok: true, issues: [], uniqueExerciseIds: ['ex_bench'] },
    },
    businessRulesValidation: { ok: true, issueCount: 0 },
    analytics: createAnalytics(),
    aiReview: {
      enabled: true,
      promptVersion: 'ai-program-review-prompt-v1.1.0',
      contractVersion: 1,
      outputSchemaVersion: 1,
      provider: { type: 'openai', model: 'review-model', usage: {} },
      review: {
        schemaVersion: 1,
        decision: 'PASS',
        requiresRepair: false,
        reviewSummary: 'Passed.',
        issues: [],
      },
    },
    aiRepair: {
      enabled: true,
      outcome: 'NOT_REQUIRED',
      attempts: 0,
      maxAttempts: 1,
      promptVersion: null,
      contractVersion: 2,
      outputSchemaVersion: 2,
      initialReviewSummary: {
        decision: 'PASS',
        issueCount: 1,
        severityCounts: { INFO: 1, LOW: 0, MEDIUM: 0, HIGH: 0 },
        categoryCounts: { NOTES_POLICY: 1 },
        issues: ['PRIVATE_INITIAL_ISSUE_SENTINEL'],
      },
      provider: null,
    },
  };
  const originalInput = clone(input);
  const generationContext = buildWeeklyPlanGenerationContext(input);

  assert.equal(generationContext.schemaVersion, 7);
  assert.deepEqual(generationContext.aiRepair, {
    enabled: true,
    outcome: 'NOT_REQUIRED',
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: {
      decision: 'PASS',
      issueCount: 1,
      severityCounts: { INFO: 1, LOW: 0, MEDIUM: 0, HIGH: 0 },
      categoryCounts: { NOTES_POLICY: 1 },
    },
    provider: null,
  });
  assert.equal(generationContext.repairAttempts, 0);
  assert.equal(generationContext.aiReview.reviewAttempts, 1);
  assert.doesNotMatch(JSON.stringify(generationContext), /PRIVATE_INITIAL_ISSUE_SENTINEL/);
  assert.deepEqual(input, originalInput);
});

test('Audit V7 persists only final repaired summaries with distinct repair metadata', () => {
  const input = {
    context: createContext({
      poolSnapshot: { checksum: 'final-checksum' },
      privateDoctrine: 'PRIVATE_DOCTRINE_SENTINEL',
    }),
    generatedAIOutput: {
      schemaVersion: 2,
      strategySummary: 'Final repaired strategy.',
      splitType: 'upper_lower',
      repairedAIOutput: 'PRIVATE_REPAIRED_OUTPUT_SENTINEL',
    },
    generatedPlanDocument: {
      name: 'Final repaired plan',
      strategySummary: 'PRIVATE_INITIAL_STRATEGY_SENTINEL',
      programRepairContext: 'PRIVATE_REPAIR_CONTEXT_SENTINEL',
    },
    validation: {
      schemaValidation: { ok: true, issues: [] },
      semanticValidation: {
        ok: true,
        issues: [],
        summary: { notesPolicy: { noteCount: 2 } },
      },
      poolValidation: {
        ok: true,
        issues: [],
        uniqueExerciseIds: ['ex_final_one', 'ex_final_two'],
      },
    },
    businessRulesValidation: { ok: true, issueCount: 0 },
    analytics: createAnalytics({ status: 'complete' }),
    generator: {
      type: 'openai',
      model: 'initial-generator-model',
      responseId: 'resp_generator',
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        reasoningTokens: 20,
      },
      rawResponse: 'PRIVATE_GENERATOR_RAW_SENTINEL',
    },
    aiReview: {
      enabled: true,
      reviewAttempts: 2,
      promptVersion: 'ai-program-review-prompt-v1.1.0',
      contractVersion: 1,
      outputSchemaVersion: 1,
      provider: {
        type: 'openai',
        model: 'final-review-model',
        responseId: 'resp_final_review',
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          reasoningTokens: 5,
        },
        rawResponse: 'PRIVATE_FINAL_REVIEW_RAW_SENTINEL',
      },
      review: {
        schemaVersion: 1,
        decision: 'PASS',
        requiresRepair: false,
        reviewSummary: 'Final review passed.',
        issues: [
          {
            category: 'NOTES_POLICY',
            severity: 'LOW',
            path: '/plan/private',
            message: 'PRIVATE_FINAL_REVIEW_MESSAGE_SENTINEL',
            suggestedAction: 'PRIVATE_FINAL_REVIEW_ACTION_SENTINEL',
          },
        ],
      },
      initialReview: 'PRIVATE_INITIAL_REVIEW_SENTINEL',
    },
    aiRepair: {
      enabled: true,
      outcome: 'PASSED',
      attempts: 1,
      maxAttempts: 1,
      promptVersion: 'ai-weekly-plan-repair-prompt-v1.0.0',
      contractVersion: 2,
      outputSchemaVersion: 2,
      initialReviewSummary: {
        decision: 'REPAIR_REQUIRED',
        issueCount: 1,
        severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
        categoryCounts: { SPLIT_DURATION_COHERENCE: 1 },
        issues: [
          {
            path: '/plan/private',
            message: 'PRIVATE_INITIAL_REVIEW_MESSAGE_SENTINEL',
            suggestedAction: 'PRIVATE_INITIAL_REVIEW_ACTION_SENTINEL',
          },
        ],
      },
      provider: {
        type: 'openai',
        model: 'repair-model',
        responseId: 'resp_repair',
        usage: {
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
          reasoningTokens: 30,
          rawUsage: 'PRIVATE_REPAIR_USAGE_SENTINEL',
        },
        rawResponse: 'PRIVATE_REPAIR_RAW_SENTINEL',
        prompt: 'PRIVATE_REPAIR_PROMPT_SENTINEL',
      },
    },
  };
  const originalInput = clone(input);
  const generationContext = buildWeeklyPlanGenerationContext(input);
  const repeatedGenerationContext = buildWeeklyPlanGenerationContext(input);

  assert.equal(generationContext.schemaVersion, 7);
  assert.equal(generationContext.strategySummary, 'Final repaired strategy.');
  assert.equal(generationContext.splitType, 'upper_lower');
  assert.deepEqual(generationContext.generator, {
    type: 'openai',
    model: 'initial-generator-model',
    responseId: 'resp_generator',
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      reasoningTokens: 20,
    },
  });
  assert.deepEqual(generationContext.aiRepair, {
    enabled: true,
    outcome: 'PASSED',
    attempts: 1,
    maxAttempts: 1,
    promptVersion: 'ai-weekly-plan-repair-prompt-v1.0.0',
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: {
      decision: 'REPAIR_REQUIRED',
      issueCount: 1,
      severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
      categoryCounts: { SPLIT_DURATION_COHERENCE: 1 },
    },
    provider: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair',
      usage: {
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        reasoningTokens: 30,
      },
    },
  });
  assert.equal(generationContext.repairAttempts, 1);
  assert.equal(generationContext.aiReview.reviewAttempts, 2);
  assert.equal(generationContext.aiReview.provider.model, 'final-review-model');
  assert.deepEqual(generationContext.validationSummary.poolValidation, {
    ok: true,
    issueCount: 0,
    uniqueExerciseIds: ['ex_final_one', 'ex_final_two'],
    uniqueExerciseCount: 2,
  });
  assert.equal(generationContext.validationSummary.analytics.status, 'complete');
  assert.deepEqual(repeatedGenerationContext, generationContext);
  assert.deepEqual(input, originalInput);

  const serialized = JSON.stringify(generationContext);
  [
    'PRIVATE_DOCTRINE_SENTINEL',
    'PRIVATE_REPAIRED_OUTPUT_SENTINEL',
    'PRIVATE_INITIAL_STRATEGY_SENTINEL',
    'PRIVATE_REPAIR_CONTEXT_SENTINEL',
    'PRIVATE_GENERATOR_RAW_SENTINEL',
    'PRIVATE_FINAL_REVIEW_RAW_SENTINEL',
    'PRIVATE_FINAL_REVIEW_MESSAGE_SENTINEL',
    'PRIVATE_FINAL_REVIEW_ACTION_SENTINEL',
    'PRIVATE_INITIAL_REVIEW_SENTINEL',
    'PRIVATE_INITIAL_REVIEW_MESSAGE_SENTINEL',
    'PRIVATE_INITIAL_REVIEW_ACTION_SENTINEL',
    'PRIVATE_REPAIR_USAGE_SENTINEL',
    'PRIVATE_REPAIR_RAW_SENTINEL',
    'PRIVATE_REPAIR_PROMPT_SENTINEL',
  ].forEach((sentinel) => assert.doesNotMatch(serialized, new RegExp(sentinel)));
  assert.doesNotMatch(serialized, /\/plan\/private/);
});

function createPassedAuditReview(options = {}) {
  const review = {
    enabled: true,
    provider: { type: 'openai', model: 'review-model', usage: {} },
    review: {
      schemaVersion: 1,
      decision: 'PASS',
      requiresRepair: false,
      issues: [],
    },
  };

  if (Object.prototype.hasOwnProperty.call(options, 'reviewAttempts')) {
    review.reviewAttempts = options.reviewAttempts;
  }

  return review;
}

function createRepairReviewSummary(decision) {
  return {
    decision,
    issueCount: decision === 'PASS' ? 0 : 1,
    severityCounts: {
      INFO: 0,
      LOW: 0,
      MEDIUM: 0,
      HIGH: decision === 'PASS' ? 0 : 1,
    },
    categoryCounts:
      decision === 'PASS' ? {} : { SPLIT_DURATION_COHERENCE: 1 },
  };
}

function createBypassedRepairMetadata(overrides = {}) {
  return {
    enabled: false,
    outcome: 'BYPASSED',
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: null,
    provider: null,
    ...overrides,
  };
}

function createNotRequiredRepairMetadata(overrides = {}) {
  return {
    enabled: true,
    outcome: 'NOT_REQUIRED',
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: createRepairReviewSummary('PASS'),
    provider: null,
    ...overrides,
  };
}

function createPassedRepairMetadata(overrides = {}) {
  return {
    enabled: true,
    outcome: 'PASSED',
    attempts: 1,
    maxAttempts: 1,
    promptVersion: 'ai-weekly-plan-repair-prompt-v1.0.0',
    contractVersion: 2,
    outputSchemaVersion: 2,
    initialReviewSummary: createRepairReviewSummary('REPAIR_REQUIRED'),
    provider: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair_strict',
      usage: {
        inputTokens: 100,
        outputTokens: 80,
        totalTokens: 180,
        reasoningTokens: null,
      },
    },
    ...overrides,
  };
}

function createGenerationAuditInput(overrides = {}) {
  return {
    context: createContext(),
    generatedPlanDocument: {},
    validation: { ok: true, issues: [], uniqueExerciseIds: [] },
    analytics: createAnalytics(),
    ...overrides,
  };
}

function assertInvalidGenerationAudit(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof WeeklyPlanAnalyticsError, true);
    assert.equal(error.code, 'INVALID_WEEKLY_PLAN_GENERATION_AUDIT');
    assert.equal(error.message, 'Weekly plan generation audit metadata is invalid');
    assert.equal(error.details, undefined);
    return true;
  });
}

test('reviewAttempts accepts only absent, one, or two', async (t) => {
  await t.test('absent falls back to one', () => {
    assert.equal(buildAIReviewAuditMetadata(createPassedAuditReview()).reviewAttempts, 1);
  });

  await t.test('one is accepted', () => {
    assert.equal(
      buildAIReviewAuditMetadata(
        createPassedAuditReview({ reviewAttempts: 1 })
      ).reviewAttempts,
      1
    );
  });

  await t.test('two is accepted for a passed repair', () => {
    const generationContext = buildWeeklyPlanGenerationContext(
      createGenerationAuditInput({
        aiReview: createPassedAuditReview({ reviewAttempts: 2 }),
        aiRepair: createPassedRepairMetadata(),
      })
    );
    assert.equal(generationContext.aiReview.reviewAttempts, 2);
    assert.equal(generationContext.aiRepair.outcome, 'PASSED');
  });

  for (const reviewAttempts of [0, 3, 25, 1.5, '2', undefined]) {
    await t.test(`explicit invalid value ${String(reviewAttempts)}`, () => {
      assertInvalidGenerationAudit(() =>
        buildAIReviewAuditMetadata(
          createPassedAuditReview({ reviewAttempts })
        )
      );
    });
  }
});

test('BYPASSED repair metadata is exact and fail-closed', async (t) => {
  await t.test('absent metadata keeps the historical disabled bypass', () => {
    assert.deepEqual(
      buildAIRepairAuditMetadata(),
      createBypassedRepairMetadata()
    );
  });

  for (const enabled of [false, true]) {
    await t.test(`exact enabled ${enabled} is accepted`, () => {
      assert.deepEqual(
        buildAIRepairAuditMetadata(createBypassedRepairMetadata({ enabled })),
        createBypassedRepairMetadata({ enabled })
      );
    });
  }

  await t.test('an explicit empty object is rejected', () => {
    assertInvalidGenerationAudit(() => buildAIRepairAuditMetadata({}));
  });

  await t.test('an unexpected root field is rejected', () => {
    assertInvalidGenerationAudit(() =>
      buildAIRepairAuditMetadata(
        createBypassedRepairMetadata({ rawOutput: 'PRIVATE_RAW_OUTPUT' })
      )
    );
  });

  const invalidCases = [
    ['attempts one', { attempts: 1 }],
    ['provider present', { provider: createPassedRepairMetadata().provider }],
    [
      'initial review summary present',
      { initialReviewSummary: createRepairReviewSummary('PASS') },
    ],
  ];
  for (const [name, overrides] of invalidCases) {
    await t.test(`${name} is rejected`, () => {
      assertInvalidGenerationAudit(() =>
        buildAIRepairAuditMetadata(createBypassedRepairMetadata(overrides))
      );
    });
  }
});

test('NOT_REQUIRED repair metadata is exact and fail-closed', async (t) => {
  await t.test('exact structure is accepted', () => {
    assert.deepEqual(
      buildAIRepairAuditMetadata(createNotRequiredRepairMetadata()),
      createNotRequiredRepairMetadata()
    );
  });

  const invalidCases = [
    [
      'non-PASS initial decision',
      {
        initialReviewSummary: createRepairReviewSummary('REPAIR_REQUIRED'),
      },
    ],
    ['attempts one', { attempts: 1 }],
    ['wrong max attempts', { maxAttempts: 2 }],
    ['provider present', { provider: createPassedRepairMetadata().provider }],
    ['wrong contract', { contractVersion: 999 }],
    ['wrong schema', { outputSchemaVersion: 999 }],
  ];
  for (const [name, overrides] of invalidCases) {
    await t.test(`${name} is rejected`, () => {
      assertInvalidGenerationAudit(() =>
        buildAIRepairAuditMetadata(createNotRequiredRepairMetadata(overrides))
      );
    });
  }
});

test('PASSED repair metadata requires exact V2 identity and OpenAI provider', async (t) => {
  await t.test('exact structure is accepted without mutation', () => {
    const input = createPassedRepairMetadata();
    const originalInput = clone(input);
    const metadata = buildAIRepairAuditMetadata(input);

    assert.deepEqual(metadata, input);
    assert.deepEqual(input, originalInput);
  });

  const validProvider = createPassedRepairMetadata().provider;
  const invalidCases = [
    [
      'non-REPAIR_REQUIRED initial decision',
      { initialReviewSummary: createRepairReviewSummary('PASS') },
    ],
    ['provider absent', { provider: null }],
    ['wrong provider type', { provider: { ...validProvider, type: 'mock' } }],
    ['empty provider model', { provider: { ...validProvider, model: ' ' } }],
    ['wrong prompt version', { promptVersion: 'PRIVATE_PROMPT_VERSION' }],
    ['wrong contract', { contractVersion: 999 }],
    ['wrong schema', { outputSchemaVersion: 999 }],
    ['attempts zero', { attempts: 0 }],
    ['attempts two', { attempts: 2 }],
    ['wrong max attempts', { maxAttempts: 2 }],
    [
      'invalid provider token count',
      {
        provider: {
          ...validProvider,
          usage: { ...validProvider.usage, totalTokens: -1 },
        },
      },
    ],
  ];
  for (const [name, overrides] of invalidCases) {
    await t.test(`${name} is rejected`, () => {
      assertInvalidGenerationAudit(() =>
        buildAIRepairAuditMetadata(createPassedRepairMetadata(overrides))
      );
    });
  }
});

test('AI review and repair audit metadata must remain coherent', async (t) => {
  const invalidCases = [
    [
      'PASSED repair with one review attempt',
      createPassedAuditReview({ reviewAttempts: 1 }),
      createPassedRepairMetadata(),
    ],
    [
      'NOT_REQUIRED repair with two review attempts',
      createPassedAuditReview({ reviewAttempts: 2 }),
      createNotRequiredRepairMetadata(),
    ],
    [
      'BYPASSED repair with PASS and two review attempts',
      createPassedAuditReview({ reviewAttempts: 2 }),
      createBypassedRepairMetadata(),
    ],
    [
      'PASSED repair with bypassed review',
      {},
      createPassedRepairMetadata(),
    ],
  ];

  for (const [name, aiReview, aiRepair] of invalidCases) {
    await t.test(`${name} is rejected without mutation`, () => {
      const input = createGenerationAuditInput({ aiReview, aiRepair });
      const originalInput = clone(input);
      assertInvalidGenerationAudit(() => buildWeeklyPlanGenerationContext(input));
      assert.deepEqual(input, originalInput);
    });
  }

  await t.test('private metadata never reaches the controlled error', () => {
    const input = createGenerationAuditInput({
      aiReview: createPassedAuditReview({ reviewAttempts: 2 }),
      aiRepair: createPassedRepairMetadata({
        promptVersion: 'PRIVATE_PROMPT_DOCTRINE_PATH_ACTION_EXERCISE_SENTINEL',
      }),
    });

    assert.throws(
      () => buildWeeklyPlanGenerationContext(input),
      (error) => {
        const serialized = JSON.stringify({
          code: error.code,
          message: error.message,
          details: error.details,
        });
        assert.equal(error.code, 'INVALID_WEEKLY_PLAN_GENERATION_AUDIT');
        assert.doesNotMatch(serialized, /PRIVATE_|prompt|doctrine|path|action|exercise/i);
        return true;
      }
    );
  });
});
