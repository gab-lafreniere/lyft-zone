const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS,
  deriveCanonicalReviewDecision,
  resolveReviewJsonPointer,
  validateProgramReviewSemantics,
  validateReviewJsonPointer,
} = require('../../src/domain/programGeneration/programReviewValidation');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReviewInput() {
  return {
    plan: {
      workouts: [
        {
          blocks: [
            {
              exercises: [{ exerciseId: 'ex_bench' }],
            },
          ],
        },
      ],
      'a/b': {
        '~metadata': true,
      },
    },
    analytics: {
      targetComparisons: {
        volume: {
          items: [{ area: 'chest' }],
        },
      },
    },
    constraints: {
      cautionJointStressTags: ['deep_knee_flexion'],
    },
    intent: {
      volumeTargets: [{ area: 'chest' }],
    },
  };
}

function createIssue(overrides = {}) {
  return {
    issueIndex: 1,
    category: 'GOAL_PRIORITY_ALIGNMENT',
    severity: 'LOW',
    path: null,
    message: 'The plan could reflect the primary goal more consistently.',
    repairability: 'NOT_APPLICABLE',
    suggestedAction: null,
    ...overrides,
  };
}

function createReview(issues = [], overrides = {}) {
  const canonical = deriveCanonicalReviewDecision(issues);

  return {
    schemaVersion: 1,
    decision: canonical.decision,
    requiresRepair: canonical.requiresRepair,
    reviewSummary: 'The review is consistent with the structured plan data.',
    issues,
    ...overrides,
  };
}

function expectIssueCode(result, code) {
  assert.equal(
    result.issues.some((issue) => issue.code === code),
    true,
    `Expected validation issue ${code}, received ${JSON.stringify(result.issues)}`
  );
}

test('deriveCanonicalReviewDecision gives FAIL priority over REPAIR_REQUIRED and otherwise PASS', () => {
  assert.deepEqual(deriveCanonicalReviewDecision([]), {
    decision: 'PASS',
    requiresRepair: false,
  });
  assert.deepEqual(
    deriveCanonicalReviewDecision([
      createIssue({ severity: 'HIGH', repairability: 'REPAIRABLE', suggestedAction: 'Repair it.' }),
    ]),
    {
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
    }
  );
  assert.deepEqual(
    deriveCanonicalReviewDecision([
      createIssue({ severity: 'HIGH', repairability: 'REPAIRABLE', suggestedAction: 'Repair it.' }),
      createIssue({
        issueIndex: 2,
        severity: 'HIGH',
        repairability: 'NON_REPAIRABLE',
        suggestedAction: null,
      }),
    ]),
    {
      decision: 'FAIL',
      requiresRepair: false,
    }
  );
});

test('validateProgramReviewSemantics accepts PASS with informative LOW and MEDIUM repairable issues', () => {
  const issues = [
    createIssue({
      severity: 'LOW',
      repairability: 'REPAIRABLE',
      suggestedAction: 'Consider preserving more of the primary emphasis.',
    }),
    createIssue({
      issueIndex: 2,
      category: 'NOTES_POLICY',
      severity: 'MEDIUM',
      repairability: 'NON_REPAIRABLE',
      suggestedAction: null,
      message: 'The current notes policy remains informational for this version.',
    }),
    createIssue({
      issueIndex: 3,
      category: 'CARDIO_INTEGRATION',
      severity: 'INFO',
      repairability: 'NOT_APPLICABLE',
      suggestedAction: null,
      message: 'Cardio integration is within the supplied plan context.',
    }),
  ];
  const review = createReview(issues);

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, true);
  assert.equal(result.decision, 'PASS');
  assert.equal(result.requiresRepair, false);
  assert.equal(result.value, review);
});

test('validateProgramReviewSemantics accepts canonical REPAIR_REQUIRED and FAIL outcomes', () => {
  const repairReview = createReview([
    createIssue({
      severity: 'HIGH',
      repairability: 'REPAIRABLE',
      suggestedAction: 'Rebalance the repeated movement pattern.',
    }),
  ]);
  const failReview = createReview([
    createIssue({
      severity: 'HIGH',
      repairability: 'NON_REPAIRABLE',
      suggestedAction: null,
    }),
  ]);

  const repairResult = validateProgramReviewSemantics(repairReview, createReviewInput());
  const failResult = validateProgramReviewSemantics(failReview, createReviewInput());

  assert.equal(repairResult.ok, true);
  assert.equal(repairResult.decision, 'REPAIR_REQUIRED');
  assert.equal(repairResult.requiresRepair, true);
  assert.equal(failResult.ok, true);
  assert.equal(failResult.decision, 'FAIL');
  assert.equal(failResult.requiresRepair, false);
});

test('validateProgramReviewSemantics rejects mismatched model decision and requiresRepair values', () => {
  const review = createReview(
    [
      createIssue({
        severity: 'HIGH',
        repairability: 'REPAIRABLE',
        suggestedAction: 'Repair the redundant exercise selection.',
      }),
    ],
    {
      decision: 'PASS',
      requiresRepair: false,
    }
  );

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, false);
  assert.equal(result.decision, 'REPAIR_REQUIRED');
  assert.equal(result.requiresRepair, true);
  expectIssueCode(result, 'CANONICAL_DECISION_MISMATCH');
  expectIssueCode(result, 'CANONICAL_REQUIRES_REPAIR_MISMATCH');
});

test('validateProgramReviewSemantics rejects HIGH NOT_APPLICABLE issues', () => {
  const review = createReview([
    createIssue({
      severity: 'HIGH',
      repairability: 'NOT_APPLICABLE',
      suggestedAction: null,
    }),
  ]);

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, false);
  expectIssueCode(result, 'INVALID_HIGH_REPAIRABILITY');
});

test('validateProgramReviewSemantics enforces suggestedAction by repairability', () => {
  const missingRepairAction = createReview([
    createIssue({
      repairability: 'REPAIRABLE',
      suggestedAction: '   ',
    }),
  ]);
  const nonRepairableAction = createReview([
    createIssue({
      repairability: 'NON_REPAIRABLE',
      suggestedAction: 'Do something.',
    }),
  ]);
  const notApplicableAction = createReview([
    createIssue({
      repairability: 'NOT_APPLICABLE',
      suggestedAction: 'Do something.',
    }),
  ]);

  const missingResult = validateProgramReviewSemantics(missingRepairAction, createReviewInput());
  const nonRepairableResult = validateProgramReviewSemantics(
    nonRepairableAction,
    createReviewInput()
  );
  const notApplicableResult = validateProgramReviewSemantics(
    notApplicableAction,
    createReviewInput()
  );

  expectIssueCode(missingResult, 'SUGGESTED_ACTION_REQUIRED');
  expectIssueCode(nonRepairableResult, 'SUGGESTED_ACTION_NOT_ALLOWED');
  expectIssueCode(notApplicableResult, 'SUGGESTED_ACTION_NOT_ALLOWED');
});

test('validateProgramReviewSemantics enforces sequential issue indexes and exact duplicate detection', () => {
  const duplicate = createIssue({ issueIndex: 3 });
  const review = createReview([
    createIssue({ issueIndex: 2 }),
    duplicate,
    createIssue({ issueIndex: 3 }),
  ]);

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, false);
  expectIssueCode(result, 'ISSUE_INDEX_NOT_SEQUENTIAL');
  expectIssueCode(result, 'DUPLICATE_ISSUE');
});

test('validateProgramReviewSemantics rejects contradictory repairability at the same category and path', () => {
  const review = createReview([
    createIssue({
      path: '/plan/workouts/0',
      repairability: 'REPAIRABLE',
      suggestedAction: 'Adjust the workout distribution.',
    }),
    createIssue({
      issueIndex: 2,
      path: '/plan/workouts/0',
      repairability: 'NON_REPAIRABLE',
      suggestedAction: null,
      message: 'This workout would require a user decision before changing it.',
    }),
  ]);

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, false);
  expectIssueCode(result, 'CONTRADICTORY_ISSUES');
});

test('validateProgramReviewSemantics validates and resolves allowed JSON Pointer roots and escapes', () => {
  const issues = [
    createIssue({ path: '/plan/workouts/0/blocks/0' }),
    createIssue({
      issueIndex: 2,
      category: 'VOLUME_FREQUENCY_ALIGNMENT',
      path: '/analytics/targetComparisons/volume/items/0',
      message: 'The target comparison is informative.',
    }),
    createIssue({
      issueIndex: 3,
      category: 'CAUTION_HANDLING',
      path: '/constraints/cautionJointStressTags',
      message: 'Caution tags are represented in the compact input.',
    }),
    createIssue({
      issueIndex: 4,
      category: 'SPLIT_DURATION_COHERENCE',
      path: '/intent/volumeTargets/0',
      message: 'Volume targets are available to review.',
    }),
    createIssue({
      issueIndex: 5,
      category: 'EXERCISE_REDUNDANCY',
      path: '/plan/a~1b/~0metadata',
      message: 'Escaped pointer segments resolve safely.',
    }),
  ];
  const reviewInput = createReviewInput();
  const result = validateProgramReviewSemantics(createReview(issues), reviewInput);

  assert.equal(result.ok, true);
  assert.deepEqual(PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS, [
    'plan',
    'analytics',
    'constraints',
    'intent',
  ]);
  assert.deepEqual(resolveReviewJsonPointer('/plan/a~1b/~0metadata', reviewInput), {
    ok: true,
    value: true,
    segments: ['plan', 'a/b', '~metadata'],
  });
});

test('validateProgramReviewSemantics rejects malformed, forbidden, and non-resolving JSON Pointers', () => {
  const cases = [
    {
      path: 'plan/workouts/0',
      code: 'INVALID_JSON_POINTER',
    },
    {
      path: '/plan/~2bad',
      code: 'INVALID_JSON_POINTER',
    },
    {
      path: '/profile/primaryGoal',
      code: 'JSON_POINTER_ROOT_NOT_ALLOWED',
    },
    {
      path: '/plan/workouts/01',
      code: 'JSON_POINTER_INVALID_ARRAY_INDEX',
    },
    {
      path: '/plan/workouts/3',
      code: 'JSON_POINTER_NOT_FOUND',
    },
  ];

  cases.forEach(({ path, code }) => {
    const review = createReview([createIssue({ path })]);
    const result = validateProgramReviewSemantics(review, createReviewInput());
    expectIssueCode(result, code);
  });
});

test('resolveReviewJsonPointer never follows inherited review input properties', () => {
  const inheritedInput = Object.create({
    plan: {
      workouts: [],
    },
  });
  inheritedInput.analytics = {};
  inheritedInput.constraints = {};
  inheritedInput.intent = {};

  const result = validateReviewJsonPointer('/plan/workouts', inheritedInput);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'JSON_POINTER_NOT_FOUND');
});

test('validateProgramReviewSemantics accepts global paths and does not mutate the review', () => {
  const review = createReview([createIssue({ path: null })]);
  const original = clone(review);

  const result = validateProgramReviewSemantics(review, createReviewInput());

  assert.equal(result.ok, true);
  assert.deepEqual(review, original);
});

test('validateProgramReviewSemantics rejects empty summaries and clearly prohibited medical language without flagging ordinary caution terms', () => {
  const emptySummary = validateProgramReviewSemantics(
    createReview([], { reviewSummary: '  ' }),
    createReviewInput()
  );
  const medicalText = validateProgramReviewSemantics(
    createReview([
      createIssue({
        message: 'This will cause injury and is not a diagnosis.',
      }),
    ]),
    createReviewInput()
  );
  const ordinaryCaution = validateProgramReviewSemantics(
    createReview([
      createIssue({
        message: 'Knee fatigue may warrant caution in the next training session.',
      }),
    ]),
    createReviewInput()
  );

  expectIssueCode(emptySummary, 'REVIEW_SUMMARY_REQUIRED');
  expectIssueCode(medicalText, 'OUT_OF_SCOPE_TEXT');
  assert.equal(ordinaryCaution.ok, true);
});
