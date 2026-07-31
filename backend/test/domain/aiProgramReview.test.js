const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIProgramReviewError,
  PROGRAM_REVIEW_INPUT_SCHEMA_VERSION,
  buildProgramReviewDecisionSummary,
  buildProgramReviewInput,
  runAIProgramReview,
} = require('../../src/domain/programGeneration/aiProgramReview');
const {
  applyBackendCalculatedDurationsToPlanDocument,
} = require('../../src/domain/programGeneration/weeklyPlanBackendDuration');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  createAiOutput,
  createContext,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

function createReviewFixture() {
  const context = createContext();
  const generatedAIOutput = createAiOutput();
  generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0] = {
    ...generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    targetSeconds: 120,
  };
  const initialDocument = createNormalizedDocument({
    targetSeconds: 120,
  });
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument: initialDocument,
    context,
  });
  const generatedPlanDocument =
    applyBackendCalculatedDurationsToPlanDocument(
      initialDocument,
      analytics
    );
  return {
    context,
    generatedAIOutput,
    generatedPlanDocument,
    analytics,
  };
}

test('Review Input V4 contains backend duration only', () => {
  const input = buildProgramReviewInput(createReviewFixture());
  const serialized = JSON.stringify(input);

  assert.equal(PROGRAM_REVIEW_INPUT_SCHEMA_VERSION, 4);
  assert.equal(input.schemaVersion, 4);
  assert.equal(input.plan.workouts[0].estimatedDurationMinutes, 14);
  assert.equal(
    input.analytics.workouts[0].durationCalculation
      .calculatedDurationMinutes,
    14
  );
  assert.equal(serialized.includes('durationCalculationDebug'), false);
  assert.equal(serialized.includes('durationDebugComparison'), false);
  assert.equal(serialized.includes('aiCalculatedDurationMinutes'), false);
});

test('Review Input preserves targetSeconds as a temporal prescription', () => {
  const input = buildProgramReviewInput(createReviewFixture());

  assert.deepEqual(
    input.plan.workouts[0].blocks[0].exercises[0].repTargets,
    ['120s']
  );
});

test('Review Input fails closed when backend Analytics is missing or duration-invalid', () => {
  const missing = createReviewFixture();
  missing.analytics = {};
  assert.throws(
    () => buildProgramReviewInput(missing),
    (error) =>
      error instanceof AIProgramReviewError &&
      error.code === 'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE'
  );

  const invalid = createReviewFixture();
  invalid.analytics.workouts[0].durationRequiresCorrection = true;
  assert.throws(
    () => buildProgramReviewInput(invalid),
    (error) =>
      error instanceof AIProgramReviewError &&
      error.code === 'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE'
  );
});

test('runAIProgramReview uses V3 contracts and no doctrine', async () => {
  let capturedPrompt;
  const result = await runAIProgramReview(createReviewFixture(), {
    reviewWeeklyPlanAi: async ({ promptDescriptor }) => {
      capturedPrompt = promptDescriptor;
      return {
        programReview: {
          schemaVersion: 3,
          decision: 'PASS',
          requiresRepair: false,
          reviewSummary: 'The plan is coherent and ready to persist.',
          issues: [],
        },
        reviewer: {
          type: 'openai',
          model: 'review-model',
          responseId: 'resp_review',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            reasoningTokens: 0,
          },
        },
      };
    },
  });

  assert.equal(result.contractVersion, 3);
  assert.equal(result.outputSchemaVersion, 3);
  assert.equal(result.promptVersion, 'ai-program-review-prompt-v1.3.0');
  assert.equal(result.decision, 'PASS');
  assert.equal(capturedPrompt.userMessage.includes('APPENDIX A'), false);
});

test('runAIProgramReview rejects invalid provider schema and semantics', async () => {
  await assert.rejects(
    () =>
      runAIProgramReview(createReviewFixture(), {
        reviewWeeklyPlanAi: async () => ({
          programReview: {},
          reviewer: {},
        }),
      }),
    (error) =>
      error instanceof AIProgramReviewError &&
      error.code === 'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED'
  );

  await assert.rejects(
    () =>
      runAIProgramReview(createReviewFixture(), {
        reviewWeeklyPlanAi: async () => ({
          programReview: {
            schemaVersion: 3,
            decision: 'REPAIR_REQUIRED',
            requiresRepair: true,
            reviewSummary: 'The output is contradictory.',
            issues: [],
          },
          reviewer: {
            type: 'openai',
            model: 'review-model',
            responseId: null,
            usage: {},
          },
        }),
      }),
    (error) =>
      error instanceof AIProgramReviewError &&
      error.code === 'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED'
  );
});

test('Review Input remains deterministic, compact, and non-mutating', () => {
  const fixture = createReviewFixture();
  const before = structuredClone(fixture);
  const first = buildProgramReviewInput(fixture);
  const second = buildProgramReviewInput(fixture);
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.deepEqual(fixture, before);
  assert.equal(serialized.includes('userId'), false);
  assert.equal(serialized.includes('poolSnapshot'), false);
  assert.equal(serialized.includes('secondaryMuscles'), true);
});

test('enabled Review requires valid reviewer metadata', async () => {
  await assert.rejects(
    () =>
      runAIProgramReview(createReviewFixture(), {
        reviewWeeklyPlanAi: async () => ({
          programReview: {
            schemaVersion: 3,
            decision: 'PASS',
            requiresRepair: false,
            reviewSummary: 'The plan is coherent and ready to persist.',
            issues: [],
          },
          reviewer: null,
        }),
      }),
    (error) =>
      error instanceof AIProgramReviewError &&
      error.code === 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE'
  );
});

test('Review decision summary retains deterministic counts only', () => {
  const summary = buildProgramReviewDecisionSummary({
    decision: 'PASS',
    requiresRepair: false,
    issues: [
      {
        severity: 'LOW',
        category: 'EXERCISE_REDUNDANCY',
      },
      {
        severity: 'MEDIUM',
        category: 'EXERCISE_REDUNDANCY',
      },
    ],
  });

  assert.deepEqual(summary, {
    decision: 'PASS',
    requiresRepair: false,
    issueCount: 2,
    severityCounts: {
      INFO: 0,
      LOW: 1,
      MEDIUM: 1,
      HIGH: 0,
    },
    categoryCounts: {
      EXERCISE_REDUNDANCY: 2,
    },
  });
});
