const {
  buildWeeklyPlanAiGenerationMetadata,
} = require('./weeklyPlanAiNormalizer');

const GENERATION_CONTEXT_SCHEMA_VERSION = 3;

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
  generator = {},
}) {
  const poolValidation = validation?.poolValidation || validation || {};
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
        uniqueExerciseIds: poolValidation?.uniqueExerciseIds || [],
      },
    },
    repairAttempts: 0,
  };
}

module.exports = {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildGeneratorAuditMetadata,
  buildProfileSnapshotSummary,
  buildWeeklyPlanGenerationContext,
};
