const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS,
  deriveCanonicalReviewDecision,
  resolveReviewJsonPointer,
  validateReviewJsonPointer,
  validateProgramReviewSemantics,
} = require('../../src/domain/programGeneration/programReviewValidation');

function createReview(overrides = {}) {
  return {
    schemaVersion: 3,
    decision: 'PASS',
    requiresRepair: false,
    reviewSummary: 'The plan is coherent and ready.',
    issues: [],
    ...overrides,
  };
}

function createIssue(overrides = {}) {
  return {
    issueIndex: 1,
    category: 'EXERCISE_REDUNDANCY',
    severity: 'LOW',
    path: '/plan/workouts/0',
    message: 'The workout contains a minor redundant choice.',
    repairability: 'NOT_APPLICABLE',
    suggestedAction: null,
    ...overrides,
  };
}

const reviewInput = {
  plan: {
    workouts: [{ orderIndex: 1 }],
  },
  analytics: {
    workouts: [
      {
        durationRequiresCorrection: false,
        durationAlignmentStatus: 'preferred',
      },
    ],
  },
  constraints: {},
  intent: {},
};

function expectIssueCode(result, code) {
  assert.equal(
    result.issues.some((issue) => issue.code === code),
    true,
    `Expected semantic issue ${code}`
  );
}

test('canonical decision remains derived from issue severity and repairability', () => {
  assert.deepEqual(deriveCanonicalReviewDecision([]), {
    decision: 'PASS',
    requiresRepair: false,
  });
  assert.deepEqual(
    deriveCanonicalReviewDecision([
      createIssue({
        severity: 'HIGH',
        repairability: 'REPAIRABLE',
        suggestedAction: 'Remove the redundant exercise.',
      }),
    ]),
    { decision: 'REPAIR_REQUIRED', requiresRepair: true }
  );
  assert.deepEqual(
    deriveCanonicalReviewDecision([
      createIssue({
        severity: 'HIGH',
        repairability: 'NON_REPAIRABLE',
      }),
    ]),
    { decision: 'FAIL', requiresRepair: false }
  );
});

test('PASS may contain informative LOW or MEDIUM issues', () => {
  const result = validateProgramReviewSemantics(
    createReview({
      issues: [createIssue()],
    }),
    reviewInput
  );
  assert.equal(result.ok, true);
});

test('REPAIR_REQUIRED needs a HIGH REPAIRABLE issue and sequential issue indexes', () => {
  const result = validateProgramReviewSemantics(
    createReview({
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      issues: [
        createIssue({
          severity: 'HIGH',
          repairability: 'REPAIRABLE',
          suggestedAction: 'Remove the redundant exercise.',
        }),
      ],
    }),
    reviewInput
  );
  assert.equal(result.ok, true);
});

test('Review V3 no longer mandates duration issues', () => {
  const formerlyBlockedInput = structuredClone(reviewInput);
  formerlyBlockedInput.analytics.workouts[0].durationRequiresCorrection = true;
  formerlyBlockedInput.analytics.workouts[0].durationAlignmentStatus =
    'correction_required_under_target';

  const result = validateProgramReviewSemantics(
    createReview(),
    formerlyBlockedInput
  );
  assert.equal(result.ok, true);
  assert.equal(
    result.issues.some((issue) => issue.code.includes('DURATION')),
    false
  );
});

test('decision and requiresRepair contradictions fail closed', () => {
  const result = validateProgramReviewSemantics(
    createReview({
      decision: 'PASS',
      requiresRepair: false,
      issues: [
        createIssue({
          severity: 'HIGH',
          repairability: 'REPAIRABLE',
          suggestedAction: 'Remove the redundant exercise.',
        }),
      ],
    }),
    reviewInput
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === 'CANONICAL_DECISION_MISMATCH'
    ),
    true
  );
});

test('issue paths, complete sentences, repairability, and numbering remain validated', () => {
  const result = validateProgramReviewSemantics(
    createReview({
      reviewSummary: 'Incomplete',
      issues: [
        createIssue({
          issueIndex: 2,
          path: '/private/value',
          repairability: 'REPAIRABLE',
          suggestedAction: null,
        }),
      ],
    }),
    reviewInput
  );
  assert.equal(result.ok, false);
  assert.equal(result.issues.length >= 4, true);
});

test('HIGH issues cannot use NOT_APPLICABLE repairability', () => {
  const result = validateProgramReviewSemantics(
    createReview({
      decision: 'FAIL',
      issues: [
        createIssue({
          severity: 'HIGH',
          repairability: 'NOT_APPLICABLE',
        }),
      ],
    }),
    reviewInput
  );

  expectIssueCode(result, 'INVALID_HIGH_REPAIRABILITY');
});

test('suggestedAction remains required only for REPAIRABLE issues', () => {
  const missing = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue({
          repairability: 'REPAIRABLE',
          suggestedAction: '   ',
        }),
      ],
    }),
    reviewInput
  );
  const forbidden = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue({
          repairability: 'NON_REPAIRABLE',
          suggestedAction: 'Change the plan.',
        }),
      ],
    }),
    reviewInput
  );

  expectIssueCode(missing, 'SUGGESTED_ACTION_REQUIRED');
  expectIssueCode(forbidden, 'SUGGESTED_ACTION_NOT_ALLOWED');
});

test('duplicate issues and contradictory repairability remain rejected', () => {
  const duplicate = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue(),
        createIssue({ issueIndex: 2 }),
      ],
    }),
    reviewInput
  );
  const contradiction = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue({
          repairability: 'REPAIRABLE',
          suggestedAction: 'Change the exercise.',
        }),
        createIssue({
          issueIndex: 2,
          repairability: 'NON_REPAIRABLE',
          message: 'A user decision is required before changing this exercise.',
        }),
      ],
    }),
    reviewInput
  );

  expectIssueCode(duplicate, 'DUPLICATE_ISSUE');
  expectIssueCode(contradiction, 'CONTRADICTORY_ISSUES');
});

test('JSON Pointer validation keeps allowlisted roots and rejects unsafe paths', () => {
  assert.deepEqual(PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS, [
    'plan',
    'analytics',
    'constraints',
    'intent',
  ]);
  assert.equal(
    resolveReviewJsonPointer('/plan/workouts/0', reviewInput).ok,
    true
  );

  for (const [path, code] of [
    ['plan/workouts/0', 'INVALID_JSON_POINTER'],
    ['/plan/~2bad', 'INVALID_JSON_POINTER'],
    ['/profile/primaryGoal', 'JSON_POINTER_ROOT_NOT_ALLOWED'],
    ['/plan/workouts/01', 'JSON_POINTER_INVALID_ARRAY_INDEX'],
    ['/plan/workouts/3', 'JSON_POINTER_NOT_FOUND'],
  ]) {
    const result = validateProgramReviewSemantics(
      createReview({ issues: [createIssue({ path })] }),
      reviewInput
    );
    expectIssueCode(result, code);
  }
});

test('JSON Pointer resolution never follows inherited properties', () => {
  const inheritedInput = Object.create({
    plan: { workouts: [] },
  });
  inheritedInput.analytics = {};
  inheritedInput.constraints = {};
  inheritedInput.intent = {};

  const result = validateReviewJsonPointer(
    '/plan/workouts',
    inheritedInput
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'JSON_POINTER_NOT_FOUND');
});

test('global issue paths remain valid and review validation does not mutate input', () => {
  const review = createReview({
    issues: [createIssue({ path: null })],
  });
  const before = structuredClone(review);
  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, true);
  assert.deepEqual(review, before);
});

test('medical claims remain prohibited while ordinary caution wording is allowed', () => {
  const medical = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue({
          message: 'This will cause injury and is not a diagnosis.',
        }),
      ],
    }),
    reviewInput
  );
  const caution = validateProgramReviewSemantics(
    createReview({
      issues: [
        createIssue({
          message: 'Knee fatigue may warrant caution next session.',
        }),
      ],
    }),
    reviewInput
  );

  expectIssueCode(medical, 'OUT_OF_SCOPE_TEXT');
  assert.equal(caution.ok, true);
});
