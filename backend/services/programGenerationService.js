const { ApiError } = require('./usersService');
const {
  createWeeklyPlan,
  prepareAIWeeklyPlanDraftForCreate,
} = require('./weeklyPlansService');
const {
  generateWeeklyPlanAiOutput,
} = require('./weeklyPlanAiGenerationService');
const {
  ExercisePoolServiceError,
} = require('./exercisePoolService');
const {
  buildProgramGenerationContext,
  attachCoachInputsToProgramGenerationContext,
} = require('../src/domain/programGeneration/programGenerationContextBuilder');
const {
  PROGRAM_GENERATION_PROMPT_VERSION,
  buildProgramGenerationPrompt,
} = require('../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
  validateWeeklyPlanAiDebugContractAgainstAnalytics,
  validateWeeklyPlanAiOutputSemantics,
  validateGeneratedExerciseIdsAgainstPool,
} = require('../src/domain/programGeneration/weeklyPlanAiValidation');
const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  buildWeeklyPlanAiJsonSchema,
  validateWeeklyPlanAiOutputSchema,
} = require('../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  normalizeWeeklyPlanAiOutput,
} = require('../src/domain/programGeneration/weeklyPlanAiNormalizer');
const {
  buildWeeklyPlanGenerationContext,
} = require('../src/domain/programGeneration/weeklyPlanGenerationAudit');
const {
  WeeklyPlanAnalyticsError,
  calculateWeeklyPlanAnalytics,
} = require('../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  WeeklyPlanBackendDurationError,
  applyBackendCalculatedDurationsToPlanDocument,
  evaluateWeeklyPlanDurationGate,
} = require('../src/domain/programGeneration/weeklyPlanBackendDuration');
const {
  AIProgramReviewError,
  runAIProgramReview,
} = require('../src/domain/programGeneration/aiProgramReview');
const {
  AIProgramRepairError,
  runAIProgramRepair,
} = require('../src/domain/programGeneration/aiProgramRepair');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
} = require('../src/domain/programGeneration/prompts/programRepairPrompt');
const {
  buildAIWeeklyPlanPresentation,
} = require('../src/domain/programGeneration/weeklyPlanAiPresentation');
const {
  isAIWeeklyPlanDebugArtifactsEnabled,
  writeInitialGenerationDebugArtifacts,
  writeWeeklyPlanGenerationDebugArtifacts,
} = require('./weeklyPlanInitialGenerationDebugService');

const EXERCISE_POOL_ERROR_STATUS = Object.freeze({
  PROFILE_NOT_READY: 409,
  UNSUPPORTED_PROFILE_SCHEMA_VERSION: 422,
  VALIDATION_ERROR: 400,
});
const SUPPORTED_PRIMARY_GOAL = 'HYPERTROPHY';
const TEMPORARILY_UNSUPPORTED_PRIMARY_GOALS = new Set(['STRENGTH', 'MIXED']);

function isAIWeeklyPlanBuilderEnabled(env = process.env) {
  return String(env.ENABLE_AI_WEEKLY_PLAN_BUILDER || '').toLowerCase() === 'true';
}

function isAIWeeklyPlanReviewEnabled(env = process.env) {
  return String(env.ENABLE_AI_WEEKLY_PLAN_REVIEW || '').toLowerCase() === 'true';
}

function isAIWeeklyPlanRepairEnabled(env = process.env) {
  return String(env.ENABLE_AI_WEEKLY_PLAN_REPAIR || '').toLowerCase() === 'true';
}

function mapExercisePoolError(error) {
  if (!(error instanceof ExercisePoolServiceError)) {
    return error;
  }

  return new ApiError(
    EXERCISE_POOL_ERROR_STATUS[error.code] || 500,
    error.code,
    error.message
  );
}

function mapWeeklyPlanAnalyticsError(error) {
  if (!(error instanceof WeeklyPlanAnalyticsError)) {
    return error;
  }

  return new ApiError(
    500,
    'AI_WEEKLY_PLAN_ANALYTICS_FAILED',
    'AI weekly plan analytics could not be calculated'
  );
}

function validateGenerationDebugContract({
  generatedAIOutput,
  analytics,
  context,
} = {}) {
  if (!generatedAIOutput) {
    return buildPassedValidation();
  }

  return validateWeeklyPlanAiDebugContractAgainstAnalytics({
    generatedAIOutput,
    analytics,
    context,
  });
}

function buildGenerationDebugContractError(validation, repair = false) {
  return new ApiError(
    502,
    repair
      ? 'AI_WEEKLY_PLAN_REPAIR_DEBUG_CONTRACT_VALIDATION_FAILED'
      : 'AI_WEEKLY_PLAN_GENERATION_DEBUG_CONTRACT_VALIDATION_FAILED',
    repair
      ? 'Repaired AI weekly plan debug contract is inconsistent with backend analytics'
      : 'AI weekly plan debug contract is inconsistent with backend analytics',
    {
      stage: 'debug_contract',
      issues: validation.issues,
    }
  );
}

function mapAIProgramReviewError(error) {
  if (!(error instanceof AIProgramReviewError)) {
    return error;
  }

  const messages = {
    AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE: 'AI weekly plan review input is incomplete',
    AI_WEEKLY_PLAN_REVIEW_INPUT_TOO_LARGE: 'AI weekly plan review input is too large',
    AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED:
      'AI weekly plan review provider returned output that does not match the schema',
    AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED:
      'AI weekly plan review provider returned semantically invalid output',
    AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE:
      'AI weekly plan review provider returned an invalid response',
  };
  const code = Object.prototype.hasOwnProperty.call(messages, error.code)
    ? error.code
    : 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE';

  return new ApiError(502, code, messages[code]);
}

function mapAIProgramRepairError(error) {
  if (!(error instanceof AIProgramRepairError)) {
    return error;
  }

  const messages = {
    AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID: 'AI weekly plan repair input is invalid',
    AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED:
      'AI weekly plan repair prompt could not be prepared',
    AI_WEEKLY_PLAN_REPAIR_INPUT_TOO_LARGE: 'AI weekly plan repair input is too large',
    AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE:
      'AI weekly plan repair provider returned an invalid response',
  };
  const code = Object.prototype.hasOwnProperty.call(messages, error.code)
    ? error.code
    : 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE';

  return new ApiError(502, code, messages[code]);
}

function assertAIWeeklyPlanBuilderEnabled(env) {
  if (!isAIWeeklyPlanBuilderEnabled(env)) {
    throw new ApiError(
      503,
      'AI_WEEKLY_PLAN_BUILDER_DISABLED',
      'AI weekly plan builder is not enabled'
    );
  }
}

function assertPoolHasExercises(context) {
  if ((context?.poolSnapshot?.availableExerciseCount || 0) <= 0) {
    throw new ApiError(
      409,
      'EMPTY_EXERCISE_POOL',
      'AI weekly plan builder cannot generate a draft from an empty exercise pool'
    );
  }
}

function assertSupportedPrimaryGoal(context) {
  const primaryGoal = context?.primaryGoal || null;

  if (!primaryGoal) {
    throw new ApiError(
      409,
      'PROFILE_NOT_READY',
      'Training profile primaryGoal is required before generating an AI weekly plan'
    );
  }

  if (TEMPORARILY_UNSUPPORTED_PRIMARY_GOALS.has(primaryGoal)) {
    throw new ApiError(
      422,
      'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL',
      'AI Weekly Plan Builder V1 currently supports HYPERTROPHY only',
      {
        primaryGoal,
        supportedPrimaryGoals: [SUPPORTED_PRIMARY_GOAL],
      }
    );
  }

  if (primaryGoal !== SUPPORTED_PRIMARY_GOAL) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Training profile primaryGoal is invalid',
      [
        {
          path: 'primaryGoal',
          code: 'INVALID_ENUM',
          message: 'primaryGoal is invalid',
        },
      ]
    );
  }
}

function assertPromptDescriptor(promptDescriptor) {
  if (
    promptDescriptor?.promptVersion !== PROGRAM_GENERATION_PROMPT_VERSION ||
    typeof promptDescriptor?.systemMessage !== 'string' ||
    !promptDescriptor.systemMessage.trim() ||
    typeof promptDescriptor?.userMessage !== 'string' ||
    !promptDescriptor.userMessage.trim()
  ) {
    throw new Error('Invalid AI weekly plan prompt descriptor');
  }
}

async function buildPromptForWeeklyPlanBuilder(context, deps = {}) {
  try {
    const promptDescriptor = await (
      deps.buildProgramGenerationPrompt || buildProgramGenerationPrompt
    )({ context });
    assertPromptDescriptor(promptDescriptor);
    return promptDescriptor;
  } catch (_error) {
    throw new ApiError(
      500,
      'AI_WEEKLY_PLAN_PROMPT_BUILD_FAILED',
      'AI weekly plan builder prompt could not be constructed'
    );
  }
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function resolveGeneratedArtifact(promptDescriptor, deps = {}) {
  if (hasOwn(deps, 'generatedAIOutput')) {
    return {
      type: 'aiOutput',
      value: deps.generatedAIOutput,
      generator: {
        type: 'mock',
        model: null,
      },
    };
  }

  if (deps.generatedPlanDocument) {
    return {
      type: 'planDocument',
      value: deps.generatedPlanDocument,
      generator: {
        type: 'mock',
        model: null,
      },
    };
  }

  const schema = buildWeeklyPlanAiJsonSchema();
  const result = await (
    deps.generateWeeklyPlanAiOutput || generateWeeklyPlanAiOutput
  )({
    promptDescriptor,
    schema,
  });

  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !hasOwn(result, 'generatedAIOutput') ||
    !result.generator ||
    typeof result.generator !== 'object' ||
    result.generator.type !== 'openai'
  ) {
    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
      'AI weekly plan provider returned an invalid response'
    );
  }

  return {
    type: 'aiOutput',
    value: result.generatedAIOutput,
    generator: result.generator,
  };
}

function buildAIOutputErrorDetails(stage, issues = []) {
  return {
    stage,
    issues,
  };
}

function buildRepairValidationErrorDetails(stage, issues = []) {
  return {
    stage,
    issueCount: Array.isArray(issues) ? issues.length : 0,
    issues: Array.isArray(issues) ? issues : [],
  };
}

function resolveSemanticValidationErrorCode(issues = []) {
  if (issues.some((issue) => issue.code === 'UNSUPPORTED_BLOCK_TYPE')) {
    return 'AI_WEEKLY_PLAN_UNSUPPORTED_BLOCK_TYPE';
  }

  if (issues.some((issue) => issue.code === 'INVALID_CARDIO_BLOCK')) {
    return 'AI_WEEKLY_PLAN_INVALID_CARDIO_BLOCK';
  }

  return 'AI_WEEKLY_PLAN_INVALID_OUTPUT';
}

function assertPoolValidationOk(poolValidation, options = {}) {
  if (poolValidation.ok) {
    return;
  }

  if (options.repair) {
    throw new ApiError(
      422,
      'AI_WEEKLY_PLAN_REPAIR_POOL_VIOLATION',
      'Repaired AI weekly plan contains exercises outside the generation pool snapshot',
      buildRepairValidationErrorDetails('pool', poolValidation.issues)
    );
  }

  throw new ApiError(
    422,
    'AI_WEEKLY_PLAN_POOL_VIOLATION',
    'Generated weekly plan contains exercises outside the generation pool snapshot',
    options.structuredDetails
      ? buildAIOutputErrorDetails('pool', poolValidation.issues)
      : poolValidation.issues
  );
}

function buildBypassedAIProgramReview() {
  return {
    enabled: false,
    decision: null,
    requiresRepair: false,
    issueCount: 0,
    severityCounts: {
      INFO: 0,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
    },
    categoryCounts: {},
    repairIssues: [],
  };
}

function buildReviewDecisionErrorDetails(review = {}, debugArtifact = null) {
  const details = {
    decision: review.decision || null,
    issueCount: Number.isSafeInteger(review.issueCount) ? review.issueCount : 0,
    severityCounts: review.severityCounts || {
      INFO: 0,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
    },
    categoryCounts: review.categoryCounts || {},
  };

  if (
    typeof debugArtifact?.jsonPath === 'string' &&
    debugArtifact.jsonPath &&
    typeof debugArtifact?.textPath === 'string' &&
    debugArtifact.textPath
  ) {
    details.debugArtifact = {
      jsonPath: debugArtifact.jsonPath,
      textPath: debugArtifact.textPath,
    };
  }

  return details;
}

function isValidAIProgramReviewResult(review) {
  if (
    review?.enabled !== true ||
    !isObject(review.review) ||
    !isObject(review.provider) ||
    review.review.decision !== review.decision ||
    review.review.requiresRepair !== review.requiresRepair
  ) {
    return false;
  }

  if (review.decision === 'PASS') {
    return review.requiresRepair === false;
  }

  if (review.decision === 'REPAIR_REQUIRED') {
    return review.requiresRepair === true;
  }

  if (review.decision === 'FAIL') {
    return review.requiresRepair === false;
  }

  return false;
}

function assertAIProgramReviewAllowsPersistence(review, options = {}) {
  if (!isValidAIProgramReviewResult(review)) {
    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
      'AI weekly plan review provider returned an invalid response'
    );
  }

  if (
    review.decision === 'PASS' &&
    review.requiresRepair === false
  ) {
    return;
  }

  if (review?.decision === 'REPAIR_REQUIRED') {
    throw new ApiError(
      422,
      'AI_WEEKLY_PLAN_REVIEW_REQUIRES_REPAIR',
      'AI weekly plan review requires a repair before persistence',
      buildReviewDecisionErrorDetails(review, options.debugArtifact)
    );
  }

  if (review?.decision === 'FAIL') {
    throw new ApiError(
      422,
      'AI_WEEKLY_PLAN_REVIEW_FAILED',
      'AI weekly plan review rejected the generated plan',
      buildReviewDecisionErrorDetails(review, options.debugArtifact)
    );
  }

  throw new ApiError(
    502,
    'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    'AI weekly plan review provider returned an invalid response'
  );
}

function assertAIProgramReviewResultIsValid(review) {
  if (!isValidAIProgramReviewResult(review)) {
    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
      'AI weekly plan review provider returned an invalid response'
    );
  }
}

function appendDebugArtifactToError(error, debugArtifact) {
  if (
    !debugArtifact ||
    typeof debugArtifact.jsonPath !== 'string' ||
    !debugArtifact.jsonPath ||
    typeof debugArtifact.textPath !== 'string' ||
    !debugArtifact.textPath
  ) {
    return error;
  }

  const reference = {
    jsonPath: debugArtifact.jsonPath,
    textPath: debugArtifact.textPath,
  };

  if (isObject(error?.details)) {
    error.details = {
      ...error.details,
      debugArtifact: reference,
    };
  } else if (Array.isArray(error?.details)) {
    error.details = {
      issues: error.details,
      debugArtifact: reference,
    };
  } else if (error && typeof error === 'object') {
    error.details = {
      debugArtifact: reference,
    };
  }

  return error;
}

function buildPassedValidation() {
  return {
    ok: true,
    issueCount: 0,
    issues: [],
  };
}

function buildFailedValidationFromError(error) {
  const issues = Array.isArray(error?.details)
    ? error.details
    : Array.isArray(error?.details?.issues)
      ? error.details.issues
      : [];

  return {
    ok: false,
    issueCount: issues.length,
    issues,
  };
}

function buildDebugValidationsForEarlyFailure(
  stage,
  error,
  currentValidations = {}
) {
  const validations = {
    schema: currentValidations.schema ?? null,
    semantic: currentValidations.semantic ?? null,
    pool: currentValidations.pool ?? null,
    businessRules: currentValidations.businessRules ?? null,
    debugContract: currentValidations.debugContract ?? null,
  };

  if (stage === 'schema_validation_failed') {
    validations.schema = buildFailedValidationFromError(error);
  } else if (stage === 'semantic_validation_failed') {
    validations.schema = buildPassedValidation();
    validations.semantic = buildFailedValidationFromError(error);
  } else if (stage === 'normalization_failed') {
    validations.schema = buildPassedValidation();
    validations.semantic = buildPassedValidation();
  } else if (stage === 'pool_validation_failed') {
    validations.pool = buildFailedValidationFromError(error);
  } else if (stage === 'business_rules_failed') {
    validations.businessRules = buildFailedValidationFromError(error);
  } else if (stage === 'debug_contract_validation_failed') {
    validations.debugContract = buildFailedValidationFromError(error);
  }

  return validations;
}

function resolveOutputFailureStage(error) {
  if (error?.details?.stage === 'schema') {
    return 'schema_validation_failed';
  }
  if (error?.details?.stage === 'semantic') {
    return 'semantic_validation_failed';
  }
  if (error?.details?.stage === 'normalization') {
    return 'normalization_failed';
  }
  return 'provider_output_received';
}

function buildGenerationDebugPayload({
  stage,
  reviewEnabled,
  repairEnabled,
  context,
  generatedAIOutput,
  normalizedPlanDocument = null,
  validations = {},
  analytics = null,
  initialReview = null,
  generationProvider,
  repairAttempted = false,
  repairTrigger = null,
  repairProvider = null,
  durationGate = null,
}) {
  return {
    stage,
    configuration: {
      reviewEnabled,
      repairEnabled,
    },
    versions: {
      promptVersion: context?.coachInputs?.promptVersion,
      doctrineVersion: null,
      outputContractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
      outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
      reviewPromptVersion: initialReview?.promptVersion ?? null,
      reviewContractVersion: initialReview?.contractVersion ?? null,
      reviewOutputSchemaVersion: initialReview?.outputSchemaVersion ?? null,
    },
    context,
    generatedAIOutput,
    normalizedPlanDocument,
    validations: {
      schema: validations.schema ?? null,
      semantic: validations.semantic ?? null,
      pool: validations.pool ?? null,
      businessRules: validations.businessRules ?? null,
      debugContract: validations.debugContract ?? null,
    },
    analytics,
    durationGate,
    initialReview,
    generationProvider,
    repairAttempted,
    repairTrigger,
    repairProvider,
    persistenceAttempted: false,
  };
}

async function throwCandidateFailureWithDebugArtifact({
  error,
  stage,
  debug,
  generatedAIOutput,
  normalizedPlanDocument,
  analytics,
  durationGate = null,
  validations,
}) {
  const debugArtifact = await captureWeeklyPlanGenerationDebugArtifacts(
    buildGenerationDebugPayload({
      stage,
      reviewEnabled: debug.reviewEnabled,
      repairEnabled: debug.repairEnabled,
      context: debug.context,
      generatedAIOutput,
      normalizedPlanDocument,
      validations: buildDebugValidationsForEarlyFailure(
        stage,
        error,
        validations
      ),
      analytics,
      durationGate,
      generationProvider: debug.generationProvider,
      repairAttempted: debug.repairAttempted,
      repairTrigger: debug.repairTrigger,
      repairProvider: debug.repairProvider,
    }),
    debug.env,
    debug.deps
  );

  throw appendDebugArtifactToError(error, debugArtifact);
}

async function assertCandidateDebugContractValid({
  candidate,
  repair,
  debug,
}) {
  if (candidate.debugContractValidation.ok) {
    return;
  }

  await throwCandidateFailureWithDebugArtifact({
    error: buildGenerationDebugContractError(
      candidate.debugContractValidation,
      repair
    ),
    stage: 'debug_contract_validation_failed',
    debug,
    generatedAIOutput: candidate.generatedAIOutput,
    normalizedPlanDocument: candidate.document,
    analytics: candidate.analytics,
    durationGate: candidate.durationGate,
    validations: {
      schema: candidate.schemaValidation,
      semantic: candidate.semanticValidation,
      pool: candidate.poolValidation,
      businessRules: candidate.businessRulesValidation,
      debugContract: candidate.debugContractValidation,
    },
  });
}

async function captureWeeklyPlanGenerationDebugArtifacts(
  payload,
  env,
  deps = {}
) {
  if (!isAIWeeklyPlanDebugArtifactsEnabled(env)) {
    return null;
  }

  const logger = deps.debugArtifactLogger || console;
  const initialReviewStage = payload.stage === 'initial_review_complete';
  const writer =
    deps.writeWeeklyPlanGenerationDebugArtifacts ||
    (initialReviewStage
      ? deps.writeInitialGenerationDebugArtifacts ||
        writeInitialGenerationDebugArtifacts
      : writeWeeklyPlanGenerationDebugArtifacts);

  try {
    return await writer(payload, {
      env,
      logger,
    });
  } catch (_error) {
    logger.warn(
      '[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact could not be written'
    );
    return null;
  }
}

function buildFinalReviewErrorDetails(review = {}) {
  const details = buildReviewDecisionErrorDetails(review);

  return {
    finalDecision: details.decision,
    issueCount: details.issueCount,
    severityCounts: details.severityCounts,
    categoryCounts: details.categoryCounts,
  };
}

function assertFinalAIProgramReviewAllowsPersistence(review) {
  assertAIProgramReviewResultIsValid(review);

  if (review.decision === 'PASS') {
    return;
  }

  throw new ApiError(
    422,
    'AI_WEEKLY_PLAN_REPAIR_FAILED',
    'AI weekly plan repair did not pass final review',
    buildFinalReviewErrorDetails(review)
  );
}

function hasOnlyKeys(object, allowedKeys) {
  return isObject(object) && Object.keys(object).every((key) => allowedKeys.includes(key));
}

function isValidRepairerMetadata(repairer) {
  const tokenKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens'];
  const isValidTokenCount = (value) =>
    value === null || (Number.isSafeInteger(value) && value >= 0);

  return (
    hasOnlyKeys(repairer, ['type', 'model', 'responseId', 'usage']) &&
    repairer.type === 'openai' &&
    typeof repairer.model === 'string' &&
    Boolean(repairer.model.trim()) &&
    (repairer.responseId === null ||
      (typeof repairer.responseId === 'string' && Boolean(repairer.responseId.trim()))) &&
    hasOnlyKeys(repairer.usage, tokenKeys) &&
    tokenKeys.every((key) => hasOwn(repairer.usage, key)) &&
    tokenKeys.every((key) => isValidTokenCount(repairer.usage[key]))
  );
}

function assertAIProgramRepairResult(repairResult) {
  if (
    !isObject(repairResult) ||
    repairResult.attemptNumber !== 1 ||
    repairResult.promptVersion !== PROGRAM_REPAIR_PROMPT_VERSION ||
    repairResult.contractVersion !== AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION ||
    repairResult.outputSchemaVersion !== AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION ||
    !isObject(repairResult.repairedAIOutput) ||
    !isValidRepairerMetadata(repairResult.repairer)
  ) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
      'AI weekly plan repair provider returned an invalid response'
    );
  }
}

function buildInitialReviewSummary(review = {}) {
  const details = buildReviewDecisionErrorDetails(review);

  return {
    decision: details.decision,
    issueCount: details.issueCount,
    severityCounts: details.severityCounts,
    categoryCounts: details.categoryCounts,
  };
}

function buildBypassedAIRepairMetadata(enabled) {
  return {
    enabled,
    outcome: 'BYPASSED',
    trigger: null,
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
    initialReviewSummary: null,
    provider: null,
  };
}

function buildNotRequiredAIRepairMetadata(initialReview) {
  return {
    enabled: true,
    outcome: 'NOT_REQUIRED',
    trigger: null,
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
    initialReviewSummary: buildInitialReviewSummary(initialReview),
    provider: null,
  };
}

function buildPassedAIRepairMetadata(repairResult, trigger, initialReview = null) {
  return {
    enabled: true,
    outcome: 'PASSED',
    trigger,
    attempts: 1,
    maxAttempts: 1,
    promptVersion: repairResult.promptVersion,
    contractVersion: repairResult.contractVersion,
    outputSchemaVersion: repairResult.outputSchemaVersion,
    initialReviewSummary:
      trigger === 'REVIEW' ? buildInitialReviewSummary(initialReview) : null,
    provider: repairResult.repairer,
  };
}

function normalizeGeneratedAIOutput(generatedAIOutput, context, options = {}) {
  const schemaValidation = validateWeeklyPlanAiOutputSchema(generatedAIOutput);

  if (!schemaValidation.ok) {
    if (options.repair) {
      throw new ApiError(
        502,
        'AI_WEEKLY_PLAN_REPAIR_SCHEMA_VALIDATION_FAILED',
        'Repaired AI weekly plan output does not match the schema',
        buildRepairValidationErrorDetails('schema', schemaValidation.issues)
      );
    }

    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_SCHEMA_VALIDATION_FAILED',
      'AI weekly plan generator returned output that does not match the schema',
      buildAIOutputErrorDetails('schema', schemaValidation.issues)
    );
  }

  const semanticValidation = validateWeeklyPlanAiOutputSemantics(schemaValidation.value);

  if (!semanticValidation.ok) {
    if (options.repair) {
      throw new ApiError(
        502,
        'AI_WEEKLY_PLAN_REPAIR_SEMANTIC_VALIDATION_FAILED',
        'Repaired AI weekly plan output is semantically invalid',
        buildRepairValidationErrorDetails('semantic', semanticValidation.issues)
      );
    }

    throw new ApiError(
      502,
      resolveSemanticValidationErrorCode(semanticValidation.issues),
      'AI weekly plan generator returned semantically invalid output',
      buildAIOutputErrorDetails('semantic', semanticValidation.issues)
    );
  }

  let generatedPlanDocument;
  try {
    generatedPlanDocument = (
      options.normalizeWeeklyPlanAiOutput || normalizeWeeklyPlanAiOutput
    )(semanticValidation.value, { context });
  } catch (error) {
    if (options.repair) {
      throw new ApiError(
        502,
        'AI_WEEKLY_PLAN_REPAIR_NORMALIZATION_FAILED',
        'Repaired AI weekly plan output could not be normalized',
        {
          stage: 'normalization',
          issues: [
            {
              code: 'NORMALIZATION_FAILED',
              path: 'root',
              message:
                error.message ||
                'Repaired AI weekly plan output could not be normalized',
            },
          ],
        }
      );
    }

    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_NORMALIZATION_FAILED',
      'AI weekly plan output could not be normalized',
      buildAIOutputErrorDetails('normalization', [
        {
          code: 'NORMALIZATION_FAILED',
          path: 'root',
          message: error.message || 'AI weekly plan output could not be normalized',
        },
      ])
    );
  }

  return {
    generatedPlanDocument,
    schemaValidation,
    semanticValidation,
  };
}

function mapWeeklyPlanBackendDurationError(error) {
  if (!(error instanceof WeeklyPlanBackendDurationError)) {
    return error;
  }

  return new ApiError(
    500,
    'AI_WEEKLY_PLAN_ANALYTICS_FAILED',
    'Backend workout durations could not be applied',
    {
      stage: 'backend_duration_application',
      code: error.code,
      details: error.details,
    }
  );
}

function buildDurationGateError(
  code,
  message,
  durationGate,
  debugContractValidation = null
) {
  return new ApiError(422, code, message, {
    stage: 'duration_gate',
    workouts: durationGate.workouts,
    debugContractIssues:
      debugContractValidation?.ok === false
        ? debugContractValidation.issues
        : [],
  });
}

async function processWeeklyPlanCandidateV4({
  generatedAIOutput,
  generatedPlanDocument,
  context,
  userId,
  deps,
  repair = false,
  debug = {},
}) {
  let normalizedArtifact = null;
  let candidateDocument = generatedPlanDocument;
  let poolValidation = null;
  let businessRulesValidation = null;
  let analytics = null;
  const debugContext = {
    env: debug.env || deps.env || process.env,
    reviewEnabled: debug.reviewEnabled === true,
    repairEnabled: debug.repairEnabled === true,
    context,
    generationProvider: debug.generationProvider || null,
    repairAttempted: repair,
    repairTrigger: repair ? debug.repairTrigger || null : null,
    repairProvider: repair ? debug.repairProvider || null : null,
    deps,
  };
  const currentValidations = () => ({
    schema: normalizedArtifact?.schemaValidation ?? null,
    semantic: normalizedArtifact?.semanticValidation ?? null,
    pool: poolValidation,
    businessRules: businessRulesValidation,
  });

  if (generatedAIOutput) {
    try {
      normalizedArtifact = normalizeGeneratedAIOutput(
        generatedAIOutput,
        context,
        {
          repair,
          normalizeWeeklyPlanAiOutput: repair
            ? deps.normalizeWeeklyPlanAiOutput
            : deps.normalizeInitialWeeklyPlanAiOutput,
        }
      );
    } catch (error) {
      await throwCandidateFailureWithDebugArtifact({
        error,
        stage: resolveOutputFailureStage(error),
        debug: debugContext,
        generatedAIOutput,
        normalizedPlanDocument: null,
        analytics: null,
        validations: currentValidations(),
      });
    }
    candidateDocument = normalizedArtifact.generatedPlanDocument;
  }

  poolValidation = validateGeneratedExerciseIdsAgainstPool(
    candidateDocument,
    context.poolSnapshot
  );
  try {
    assertPoolValidationOk(poolValidation, {
      repair,
      structuredDetails: !repair,
    });
  } catch (error) {
    await throwCandidateFailureWithDebugArtifact({
      error,
      stage: 'pool_validation_failed',
      debug: debugContext,
      generatedAIOutput,
      normalizedPlanDocument: candidateDocument,
      analytics: null,
      validations: currentValidations(),
    });
  }

  let prepared;
  try {
    prepared = await (
      deps.prepareAIWeeklyPlanDraftForCreate ||
      prepareAIWeeklyPlanDraftForCreate
    )({
      ...candidateDocument,
      userId,
      source: 'ai',
    });
    if (!isObject(prepared) || !isObject(prepared.document)) {
      throw new Error('Invalid weekly plan preflight result');
    }
    businessRulesValidation = prepared.businessRulesValidation;
  } catch (error) {
    const mappedError = repair
      ? new ApiError(
        422,
        'AI_WEEKLY_PLAN_REPAIR_BUSINESS_RULES_FAILED',
        'Repaired AI weekly plan failed business rules validation',
        { stage: 'business_rules' }
      )
      : error;
    await throwCandidateFailureWithDebugArtifact({
      error: mappedError,
      stage: 'business_rules_failed',
      debug: debugContext,
      generatedAIOutput,
      normalizedPlanDocument: candidateDocument,
      analytics: null,
      validations: currentValidations(),
    });
  }

  try {
    analytics = await (
      deps.calculateWeeklyPlanAnalytics || calculateWeeklyPlanAnalytics
    )({
      generatedAIOutput,
      generatedPlanDocument: prepared.document,
      context,
    });
  } catch (error) {
    const mappedError = repair
      ? new ApiError(
        500,
        'AI_WEEKLY_PLAN_REPAIR_ANALYTICS_FAILED',
        'Repaired AI weekly plan analytics could not be calculated'
      )
      : mapWeeklyPlanAnalyticsError(error);
    await throwCandidateFailureWithDebugArtifact({
      error: mappedError,
      stage: 'analytics_failed',
      debug: debugContext,
      generatedAIOutput,
      normalizedPlanDocument: prepared.document,
      analytics: null,
      validations: currentValidations(),
    });
  }

  let documentWithBackendDurations;
  try {
    documentWithBackendDurations = (
      deps.applyBackendCalculatedDurationsToPlanDocument ||
      applyBackendCalculatedDurationsToPlanDocument
    )(prepared.document, analytics);
  } catch (error) {
    await throwCandidateFailureWithDebugArtifact({
      error: mapWeeklyPlanBackendDurationError(error),
      stage: 'backend_duration_application_failed',
      debug: debugContext,
      generatedAIOutput,
      normalizedPlanDocument: prepared.document,
      analytics,
      validations: currentValidations(),
    });
  }

  const debugContractValidation = validateGenerationDebugContract({
    generatedAIOutput,
    analytics,
    context,
  });

  const durationGate = (
    deps.evaluateWeeklyPlanDurationGate || evaluateWeeklyPlanDurationGate
  )(analytics);

  return {
    generatedAIOutput,
    document: documentWithBackendDurations,
    analytics,
    durationGate,
    debugContractValidation,
    poolValidation,
    businessRulesValidation,
    schemaValidation: normalizedArtifact?.schemaValidation ?? null,
    semanticValidation: normalizedArtifact?.semanticValidation ?? null,
  };
}

async function runProgramReviewV4(candidate, context, deps) {
  if (candidate.durationGate.correctionRequired) {
    throw buildDurationGateError(
      'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED',
      'AI weekly plan duration requires correction before Review',
      candidate.durationGate
    );
  }
  if (!candidate.debugContractValidation?.ok) {
    throw buildGenerationDebugContractError(
      candidate.debugContractValidation,
      false
    );
  }

  try {
    const review = await (deps.runAIProgramReview || runAIProgramReview)(
      {
        context,
        generatedAIOutput: candidate.generatedAIOutput,
        generatedPlanDocument: candidate.document,
        analytics: candidate.analytics,
      },
      deps
    );
    assertAIProgramReviewResultIsValid(review);
    return review;
  } catch (error) {
    throw mapAIProgramReviewError(error);
  }
}

async function runProgramRepairV4({
  trigger,
  candidate,
  context,
  initialReview = null,
  userId,
  deps,
  debug,
}) {
  if (!candidate.generatedAIOutput) {
    throw new ApiError(
      502,
      'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID',
      'AI weekly plan repair input is invalid'
    );
  }

  let repairResult;
  try {
    repairResult = await (deps.runAIProgramRepair || runAIProgramRepair)(
      {
        trigger,
        context,
        generatedAIOutput: candidate.generatedAIOutput,
        generatedPlanDocument: candidate.document,
        analytics: candidate.analytics,
        initialReview,
        debugContractValidation: candidate.debugContractValidation,
      },
      deps
    );
    assertAIProgramRepairResult(repairResult);
  } catch (error) {
    throw mapAIProgramRepairError(error);
  }

  const repairedCandidate = await processWeeklyPlanCandidateV4({
    generatedAIOutput: repairResult.repairedAIOutput,
    context,
    userId,
    deps,
    repair: true,
    debug: {
      ...debug,
      repairTrigger: trigger,
      repairProvider: repairResult.repairer,
    },
  });

  return {
    repairResult,
    repairedCandidate,
  };
}

async function createAIWeeklyPlanDraftV4(payload = {}, deps = {}) {
  const env = deps.env || process.env;
  assertAIWeeklyPlanBuilderEnabled(env);
  const reviewEnabled = isAIWeeklyPlanReviewEnabled(env);
  const repairEnabled = isAIWeeklyPlanRepairEnabled(env);

  let context;
  try {
    context = await (
      deps.buildProgramGenerationContext || buildProgramGenerationContext
    )(payload.userId, payload.options || {}, deps);
  } catch (error) {
    throw mapExercisePoolError(error);
  }

  assertSupportedPrimaryGoal(context);
  assertPoolHasExercises(context);
  context = attachCoachInputsToProgramGenerationContext(context, {
    promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
  });
  const promptDescriptor = await buildPromptForWeeklyPlanBuilder(
    context,
    deps
  );
  const generatedArtifact = await resolveGeneratedArtifact(
    promptDescriptor,
    deps
  );
  const candidateDebug = {
    env,
    reviewEnabled,
    repairEnabled,
    generationProvider: generatedArtifact.generator,
  };

  let candidate = await processWeeklyPlanCandidateV4({
    generatedAIOutput:
      generatedArtifact.type === 'aiOutput'
        ? generatedArtifact.value
        : null,
    generatedPlanDocument:
      generatedArtifact.type === 'planDocument'
        ? generatedArtifact.value
        : null,
    context,
    userId: payload.userId,
    deps,
    debug: candidateDebug,
  });

  const initialDurationGate = candidate.durationGate;
  let repairConsumed = false;
  let repairTrigger = null;
  let repairResult = null;
  let initialReview = null;
  let finalReview = null;

  if (candidate.durationGate.correctionRequired) {
    const durationCorrectionArtifact =
      await captureWeeklyPlanGenerationDebugArtifacts(
      buildGenerationDebugPayload({
        stage: 'duration_correction_required',
        reviewEnabled,
        repairEnabled,
        context,
        generatedAIOutput: candidate.generatedAIOutput,
        normalizedPlanDocument: candidate.document,
        analytics: candidate.analytics,
        durationGate: candidate.durationGate,
        validations: {
          schema: candidate.schemaValidation,
          semantic: candidate.semanticValidation,
          pool: candidate.poolValidation,
          businessRules: candidate.businessRulesValidation,
          debugContract: candidate.debugContractValidation,
        },
        generationProvider: generatedArtifact.generator,
      }),
      env,
      deps
    );

    if (!repairEnabled) {
      throw appendDebugArtifactToError(
        buildDurationGateError(
          'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED',
          'AI weekly plan duration requires correction',
          candidate.durationGate,
          candidate.debugContractValidation
        ),
        durationCorrectionArtifact
      );
    }

    const durationRepair = await runProgramRepairV4({
      trigger: 'DURATION',
      candidate,
      context,
      userId: payload.userId,
      deps,
      debug: candidateDebug,
    });
    repairConsumed = true;
    repairTrigger = 'DURATION';
    repairResult = durationRepair.repairResult;
    candidate = durationRepair.repairedCandidate;

    if (candidate.durationGate.correctionRequired) {
      const durationRepairFailureArtifact =
        await captureWeeklyPlanGenerationDebugArtifacts(
        buildGenerationDebugPayload({
          stage: 'duration_repair_failed',
          reviewEnabled,
          repairEnabled,
          context,
          generatedAIOutput: candidate.generatedAIOutput,
          normalizedPlanDocument: candidate.document,
          analytics: candidate.analytics,
          durationGate: candidate.durationGate,
          validations: {
            schema: candidate.schemaValidation,
            semantic: candidate.semanticValidation,
            pool: candidate.poolValidation,
            businessRules: candidate.businessRulesValidation,
            debugContract: candidate.debugContractValidation,
          },
          generationProvider: generatedArtifact.generator,
          repairAttempted: true,
          repairTrigger,
          repairProvider: repairResult?.repairer,
        }),
        env,
        deps
      );
      throw appendDebugArtifactToError(
        buildDurationGateError(
          'AI_WEEKLY_PLAN_DURATION_REPAIR_FAILED',
          'AI weekly plan duration repair did not reach the acceptable range',
          candidate.durationGate,
          candidate.debugContractValidation
        ),
        durationRepairFailureArtifact
      );
    }

    await assertCandidateDebugContractValid({
      candidate,
      repair: true,
      debug: {
        ...candidateDebug,
        repairAttempted: true,
        repairTrigger,
        repairProvider: repairResult?.repairer,
        context,
        deps,
      },
    });

    await captureWeeklyPlanGenerationDebugArtifacts(
      buildGenerationDebugPayload({
        stage: 'duration_repair_complete',
        reviewEnabled,
        repairEnabled,
        context,
        generatedAIOutput: candidate.generatedAIOutput,
        normalizedPlanDocument: candidate.document,
        analytics: candidate.analytics,
        durationGate: candidate.durationGate,
        validations: {
          schema: candidate.schemaValidation,
          semantic: candidate.semanticValidation,
          pool: candidate.poolValidation,
          businessRules: candidate.businessRulesValidation,
          debugContract: candidate.debugContractValidation,
        },
        generationProvider: generatedArtifact.generator,
        repairAttempted: true,
        repairTrigger,
        repairProvider: repairResult?.repairer,
      }),
      env,
      deps
    );
  }

  if (!repairConsumed && !candidate.durationGate.correctionRequired) {
    await assertCandidateDebugContractValid({
      candidate,
      repair: repairConsumed,
      debug: {
        ...candidateDebug,
        repairAttempted: repairConsumed,
        repairTrigger,
        repairProvider: repairResult?.repairer,
        context,
        deps,
      },
    });
  }

  let aiReview = buildBypassedAIProgramReview();
  let aiRepair = buildBypassedAIRepairMetadata(repairEnabled);

  if (reviewEnabled) {
    initialReview = await runProgramReviewV4(candidate, context, deps);

    if (initialReview.decision === 'PASS') {
      assertAIProgramReviewAllowsPersistence(initialReview);
      finalReview = initialReview;
      aiReview = {
        ...initialReview,
        reviewAttempts: 1,
      };
      aiRepair = repairConsumed
        ? buildPassedAIRepairMetadata(
            repairResult,
            repairTrigger,
            null
          )
        : repairEnabled
          ? buildNotRequiredAIRepairMetadata(initialReview)
          : buildBypassedAIRepairMetadata(false);
    } else if (initialReview.decision === 'FAIL') {
      assertAIProgramReviewAllowsPersistence(initialReview);
    } else if (repairConsumed) {
      throw new ApiError(
        422,
        'AI_WEEKLY_PLAN_REPAIR_BUDGET_EXHAUSTED',
        'AI weekly plan Review requires repair after the single Repair was consumed',
        buildReviewDecisionErrorDetails(initialReview)
      );
    } else if (!repairEnabled) {
      assertAIProgramReviewAllowsPersistence(initialReview);
    } else {
      await captureWeeklyPlanGenerationDebugArtifacts(
        buildGenerationDebugPayload({
          stage: 'review_repair_required',
          reviewEnabled,
          repairEnabled,
          context,
          generatedAIOutput: candidate.generatedAIOutput,
          normalizedPlanDocument: candidate.document,
          analytics: candidate.analytics,
          durationGate: candidate.durationGate,
          validations: {
            schema: candidate.schemaValidation,
            semantic: candidate.semanticValidation,
            pool: candidate.poolValidation,
            businessRules: candidate.businessRulesValidation,
            debugContract: candidate.debugContractValidation,
          },
          initialReview,
          generationProvider: generatedArtifact.generator,
        }),
        env,
        deps
      );

      const reviewRepair = await runProgramRepairV4({
        trigger: 'REVIEW',
        candidate,
        context,
        initialReview,
        userId: payload.userId,
        deps,
        debug: candidateDebug,
      });
      repairConsumed = true;
      repairTrigger = 'REVIEW';
      repairResult = reviewRepair.repairResult;
      candidate = reviewRepair.repairedCandidate;

      if (candidate.durationGate.correctionRequired) {
        const repairDurationFailureArtifact =
          await captureWeeklyPlanGenerationDebugArtifacts(
          buildGenerationDebugPayload({
            stage: 'duration_repair_failed',
            reviewEnabled,
            repairEnabled,
            context,
            generatedAIOutput: candidate.generatedAIOutput,
            normalizedPlanDocument: candidate.document,
            analytics: candidate.analytics,
            durationGate: candidate.durationGate,
            validations: {
              schema: candidate.schemaValidation,
              semantic: candidate.semanticValidation,
              pool: candidate.poolValidation,
              businessRules: candidate.businessRulesValidation,
              debugContract: candidate.debugContractValidation,
            },
            initialReview,
            generationProvider: generatedArtifact.generator,
            repairAttempted: true,
            repairTrigger,
            repairProvider: repairResult?.repairer,
          }),
          env,
          deps
        );
        throw appendDebugArtifactToError(
          buildDurationGateError(
            'AI_WEEKLY_PLAN_REPAIR_DURATION_INVALID',
            'Qualitative AI weekly plan repair made duration invalid',
            candidate.durationGate,
            candidate.debugContractValidation
          ),
          repairDurationFailureArtifact
        );
      }

      await assertCandidateDebugContractValid({
        candidate,
        repair: true,
        debug: {
          ...candidateDebug,
          repairAttempted: true,
          repairTrigger,
          repairProvider: repairResult?.repairer,
          context,
          deps,
        },
      });

      finalReview = await runProgramReviewV4(candidate, context, deps);
      assertFinalAIProgramReviewAllowsPersistence(finalReview);
      aiReview = {
        ...finalReview,
        reviewAttempts: 2,
      };
      aiRepair = buildPassedAIRepairMetadata(
        repairResult,
        repairTrigger,
        initialReview
      );
    }
  } else if (repairConsumed) {
    aiRepair = buildPassedAIRepairMetadata(
      repairResult,
      repairTrigger,
      null
    );
  }

  await captureWeeklyPlanGenerationDebugArtifacts(
    buildGenerationDebugPayload({
      stage: reviewEnabled
        ? 'final_review_complete'
        : repairConsumed && repairTrigger === 'DURATION'
          ? 'duration_repair_complete'
          : 'duration_gate_passed',
      reviewEnabled,
      repairEnabled,
      context,
      generatedAIOutput: candidate.generatedAIOutput,
      normalizedPlanDocument: candidate.document,
      analytics: candidate.analytics,
      durationGate: candidate.durationGate,
      validations: {
        schema: candidate.schemaValidation,
        semantic: candidate.semanticValidation,
        pool: candidate.poolValidation,
        businessRules: candidate.businessRulesValidation,
        debugContract: candidate.debugContractValidation,
      },
      initialReview: finalReview,
      generationProvider: generatedArtifact.generator,
      repairAttempted: repairConsumed,
      repairTrigger,
      repairProvider: repairResult?.repairer,
    }),
    env,
    deps
  );

  let generationContext;
  try {
    generationContext = await (
      deps.buildWeeklyPlanGenerationContext ||
      buildWeeklyPlanGenerationContext
    )({
      context,
      generatedAIOutput: candidate.generatedAIOutput,
      generatedPlanDocument: candidate.document,
      validation: {
        schemaValidation: candidate.schemaValidation,
        semanticValidation: candidate.semanticValidation,
        poolValidation: candidate.poolValidation,
      },
      businessRulesValidation: candidate.businessRulesValidation,
      analytics: candidate.analytics,
      initialDurationGate,
      finalDurationGate: candidate.durationGate,
      generator: generatedArtifact.generator,
      aiReview,
      aiRepair,
    });
  } catch (error) {
    throw mapWeeklyPlanAnalyticsError(error);
  }

  const aiPresentation = buildAIWeeklyPlanPresentation({
    context,
    generatedAIOutput: candidate.generatedAIOutput,
    generatedPlanDocument: candidate.document,
    analytics: candidate.analytics,
  });

  const createdDraft = await (deps.createWeeklyPlan || createWeeklyPlan)({
    ...candidate.document,
    userId: payload.userId,
    source: 'ai',
    generationContext,
  });

  return {
    ...createdDraft,
    aiPresentation,
  };
}

module.exports = {
  assertAIProgramReviewAllowsPersistence,
  buildBypassedAIProgramReview,
  createAIWeeklyPlanDraft: createAIWeeklyPlanDraftV4,
  isAIWeeklyPlanBuilderEnabled,
  isAIWeeklyPlanRepairEnabled,
  isAIWeeklyPlanReviewEnabled,
  mapAIProgramRepairError,
  mapAIProgramReviewError,
  mapExercisePoolError,
};
