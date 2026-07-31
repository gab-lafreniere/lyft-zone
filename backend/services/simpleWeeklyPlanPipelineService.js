const {
  validateSimpleWeeklyPlanStructure,
} = require('../src/domain/simpleWeeklyPlanPipeline/structureValidation');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  validateSimpleWeeklyPlanFills,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillValidation');
const {
  materializeSimpleWeeklyPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillMaterializer');
const {
  validateFinalWeeklyPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/finalValidation');
const {
  writeWeeklyPlanPipelineArtifacts,
} = require('./weeklyPlanPipelineArtifactWriter');

class SimpleWeeklyPlanPipelineError extends Error {
  constructor(stage, errors) {
    super(`Simple Weekly Plan pipeline failed at ${stage}`);
    this.name = 'SimpleWeeklyPlanPipelineError';
    this.stage = stage;
    this.errors = errors;
  }
}

async function runDeterministicWeeklyPlanPipeline({
  promptInputText,
  generatedPlanText,
  structurePromptInputText = [
    'STATUS: NOT_APPLICABLE',
    'MESSAGE: The deterministic Phase 1 pipeline does not call AI 2.',
  ].join('\n'),
  extractedStructure,
  sessionsPerWeek,
  fillPromptInputText = [
    'STATUS: NOT_APPLICABLE',
    'MESSAGE: The deterministic Phase 1 pipeline does not call AI 3.',
  ].join('\n'),
  fills,
  eligibleExerciseLookup,
  runtimeUserId,
  writeArtifacts = false,
  artifactOptions = {},
  finalPreflight,
}) {
  const structureValidation =
    validateSimpleWeeklyPlanStructure(extractedStructure, {
      sessionsPerWeek,
    });
  if (!structureValidation.valid) {
    throw new SimpleWeeklyPlanPipelineError(
      'OUTPUT_3_STRUCTURE_VALIDATION',
      structureValidation.errors
    );
  }

  const legacyGeometry = adaptSimpleWeeklyPlanStructureToLegacyGeometry(
    extractedStructure,
    { sessionsPerWeek }
  );
  const skeleton = buildSimpleWeeklyPlanSkeleton(legacyGeometry);
  const fillOutput = {
    ...fills,
    geometryHash:
      fills?.geometryHash === '$SKELETON_GEOMETRY_HASH'
        ? skeleton.geometryHash
        : fills?.geometryHash,
  };
  const fillValidation = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput,
    eligibleExerciseLookup,
  });
  if (!fillValidation.valid) {
    throw new SimpleWeeklyPlanPipelineError(
      'FILL_VALIDATION',
      fillValidation.errors
    );
  }

  const materialization = materializeSimpleWeeklyPlan({
    skeleton,
    normalizedFills: fillValidation.normalizedFills,
    eligibleExerciseLookup,
  });
  if (!materialization.valid) {
    throw new SimpleWeeklyPlanPipelineError(
      'GEOMETRY_LOCK',
      materialization.errors
    );
  }

  const finalValidation = await validateFinalWeeklyPlan({
    completedDocument: materialization.document,
    runtimeUserId,
    preflight: finalPreflight,
  });

  const outputs = {
    output1: promptInputText,
    output2: generatedPlanText,
    output3: structurePromptInputText,
    output4: extractedStructure,
    output5: skeleton,
    output6: fillPromptInputText,
    output7: materialization.document,
    output8: finalValidation,
  };

  const artifacts = writeArtifacts
    ? await writeWeeklyPlanPipelineArtifacts({
      outputs,
      ...artifactOptions,
    })
    : null;

  return {
    outputs,
    artifacts,
  };
}

module.exports = {
  SimpleWeeklyPlanPipelineError,
  runDeterministicWeeklyPlanPipeline,
};
