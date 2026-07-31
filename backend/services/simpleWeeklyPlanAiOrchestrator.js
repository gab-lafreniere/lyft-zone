const {
  buildTextualAIWeeklyPlanPromptForUser,
} = require('./programGenerationTextPromptService');
const {
  buildExercisePoolForUser,
} = require('./exercisePoolService');
const {
  prepareAIWeeklyPlanDraftForCreate,
} = require('./weeklyPlansService');
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
  normalizeSimpleWeeklyPlanProviderFills,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillSchema');
const {
  materializeSimpleWeeklyPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillMaterializer');
const {
  validateFinalWeeklyPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/finalValidation');
const {
  buildCompactExerciseLookup,
  buildEligibleExerciseLookup,
} = require('../src/domain/simpleWeeklyPlanPipeline/compactExerciseLookup');
const {
  buildFillExtractionRequest,
  buildStructureExtractionRequest,
} = require('../src/domain/simpleWeeklyPlanPipeline/aiPrompts');
const {
  createSimpleWeeklyPlanOpenAIProvider,
  renderSimpleWeeklyPlanModelInput,
  resolveSimpleWeeklyPlanAiConfig,
  sanitizeProviderDiagnostics,
} = require('./simpleWeeklyPlanAiProvider');
const {
  CANONICAL_OUTPUT_FILES,
  createRunId,
  writeWeeklyPlanPipelineArtifacts,
} = require('./weeklyPlanPipelineArtifactWriter');
const {
  estimateOpenAiCostUsd,
} = require('../src/ai/openAiPricing');

const OUTPUT_DESCRIPTOR_BY_NUMBER = new Map(
  CANONICAL_OUTPUT_FILES.map((descriptor, index) => [
    index + 1,
    {
      key: descriptor[0],
      filename: descriptor[1],
      format: descriptor[2],
    },
  ])
);

function cleanError(error) {
  return {
    code: String(error?.code || error?.name || 'PIPELINE_FAILED'),
    message: String(error?.message || 'Simple Weekly Plan pipeline failed'),
  };
}

function notProducedText(blockedByOutput, error) {
  const blockedBy =
    OUTPUT_DESCRIPTOR_BY_NUMBER.get(blockedByOutput)?.filename
      ?.replace(/\.[^.]+$/, '') || `output${blockedByOutput}`;
  return [
    'STATUS: NOT_PRODUCED',
    `BLOCKED_BY_OUTPUT: ${blockedBy}`,
    `ERROR_CODE: ${error.code}`,
    `MESSAGE: ${error.message}`,
  ].join('\n');
}

function outputErrorText(outputNumber, error) {
  return [
    'STATUS: ERROR',
    `OUTPUT: ${outputNumber}`,
    `ERROR_CODE: ${error.code}`,
    `MESSAGE: ${error.message}`,
  ].join('\n');
}

function notProducedJson(blockedByOutput, error) {
  return {
    status: 'NOT_PRODUCED',
    blockedByOutput,
    error,
  };
}

function outputErrorJson(
  outputNumber,
  error,
  details = null,
  received = undefined,
  providerDiagnostics = null
) {
  return {
    status: 'ERROR',
    output: outputNumber,
    error,
    ...(received !== undefined ? { received } : {}),
    ...(details ? { details } : {}),
    ...(providerDiagnostics ? { providerDiagnostics } : {}),
  };
}

function createEmptyOutputs() {
  const pending = {
    code: 'PIPELINE_NOT_STARTED',
    message: 'Pipeline did not reach this output',
  };
  return {
    output1: notProducedText(1, pending),
    output2: notProducedText(1, pending),
    output3: notProducedText(1, pending),
    output4: notProducedJson(1, pending),
    output5: notProducedJson(1, pending),
    output6: notProducedText(1, pending),
    output7: notProducedJson(1, pending),
    output8: notProducedJson(1, pending),
  };
}

function markFailureOutputs(
  outputs,
  outputNumber,
  error,
  details = null,
  received = undefined
) {
  const cleaned = cleanError(error);
  const currentKey = `output${outputNumber}`;
  const currentFormat =
    OUTPUT_DESCRIPTOR_BY_NUMBER.get(outputNumber)?.format;
  outputs[currentKey] =
    currentFormat === 'text'
      ? outputErrorText(outputNumber, cleaned)
      : outputErrorJson(
        outputNumber,
        cleaned,
        details,
        received,
        outputNumber === 7
          ? sanitizeProviderDiagnostics(error?.providerDiagnostics)
          : null
      );

  for (let number = outputNumber + 1; number <= 8; number += 1) {
    const format = OUTPUT_DESCRIPTOR_BY_NUMBER.get(number)?.format;
    outputs[`output${number}`] =
      format === 'text'
        ? notProducedText(outputNumber, cleaned)
        : notProducedJson(outputNumber, cleaned);
  }
  return cleaned;
}

function summarizeStructure(structure = {}) {
  const workouts = Array.isArray(structure.workouts)
    ? structure.workouts
    : [];
  let blockCount = 0;
  let exerciseCount = 0;
  let setTemplateCount = 0;
  workouts.forEach((workout) => {
    const blocks = Array.isArray(workout.blocks) ? workout.blocks : [];
    blockCount += blocks.length;
    blocks.forEach((block) => {
      const setCounts = Array.isArray(block.setCounts) ? block.setCounts : [];
      exerciseCount += setCounts.length;
      setTemplateCount += setCounts.reduce(
        (sum, count) => sum + Number(count || 0),
        0
      );
    });
  });
  return {
    workoutCount: workouts.length,
    blockCount,
    exerciseCount,
    setTemplateCount,
  };
}

const AI_USAGE_FIELDS = Object.freeze([
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
]);

function normalizeAiUsageValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function buildAiUsageCall({ call, stage, model, usage }) {
  const normalizedUsage = Object.fromEntries(
    AI_USAGE_FIELDS.map((field) => [
      field,
      normalizeAiUsageValue(usage?.[field]),
    ])
  );

  return {
    call,
    stage,
    model,
    ...normalizedUsage,
    estimatedCostUsd: estimateOpenAiCostUsd({
      model,
      usage: normalizedUsage,
    }),
  };
}

function sumCompleteAiUsageField(calls, field) {
  if (
    calls.length !== 3 ||
    calls.some((call) => call[field] === null)
  ) {
    return null;
  }
  const total = calls.reduce((sum, call) => sum + call[field], 0);
  return field === 'estimatedCostUsd'
    ? Math.round(total * 100000000) / 100000000
    : total;
}

function buildAiUsageReport(calls) {
  return {
    calls,
    totals: {
      ...Object.fromEntries(
        AI_USAGE_FIELDS.map((field) => [
          field,
          sumCompleteAiUsageField(calls, field),
        ])
      ),
      estimatedCostUsd: sumCompleteAiUsageField(
        calls,
        'estimatedCostUsd'
      ),
    },
  };
}

function renderStructureModelInputArtifact({
  structureRequest,
  model,
  maxOutputTokens,
}) {
  const artifact = renderSimpleWeeklyPlanModelInput({
    model,
    systemMessage: structureRequest.systemMessage,
    userMessage: structureRequest.userMessage,
    schema: structureRequest.schema,
    formatName: structureRequest.formatName,
    maxOutputTokens,
  });
  const sourceSection =
    `\n\nSOURCE PLAN\n${structureRequest.sourcePlan}`;
  const sourceIndex = artifact.indexOf(sourceSection);
  const metadataMarker = '\n\nMODEL INPUT METADATA';
  const metadataIndex = artifact.lastIndexOf(metadataMarker);

  if (sourceIndex < 0 || metadataIndex < 0 || sourceIndex >= metadataIndex) {
    throw new Error('Unable to render Output #3 section order');
  }

  const withoutSource =
    artifact.slice(0, sourceIndex) +
    artifact.slice(sourceIndex + sourceSection.length);
  const insertionIndex = withoutSource.lastIndexOf(metadataMarker);

  return (
    withoutSource.slice(0, insertionIndex) +
    sourceSection +
    withoutSource.slice(insertionIndex)
  );
}

function renderFillModelInputArtifact({
  fillRequest,
  model,
  maxOutputTokens,
}) {
  const artifact = renderSimpleWeeklyPlanModelInput({
    model,
    systemMessage: fillRequest.systemMessage,
    userMessage: fillRequest.userMessage,
    schema: fillRequest.schema,
    formatName: fillRequest.formatName,
    maxOutputTokens,
  });
  const fillSections = [
    'PLAN SKELETON AND SLOT REGISTRY',
    fillRequest.skeletonText,
    '',
    'SOURCE PLAN',
    fillRequest.sourcePlan,
  ].join('\n');
  const sectionSuffix = `\n\n${fillSections}`;
  const sectionIndex = artifact.indexOf(sectionSuffix);
  const metadataMarker = '\n\nMODEL INPUT METADATA';
  const metadataIndex = artifact.lastIndexOf(metadataMarker);

  if (
    sectionIndex < 0 ||
    metadataIndex < 0 ||
    sectionIndex >= metadataIndex
  ) {
    throw new Error('Unable to render Output #6 section order');
  }

  const withoutFillSections =
    artifact.slice(0, sectionIndex) +
    artifact.slice(sectionIndex + sectionSuffix.length);
  const insertionIndex = withoutFillSections.lastIndexOf(metadataMarker);

  const rendered = (
    withoutFillSections.slice(0, insertionIndex) +
    sectionSuffix +
    withoutFillSections.slice(insertionIndex)
  );
  const requiredHeadings = [
    'SYSTEM MESSAGE',
    'USER MESSAGE',
    'STRUCTURED OUTPUT CONFIGURATION',
    'PLAN SKELETON AND SLOT REGISTRY',
    'SOURCE PLAN',
    'MODEL INPUT METADATA',
  ];
  const hasExactHeadings = requiredHeadings.every(
    (heading) =>
      (rendered.match(new RegExp(`^${heading}$`, 'gm')) || []).length === 1
  );
  if (!hasExactHeadings) {
    throw new Error('Unable to render Output #6 sections exactly once');
  }
  return rendered;
}

function buildStatus(outputs) {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => {
      const key = `output${index + 1}`;
      const value = outputs[key];
      if (typeof value === 'string') {
        return [
          key,
          value.startsWith('STATUS: ERROR')
            ? 'ERROR'
            : value.startsWith('STATUS: NOT_PRODUCED')
              ? 'NOT_PRODUCED'
              : 'PRODUCED',
        ];
      }
      return [
        key,
        value?.status === 'ERROR' || value?.status === 'NOT_PRODUCED'
          ? value.status
          : key === 'output8' && value?.valid === false
            ? 'PRODUCED_INVALID'
            : 'PRODUCED',
      ];
    })
  );
}

async function runSimpleWeeklyPlanAiPipeline({
  userId,
  outputDirectory,
  models,
  provider,
  timeouts,
  maxOutputTokens,
  dependencies = {},
  runId = createRunId(),
}) {
  const outputs = createEmptyOutputs();
  const config = resolveSimpleWeeklyPlanAiConfig(
    dependencies.env || process.env,
    { models, timeouts, maxOutputTokens }
  );
  const aiProvider =
    provider ||
    createSimpleWeeklyPlanOpenAIProvider({
      openAIClient: dependencies.openAIClient,
      getClient: dependencies.getOpenAIClient,
    });
  const buildPrompt =
    dependencies.buildPromptForUser ||
    buildTextualAIWeeklyPlanPromptForUser;
  const buildPool =
    dependencies.buildExercisePoolForUser ||
    buildExercisePoolForUser;
  const buildSkeleton =
    dependencies.buildSkeleton ||
    buildSimpleWeeklyPlanSkeleton;
  const finalPreflight =
    dependencies.finalPreflight ||
    prepareAIWeeklyPlanDraftForCreate;
  const writeArtifacts =
    dependencies.writeArtifacts ||
    writeWeeklyPlanPipelineArtifacts;
  const prismaDependencies = dependencies.prisma
    ? { prisma: dependencies.prisma }
    : {};
  const modelsUsed = [];
  const aiUsageCalls = [];
  let currentOutput = 1;
  let extractedStructure = null;
  let structureGeometry = null;
  let skeleton = null;
  let fillOutput = null;
  let rawFillOutput = null;
  let blockingError = null;
  let failureReceived;

  try {
    currentOutput = 1;
    const prompt = await buildPrompt(
      userId,
      {},
      prismaDependencies
    );
    outputs.output1 = renderSimpleWeeklyPlanModelInput({
      model: config.models.call1,
      systemMessage: prompt.systemMessage,
      userMessage: prompt.userMessage,
      maxOutputTokens: config.maxOutputTokens.call1,
    });

    currentOutput = 2;
    const call1 = await aiProvider.generate({
      stage: 'CALL_1_PLAN_TEXT',
      model: config.models.call1,
      systemMessage: prompt.systemMessage,
      userMessage: prompt.userMessage,
      timeoutMs: config.timeouts.call1,
      maxOutputTokens: config.maxOutputTokens.call1,
    });
    if (typeof call1.value !== 'string' || !call1.value.trim()) {
      const error = new Error('Call 1 returned empty plan text');
      error.code = 'EMPTY_OUTPUT_2';
      throw error;
    }
    modelsUsed.push(call1.model || config.models.call1);
    aiUsageCalls.push(
      buildAiUsageCall({
        call: 1,
        stage: 'CALL_1_PLAN_TEXT',
        model: call1.model || config.models.call1,
        usage: call1.usage,
      })
    );
    outputs.output2 = call1.value.trim();

    currentOutput = 3;
    const structureRequest = buildStructureExtractionRequest({
      generatedPlanText: outputs.output2,
      sessionsPerWeek: prompt.sessionsPerWeek,
    });
    outputs.output3 = renderStructureModelInputArtifact({
      structureRequest,
      model: config.models.call2,
      maxOutputTokens: config.maxOutputTokens.call2,
    });

    currentOutput = 4;
    const call2 = await aiProvider.generate({
      stage: 'CALL_2_STRUCTURE',
      model: config.models.call2,
      systemMessage: structureRequest.systemMessage,
      userMessage: structureRequest.userMessage,
      schema: structureRequest.schema,
      formatName: structureRequest.formatName,
      timeoutMs: config.timeouts.call2,
      maxOutputTokens: config.maxOutputTokens.call2,
    });
    modelsUsed.push(call2.model || config.models.call2);
    aiUsageCalls.push(
      buildAiUsageCall({
        call: 2,
        stage: 'CALL_2_STRUCTURE',
        model: call2.model || config.models.call2,
        usage: call2.usage,
      })
    );
    extractedStructure = call2.value;
    const structureValidation =
      validateSimpleWeeklyPlanStructure(extractedStructure, {
        sessionsPerWeek: prompt.sessionsPerWeek,
      });
    if (!structureValidation.valid) {
      const error = new Error('Output #4 structure validation failed');
      error.code = 'OUTPUT_4_STRUCTURE_INVALID';
      error.details = structureValidation.errors;
      failureReceived = extractedStructure;
      throw error;
    }
    outputs.output4 = extractedStructure;

    currentOutput = 5;
    structureGeometry = adaptSimpleWeeklyPlanStructureToLegacyGeometry(
      extractedStructure,
      { sessionsPerWeek: prompt.sessionsPerWeek }
    );
    skeleton = buildSkeleton(structureGeometry);
    outputs.output5 = skeleton;

    currentOutput = 6;
    const poolResult = await buildPool(
      userId,
      {},
      prismaDependencies
    );
    const eligibleExerciseLookup = buildEligibleExerciseLookup(poolResult);
    buildCompactExerciseLookup({
      generatedPlanText: outputs.output2,
      eligibleExerciseLookup,
    });
    const fillRequest = buildFillExtractionRequest({
      generatedPlanText: outputs.output2,
      skeleton,
    });
    outputs.output6 = renderFillModelInputArtifact({
      fillRequest,
      model: config.models.call3,
      maxOutputTokens: config.maxOutputTokens.call3,
    });

    currentOutput = 7;
    const call3 = await aiProvider.generate({
      stage: 'CALL_3_FILLS',
      model: config.models.call3,
      systemMessage: fillRequest.systemMessage,
      userMessage: fillRequest.userMessage,
      schema: fillRequest.schema,
      formatName: fillRequest.formatName,
      timeoutMs: config.timeouts.call3,
      maxOutputTokens: config.maxOutputTokens.call3,
    });
    modelsUsed.push(call3.model || config.models.call3);
    aiUsageCalls.push(
      buildAiUsageCall({
        call: 3,
        stage: 'CALL_3_FILLS',
        model: call3.model || config.models.call3,
        usage: call3.usage,
      })
    );
    rawFillOutput = call3.value;
    failureReceived = rawFillOutput;
    fillOutput = normalizeSimpleWeeklyPlanProviderFills(rawFillOutput);
    const fillValidation = validateSimpleWeeklyPlanFills({
      skeleton,
      fillOutput,
      eligibleExerciseLookup,
    });
    if (!fillValidation.valid) {
      const error = new Error('Fill validation failed');
      error.code = 'FILL_OUTPUT_INVALID';
      error.details = fillValidation.errors;
      failureReceived = rawFillOutput;
      throw error;
    }
    const materialization = materializeSimpleWeeklyPlan({
      skeleton,
      normalizedFills: fillValidation.normalizedFills,
      eligibleExerciseLookup,
    });
    if (!materialization.valid) {
      const error = new Error('Geometry lock validation failed');
      error.code = 'GEOMETRY_LOCK_FAILED';
      error.details = materialization.errors;
      failureReceived = rawFillOutput;
      throw error;
    }
    outputs.output7 = materialization.document;
    failureReceived = undefined;

    currentOutput = 8;
    const finalValidation = await validateFinalWeeklyPlan({
      completedDocument: outputs.output7,
      runtimeUserId: userId,
      preflight: finalPreflight,
    });
    outputs.output8 = {
      ...finalValidation,
      aiUsage: buildAiUsageReport(aiUsageCalls),
    };
  } catch (error) {
    blockingError = markFailureOutputs(
      outputs,
      currentOutput,
      error,
      Array.isArray(error?.details) ? error.details : null,
      failureReceived
    );
  }

  const artifacts = await writeArtifacts({
    outputs,
    runId,
    baseDirectory: outputDirectory,
  });
  const statuses = buildStatus(outputs);
  const isValid = outputs.output8?.valid === true;

  return {
    runId: artifacts.runId,
    runDirectory: artifacts.runDirectory,
    files: artifacts.files,
    models: config.models,
    modelsUsed,
    statuses,
    valid: isValid,
    counts: structureGeometry
      ? summarizeStructure(structureGeometry)
      : null,
    slotCount: Array.isArray(skeleton?.slots) ? skeleton.slots.length : 0,
    fillCount:
      fillOutput?.fills && typeof fillOutput.fills === 'object'
        ? Object.keys(fillOutput.fills).length
        : 0,
    output8: outputs.output8,
    completedDocument: isValid ? outputs.output7 : null,
    metrics: isValid ? outputs.output8.metrics : null,
    generatedPlanText: isValid ? outputs.output2 : null,
    error: blockingError,
  };
}

module.exports = {
  buildAiUsageCall,
  buildAiUsageReport,
  buildStatus,
  cleanError,
  createEmptyOutputs,
  markFailureOutputs,
  notProducedJson,
  notProducedText,
  runSimpleWeeklyPlanAiPipeline,
  summarizeStructure,
};
