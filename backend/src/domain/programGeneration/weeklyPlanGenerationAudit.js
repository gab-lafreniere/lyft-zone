const {
  buildWeeklyPlanAiGenerationMetadata,
} = require('./weeklyPlanAiNormalizer');
const {
  buildWeeklyPlanAnalyticsAuditSummary,
} = require('./weeklyPlanAnalytics');

const GENERATION_CONTEXT_SCHEMA_VERSION = 5;
const REVIEW_SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH']);

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
    throw new Error('Only a passed AI program review may be persisted');
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
    reviewAttempts: 1,
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

function buildAIReviewAuditMetadata(aiReview = {}) {
  if (!aiReview?.enabled) {
    return buildBypassedReviewAuditMetadata();
  }

  return buildPassedReviewAuditMetadata(aiReview);
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

function buildWeeklyPlanGenerationContext({
  context,
  generatedPlanDocument,
  generatedAIOutput,
  validation,
  businessRulesValidation,
  analytics,
  generator = {},
  aiReview = {},
}) {
  const poolValidation = validation?.poolValidation || validation || {};
  const uniqueExerciseIds = poolValidation?.uniqueExerciseIds || [];
  const aiMetadata = generatedAIOutput
    ? buildWeeklyPlanAiGenerationMetadata(generatedAIOutput)
    : {
        strategySummary: generatedPlanDocument?.strategySummary || null,
      };
  const coachInputs = context?.coachInputs || {};

  return {
    schemaVersion: GENERATION_CONTEXT_SCHEMA_VERSION,
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
    aiReview: buildAIReviewAuditMetadata(aiReview),
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
      analytics: analytics ? buildWeeklyPlanAnalyticsAuditSummary(analytics) : null,
    },
    repairAttempts: 0,
  };
}

module.exports = {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIReviewAuditMetadata,
  buildBypassedReviewAuditMetadata,
  buildGeneratorAuditMetadata,
  buildProfileSnapshotSummary,
  buildWeeklyPlanGenerationContext,
};
