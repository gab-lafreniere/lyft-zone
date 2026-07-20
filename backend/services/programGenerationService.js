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
  WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
  WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
  WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
  loadWeeklyPlanBuilderDoctrine,
} = require('../src/ai/doctrines/bodybuildingDoctrineLoader');
const {
  PROGRAM_GENERATION_PROMPT_VERSION,
  buildProgramGenerationPrompt,
} = require('../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
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

async function loadDoctrineForWeeklyPlanBuilder(deps = {}) {
  try {
    const doctrine = await (
      deps.loadWeeklyPlanBuilderDoctrine || loadWeeklyPlanBuilderDoctrine
    )();

    if (
      doctrine?.id !== WEEKLY_PLAN_BUILDER_DOCTRINE_ID ||
      doctrine?.version !== WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION ||
      doctrine?.derivedFromDoctrineVersion !==
        WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION ||
      typeof doctrine?.content !== 'string' ||
      !doctrine.content.trim()
    ) {
      throw new Error('Invalid weekly plan builder doctrine descriptor');
    }

    return doctrine;
  } catch (_error) {
    throw new ApiError(
      503,
      'AI_WEEKLY_PLAN_DOCTRINE_UNAVAILABLE',
      'AI weekly plan builder doctrine is unavailable'
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

async function buildPromptForWeeklyPlanBuilder(doctrine, context, deps = {}) {
  try {
    const promptDescriptor = await (
      deps.buildProgramGenerationPrompt || buildProgramGenerationPrompt
    )({ doctrine, context });
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
  };
}

function resolveSemanticValidationErrorCode(issues = []) {
  if (issues.some((issue) => issue.code === 'UNSUPPORTED_BLOCK_TYPE')) {
    return 'AI_WEEKLY_PLAN_UNSUPPORTED_BLOCK_TYPE';
  }

  if (issues.some((issue) => issue.code === 'INVALID_CARDIO_BLOCK')) {
    return 'AI_WEEKLY_PLAN_INVALID_CARDIO_BLOCK';
  }

  if (issues.some((issue) => issue.code === 'NOTES_POLICY_VIOLATION')) {
    return 'AI_WEEKLY_PLAN_NOTES_POLICY_VIOLATION';
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

function buildReviewDecisionErrorDetails(review = {}) {
  return {
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

function assertAIProgramReviewAllowsPersistence(review) {
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
      buildReviewDecisionErrorDetails(review)
    );
  }

  if (review?.decision === 'FAIL') {
    throw new ApiError(
      422,
      'AI_WEEKLY_PLAN_REVIEW_FAILED',
      'AI weekly plan review rejected the generated plan',
      buildReviewDecisionErrorDetails(review)
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
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
    initialReviewSummary: buildInitialReviewSummary(initialReview),
    provider: null,
  };
}

function buildPassedAIRepairMetadata(repairResult, initialReview) {
  return {
    enabled: true,
    outcome: 'PASSED',
    attempts: 1,
    maxAttempts: 1,
    promptVersion: repairResult.promptVersion,
    contractVersion: repairResult.contractVersion,
    outputSchemaVersion: repairResult.outputSchemaVersion,
    initialReviewSummary: buildInitialReviewSummary(initialReview),
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
        'Repaired AI weekly plan output could not be normalized'
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

async function createAIWeeklyPlanDraft(payload = {}, deps = {}) {
  const env = deps.env || process.env;
  assertAIWeeklyPlanBuilderEnabled(env);

  let context;
  try {
    context = await (deps.buildProgramGenerationContext || buildProgramGenerationContext)(
      payload.userId,
      payload.options || {},
      deps
    );
  } catch (error) {
    throw mapExercisePoolError(error);
  }

  assertSupportedPrimaryGoal(context);
  assertPoolHasExercises(context);

  const doctrine = await loadDoctrineForWeeklyPlanBuilder(deps);
  context = attachCoachInputsToProgramGenerationContext(context, {
    doctrine,
    promptVersion: PROGRAM_GENERATION_PROMPT_VERSION,
  });
  const promptDescriptor = await buildPromptForWeeklyPlanBuilder(doctrine, context, deps);

  const generatedArtifact = await resolveGeneratedArtifact(promptDescriptor, deps);
  let generatedAIOutput = null;
  let generatedPlanDocument;
  let schemaValidation = null;
  let semanticValidation = null;
  let poolValidation;

  if (generatedArtifact.type === 'aiOutput') {
    generatedAIOutput = generatedArtifact.value;
    const normalizedArtifact = normalizeGeneratedAIOutput(generatedAIOutput, context);
    generatedPlanDocument = normalizedArtifact.generatedPlanDocument;
    schemaValidation = normalizedArtifact.schemaValidation;
    semanticValidation = normalizedArtifact.semanticValidation;
    poolValidation = validateGeneratedExerciseIdsAgainstPool(
      generatedPlanDocument,
      context.poolSnapshot
    );

    assertPoolValidationOk(poolValidation, { structuredDetails: true });
  } else {
    generatedPlanDocument = generatedArtifact.value;
    poolValidation = validateGeneratedExerciseIdsAgainstPool(
      generatedPlanDocument,
      context.poolSnapshot
    );

    assertPoolValidationOk(poolValidation);
  }

  const prepared = await (
    deps.prepareAIWeeklyPlanDraftForCreate || prepareAIWeeklyPlanDraftForCreate
  )({
    ...generatedPlanDocument,
    userId: payload.userId,
    source: 'ai',
  });

  let analytics;
  try {
    analytics = await (
      deps.calculateWeeklyPlanAnalytics || calculateWeeklyPlanAnalytics
    )({
      generatedAIOutput,
      generatedPlanDocument: prepared.document,
      context,
    });
  } catch (error) {
    throw mapWeeklyPlanAnalyticsError(error);
  }

  const reviewEnabled = isAIWeeklyPlanReviewEnabled(env);
  const repairEnabled = isAIWeeklyPlanRepairEnabled(env);
  let finalGeneratedAIOutput = generatedAIOutput;
  let finalPrepared = prepared;
  let finalSchemaValidation = schemaValidation;
  let finalSemanticValidation = semanticValidation;
  let finalPoolValidation = poolValidation;
  let finalAnalytics = analytics;
  let aiReview = buildBypassedAIProgramReview();
  let aiRepair = buildBypassedAIRepairMetadata(repairEnabled);

  if (reviewEnabled) {
    let initialReview;
    try {
      initialReview = await (deps.runAIProgramReview || runAIProgramReview)(
        {
          doctrine,
          context,
          generatedAIOutput,
          generatedPlanDocument: prepared.document,
          analytics,
        },
        deps
      );
    } catch (error) {
      throw mapAIProgramReviewError(error);
    }

    assertAIProgramReviewResultIsValid(initialReview);

    if (initialReview.decision === 'PASS') {
      assertAIProgramReviewAllowsPersistence(initialReview);
      aiReview = initialReview;
      if (repairEnabled) {
        aiRepair = buildNotRequiredAIRepairMetadata(initialReview);
      }
    } else if (initialReview.decision === 'FAIL' || !repairEnabled) {
      assertAIProgramReviewAllowsPersistence(initialReview);
    } else {
      if (!generatedAIOutput) {
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
            doctrine,
            context,
            generatedAIOutput,
            generatedPlanDocument: prepared.document,
            analytics,
            initialReview,
          },
          deps
        );
        assertAIProgramRepairResult(repairResult);
      } catch (error) {
        throw mapAIProgramRepairError(error);
      }

      const repairedAIOutput = repairResult.repairedAIOutput;
      const normalizedRepairedArtifact = normalizeGeneratedAIOutput(
        repairedAIOutput,
        context,
        {
          repair: true,
          normalizeWeeklyPlanAiOutput: deps.normalizeWeeklyPlanAiOutput,
        }
      );
      const repairedPoolValidation = validateGeneratedExerciseIdsAgainstPool(
        normalizedRepairedArtifact.generatedPlanDocument,
        context.poolSnapshot
      );
      assertPoolValidationOk(repairedPoolValidation, { repair: true });

      let preparedRepaired;
      try {
        preparedRepaired = await (
          deps.prepareAIWeeklyPlanDraftForCreate || prepareAIWeeklyPlanDraftForCreate
        )({
          ...normalizedRepairedArtifact.generatedPlanDocument,
          userId: payload.userId,
          source: 'ai',
        });

        if (!isObject(preparedRepaired) || !isObject(preparedRepaired.document)) {
          throw new Error('Invalid repaired weekly plan preflight result');
        }
      } catch (_error) {
        throw new ApiError(
          422,
          'AI_WEEKLY_PLAN_REPAIR_BUSINESS_RULES_FAILED',
          'Repaired AI weekly plan failed business rules validation',
          { stage: 'business_rules' }
        );
      }

      let repairedAnalytics;
      try {
        repairedAnalytics = await (
          deps.calculateWeeklyPlanAnalytics || calculateWeeklyPlanAnalytics
        )({
          generatedAIOutput: repairedAIOutput,
          generatedPlanDocument: preparedRepaired.document,
          context,
        });
      } catch (_error) {
        throw new ApiError(
          500,
          'AI_WEEKLY_PLAN_REPAIR_ANALYTICS_FAILED',
          'Repaired AI weekly plan analytics could not be calculated'
        );
      }

      let finalReview;
      try {
        finalReview = await (deps.runAIProgramReview || runAIProgramReview)(
          {
            doctrine,
            context,
            generatedAIOutput: repairedAIOutput,
            generatedPlanDocument: preparedRepaired.document,
            analytics: repairedAnalytics,
          },
          deps
        );
      } catch (error) {
        throw mapAIProgramReviewError(error);
      }

      assertFinalAIProgramReviewAllowsPersistence(finalReview);

      finalGeneratedAIOutput = repairedAIOutput;
      finalPrepared = preparedRepaired;
      finalSchemaValidation = normalizedRepairedArtifact.schemaValidation;
      finalSemanticValidation = normalizedRepairedArtifact.semanticValidation;
      finalPoolValidation = repairedPoolValidation;
      finalAnalytics = repairedAnalytics;
      aiReview = {
        ...finalReview,
        reviewAttempts: 2,
      };
      aiRepair = buildPassedAIRepairMetadata(repairResult, initialReview);
    }
  }

  const generatedPlanDocumentForAudit = finalGeneratedAIOutput
    ? finalPrepared.document
    : {
        ...finalPrepared.document,
        strategySummary:
          typeof generatedPlanDocument?.strategySummary === 'string'
            ? generatedPlanDocument.strategySummary
            : null,
      };

  let generationContext;
  try {
    generationContext = await (
      deps.buildWeeklyPlanGenerationContext || buildWeeklyPlanGenerationContext
    )({
      context,
      generatedAIOutput: finalGeneratedAIOutput,
      generatedPlanDocument: generatedPlanDocumentForAudit,
      validation: {
        schemaValidation: finalSchemaValidation,
        semanticValidation: finalSemanticValidation,
        poolValidation: finalPoolValidation,
      },
      businessRulesValidation: finalPrepared.businessRulesValidation,
      analytics: finalAnalytics,
      generator: generatedArtifact.generator,
      aiReview,
      aiRepair,
    });
  } catch (error) {
    throw mapWeeklyPlanAnalyticsError(error);
  }

  return (deps.createWeeklyPlan || createWeeklyPlan)({
    ...finalPrepared.document,
    userId: payload.userId,
    source: 'ai',
    generationContext,
  });
}

module.exports = {
  assertAIProgramReviewAllowsPersistence,
  buildBypassedAIProgramReview,
  createAIWeeklyPlanDraft,
  isAIWeeklyPlanBuilderEnabled,
  isAIWeeklyPlanRepairEnabled,
  isAIWeeklyPlanReviewEnabled,
  mapAIProgramRepairError,
  mapAIProgramReviewError,
  mapExercisePoolError,
};
