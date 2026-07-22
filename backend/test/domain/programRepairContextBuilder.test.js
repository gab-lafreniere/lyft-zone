'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/programGenerationContextBuilder');
const {
  PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
  PROGRAM_REPAIR_MAX_ATTEMPTS,
  PROGRAM_REPAIR_OUTPUT_MODE,
  ProgramRepairContextError,
  buildProgramRepairContext,
} = require('../../src/domain/programGeneration/programRepairContextBuilder');
const {
  PROGRAM_REVIEW_CONTRACT_VERSION,
  PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/programReviewSchema');
const {
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

function clone(value) {
  return structuredClone(value);
}

function createIssue(overrides = {}) {
  return {
    issueIndex: 1,
    category: 'SPLIT_DURATION_COHERENCE',
    severity: 'HIGH',
    path: '/analytics/workouts/0/durationAlignmentStatus',
    message: 'The workout is shorter than requested.',
    repairability: 'REPAIRABLE',
    suggestedAction: 'Increase useful training work.',
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    schemaVersion: PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
    generationMode: 'weekly_plan_draft',
    physicalNotes: 'Keep transitions simple.',
    evaluationPolicy: clone(WEEKLY_PLAN_EVALUATION_POLICY),
    poolSnapshot: {
      allowedExerciseIds: ['ex_press'],
      checksum: 'pool-checksum',
    },
    exercisePoolItems: [
      {
        exerciseId: 'ex_press',
        name: 'Machine Press',
      },
    ],
    ...overrides,
  };
}

function createGeneratedAIOutput(overrides = {}) {
  return {
    schemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
    strategySummary: 'A balanced hypertrophy plan.',
    workouts: [{ orderIndex: 1, blocks: [] }],
    ...overrides,
  };
}

function createGeneratedPlanDocument(overrides = {}) {
  return {
    name: 'Prepared plan',
    workouts: [{ orderIndex: 1, blocks: [] }],
    ...overrides,
  };
}

function createAnalytics(overrides = {}) {
  return {
    schemaVersion: WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
    evaluationPolicy: {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    },
    plan: {
      workoutCount: 1,
    },
    workouts: [
      {
        workoutOrderIndex: 1,
        durationDifferenceMinutes: -18,
      },
    ],
    ...overrides,
  };
}

function createInitialReview(overrides = {}) {
  const reviewOverrides = overrides.review || {};
  const { review: _review, ...rootOverrides } = overrides;

  return {
    enabled: true,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    contractVersion: PROGRAM_REVIEW_CONTRACT_VERSION,
    outputSchemaVersion: PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
    provider: {
      type: 'openai',
      usage: { inputTokens: 123, outputTokens: 45 },
      privateMetadata: 'PRIVATE_PROVIDER_METADATA',
    },
    reviewInput: {
      privateValue: 'PRIVATE_REVIEW_INPUT',
    },
    issueCount: 6,
    severityCounts: { INFO: 1, LOW: 1, MEDIUM: 1, HIGH: 3 },
    ...rootOverrides,
    review: {
      schemaVersion: PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      reviewSummary: 'The plan needs a bounded repair.',
      issues: [createIssue()],
      ...reviewOverrides,
    },
  };
}

function createInput(overrides = {}) {
  return {
    context: createContext(),
    generatedAIOutput: createGeneratedAIOutput(),
    generatedPlanDocument: createGeneratedPlanDocument(),
    analytics: createAnalytics(),
    initialReview: createInitialReview(),
    ...overrides,
  };
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return;
  }

  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach((item) => assertDeepFrozen(item, seen));
}

function assertDeepNotFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return;
  }

  seen.add(value);
  assert.equal(Object.isFrozen(value), false);
  Object.values(value).forEach((item) => assertDeepNotFrozen(item, seen));
}

function assertControlledError(input, expectedCode) {
  assert.throws(
    () => buildProgramRepairContext(input),
    (error) => {
      assert.equal(error instanceof ProgramRepairContextError, true);
      assert.equal(error.code, expectedCode);
      assert.doesNotMatch(error.message, /Keep transitions simple|PRIVATE|ex_press/);
      return true;
    }
  );
}

test('buildProgramRepairContext creates the exact V1 root and one-attempt control', () => {
  const input = createInput();
  const result = buildProgramRepairContext(input);

  assert.equal(PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION, 1);
  assert.equal(PROGRAM_REPAIR_MAX_ATTEMPTS, 1);
  assert.equal(PROGRAM_REPAIR_OUTPUT_MODE, 'full_replacement');
  assert.deepEqual(Object.keys(result), [
    'schemaVersion',
    'repairControl',
    'programGenerationContext',
    'source',
    'repairBrief',
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.repairControl, {
    maxAttempts: 1,
    attemptNumber: 1,
    outputMode: 'full_replacement',
    finalValidationRequired: true,
    finalAnalyticsRequired: true,
    finalReviewRequired: true,
  });
  assert.deepEqual(result.programGenerationContext, input.context);
  assert.deepEqual(result.source.generatedAIOutput, input.generatedAIOutput);
  assert.deepEqual(result.source.generatedPlanDocument, input.generatedPlanDocument);
  assert.deepEqual(result.source.analytics, input.analytics);
});

test('mandatory and recommended issues are projected, filtered, and ordered by issueIndex', () => {
  const input = createInput();
  input.initialReview = createInitialReview({
    review: {
      issues: [
        createIssue({ issueIndex: 6, message: 'Second mandatory issue.' }),
        createIssue({
          issueIndex: 4,
          severity: 'MEDIUM',
          category: 'GOAL_PRIORITY_ALIGNMENT',
          message: 'Recommended issue.',
          privateIssueMetadata: 'PRIVATE_ISSUE_METADATA',
        }),
        createIssue({ issueIndex: 3, severity: 'LOW' }),
        createIssue({
          issueIndex: 2,
          repairability: 'NON_REPAIRABLE',
          suggestedAction: null,
        }),
        createIssue({ issueIndex: 1 }),
        createIssue({
          issueIndex: 5,
          severity: 'INFO',
          repairability: 'NOT_APPLICABLE',
          suggestedAction: null,
        }),
      ],
    },
  });

  const result = buildProgramRepairContext(input);

  assert.deepEqual(
    result.repairBrief.mandatoryIssues.map((issue) => issue.issueIndex),
    [1, 6]
  );
  assert.deepEqual(
    result.repairBrief.recommendedIssues.map((issue) => issue.issueIndex),
    [4]
  );
  assert.deepEqual(Object.keys(result.repairBrief.mandatoryIssues[0]), [
    'issueIndex',
    'category',
    'severity',
    'path',
    'message',
    'repairability',
    'suggestedAction',
  ]);
  assert.deepEqual(result.repairBrief.initialReview, {
    schemaVersion: 1,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    reviewSummary: 'The plan needs a bounded repair.',
  });

  const serializedBrief = JSON.stringify(result.repairBrief);
  assert.doesNotMatch(serializedBrief, /PRIVATE_ISSUE_METADATA/);
  assert.doesNotMatch(serializedBrief, /provider|reviewInput|inputTokens|severityCounts/);
});

test('ProgramGenerationContext V4 and canonical Evaluation Policy V1 are required', () => {
  const cases = [
    createInput({ context: null }),
    createInput({ context: createContext({ schemaVersion: 3 }) }),
    createInput({ context: createContext({ evaluationPolicy: null }) }),
    createInput({
      context: createContext({
        evaluationPolicy: {
          id: 'wrong-policy',
          version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
        },
      }),
    }),
    createInput({
      context: createContext({
        evaluationPolicy: {
          id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
          version: 2,
        },
      }),
    }),
    createInput({ context: createContext({ poolSnapshot: null }) }),
    createInput({ context: createContext({ exercisePoolItems: null }) }),
  ];

  cases.forEach((input) =>
    assertControlledError(input, 'INVALID_PROGRAM_REPAIR_CONTEXT')
  );
});

test('Generated AI Output V2 and the prepared plan document are required', () => {
  const cases = [
    createInput({ generatedAIOutput: null }),
    createInput({ generatedAIOutput: createGeneratedAIOutput({ schemaVersion: 1 }) }),
    createInput({ generatedAIOutput: createGeneratedAIOutput({ workouts: null }) }),
    createInput({ generatedPlanDocument: null }),
    createInput({ generatedPlanDocument: createGeneratedPlanDocument({ workouts: null }) }),
  ];

  cases.forEach((input) =>
    assertControlledError(input, 'INVALID_PROGRAM_REPAIR_SOURCE_PLAN')
  );
});

test('Analytics V2 with a matching canonical policy, plan, and workouts is required', () => {
  const cases = [
    createInput({ analytics: null }),
    createInput({ analytics: createAnalytics({ schemaVersion: 1 }) }),
    createInput({ analytics: createAnalytics({ evaluationPolicy: null }) }),
    createInput({
      analytics: createAnalytics({
        evaluationPolicy: {
          id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
          version: 2,
        },
      }),
    }),
    createInput({ analytics: createAnalytics({ plan: null }) }),
    createInput({ analytics: createAnalytics({ workouts: null }) }),
  ];

  cases.forEach((input) =>
    assertControlledError(input, 'INVALID_PROGRAM_REPAIR_ANALYTICS')
  );
});

test('only an enabled REPAIR_REQUIRED initial review can create a repair context', () => {
  const passReview = createInitialReview({
    decision: 'PASS',
    requiresRepair: false,
    review: {
      decision: 'PASS',
      requiresRepair: false,
      issues: [],
    },
  });
  const failReview = createInitialReview({
    decision: 'FAIL',
    requiresRepair: false,
    review: {
      decision: 'FAIL',
      requiresRepair: false,
      issues: [
        createIssue({ repairability: 'NON_REPAIRABLE', suggestedAction: null }),
      ],
    },
  });
  const cases = [
    createInput({ initialReview: null }),
    createInput({ initialReview: passReview }),
    createInput({ initialReview: failReview }),
    createInput({ initialReview: createInitialReview({ enabled: false }) }),
    createInput({
      initialReview: createInitialReview({ contractVersion: 2 }),
    }),
    createInput({
      initialReview: createInitialReview({ outputSchemaVersion: 2 }),
    }),
    createInput({
      initialReview: createInitialReview({ review: { schemaVersion: 2 } }),
    }),
    createInput({
      initialReview: createInitialReview({ review: { issues: [] } }),
    }),
    createInput({
      initialReview: createInitialReview({
        review: {
          issues: [
            createIssue({
              severity: 'HIGH',
              repairability: 'NON_REPAIRABLE',
              suggestedAction: null,
            }),
            createIssue({ severity: 'MEDIUM' }),
          ],
        },
      }),
    }),
  ];

  cases.forEach((input) =>
    assertControlledError(input, 'INVALID_PROGRAM_REPAIR_REVIEW')
  );
});

test('the result is deterministic, deeply immutable, and does not mutate or freeze inputs', () => {
  const input = createInput();
  const before = clone(input);

  const first = buildProgramRepairContext(input);
  const second = buildProgramRepairContext(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assertDeepFrozen(first);
  assertDeepNotFrozen(input);

  assert.notStrictEqual(first.programGenerationContext, input.context);
  assert.notStrictEqual(first.source.generatedAIOutput, input.generatedAIOutput);
  assert.notStrictEqual(first.source.generatedPlanDocument, input.generatedPlanDocument);
  assert.notStrictEqual(first.source.analytics, input.analytics);
  assert.notStrictEqual(first.repairBrief.mandatoryIssues[0], input.initialReview.review.issues[0]);

  assert.throws(() => {
    first.repairControl.maxAttempts = 2;
  }, TypeError);
  assert.throws(() => {
    first.programGenerationContext.physicalNotes = 'mutated';
  }, TypeError);
  assert.equal(input.context.physicalNotes, 'Keep transitions simple.');
});
