const {
  buildWeeklyPlanAiGenerationMetadata,
} = require('./weeklyPlanAiNormalizer');
const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
} = require('./weeklyPlanAiSchema');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
} = require('./prompts/programRepairPrompt');
const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('./programGenerationContextBuilder');
const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
  WeeklyPlanAnalyticsError,
  buildWeeklyPlanAnalyticsAuditSummary,
} = require('./weeklyPlanAnalytics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('./weeklyPlanEvaluationPolicy');

const GENERATION_CONTEXT_SCHEMA_VERSION = 7;
const REVIEW_SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH']);
const REPAIR_PROVIDER_USAGE_KEYS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
]);
const AI_REPAIR_AUDIT_KEYS = Object.freeze([
  'enabled',
  'outcome',
  'attempts',
  'maxAttempts',
  'promptVersion',
  'contractVersion',
  'outputSchemaVersion',
  'initialReviewSummary',
  'provider',
]);

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function throwInvalidGenerationAudit() {
  throw new WeeklyPlanAnalyticsError(
    'INVALID_WEEKLY_PLAN_GENERATION_AUDIT',
    'Weekly plan generation audit metadata is invalid'
  );
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function buildGeneratorAuditMetadata(generator = {}) {
  return {
    type: generator.type === 'openai' ? 'openai' : 'mock',
    model: normalizeOptionalString(generator.model),
    responseId: normalizeOptionalString(generator.responseId),
    usage: {
      inputTokens: normalizeTokenCount(generator.usage?.inputTokens),
      outputTokens: normalizeTokenCount(generator.usage?.outputTokens),
      totalTokens: normalizeTokenCount(generator.usage?.totalTokens),
      reasoningTokens: normalizeTokenCount(generator.usage?.reasoningTokens),
    },
  };
}

function createReviewSeverityCounts() {
  return {
    INFO: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
  };
}

function buildBypassedReviewAuditMetadata() {
  return {
    enabled: false,
    outcome: 'BYPASSED',
    reviewAttempts: 0,
    schemaVersion: 1,
    contractVersion: 1,
    outputSchemaVersion: 1,
    promptVersion: null,
    decision: null,
    requiresRepair: false,
    issueCount: 0,
    severityCounts: createReviewSeverityCounts(),
    categoryCounts: {},
    reviewSummary: null,
    provider: null,
  };
}

function buildPassedReviewAuditMetadata(aiReview = {}) {
  const review = aiReview.review || {};

  if (review.decision !== 'PASS' || review.requiresRepair !== false) {
    throwInvalidGenerationAudit();
  }

  const reviewAttempts = hasOwn(aiReview, 'reviewAttempts')
    ? aiReview.reviewAttempts
    : 1;
  if (reviewAttempts !== 1 && reviewAttempts !== 2) {
    throwInvalidGenerationAudit();
  }

  const severityCounts = createReviewSeverityCounts();
  const categoryCounts = {};
  const issues = Array.isArray(review.issues) ? review.issues : [];

  issues.forEach((issue) => {
    if (REVIEW_SEVERITIES.includes(issue?.severity)) {
      severityCounts[issue.severity] += 1;
    }

    const category = normalizeOptionalString(issue?.category);
    if (category) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
  });

  return {
    enabled: true,
    outcome: 'PASSED',
    reviewAttempts,
    schemaVersion:
      Number.isSafeInteger(review.schemaVersion) && review.schemaVersion > 0
        ? review.schemaVersion
        : 1,
    contractVersion:
      Number.isSafeInteger(aiReview.contractVersion) && aiReview.contractVersion > 0
        ? aiReview.contractVersion
        : 1,
    outputSchemaVersion:
      Number.isSafeInteger(aiReview.outputSchemaVersion) && aiReview.outputSchemaVersion > 0
        ? aiReview.outputSchemaVersion
        : 1,
    promptVersion: normalizeOptionalString(aiReview.promptVersion),
    decision: 'PASS',
    requiresRepair: false,
    issueCount: issues.length,
    severityCounts,
    categoryCounts,
    reviewSummary: normalizeOptionalString(review.reviewSummary),
    provider: aiReview.provider ? buildGeneratorAuditMetadata(aiReview.provider) : null,
  };
}

function isValidCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function buildReviewCountSummary(summary, expectedDecision) {
  if (
    !isObject(summary) ||
    summary.decision !== expectedDecision ||
    !isValidCount(summary.issueCount) ||
    !isObject(summary.severityCounts) ||
    !isObject(summary.categoryCounts) ||
    !REVIEW_SEVERITIES.every((severity) =>
      isValidCount(summary.severityCounts[severity])
    ) ||
    !Object.entries(summary.categoryCounts).every(
      ([category, count]) => Boolean(normalizeOptionalString(category)) && isValidCount(count)
    )
  ) {
    throwInvalidGenerationAudit();
  }

  const severityCounts = createReviewSeverityCounts();
  REVIEW_SEVERITIES.forEach((severity) => {
    severityCounts[severity] = summary.severityCounts[severity];
  });

  const categoryCounts = {};
  Object.entries(summary.categoryCounts).forEach(([category, count]) => {
    categoryCounts[normalizeOptionalString(category)] = count;
  });

  return {
    decision: expectedDecision,
    issueCount: summary.issueCount,
    severityCounts,
    categoryCounts,
  };
}

function isValidRepairProvider(provider) {
  return (
    isObject(provider) &&
    provider.type === 'openai' &&
    typeof provider.model === 'string' &&
    Boolean(provider.model.trim()) &&
    (provider.responseId === null ||
      (typeof provider.responseId === 'string' && Boolean(provider.responseId.trim()))) &&
    isObject(provider.usage) &&
    REPAIR_PROVIDER_USAGE_KEYS.every(
      (key) =>
        hasOwn(provider.usage, key) &&
        (provider.usage[key] === null || isValidCount(provider.usage[key]))
    )
  );
}

function buildDefaultBypassedAIRepairAuditMetadata(enabled = false) {
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

function hasCanonicalRepairVersions(aiRepair) {
  return (
    aiRepair.contractVersion === AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION &&
    aiRepair.outputSchemaVersion === AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION
  );
}

function buildAIRepairAuditMetadata(aiRepair) {
  if (aiRepair === undefined) {
    return buildDefaultBypassedAIRepairAuditMetadata();
  }

  if (!isObject(aiRepair)) {
    throwInvalidGenerationAudit();
  }

  const repairKeys = Object.keys(aiRepair);
  if (
    repairKeys.length !== AI_REPAIR_AUDIT_KEYS.length ||
    !repairKeys.every((key) => AI_REPAIR_AUDIT_KEYS.includes(key))
  ) {
    throwInvalidGenerationAudit();
  }

  if (aiRepair.outcome === 'BYPASSED') {
    if (
      typeof aiRepair.enabled !== 'boolean' ||
      aiRepair.attempts !== 0 ||
      aiRepair.maxAttempts !== 1 ||
      aiRepair.promptVersion !== null ||
      !hasCanonicalRepairVersions(aiRepair) ||
      aiRepair.initialReviewSummary !== null ||
      aiRepair.provider !== null
    ) {
      throwInvalidGenerationAudit();
    }

    return buildDefaultBypassedAIRepairAuditMetadata(aiRepair.enabled);
  }

  if (aiRepair.outcome === 'NOT_REQUIRED') {
    if (
      aiRepair.enabled !== true ||
      aiRepair.attempts !== 0 ||
      aiRepair.maxAttempts !== 1 ||
      aiRepair.promptVersion !== null ||
      !hasCanonicalRepairVersions(aiRepair) ||
      !isObject(aiRepair.initialReviewSummary) ||
      aiRepair.initialReviewSummary.decision !== 'PASS' ||
      aiRepair.provider !== null
    ) {
      throwInvalidGenerationAudit();
    }

    return {
      ...buildDefaultBypassedAIRepairAuditMetadata(true),
      outcome: 'NOT_REQUIRED',
      initialReviewSummary: buildReviewCountSummary(
        aiRepair.initialReviewSummary,
        'PASS'
      ),
    };
  }

  if (aiRepair.outcome === 'PASSED') {
    if (
      aiRepair.enabled !== true ||
      aiRepair.attempts !== 1 ||
      aiRepair.maxAttempts !== 1 ||
      aiRepair.promptVersion !== PROGRAM_REPAIR_PROMPT_VERSION ||
      !hasCanonicalRepairVersions(aiRepair) ||
      !isObject(aiRepair.initialReviewSummary) ||
      aiRepair.initialReviewSummary.decision !== 'REPAIR_REQUIRED' ||
      !isValidRepairProvider(aiRepair.provider)
    ) {
      throwInvalidGenerationAudit();
    }

    return {
      ...buildDefaultBypassedAIRepairAuditMetadata(true),
      outcome: 'PASSED',
      attempts: 1,
      promptVersion: aiRepair.promptVersion,
      initialReviewSummary: buildReviewCountSummary(
        aiRepair.initialReviewSummary,
        'REPAIR_REQUIRED'
      ),
      provider: buildGeneratorAuditMetadata(aiRepair.provider),
    };
  }

  throwInvalidGenerationAudit();
}

function buildAIReviewAuditMetadata(aiReview = {}) {
  if (!aiReview?.enabled) {
    if (hasOwn(aiReview, 'reviewAttempts') && aiReview.reviewAttempts !== 0) {
      throwInvalidGenerationAudit();
    }
    return buildBypassedReviewAuditMetadata();
  }

  return buildPassedReviewAuditMetadata(aiReview);
}

function assertAIReviewAndRepairAuditConsistency(aiReview, aiRepair) {
  if (!aiReview.enabled) {
    if (
      aiReview.reviewAttempts !== 0 ||
      aiRepair.outcome !== 'BYPASSED' ||
      aiRepair.attempts !== 0
    ) {
      throwInvalidGenerationAudit();
    }
    return;
  }

  if (aiReview.decision !== 'PASS') {
    throwInvalidGenerationAudit();
  }

  if (aiRepair.outcome === 'PASSED') {
    if (
      aiReview.reviewAttempts !== 2 ||
      aiRepair.attempts !== 1
    ) {
      throwInvalidGenerationAudit();
    }
    return;
  }

  if (
    (aiRepair.outcome === 'BYPASSED' || aiRepair.outcome === 'NOT_REQUIRED') &&
    aiReview.reviewAttempts === 1 &&
    aiRepair.attempts === 0
  ) {
    return;
  }

  throwInvalidGenerationAudit();
}

function buildProfileSnapshotSummary(context = {}) {
  return {
    profileSchemaVersion: context.profileSchemaVersion || null,
    primaryGoal: context.primaryGoal || null,
    experience: context.experience || null,
    availability: context.availability || {},
    musclePriorityProfile: context.musclePriorityProfile || {},
    equipmentContext: {
      equipmentPreset: context.equipmentContext?.equipmentPreset || null,
      availableEquipment: context.equipmentContext?.availableEquipment || [],
      equipmentBias: context.equipmentContext?.equipmentBias || 'no_preference',
    },
    movementConstraints: {
      blockedExerciseIds: context.movementConstraints?.blockedExerciseIds || [],
      blockedMovementPatterns: context.movementConstraints?.blockedMovementPatterns || [],
      blockedJointStressTags: context.movementConstraints?.blockedJointStressTags || [],
      cautionMovementPatterns: context.movementConstraints?.cautionMovementPatterns || [],
      cautionJointStressTags: context.movementConstraints?.cautionJointStressTags || [],
    },
    cardioProfile: context.cardioProfile || {},
    hasPhysicalNotes: Boolean(context.physicalNotes),
  };
}

function assertCanonicalEvaluationPolicyAuditInput(context, analytics) {
  const contextPolicy = context?.evaluationPolicy;
  const analyticsPolicy = analytics?.evaluationPolicy;
  const hasCanonicalContextPolicy =
    contextPolicy?.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    contextPolicy?.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION;
  const hasCanonicalAnalyticsPolicy =
    analyticsPolicy?.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    analyticsPolicy?.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION;
  const hasMatchingPolicyIdentity =
    contextPolicy?.id === analyticsPolicy?.id &&
    contextPolicy?.version === analyticsPolicy?.version;

  if (
    context?.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION ||
    !hasCanonicalContextPolicy ||
    analytics?.schemaVersion !== WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION ||
    !hasCanonicalAnalyticsPolicy ||
    !hasMatchingPolicyIdentity
  ) {
    throw new WeeklyPlanAnalyticsError(
      'INVALID_WEEKLY_PLAN_ANALYTICS',
      'A valid weekly plan analytics result is required'
    );
  }
}

function buildWeeklyPlanGenerationContext({
  context,
  generatedPlanDocument,
  generatedAIOutput,
  validation,
  businessRulesValidation,
  analytics,
  generator = {},
  aiReview = {},
  aiRepair,
}) {
  assertCanonicalEvaluationPolicyAuditInput(context, analytics);

  const poolValidation = validation?.poolValidation || validation || {};
  const uniqueExerciseIds = poolValidation?.uniqueExerciseIds || [];
  const aiMetadata = generatedAIOutput
    ? buildWeeklyPlanAiGenerationMetadata(generatedAIOutput)
    : {
        strategySummary: generatedPlanDocument?.strategySummary || null,
      };
  const coachInputs = context?.coachInputs || {};
  const analyticsAuditSummary = buildWeeklyPlanAnalyticsAuditSummary(analytics);
  const aiReviewAuditMetadata = buildAIReviewAuditMetadata(aiReview);
  const aiRepairAuditMetadata = buildAIRepairAuditMetadata(aiRepair);
  assertAIReviewAndRepairAuditConsistency(
    aiReviewAuditMetadata,
    aiRepairAuditMetadata
  );

  return {
    schemaVersion: GENERATION_CONTEXT_SCHEMA_VERSION,
    evaluationPolicy: {
      id: context.evaluationPolicy.id,
      version: context.evaluationPolicy.version,
    },
    generationType: 'ai_weekly_plan_builder_v1',
    generationMode: context?.generationMode || 'weekly_plan_draft',
    createdAt: context?.createdAt || new Date().toISOString(),
    doctrineId: coachInputs.doctrineId || null,
    doctrineVersion: coachInputs.doctrineVersion || null,
    derivedFromDoctrineVersion: coachInputs.derivedFromDoctrineVersion || null,
    promptVersion: coachInputs.promptVersion || null,
    generator: buildGeneratorAuditMetadata(generator),
    aiContractVersion: aiMetadata.aiContractVersion || null,
    aiOutputSchemaVersion: aiMetadata.aiOutputSchemaVersion || null,
    poolSnapshot: context?.poolSnapshot || null,
    profileSnapshotSummary: buildProfileSnapshotSummary(context),
    strategySummary: aiMetadata.strategySummary || null,
    splitType: aiMetadata.splitType || null,
    volumeTargets: aiMetadata.volumeTargets || null,
    frequencyTargets: aiMetadata.frequencyTargets || null,
    progressionModel: aiMetadata.progressionModel || null,
    cautionHandling: aiMetadata.cautionHandling || null,
    notesPolicy: aiMetadata.notesPolicy || null,
    aiReview: aiReviewAuditMetadata,
    aiRepair: aiRepairAuditMetadata,
    validationSummary: {
      aiOutputSchemaValidation: validation?.schemaValidation
        ? {
            ok: Boolean(validation.schemaValidation.ok),
            issueCount: Array.isArray(validation.schemaValidation.issues)
              ? validation.schemaValidation.issues.length
              : 0,
          }
        : null,
      aiOutputSemanticValidation: validation?.semanticValidation
        ? {
            ok: Boolean(validation.semanticValidation.ok),
            issueCount: Array.isArray(validation.semanticValidation.issues)
              ? validation.semanticValidation.issues.length
              : 0,
            notesPolicy: validation.semanticValidation.summary?.notesPolicy || null,
          }
        : null,
      poolValidation: {
        ok: Boolean(poolValidation?.ok),
        issueCount: Array.isArray(poolValidation?.issues) ? poolValidation.issues.length : 0,
        uniqueExerciseIds,
        uniqueExerciseCount: new Set(uniqueExerciseIds).size,
      },
      businessRulesValidation: businessRulesValidation
        ? {
            ok: Boolean(businessRulesValidation.ok),
            issueCount:
              Number.isSafeInteger(businessRulesValidation.issueCount) &&
              businessRulesValidation.issueCount >= 0
                ? businessRulesValidation.issueCount
                : 0,
          }
        : null,
      analytics: analyticsAuditSummary,
    },
    repairAttempts: aiRepairAuditMetadata.attempts,
  };
}

module.exports = {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIRepairAuditMetadata,
  buildAIReviewAuditMetadata,
  buildBypassedReviewAuditMetadata,
  buildGeneratorAuditMetadata,
  buildProfileSnapshotSummary,
  buildWeeklyPlanGenerationContext,
};
