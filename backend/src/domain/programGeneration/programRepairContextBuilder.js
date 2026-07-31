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
const {
  buildDurationCorrectionDetails,
} = require('./weeklyPlanBackendDuration');

const PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION = 4;
const PROGRAM_REPAIR_MAX_ATTEMPTS = 1;
const PROGRAM_REPAIR_OUTPUT_MODE = 'full_replacement';
const PROGRAM_REPAIR_TRIGGERS = Object.freeze(['DURATION', 'REVIEW']);
const MIN_SESSIONS_PER_WEEK = 1;
const MAX_SESSIONS_PER_WEEK = 7;
const MIN_DURATION_PER_SESSION_MINUTES = 15;
const MAX_DURATION_PER_SESSION_MINUTES = 120;

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
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function hasCanonicalEvaluationPolicyIdentity(policy) {
  return (
    isObject(policy) &&
    policy.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    policy.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  );
}

function assertProgramGenerationContext(context) {
  const availability = context?.availability;
  if (
    !isObject(context) ||
    context.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION ||
    !hasCanonicalEvaluationPolicyIdentity(context.evaluationPolicy) ||
    !isObject(context.poolSnapshot) ||
    !Array.isArray(context.exercisePoolItems) ||
    !isObject(availability) ||
    !Number.isInteger(availability.sessionsPerWeek) ||
    availability.sessionsPerWeek < MIN_SESSIONS_PER_WEEK ||
    availability.sessionsPerWeek > MAX_SESSIONS_PER_WEEK ||
    !Number.isInteger(availability.durationPerSession) ||
    availability.durationPerSession < MIN_DURATION_PER_SESSION_MINUTES ||
    availability.durationPerSession > MAX_DURATION_PER_SESSION_MINUTES
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
  const hasCanonicalRequestedDurations =
    Array.isArray(analytics?.workouts) &&
    analytics.workouts.every(
      (workout) =>
        workout?.requestedDurationMinutes ===
        context.availability.durationPerSession &&
        isObject(workout?.durationCalculation)
    );

  if (
    !isObject(analytics) ||
    analytics.schemaVersion !== WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION ||
    !hasCanonicalEvaluationPolicyIdentity(analytics.evaluationPolicy) ||
    !hasMatchingPolicyIdentity ||
    !isObject(analytics.plan) ||
    !Array.isArray(analytics.workouts) ||
    !hasCanonicalRequestedDurations
  ) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_ANALYTICS',
      'Valid backend-only program repair analytics are required'
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

function projectEvaluationPolicy(policy) {
  return {
    id: policy.id,
    version: policy.version,
    scope: policy.scope,
    duration: cloneStructuredValue(policy.duration),
    cardio: cloneStructuredValue(policy.cardio),
    volumeFrequencyTargetsEvaluated: false,
  };
}

function buildAcceptableDurationBrief(analytics) {
  return {
    status: 'ACCEPTABLE',
    workouts: analytics.workouts.map((workout) => ({
      workoutOrderIndex: workout.workoutOrderIndex,
      requestedDurationMinutes: workout.requestedDurationMinutes,
      calculatedDurationMinutes: workout.calculatedDurationMinutes,
      durationAlignmentStatus: workout.durationAlignmentStatus,
      backendDurationCalculation: cloneStructuredValue(
        workout.durationCalculation
      ),
    })),
  };
}

function projectDebugContractValidation(validation) {
  const issues = Array.isArray(validation?.issues)
    ? validation.issues
        .filter((issue) => isObject(issue))
        .map((issue) => ({
          code: typeof issue.code === 'string' ? issue.code : null,
          path: typeof issue.path === 'string' ? issue.path : null,
          message: typeof issue.message === 'string' ? issue.message : null,
        }))
        .filter((issue) => issue.code && issue.path && issue.message)
    : [];

  return {
    requiresCorrection: validation?.ok === false && issues.length > 0,
    issues,
  };
}

function buildProgramRepairContext({
  context,
  generatedAIOutput,
  generatedPlanDocument,
  analytics,
  initialReview = null,
  trigger = null,
  debugContractValidation = null,
} = {}) {
  assertProgramGenerationContext(context);
  assertSourcePlan(generatedAIOutput, generatedPlanDocument);
  assertAnalytics(analytics, context);

  const resolvedTrigger =
    trigger ||
    (analytics.workouts.some(
      (workout) => workout.durationRequiresCorrection === true
    )
      ? 'DURATION'
      : 'REVIEW');

  if (!PROGRAM_REPAIR_TRIGGERS.includes(resolvedTrigger)) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_TRIGGER',
      'Program repair trigger must be DURATION or REVIEW'
    );
  }

  if (resolvedTrigger === 'REVIEW') {
    assertInitialReview(initialReview);
    if (
      analytics.workouts.some(
        (workout) => workout.durationRequiresCorrection === true
      )
    ) {
      throw new ProgramRepairContextError(
        'INVALID_PROGRAM_REPAIR_ANALYTICS',
        'Review repair requires duration-valid backend Analytics'
      );
    }
  }

  const durationCorrections =
    resolvedTrigger === 'DURATION'
      ? buildDurationCorrectionDetails(analytics)
      : [];
  if (resolvedTrigger === 'DURATION' && durationCorrections.length === 0) {
    throw new ProgramRepairContextError(
      'INVALID_PROGRAM_REPAIR_ANALYTICS',
      'Duration repair requires at least one correction-required workout'
    );
  }

  const projectedContext = cloneStructuredValue(context);
  projectedContext.evaluationPolicy = projectEvaluationPolicy(
    context.evaluationPolicy
  );

  const review =
    resolvedTrigger === 'REVIEW'
      ? {
          schemaVersion: initialReview.review.schemaVersion,
          decision: initialReview.review.decision,
          requiresRepair: initialReview.review.requiresRepair,
          reviewSummary: initialReview.review.reviewSummary,
        }
      : null;
  const issues = resolvedTrigger === 'REVIEW' ? initialReview.review.issues : [];

  return deepFreeze({
    schemaVersion: PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
    repairControl: {
      maxAttempts: PROGRAM_REPAIR_MAX_ATTEMPTS,
      attemptNumber: 1,
      outputMode: PROGRAM_REPAIR_OUTPUT_MODE,
      trigger: resolvedTrigger,
    },
    programGenerationContext: projectedContext,
    source: {
      generatedAIOutput: cloneStructuredValue(generatedAIOutput),
      generatedPlanDocument: cloneStructuredValue(generatedPlanDocument),
      analytics: cloneStructuredValue(analytics),
    },
    repairBrief: {
      duration:
        resolvedTrigger === 'DURATION'
          ? {
              status: 'CORRECTION_REQUIRED',
              workouts: durationCorrections,
            }
          : buildAcceptableDurationBrief(analytics),
      debugContract: projectDebugContractValidation(
        debugContractValidation
      ),
      review,
      mandatoryIssues: projectIssues(issues, 'HIGH'),
      recommendedIssues: projectIssues(issues, 'MEDIUM'),
    },
  });
}

module.exports = {
  PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
  PROGRAM_REPAIR_MAX_ATTEMPTS,
  PROGRAM_REPAIR_OUTPUT_MODE,
  PROGRAM_REPAIR_TRIGGERS,
  ProgramRepairContextError,
  buildProgramRepairContext,
};
