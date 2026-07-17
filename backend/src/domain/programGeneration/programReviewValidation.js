const {
  PROGRAM_REVIEW_LIMITS,
} = require('./programReviewSchema');

const PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS = Object.freeze([
  'plan',
  'analytics',
  'constraints',
  'intent',
]);

const FORBIDDEN_TEXT_PATTERNS = [
  /\bnot a diagnosis\b/i,
  /\bnot medical advice\b/i,
  /\bdiagnos(?:e|ed|es|is|tic(?:s|ally)?)\b/i,
  /\binjury diagnosis\b/i,
  /\bpossible injury\b/i,
  /\bmedical condition\b/i,
  /\b(?:certain|definite|guaranteed|inevitable)\s+overtraining\b/i,
  /\bovertraining\s+(?:will\s+(?:occur|happen)|is\s+(?:certain|definite|guaranteed|inevitable))\b/i,
  /\b(?:will|can)\s+(?:cause|lead to)\s+(?:an?\s+)?(?:injury|damage|harm)\b/i,
  /\bpas\s+un\s+diagnostic\b/i,
  /\b(?:condition|avis)\s+m[ée]dical(?:e)?\b/i,
  /\b(?:risque\s+de|causera|entra[iî]nera)\s+(?:une?\s+)?(?:blessure|dommage)\b/i,
  /\bsurentra[iî]nement\s+(?:certain|garanti|in[ée]vitable)\b/i,
];

class ProgramReviewValidationError extends Error {
  constructor(message, { code = 'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED', issues = [] } = {}) {
    super(message);
    this.name = 'ProgramReviewValidationError';
    this.code = code;
    this.issues = issues;
  }
}

function toIssues(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object' && Array.isArray(value.issues)) {
    return value.issues;
  }

  return [];
}

function pushIssue(issues, path, code, message, extra = {}) {
  issues.push({
    code,
    path,
    message,
    ...extra,
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObjectLike(value) {
  return Boolean(value) && typeof value === 'object';
}

function hasNonEmptyTrimmedString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deriveCanonicalReviewDecision(reviewOrIssues = []) {
  const issues = toIssues(reviewOrIssues);
  const hasHighNonRepairable = issues.some(
    (issue) => issue?.severity === 'HIGH' && issue?.repairability === 'NON_REPAIRABLE'
  );
  const hasHighRepairable = issues.some(
    (issue) => issue?.severity === 'HIGH' && issue?.repairability === 'REPAIRABLE'
  );

  const decision = hasHighNonRepairable
    ? 'FAIL'
    : hasHighRepairable
      ? 'REPAIR_REQUIRED'
      : 'PASS';

  return {
    decision,
    requiresRepair: decision === 'REPAIR_REQUIRED',
  };
}

function decodeJsonPointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveReviewJsonPointer(pointer, reviewInput) {
  if (pointer === null) {
    return {
      ok: true,
      value: null,
      segments: [],
    };
  }

  if (typeof pointer !== 'string') {
    return {
      ok: false,
      code: 'INVALID_JSON_POINTER',
      message: 'Review issue path must be null or a JSON Pointer string',
    };
  }

  if (pointer.length > PROGRAM_REVIEW_LIMITS.pathMaxLength) {
    return {
      ok: false,
      code: 'INVALID_JSON_POINTER',
      message: 'Review issue path exceeds the maximum length',
    };
  }

  if (!pointer.startsWith('/')) {
    return {
      ok: false,
      code: 'INVALID_JSON_POINTER',
      message: 'Review issue path must start with a slash',
    };
  }

  const rawSegments = pointer.slice(1).split('/');
  const hasInvalidEscape = rawSegments.some((segment) => !/^(?:[^~]|~[01])*$/.test(segment));
  if (hasInvalidEscape) {
    return {
      ok: false,
      code: 'INVALID_JSON_POINTER',
      message: 'Review issue path contains an invalid JSON Pointer escape',
    };
  }

  const segments = rawSegments.map(decodeJsonPointerSegment);
  const root = segments[0];

  if (!PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS.includes(root)) {
    return {
      ok: false,
      code: 'JSON_POINTER_ROOT_NOT_ALLOWED',
      message: 'Review issue path must begin at an allowed review input root',
      root,
    };
  }

  if (!isObjectLike(reviewInput) || Array.isArray(reviewInput)) {
    return {
      ok: false,
      code: 'JSON_POINTER_TARGET_UNAVAILABLE',
      message: 'Review input is required to resolve a review issue path',
    };
  }

  let current = reviewInput;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) {
        return {
          ok: false,
          code: 'JSON_POINTER_INVALID_ARRAY_INDEX',
          message: 'Review issue path must use zero-based array indexes',
          segment,
        };
      }

      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length || !hasOwn(current, segment)) {
        return {
          ok: false,
          code: 'JSON_POINTER_NOT_FOUND',
          message: 'Review issue path does not resolve to review input data',
          segment,
        };
      }

      current = current[index];
      continue;
    }

    if (!isObjectLike(current) || !hasOwn(current, segment)) {
      return {
        ok: false,
        code: 'JSON_POINTER_NOT_FOUND',
        message: 'Review issue path does not resolve to review input data',
        segment,
      };
    }

    current = current[segment];
  }

  return {
    ok: true,
    value: current,
    segments,
  };
}

function validateReviewJsonPointer(pointer, reviewInput) {
  return resolveReviewJsonPointer(pointer, reviewInput);
}

function containsForbiddenProgramReviewText(value) {
  return (
    typeof value === 'string' &&
    FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function validateIssueText(value, path, issues) {
  if (containsForbiddenProgramReviewText(value)) {
    pushIssue(
      issues,
      path,
      'OUT_OF_SCOPE_TEXT',
      'Review text contains prohibited medical, diagnostic, or dramatic wording'
    );
  }
}

function validateIssueRepairability(issue, path, issues) {
  if (issue?.severity === 'HIGH' && issue?.repairability === 'NOT_APPLICABLE') {
    pushIssue(
      issues,
      `${path}.repairability`,
      'INVALID_HIGH_REPAIRABILITY',
      'HIGH issues must be REPAIRABLE or NON_REPAIRABLE'
    );
  }

  if (issue?.repairability === 'REPAIRABLE') {
    if (!hasNonEmptyTrimmedString(issue.suggestedAction)) {
      pushIssue(
        issues,
        `${path}.suggestedAction`,
        'SUGGESTED_ACTION_REQUIRED',
        'REPAIRABLE issues require a non-empty suggestedAction'
      );
    }
    return;
  }

  if (
    issue?.repairability === 'NON_REPAIRABLE' ||
    issue?.repairability === 'NOT_APPLICABLE'
  ) {
    if (issue.suggestedAction !== null) {
      pushIssue(
        issues,
        `${path}.suggestedAction`,
        'SUGGESTED_ACTION_NOT_ALLOWED',
        'suggestedAction must be null unless the issue is REPAIRABLE'
      );
    }
  }
}

function validateProgramReviewSemantics(review = {}, reviewInput) {
  const source = isObjectLike(review) && !Array.isArray(review) ? review : {};
  const reviewIssues = toIssues(source);
  const issues = [];
  const canonical = deriveCanonicalReviewDecision(reviewIssues);
  const exactIssueKeys = new Set();
  const repairabilityByLocation = new Map();

  if (!hasNonEmptyTrimmedString(source.reviewSummary)) {
    pushIssue(
      issues,
      'reviewSummary',
      'REVIEW_SUMMARY_REQUIRED',
      'reviewSummary must contain non-whitespace text'
    );
  }

  validateIssueText(source.reviewSummary, 'reviewSummary', issues);

  reviewIssues.forEach((issue, index) => {
    const issuePath = `issues[${index}]`;

    if (issue?.issueIndex !== index + 1) {
      pushIssue(
        issues,
        `${issuePath}.issueIndex`,
        'ISSUE_INDEX_NOT_SEQUENTIAL',
        'issueIndex must be unique and sequential starting at 1',
        {
          expected: index + 1,
          actual: issue?.issueIndex,
        }
      );
    }

    validateIssueRepairability(issue, issuePath, issues);
    validateIssueText(issue?.message, `${issuePath}.message`, issues);
    validateIssueText(issue?.suggestedAction, `${issuePath}.suggestedAction`, issues);

    if (issue?.path !== null) {
      const pointerResult = resolveReviewJsonPointer(issue?.path, reviewInput);
      if (!pointerResult.ok) {
        pushIssue(
          issues,
          `${issuePath}.path`,
          pointerResult.code,
          pointerResult.message
        );
      }
    }

    const exactIssueKey = JSON.stringify([
      issue?.category,
      issue?.path,
      issue?.message,
    ]);
    if (exactIssueKeys.has(exactIssueKey)) {
      pushIssue(
        issues,
        issuePath,
        'DUPLICATE_ISSUE',
        'Review issues must not duplicate category, path, and message exactly'
      );
    } else {
      exactIssueKeys.add(exactIssueKey);
    }

    if (typeof issue?.category === 'string' && (typeof issue.path === 'string' || issue.path === null)) {
      const locationKey = JSON.stringify([issue.category, issue.path]);
      const previousRepairability = repairabilityByLocation.get(locationKey);

      if (
        previousRepairability &&
        issue.repairability &&
        previousRepairability !== issue.repairability
      ) {
        pushIssue(
          issues,
          issuePath,
          'CONTRADICTORY_ISSUES',
          'Issues for the same category and path cannot disagree on repairability'
        );
      } else if (issue.repairability) {
        repairabilityByLocation.set(locationKey, issue.repairability);
      }
    }
  });

  if (source.decision !== canonical.decision) {
    pushIssue(
      issues,
      'decision',
      'CANONICAL_DECISION_MISMATCH',
      'decision must match the canonical decision derived from issues',
      {
        expected: canonical.decision,
        actual: source.decision,
      }
    );
  }

  if (source.requiresRepair !== canonical.requiresRepair) {
    pushIssue(
      issues,
      'requiresRepair',
      'CANONICAL_REQUIRES_REPAIR_MISMATCH',
      'requiresRepair must match the canonical decision derived from issues',
      {
        expected: canonical.requiresRepair,
        actual: source.requiresRepair,
      }
    );
  }

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? review : null,
    issues,
    decision: canonical.decision,
    requiresRepair: canonical.requiresRepair,
  };
}

module.exports = {
  PROGRAM_REVIEW_ALLOWED_POINTER_ROOTS,
  ProgramReviewValidationError,
  containsForbiddenProgramReviewText,
  deriveCanonicalReviewDecision,
  resolveReviewJsonPointer,
  validateProgramReviewSemantics,
  validateReviewJsonPointer,
};
