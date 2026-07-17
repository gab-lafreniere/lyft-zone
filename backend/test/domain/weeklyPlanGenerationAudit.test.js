const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIReviewAuditMetadata,
  buildWeeklyPlanGenerationContext,
} = require('../../src/domain/programGeneration/weeklyPlanGenerationAudit');

function createAnalytics(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'partial',
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
      estimatedDurationMinutesTotal: 42,
      estimatedDurationMinutesAverage: 42,
      declaredEstimatedDurationMinutesTotal: 60,
      durationDifferenceMinutesTotal: -18,
      minWorkoutDurationMinutes: 42,
      maxWorkoutDurationMinutes: 42,
      cardioDurationMinutes: 0,
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
    context: {
      generationMode: 'weekly_plan_draft',
      createdAt: '2026-06-01T12:00:00.000Z',
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
        promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.1',
      },
      doctrineContent: 'FULL_DOCTRINE_CONTENT_SENTINEL',
      systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
      userMessage: 'USER_MESSAGE_SENTINEL',
      poolSnapshot: {
        checksum: 'checksum',
      },
    },
    generatedPlanDocument: {
      strategySummary: 'Static hypertrophy plan.',
    },
    validation: {
      ok: true,
      issues: [],
      uniqueExerciseIds: ['ex_db_bench'],
    },
    generator: {
      type: 'mock',
      model: null,
      rawResponse: 'RAW_PROVIDER_RESPONSE_SENTINEL',
      requestId: 'req_http_private_123',
    },
  });

  assert.equal(GENERATION_CONTEXT_SCHEMA_VERSION, 5);
  assert.equal(generationContext.schemaVersion, 5);
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
    'ai-weekly-plan-builder-prompt-v1.0.1'
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
  assert.equal(generationContext.validationSummary.analytics, null);
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
});

test('buildWeeklyPlanGenerationContext retains V3 fields and adds allowlisted V4 analytics', () => {
  const analytics = createAnalytics();
  const generationContext = buildWeeklyPlanGenerationContext({
    context: {
      generationMode: 'weekly_plan_draft',
      createdAt: '2026-06-01T12:00:00.000Z',
      coachInputs: {},
      poolSnapshot: { checksum: 'checksum' },
    },
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
  });

  assert.equal(generationContext.schemaVersion, 5);
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
    schemaVersion: 1,
    status: 'partial',
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
      estimatedDurationMinutesTotal: 42,
      estimatedDurationMinutesAverage: 42,
      declaredEstimatedDurationMinutesTotal: 60,
      durationDifferenceMinutesTotal: -18,
      minWorkoutDurationMinutes: 42,
      maxWorkoutDurationMinutes: 42,
      cardioDurationMinutes: 0,
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

  const serialized = JSON.stringify(generationContext);
  assert.doesNotMatch(serialized, /RAW_USAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_OUTPUT_TEXT_SENTINEL/);
  assert.doesNotMatch(serialized, /req_http_private_456/);
  assert.doesNotMatch(serialized, /PRIVATE_WORKOUT_NAME_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_EXERCISE_NAME_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_UNRESOLVED_EXERCISE_ID_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_TARGET_RATIONALE_SENTINEL/);
});

test('buildWeeklyPlanGenerationContext normalizes absent OpenAI metadata to null', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: {},
    generatedPlanDocument: {},
    validation: { ok: true, issues: [] },
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
  assert.equal(generationContext.validationSummary.analytics, null);
});

test('buildAIReviewAuditMetadata persists only allowlisted PASS review data', () => {
  const metadata = buildAIReviewAuditMetadata({
    enabled: true,
    promptVersion: 'ai-program-review-prompt-v1.0.0',
    contractVersion: 1,
    outputSchemaVersion: 1,
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
    promptVersion: 'ai-program-review-prompt-v1.0.0',
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
  assert.doesNotMatch(serialized, /\/plan\/notesSummary/);
});
