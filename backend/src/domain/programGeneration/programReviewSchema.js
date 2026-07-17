const Ajv = require('ajv');

const PROGRAM_REVIEW_CONTRACT_VERSION = 1;
const PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION = 1;
const PROGRAM_REVIEW_RESPONSE_FORMAT_NAME = 'ai_program_review_v1';

const PROGRAM_REVIEW_CATEGORIES = Object.freeze([
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

const PROGRAM_REVIEW_SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH']);
const PROGRAM_REVIEW_REPAIRABILITIES = Object.freeze([
  'NOT_APPLICABLE',
  'REPAIRABLE',
  'NON_REPAIRABLE',
]);
const PROGRAM_REVIEW_DECISIONS = Object.freeze(['PASS', 'REPAIR_REQUIRED', 'FAIL']);

const PROGRAM_REVIEW_LIMITS = Object.freeze({
  reviewSummaryMaxLength: 400,
  issuesMaxCount: 12,
  issueMessageMaxLength: 200,
  suggestedActionMaxLength: 200,
  pathMaxLength: 200,
});

let compiledValidator = null;

function nullable(schema) {
  return {
    ...schema,
    type: Array.isArray(schema.type)
      ? Array.from(new Set([...schema.type, 'null']))
      : [schema.type, 'null'],
  };
}

function buildStringSchema(minLength, maxLength) {
  return {
    type: 'string',
    minLength,
    maxLength,
  };
}

function buildProgramReviewIssueSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'issueIndex',
      'category',
      'severity',
      'path',
      'message',
      'repairability',
      'suggestedAction',
    ],
    properties: {
      issueIndex: {
        type: 'integer',
        minimum: 1,
      },
      category: {
        type: 'string',
        enum: PROGRAM_REVIEW_CATEGORIES,
      },
      severity: {
        type: 'string',
        enum: PROGRAM_REVIEW_SEVERITIES,
      },
      path: nullable(buildStringSchema(1, PROGRAM_REVIEW_LIMITS.pathMaxLength)),
      message: buildStringSchema(1, PROGRAM_REVIEW_LIMITS.issueMessageMaxLength),
      repairability: {
        type: 'string',
        enum: PROGRAM_REVIEW_REPAIRABILITIES,
      },
      suggestedAction: nullable(
        buildStringSchema(1, PROGRAM_REVIEW_LIMITS.suggestedActionMaxLength)
      ),
    },
  };
}

function buildProgramReviewJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'decision', 'requiresRepair', 'reviewSummary', 'issues'],
    properties: {
      schemaVersion: {
        type: 'integer',
        enum: [PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION],
      },
      decision: {
        type: 'string',
        enum: PROGRAM_REVIEW_DECISIONS,
      },
      requiresRepair: {
        type: 'boolean',
      },
      reviewSummary: buildStringSchema(1, PROGRAM_REVIEW_LIMITS.reviewSummaryMaxLength),
      issues: {
        type: 'array',
        minItems: 0,
        maxItems: PROGRAM_REVIEW_LIMITS.issuesMaxCount,
        items: buildProgramReviewIssueSchema(),
      },
    },
  };
}

function getValidator() {
  if (!compiledValidator) {
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    compiledValidator = ajv.compile(buildProgramReviewJsonSchema());
  }

  return compiledValidator;
}

function normalizeSchemaPath(instancePath = '', additionalProperty = null) {
  const segments = String(instancePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let path = '';
  segments.forEach((segment) => {
    if (/^\d+$/.test(segment)) {
      path += `[${segment}]`;
      return;
    }

    path += path ? `.${segment}` : segment;
  });

  if (additionalProperty) {
    path += path ? `.${additionalProperty}` : additionalProperty;
  }

  return path || 'root';
}

function mapAjvKeywordToIssueCode(keyword) {
  switch (keyword) {
    case 'additionalProperties':
      return 'UNKNOWN_FIELD';
    case 'required':
      return 'REQUIRED';
    case 'enum':
      return 'INVALID_ENUM';
    case 'type':
      return 'INVALID_TYPE';
    case 'minItems':
      return 'MIN_ITEMS_REQUIRED';
    case 'maxItems':
      return 'MAX_ITEMS_EXCEEDED';
    case 'minLength':
      return 'STRING_TOO_SHORT';
    case 'maxLength':
      return 'STRING_TOO_LONG';
    case 'minimum':
      return 'VALUE_TOO_SMALL';
    default:
      return 'SCHEMA_VALIDATION_FAILED';
  }
}

function formatAjvError(error) {
  const additionalProperty =
    error.keyword === 'additionalProperties' ? error.params?.additionalProperty : null;
  const missingProperty = error.keyword === 'required' ? error.params?.missingProperty : null;
  const path = normalizeSchemaPath(error.instancePath, additionalProperty || missingProperty);

  return {
    code: mapAjvKeywordToIssueCode(error.keyword),
    path,
    message: error.message || 'Schema validation failed',
    expected: error.params || undefined,
    actual: undefined,
  };
}

function validateProgramReviewSchema(payload = {}) {
  const validate = getValidator();
  const ok = validate(payload);

  return {
    ok,
    value: ok ? payload : null,
    issues: ok ? [] : (validate.errors || []).map(formatAjvError),
  };
}

module.exports = {
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
};
