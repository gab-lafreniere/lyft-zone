const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('./programGenerationContextBuilder');
const {
  PROGRAM_REVIEW_CONTRACT_VERSION,
  PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
} = require('./programReviewSchema');
const {
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
} = require('./weeklyPlanAiSchema');
const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
} = require('./weeklyPlanAnalytics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('./weeklyPlanEvaluationPolicy');

const PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION = 1;
const PROGRAM_REPAIR_MAX_ATTEMPTS = 1;
const PROGRAM_REPAIR_OUTPUT_MODE = 'full_replacement';

class ProgramRepairContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProgramRepairContextError';
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasCanonicalEvaluationPolicyIdentity(policy) {
  return (
    isObject(policy) &&
    policy.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    policy.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  );
}

function assertProgramGenerationContext(context) {
  if (
    !isObject(context) ||
    context.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION ||
    !hasCanonicalEvaluationPolicyIdentity(context.evaluationPolicy) ||
    !isObject(context.poolSnapshot) ||
    !Array.isArray(context.exercisePoolItems)
  ) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_CONTEXT',
      'A valid program generation context is required'
    );
  }
}

function assertSourcePlan(generatedAIOutput, generatedPlanDocument) {
  if (
    !isObject(generatedAIOutput) ||
    generatedAIOutput.schemaVersion !== AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION ||
    !Array.isArray(generatedAIOutput.workouts) ||
    !isObject(generatedPlanDocument) ||
    !Array.isArray(generatedPlanDocument.workouts)
  ) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_SOURCE_PLAN',
      'A valid program repair source plan is required'
    );
  }
}

function assertAnalytics(analytics, context) {
  const hasMatchingPolicyIdentity =
    analytics?.evaluationPolicy?.id === context.evaluationPolicy.id &&
    analytics?.evaluationPolicy?.version === context.evaluationPolicy.version;

  if (
    !isObject(analytics) ||
    analytics.schemaVersion !== WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION ||
    !hasCanonicalEvaluationPolicyIdentity(analytics.evaluationPolicy) ||
    !hasMatchingPolicyIdentity ||
    !isObject(analytics.plan) ||
    !Array.isArray(analytics.workouts)
  ) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_ANALYTICS',
      'Valid program repair analytics are required'
    );
  }
}

function isRepairableIssue(issue, severity) {
  return (
    isObject(issue) &&
    issue.severity === severity &&
    issue.repairability === 'REPAIRABLE'
  );
}

function assertInitialReview(initialReview) {
  const review = initialReview?.review;
  const issues = review?.issues;
  const hasMandatoryIssue =
    Array.isArray(issues) &&
    issues.some((issue) => isRepairableIssue(issue, 'HIGH'));

  if (
    !isObject(initialReview) ||
    initialReview.enabled !== true ||
    initialReview.decision !== 'REPAIR_REQUIRED' ||
    initialReview.requiresRepair !== true ||
    !isObject(review) ||
    review.schemaVersion !== PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION ||
    review.decision !== 'REPAIR_REQUIRED' ||
    review.requiresRepair !== true ||
    initialReview.contractVersion !== PROGRAM_REVIEW_CONTRACT_VERSION ||
    initialReview.outputSchemaVersion !== PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION ||
    !Array.isArray(issues) ||
    !hasMandatoryIssue
  ) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_REVIEW',
      'A repair-required initial program review is required'
    );
  }
}

function projectIssue(issue) {
  return {
    issueIndex: issue.issueIndex,
    category: issue.category,
    severity: issue.severity,
    path: issue.path,
    message: issue.message,
    repairability: issue.repairability,
    suggestedAction: issue.suggestedAction,
  };
}

function projectIssues(issues, severity) {
  return issues
    .filter((issue) => isRepairableIssue(issue, severity))
    .map(projectIssue)
    .sort((left, right) => left.issueIndex - right.issueIndex);
}

function cloneStructuredValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);

  Object.keys(value).forEach((key) => {
    clone[key] = cloneStructuredValue(value[key], seen);
  });

  return clone;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function buildProgramRepairContext({
  context,
  generatedAIOutput,
  generatedPlanDocument,
  analytics,
  initialReview,
} = {}) {
  assertProgramGenerationContext(context);
  assertSourcePlan(generatedAIOutput, generatedPlanDocument);
  assertAnalytics(analytics, context);
  assertInitialReview(initialReview);

  const repairContext = {
    schemaVersion: PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
    repairControl: {
      maxAttempts: PROGRAM_REPAIR_MAX_ATTEMPTS,
      attemptNumber: 1,
      outputMode: PROGRAM_REPAIR_OUTPUT_MODE,
      finalValidationRequired: true,
      finalAnalyticsRequired: true,
      finalReviewRequired: true,
    },
    programGenerationContext: context,
    source: {
      generatedAIOutput,
      generatedPlanDocument,
      analytics,
    },
    repairBrief: {
      initialReview: {
        schemaVersion: initialReview.review.schemaVersion,
        decision: initialReview.review.decision,
        requiresRepair: initialReview.review.requiresRepair,
        reviewSummary: initialReview.review.reviewSummary,
      },
      mandatoryIssues: projectIssues(initialReview.review.issues, 'HIGH'),
      recommendedIssues: projectIssues(initialReview.review.issues, 'MEDIUM'),
    },
  };

  return deepFreeze(cloneStructuredValue(repairContext));
}

module.exports = {
  PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
  PROGRAM_REPAIR_MAX_ATTEMPTS,
  PROGRAM_REPAIR_OUTPUT_MODE,
  ProgramRepairContextError,
  buildProgramRepairContext,
};
