const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS,
  deriveCanonicalReviewDecision,
  resolveReviewJsonPointer,
  validateProgramReviewSemantics,
  validateReviewJsonPointer,
} = require('../../src/domain/programGeneration/programReviewValidation');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReviewInput({ workouts = [] } = {}) {
  return {
    schemaVersion: 2,
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
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
      schemaVersion: 2,
      status: 'complete',
      evaluationPolicy: {
        id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
        version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
      },
      plan: {
        durationDifferenceMinutesTotal: 0,
      },
      workouts,
      targetComparisons: {
        volume: {
          bodyParts: {
            items: [{ area: 'chest' }],
          },
        },
      },
    },
    constraints: {
      cautionJointStressTags: ['deep_knee_flexion'],
    },
    intent: {
      volumeTargets: {
        bodyParts: [{ area: 'chest' }],
        muscleFocuses: [],
      },
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

function createDurationWorkout(overrides = {}) {
  return {
    workoutOrderIndex: 10,
    requestedDurationMinutes: 60,
    calculatedDurationMinutes: 45,
    durationDifferenceMinutes: -15,
    durationUtilizationRatio: 0.75,
    durationAlignmentStatus: 'correction_required_under_target',
    durationRequiresCorrection: true,
    ...overrides,
  };
}

function createDurationIssue(workoutIndex, overrides = {}) {
  return createIssue({
    category: 'SPLIT_DURATION_COHERENCE',
    severity: 'HIGH',
    path: `/analytics/workouts/${workoutIndex}/durationAlignmentStatus`,
    message: 'The calculated workout duration requires correction.',
    repairability: 'REPAIRABLE',
    suggestedAction: 'Adjust the workout duration using the supplied analytics.',
    ...overrides,
  });
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

test('mandatory under-target and over-target duration issues validate as REPAIR_REQUIRED', async (t) => {
  const cases = [
    {
      name: 'under target',
      workout: createDurationWorkout(),
    },
    {
      name: 'over target',
      workout: createDurationWorkout({
        calculatedDurationMinutes: 75,
        durationDifferenceMinutes: 15,
        durationUtilizationRatio: 1.25,
        durationAlignmentStatus: 'correction_required_over_target',
      }),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const reviewInput = createReviewInput({ workouts: [entry.workout] });
      const review = createReview([createDurationIssue(0)]);
      const result = validateProgramReviewSemantics(review, reviewInput);

      assert.equal(result.ok, true);
      assert.equal(result.value, review);
      assert.equal(result.decision, 'REPAIR_REQUIRED');
      assert.equal(result.requiresRepair, true);
    });
  }
});

test('a missing mandatory duration issue fails closed without fabricating review content', () => {
  const reviewInput = createReviewInput({ workouts: [createDurationWorkout()] });
  const review = createReview([]);
  const originalReviewInput = clone(reviewInput);
  const originalReview = clone(review);

  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.equal(result.decision, 'PASS');
  assert.equal(result.requiresRepair, false);
  expectIssueCode(result, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');
  assert.deepEqual(reviewInput, originalReviewInput);
  assert.deepEqual(review, originalReview);
  assert.deepEqual(review.issues, []);
  assert.equal(review.decision, 'PASS');
  assert.equal(review.requiresRepair, false);
});

test('every workout requiring duration correction needs its own array-indexed issue', () => {
  const reviewInput = createReviewInput({
    workouts: [
      createDurationWorkout({ workoutOrderIndex: 4 }),
      createDurationWorkout({ workoutOrderIndex: 8 }),
    ],
  });
  const review = createReview([createDurationIssue(0)]);
  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, false);
  expectIssueCode(result, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');
  assert.equal(
    result.issues.some(
      (issue) => issue.workoutIndex === 1 &&
        issue.expectedPath === '/analytics/workouts/1/durationAlignmentStatus'
    ),
    true
  );
});

test('mandatory duration paths use the zero-based array index, not another workout index', () => {
  const wrongArrayIndexInput = createReviewInput({
    workouts: [
      createDurationWorkout({ workoutOrderIndex: 7 }),
      createDurationWorkout({
        workoutOrderIndex: 1,
        durationAlignmentStatus: 'preferred',
        durationRequiresCorrection: false,
      }),
    ],
  });
  const wrongArrayIndex = validateProgramReviewSemantics(
    createReview([createDurationIssue(1)]),
    wrongArrayIndexInput
  );

  assert.equal(wrongArrayIndex.ok, false);
  expectIssueCode(wrongArrayIndex, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');

  const workoutOrderIndexInput = createReviewInput({
    workouts: [
      createDurationWorkout({ workoutOrderIndex: 2 }),
      createDurationWorkout({
        workoutOrderIndex: 1,
        durationAlignmentStatus: 'preferred',
        durationRequiresCorrection: false,
      }),
      createDurationWorkout({
        workoutOrderIndex: 3,
        durationAlignmentStatus: 'preferred',
        durationRequiresCorrection: false,
      }),
    ],
  });
  const workoutOrderIndexPath = validateProgramReviewSemantics(
    createReview([createDurationIssue(2)]),
    workoutOrderIndexInput
  );

  assert.equal(workoutOrderIndexPath.ok, false);
  expectIssueCode(workoutOrderIndexPath, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');
});

test('mandatory duration issues require the exact path, category, severity, and repairability', async (t) => {
  const cases = [
    {
      name: 'wrong field path',
      overrides: { path: '/analytics/workouts/0/calculatedDurationMinutes' },
    },
    {
      name: 'wrong category',
      overrides: { category: 'VOLUME_FREQUENCY_ALIGNMENT' },
    },
    {
      name: 'medium severity',
      overrides: { severity: 'MEDIUM' },
    },
    {
      name: 'non-repairable',
      overrides: { repairability: 'NON_REPAIRABLE', suggestedAction: null },
    },
    {
      name: 'not applicable',
      overrides: { repairability: 'NOT_APPLICABLE', suggestedAction: null },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const reviewInput = createReviewInput({ workouts: [createDurationWorkout()] });
      const review = createReview([createDurationIssue(0, entry.overrides)]);
      const result = validateProgramReviewSemantics(review, reviewInput);

      assert.equal(result.ok, false);
      expectIssueCode(result, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');
    });
  }
});

test('a workout requiring correction rejects multiple issues at its canonical duration path', () => {
  const reviewInput = createReviewInput({ workouts: [createDurationWorkout()] });
  const review = createReview([
    createDurationIssue(0),
    createDurationIssue(0, {
      issueIndex: 2,
      message: 'A second duration issue must not be emitted for the same workout.',
    }),
  ]);
  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, false);
  expectIssueCode(result, 'MANDATORY_DURATION_CORRECTION_ISSUE_MISSING_OR_INVALID');
});

test('non-correction duration statuses allow PASS without a duration issue', async (t) => {
  const statuses = [
    'preferred',
    'acceptable_under_target',
    'acceptable_over_target',
    'unavailable',
  ];

  for (const status of statuses) {
    await t.test(status, () => {
      const reviewInput = createReviewInput({
        workouts: [
          createDurationWorkout({
            durationAlignmentStatus: status,
            durationRequiresCorrection: false,
          }),
        ],
      });
      const result = validateProgramReviewSemantics(createReview([]), reviewInput);

      assert.equal(result.ok, true);
      assert.equal(result.decision, 'PASS');
      assert.equal(result.requiresRepair, false);
    });
  }
});

test('a false canonical blocking duration issue is rejected for a non-correction workout', () => {
  const reviewInput = createReviewInput({
    workouts: [
      createDurationWorkout({
        durationAlignmentStatus: 'preferred',
        durationRequiresCorrection: false,
      }),
    ],
  });
  const review = createReview([createDurationIssue(0)]);
  const originalReview = clone(review);
  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, false);
  assert.equal(result.decision, 'REPAIR_REQUIRED');
  assert.equal(result.requiresRepair, true);
  expectIssueCode(result, 'UNJUSTIFIED_DURATION_CORRECTION_ISSUE');
  assert.deepEqual(review, originalReview);
});

test('a distinct global duration coherence issue at another valid path keeps existing behavior', () => {
  const reviewInput = createReviewInput({
    workouts: [
      createDurationWorkout({
        durationAlignmentStatus: 'acceptable_under_target',
        durationRequiresCorrection: false,
      }),
    ],
  });
  const review = createReview([
    createDurationIssue(0, {
      path: '/analytics/plan/durationDifferenceMinutesTotal',
      message: 'The aggregate duration distribution requires a distinct review.',
    }),
  ]);
  const result = validateProgramReviewSemantics(review, reviewInput);

  assert.equal(result.ok, true);
  assert.equal(result.decision, 'REPAIR_REQUIRED');
  assert.equal(result.requiresRepair, true);
});

test('missing or invalid analytics workouts retain controlled JSON Pointer validation', () => {
  const invalidInputs = [createReviewInput(), createReviewInput()];
  delete invalidInputs[0].analytics.workouts;
  invalidInputs[1].analytics.workouts = null;

  invalidInputs.forEach((reviewInput) => {
    const review = createReview([
      createIssue({ path: '/analytics/workouts/0/durationAlignmentStatus' }),
    ]);
    const result = validateProgramReviewSemantics(review, reviewInput);

    assert.equal(result.ok, false);
    expectIssueCode(result, 'JSON_POINTER_NOT_FOUND');
  });
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
      path: '/analytics/targetComparisons/volume/bodyParts/items/0',
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
      path: '/intent/volumeTargets/bodyParts/0',
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
