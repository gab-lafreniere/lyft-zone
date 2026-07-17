const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REVIEW_CATEGORIES,
  PROGRAM_REVIEW_CONTRACT_VERSION,
  PROGRAM_REVIEW_DECISIONS,
  PROGRAM_REVIEW_LIMITS,
  PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
  PROGRAM_REVIEW_REPAIRABILITIES,
  PROGRAM_REVIEW_RESPONSE_FORMAT_NAME,
  PROGRAM_REVIEW_SEVERITIES,
  buildProgramReviewJsonSchema,
  validateProgramReviewSchema,
} = require('../../src/domain/programGeneration/programReviewSchema');

const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = new Set([
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIssue(overrides = {}) {
  return {
    issueIndex: 1,
    category: 'GOAL_PRIORITY_ALIGNMENT',
    severity: 'LOW',
    path: null,
    message: 'The main priority could be reflected more consistently.',
    repairability: 'NOT_APPLICABLE',
    suggestedAction: null,
    ...overrides,
  };
}

function createReview(overrides = {}) {
  return {
    schemaVersion: 1,
    decision: 'PASS',
    requiresRepair: false,
    reviewSummary: 'The plan is coherent with the provided targets.',
    issues: [],
    ...overrides,
  };
}

function findUnsupportedKeywords(value, path = 'root', matches = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findUnsupportedKeywords(entry, `${path}[${index}]`, matches)
    );
    return matches;
  }

  if (!value || typeof value !== 'object') {
    return matches;
  }

  Object.entries(value).forEach(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    if (UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS.has(key)) {
      matches.push(entryPath);
    }
    findUnsupportedKeywords(entry, entryPath, matches);
  });

  return matches;
}

test('program review exports the V1 contract constants and closed enums', () => {
  assert.equal(PROGRAM_REVIEW_CONTRACT_VERSION, 1);
  assert.equal(PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION, 1);
  assert.equal(PROGRAM_REVIEW_RESPONSE_FORMAT_NAME, 'ai_program_review_v1');
  assert.deepEqual(PROGRAM_REVIEW_DECISIONS, ['PASS', 'REPAIR_REQUIRED', 'FAIL']);
  assert.deepEqual(PROGRAM_REVIEW_SEVERITIES, ['INFO', 'LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(PROGRAM_REVIEW_REPAIRABILITIES, [
    'NOT_APPLICABLE',
    'REPAIRABLE',
    'NON_REPAIRABLE',
  ]);
  assert.deepEqual(PROGRAM_REVIEW_CATEGORIES, [
    'GOAL_PRIORITY_ALIGNMENT',
    'VOLUME_FREQUENCY_ALIGNMENT',
    'SPLIT_DURATION_COHERENCE',
    'EXERCISE_REDUNDANCY',
    'EXERCISE_ORDER_SUPERSET',
    'PRESCRIPTION_PARAMETERS',
    'CAUTION_HANDLING',
    'NOTES_POLICY',
    'CARDIO_INTEGRATION',
  ]);
});

test('validateProgramReviewSchema accepts valid PASS, REPAIR_REQUIRED, and FAIL contracts', () => {
  const pass = validateProgramReviewSchema(createReview());
  const repairRequired = validateProgramReviewSchema(
    createReview({
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      issues: [
        createIssue({
          severity: 'HIGH',
          repairability: 'REPAIRABLE',
          suggestedAction: 'Rebalance the redundant block.',
        }),
      ],
    })
  );
  const fail = validateProgramReviewSchema(
    createReview({
      decision: 'FAIL',
      issues: [
        createIssue({
          severity: 'HIGH',
          repairability: 'NON_REPAIRABLE',
        }),
      ],
    })
  );

  assert.equal(pass.ok, true);
  assert.equal(repairRequired.ok, true);
  assert.equal(fail.ok, true);
  assert.deepEqual(pass.issues, []);
});

test('validateProgramReviewSchema requires every root and issue field and rejects unknown fields', () => {
  const missingRoot = clone(createReview());
  delete missingRoot.reviewSummary;

  const missingIssueField = createReview({
    issues: [createIssue()],
  });
  delete missingIssueField.issues[0].suggestedAction;

  const unknownRoot = createReview({ unexpected: true });
  const unknownIssue = createReview({
    issues: [createIssue({ unexpected: true })],
  });

  assert.equal(validateProgramReviewSchema(missingRoot).ok, false);
  assert.equal(validateProgramReviewSchema(missingIssueField).ok, false);
  assert.equal(
    validateProgramReviewSchema(unknownRoot).issues.some((issue) => issue.code === 'UNKNOWN_FIELD'),
    true
  );
  assert.equal(
    validateProgramReviewSchema(unknownIssue).issues.some(
      (issue) => issue.path === 'issues[0].unexpected'
    ),
    true
  );
});

test('validateProgramReviewSchema enforces its closed enums and issue index minimum', () => {
  const invalidDecision = validateProgramReviewSchema(
    createReview({ decision: 'RETRY' })
  );
  const invalidCategory = validateProgramReviewSchema(
    createReview({
      issues: [createIssue({ category: 'CAUTION_NOTES_HANDLING' })],
    })
  );
  const invalidSeverity = validateProgramReviewSchema(
    createReview({
      issues: [createIssue({ severity: 'CRITICAL' })],
    })
  );
  const invalidRepairability = validateProgramReviewSchema(
    createReview({
      issues: [createIssue({ repairability: 'OPTIONAL' })],
    })
  );
  const invalidIssueIndex = validateProgramReviewSchema(
    createReview({
      issues: [createIssue({ issueIndex: 0 })],
    })
  );

  [
    invalidDecision,
    invalidCategory,
    invalidSeverity,
    invalidRepairability,
    invalidIssueIndex,
  ].forEach((result) => assert.equal(result.ok, false));
  assert.equal(invalidDecision.issues.some((issue) => issue.code === 'INVALID_ENUM'), true);
  assert.equal(invalidIssueIndex.issues.some((issue) => issue.code === 'VALUE_TOO_SMALL'), true);
});

test('validateProgramReviewSchema enforces all review string and issue count limits', () => {
  const overlongSummary = validateProgramReviewSchema(
    createReview({ reviewSummary: 'x'.repeat(PROGRAM_REVIEW_LIMITS.reviewSummaryMaxLength + 1) })
  );
  const overlongMessage = validateProgramReviewSchema(
    createReview({
      issues: [
        createIssue({ message: 'x'.repeat(PROGRAM_REVIEW_LIMITS.issueMessageMaxLength + 1) }),
      ],
    })
  );
  const overlongAction = validateProgramReviewSchema(
    createReview({
      issues: [
        createIssue({
          repairability: 'REPAIRABLE',
          suggestedAction: 'x'.repeat(PROGRAM_REVIEW_LIMITS.suggestedActionMaxLength + 1),
        }),
      ],
    })
  );
  const overlongPath = validateProgramReviewSchema(
    createReview({
      issues: [createIssue({ path: '/plan/' + 'x'.repeat(PROGRAM_REVIEW_LIMITS.pathMaxLength) })],
    })
  );
  const tooManyIssues = validateProgramReviewSchema(
    createReview({
      issues: Array.from({ length: PROGRAM_REVIEW_LIMITS.issuesMaxCount + 1 }, (_, index) =>
        createIssue({ issueIndex: index + 1 })
      ),
    })
  );

  [overlongSummary, overlongMessage, overlongAction, overlongPath, tooManyIssues].forEach(
    (result) => assert.equal(result.ok, false)
  );
  assert.equal(tooManyIssues.issues.some((issue) => issue.code === 'MAX_ITEMS_EXCEEDED'), true);
});

test('validateProgramReviewSchema accepts a contract close to every allowed schema limit', () => {
  const payload = createReview({
    reviewSummary: 's'.repeat(PROGRAM_REVIEW_LIMITS.reviewSummaryMaxLength),
    issues: Array.from({ length: PROGRAM_REVIEW_LIMITS.issuesMaxCount }, (_, index) =>
      createIssue({
        issueIndex: index + 1,
        path: `/plan/${'p'.repeat(PROGRAM_REVIEW_LIMITS.pathMaxLength - 6)}`,
        message: 'm'.repeat(PROGRAM_REVIEW_LIMITS.issueMessageMaxLength),
        repairability: 'REPAIRABLE',
        suggestedAction: 'a'.repeat(PROGRAM_REVIEW_LIMITS.suggestedActionMaxLength),
      })
    ),
  });

  const result = validateProgramReviewSchema(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value, payload);
});

test('program review schema keeps Structured Outputs-compatible object shapes', () => {
  const schema = buildProgramReviewJsonSchema();
  const issueSchema = schema.properties.issues.items;

  assert.deepEqual(findUnsupportedKeywords(schema), []);
  assert.equal(schema.additionalProperties, false);
  assert.equal(issueSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), [
    'schemaVersion',
    'decision',
    'requiresRepair',
    'reviewSummary',
    'issues',
  ]);
  assert.deepEqual(issueSchema.required, [
    'issueIndex',
    'category',
    'severity',
    'path',
    'message',
    'repairability',
    'suggestedAction',
  ]);
});
