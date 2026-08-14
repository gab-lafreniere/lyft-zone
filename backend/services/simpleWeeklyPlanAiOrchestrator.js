const { performance } = require('node:perf_hooks');
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
  resolveDeterministicWeeklyPlanFills,
} = require('../src/domain/simpleWeeklyPlanPipeline/deterministicFillResolver');
const {
  mergeWeeklyPlanFillFallback,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillFallback');
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
  buildBoundPlanExtractionRequest,
  buildFillExtractionRequest,
  buildStructureExtractionRequest,
} = require('../src/domain/simpleWeeklyPlanPipeline/aiPrompts');
const {
  verifyBoundPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/boundPlanVerification');
const {
  resolveBoundPlanWeeklyPlanFills,
} = require('../src/domain/simpleWeeklyPlanPipeline/boundPlanFillResolver');
const {
  adaptBoundPlanToGeometry,
} = require('../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  ACTIONS,
  decideRecoveryAction,
} = require('../src/domain/simpleWeeklyPlanPipeline/pipelineRecoveryPolicy');
const {
  buildBinderRetryDirective,
  buildCreatorRepairRequest,
} = require('../src/domain/simpleWeeklyPlanPipeline/retryDirectives');
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
const {
  resolveWeeklyPlanFillFallback,
} = require('./simpleWeeklyPlanFillFallbackService');

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
    output6: notProducedJson(1, pending),
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

function normalizeDurationMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function buildAiUsageCall({ call, stage, model, usage, durationMs = null }) {
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
    durationMs: normalizeDurationMs(durationMs),
    estimatedCostUsd: estimateOpenAiCostUsd({
      model,
      usage: normalizedUsage,
    }),
  };
}

function reportProgressSafely(onProgress, stage) {
  if (typeof onProgress !== 'function') {
    return;
  }
  try {
    const result = onProgress(stage);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.warn('[simpleWeeklyPlanAiOrchestrator] progress callback failed', {
          stage,
          error: error?.message || String(error),
        });
      });
    }
  } catch (error) {
    console.warn('[simpleWeeklyPlanAiOrchestrator] progress callback failed', {
      stage,
      error: error?.message || String(error),
    });
  }
}

function summarizeCompletedDocument(document = {}) {
  const workouts = Array.isArray(document.workouts) ? document.workouts : [];
  let generatedExerciseCount = 0;
  let generatedSetCount = 0;
  workouts.forEach((workout) => {
    (Array.isArray(workout?.blocks) ? workout.blocks : []).forEach((block) => {
      (Array.isArray(block?.exercises) ? block.exercises : []).forEach((exercise) => {
        generatedExerciseCount += 1;
        generatedSetCount += Array.isArray(exercise?.setTemplates)
          ? exercise.setTemplates.length
          : 0;
      });
    });
  });
  return {
    generatedWorkoutCount: workouts.length,
    generatedExerciseCount,
    generatedSetCount,
  };
}

function sumCompleteAiUsageField(calls, field) {
  if (
    calls.length === 0 ||
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
    'PLAN SKELETON AND ENTITY REGISTRY',
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
    'PLAN SKELETON AND ENTITY REGISTRY',
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

function pipelineError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) {
    error.details = Array.isArray(details) ? details : [details];
  }
  return error;
}

// Turns a verification failure into the facts the backend is allowed to state to
// Call #1. Only counts, coordinates and the offending identifier travel; the backend
// never suggests how the coach should fix the plan.
function repairFactsFor(constraint, failures) {
  if (constraint === 'WORKOUT_COUNT') {
    const failure = failures.find(
      (entry) => entry.code === 'BOUND_PLAN_WORKOUT_COUNT_MISMATCH'
    );
    return { received: failure?.received, expected: failure?.expected };
  }
  if (constraint === 'SUPERSET_EQUAL_SETS') {
    const failure = failures.find(
      (entry) => entry.code === 'BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL'
    );
    const match = String(failure?.path || '')
      .match(/workouts\/(\d+)\/blocks\/(\d+)/);
    return {
      location: match
        ? `workout ${Number(match[1]) + 1}, block ${Number(match[2]) + 1}`
        : 'a superset block',
      received: (failure?.received || []).join(' and '),
    };
  }
  const failure = failures.find(
    (entry) => entry.code === 'BOUND_PLAN_EXERCISE_OUTSIDE_POOL'
  );
  return { received: failure?.received };
}

/**
 * Binds Call #1's plan into a BoundPlan, recovering from a defective bind or from a
 * violated Call #1 hard constraint.
 *
 * Budgets are enforced by pipelineRecoveryPolicy: at most 2 creator attempts, at most
 * 2 binder attempts per creator output and 4 in total. Every superseded attempt is
 * archived as a sidecar; the canonical chain always describes the winning attempt.
 */
async function bindPlanWithRecovery(context) {
  const {
    aiProvider,
    config,
    prompt,
    eligibleExerciseLookup,
    sessionsPerWeek,
    monotonicNow,
    aiUsageCalls,
    modelsUsed,
    attemptSidecars,
    ledger,
    outputs,
    recordCall1,
  } = context;

  let planText = context.initialPlanText;
  let promptArtifact = context.initialPromptArtifact;
  let correctiveDirective = null;
  let previousConstraintsForPlan = null;

  for (;;) {
    // Canonical 01/02 describe the creator output currently being bound, so a repaired
    // plan is never absent from the artifacts even if all of its binds fail.
    outputs.output1 = promptArtifact;
    outputs.output2 = planText;

    const bindRequest = buildBoundPlanExtractionRequest({
      generatedPlanText: planText,
      correctiveDirective,
    });
    const bindArtifact = renderStructureModelInputArtifact({
      structureRequest: bindRequest,
      model: config.models.call2,
      maxOutputTokens: config.maxOutputTokens.call2,
    });
    // Assigned before the call so a failed bind never leaves Output 03 claiming the
    // pipeline never started while 03-aN proves a prompt was rendered.
    outputs.output3 = bindArtifact;

    const startedAt = monotonicNow();
    const call2 = await aiProvider.generate({
      stage: 'CALL_2_BIND_PLAN',
      model: config.models.call2,
      systemMessage: bindRequest.systemMessage,
      userMessage: bindRequest.userMessage,
      schema: bindRequest.schema,
      formatName: bindRequest.formatName,
      timeoutMs: config.timeouts.call2,
      maxOutputTokens: config.maxOutputTokens.call2,
    });
    ledger.binderAttempts += 1;
    modelsUsed.push(call2.model || config.models.call2);
    aiUsageCalls.push({
      ...buildAiUsageCall({
        call: 2,
        stage: 'CALL_2_BIND_PLAN',
        model: call2.model || config.models.call2,
        usage: call2.usage,
        durationMs: monotonicNow() - startedAt,
      }),
      attempt: ledger.binderAttempts,
    });

    const boundPlan = call2.value;
    const verification = verifyBoundPlan({
      boundPlan,
      generatedPlanText: planText,
      eligibleExerciseLookup,
      sessionsPerWeek,
    });
    ledger.coverage = verification.coverage;

    const decision = decideRecoveryAction({
      failures: verification.failures,
      coverage: verification.coverage,
      state: {
        recoveryLevel: config.recoveryLevel,
        creatorAttempt: ledger.creatorAttempts,
        binderAttemptForPlan: ledger.binderAttemptsForCurrentPlan,
        binderAttemptsTotal: ledger.binderAttempts,
        creatorRepairUsed: ledger.creatorRepairUsed,
        previousConstraintsForPlan,
      },
    });

    if (decision.action === ACTIONS.PROCEED) {
      ledger.timeline.push({
        attempt: ledger.binderAttempts,
        call: 2,
        outcome: 'ACCEPTED',
        ...(decision.reason ? { reason: decision.reason } : {}),
        warnings: verification.warnings.map((warning) => warning.code),
      });
      return {
        boundPlan,
        planText,
        promptArtifact,
        bindArtifact,
        verification,
      };
    }

    // Archive the superseded bind before anything overwrites it.
    const supersededIndex = ledger.binderAttempts;
    attemptSidecars[`03-a${supersededIndex}`] = bindArtifact;
    attemptSidecars[`04-a${supersededIndex}`] = boundPlan;
    attemptSidecars[`04-a${supersededIndex}-verification`] = {
      valid: verification.valid,
      failures: verification.failures,
      warnings: verification.warnings,
      coverage: verification.coverage,
      decision: decision.action,
      reason: decision.reason,
    };
    ledger.timeline.push({
      attempt: supersededIndex,
      call: 2,
      outcome: 'REJECTED',
      reason: decision.reason,
      codes: decision.failureCodes || decision.classification.codes,
      ...(decision.coverage ? { coverage: decision.coverage } : {}),
    });

    if (decision.action === ACTIONS.FAIL_CLOSED) {
      throw pipelineError(
        decision.code || 'BOUND_PLAN_VERIFICATION_FAILED',
        'Bound plan verification failed',
        verification.failures.length
          ? verification.failures
          : [{ code: decision.code, reason: decision.reason, coverage: decision.coverage }]
      );
    }

    if (decision.action === ACTIONS.RETRY_BINDER) {
      correctiveDirective = buildBinderRetryDirective(
        decision.failureCodes || decision.classification.codes
      );
      previousConstraintsForPlan = decision.classification.constraints;
      ledger.binderAttemptsForCurrentPlan += 1;
      continue;
    }

    // REPAIR_CREATOR: regenerate the complete plan with one backend-stated violation.
    const repairRequest = buildCreatorRepairRequest({
      systemMessage: prompt.systemMessage,
      userMessage: prompt.userMessage,
      previousPlanText: planText,
      constraint: decision.constraint,
      facts: repairFactsFor(decision.constraint, verification.failures),
    });
    attemptSidecars['01-a1'] = promptArtifact;
    attemptSidecars['02-a1'] = planText;

    const repaired = await recordCall1({
      systemMessage: repairRequest.systemMessage,
      userMessage: repairRequest.userMessage,
      attempt: ledger.creatorAttempts + 1,
    });

    ledger.creatorAttempts += 1;
    ledger.creatorRepairUsed = true;
    ledger.creatorRepairReason = decision.code
      || `CREATOR_REPAIR_${decision.constraint}`;
    ledger.creatorRepairViolation = repairRequest.violation;
    ledger.binderAttemptsForCurrentPlan = 1;
    ledger.timeline.push({
      attempt: ledger.creatorAttempts,
      call: 1,
      outcome: 'REPAIRED',
      constraint: decision.constraint,
    });

    planText = repaired.planText;
    promptArtifact = repaired.promptArtifact;
    correctiveDirective = null;
    previousConstraintsForPlan = null;
  }
}

async function runSimpleWeeklyPlanAiPipeline({
  userId,
  outputDirectory,
  models,
  provider,
  timeouts,
  maxOutputTokens,
  deterministicFillsEnabled,
  extractionMode,
  recoveryLevel,
  onProgress,
  dependencies = {},
  runId = createRunId(),
}) {
  const monotonicNow = dependencies.monotonicNow || (() => performance.now());
  const pipelineStartedAt = monotonicNow();
  const stageDurations = {
    contextPreparationMs: null,
    programTextGenerationMs: null,
    structureExtractionMs: null,
    deterministicBuildMs: null,
    fillGenerationMs: null,
    validationMs: null,
    persistenceMs: null,
  };
  let activeTimingStage = null;
  let activeTimingStartedAt = null;
  function startTimingStage(stage) {
    if (activeTimingStage) {
      stageDurations[activeTimingStage] = normalizeDurationMs(
        monotonicNow() - activeTimingStartedAt
      );
    }
    activeTimingStage = stage;
    activeTimingStartedAt = monotonicNow();
  }
  function closeTimingStage() {
    if (!activeTimingStage) {
      return;
    }
    stageDurations[activeTimingStage] = normalizeDurationMs(
      monotonicNow() - activeTimingStartedAt
    );
    activeTimingStage = null;
    activeTimingStartedAt = null;
  }
  const outputs = createEmptyOutputs();
  const config = resolveSimpleWeeklyPlanAiConfig(
    dependencies.env || process.env,
    {
      models,
      timeouts,
      maxOutputTokens,
      deterministicFillsEnabled,
      extractionMode,
      recoveryLevel,
    }
  );
  const boundPlanMode = config.extractionMode === 'BOUND_PLAN';
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
  const artifactSidecars = {};
  const fillResolutionObservability = {
    mode: config.extractionMode === 'BOUND_PLAN'
      ? 'BOUND_PLAN_DETERMINISTIC'
      : config.deterministicFillsEnabled
        ? 'DETERMINISTIC_WITH_FALLBACK'
        : 'LEGACY_FULL_AI',
    resolverVersion: null,
    deterministicFieldCount: null,
    totalFieldCount: null,
    unresolvedFieldCount: null,
    unresolvedRate: null,
    fallbackRequired: false,
    fallbackFieldCount: 0,
    fallbackDurationMs: null,
    fallbackInputTokens: null,
    fallbackOutputTokens: null,
    fallbackCostUsd: null,
    fallbackValidationOutcome: 'NOT_REQUIRED',
  };
  let blockingError = null;
  let failureReceived;
  let prompt = null;
  let boundPlan = null;
  const attemptSidecars = {};
  const attemptLedger = {
    creatorAttempts: 1,
    binderAttempts: 0,
    binderAttemptsForCurrentPlan: 1,
    creatorRepairUsed: false,
    creatorRepairReason: null,
    creatorRepairViolation: null,
    timeline: [],
    coverage: null,
  };
  // Built lazily so the GEOMETRY_ONLY path keeps attributing a pool failure to
  // Output 6 exactly as it does today, while BOUND_PLAN can verify at Output 4.
  let eligibleLookupPromise = null;
  function getEligibleExerciseLookup() {
    if (!eligibleLookupPromise) {
      eligibleLookupPromise = buildPool(userId, {}, prismaDependencies)
        .then(buildEligibleExerciseLookup);
    }
    return eligibleLookupPromise;
  }

  try {
    currentOutput = 1;
    reportProgressSafely(onProgress, 'PROFILE_SETUP');
    startTimingStage('contextPreparationMs');
    prompt = await buildPrompt(
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

    // Shared by the initial generation and by a creator repair. The initial call uses
    // the locked prompt unchanged; a repair appends one backend-authored violation and
    // the previous plan, assembled in retryDirectives.js.
    async function recordCall1({ systemMessage, userMessage, attempt = 1 }) {
      const startedAt = monotonicNow();
      const call1 = await aiProvider.generate({
        stage: 'CALL_1_PLAN_TEXT',
        model: config.models.call1,
        systemMessage,
        userMessage,
        timeoutMs: config.timeouts.call1,
        maxOutputTokens: config.maxOutputTokens.call1,
      });
      if (typeof call1.value !== 'string' || !call1.value.trim()) {
        throw pipelineError('EMPTY_OUTPUT_2', 'Call 1 returned empty plan text');
      }
      modelsUsed.push(call1.model || config.models.call1);
      aiUsageCalls.push({
        ...buildAiUsageCall({
          call: 1,
          stage: 'CALL_1_PLAN_TEXT',
          model: call1.model || config.models.call1,
          usage: call1.usage,
          durationMs: monotonicNow() - startedAt,
        }),
        // Attempt numbering is a BOUND_PLAN concern; adding it in GEOMETRY_ONLY would
        // change the legacy Output 08 shape and break the rollback guarantee.
        ...(boundPlanMode ? { attempt } : {}),
      });
      return {
        planText: call1.value.trim(),
        promptArtifact: renderSimpleWeeklyPlanModelInput({
          model: config.models.call1,
          systemMessage,
          userMessage,
          maxOutputTokens: config.maxOutputTokens.call1,
        }),
      };
    }

    currentOutput = 2;
    reportProgressSafely(onProgress, 'DESIGNING_PROGRAM');
    startTimingStage('programTextGenerationMs');
    const initialCall1 = await recordCall1({
      systemMessage: prompt.systemMessage,
      userMessage: prompt.userMessage,
      attempt: 1,
    });
    outputs.output2 = initialCall1.planText;

    currentOutput = 3;
    reportProgressSafely(onProgress, 'EXTRACTING_STRUCTURE');
    startTimingStage('structureExtractionMs');
    let eligibleExerciseLookup = null;

    if (boundPlanMode) {
      eligibleExerciseLookup = await getEligibleExerciseLookup();
      currentOutput = 4;
      const bound = await bindPlanWithRecovery({
        aiProvider,
        config,
        prompt,
        eligibleExerciseLookup,
        sessionsPerWeek: prompt.sessionsPerWeek,
        monotonicNow,
        aiUsageCalls,
        modelsUsed,
        attemptSidecars,
        ledger: attemptLedger,
        outputs,
        recordCall1,
        initialPlanText: outputs.output2,
        initialPromptArtifact: outputs.output1,
      });
      // Canonical 01/02/03 were kept current inside the bind loop.
      boundPlan = bound.boundPlan;
      outputs.output4 = boundPlan;
    } else {
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
      const call2StartedAt = monotonicNow();
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
          durationMs: monotonicNow() - call2StartedAt,
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
    }

    currentOutput = 5;
    reportProgressSafely(onProgress, 'BUILDING_PROGRAM');
    startTimingStage('deterministicBuildMs');
    structureGeometry = boundPlanMode
      ? adaptBoundPlanToGeometry(boundPlan)
      : adaptSimpleWeeklyPlanStructureToLegacyGeometry(
        extractedStructure,
        { sessionsPerWeek: prompt.sessionsPerWeek }
      );
    skeleton = buildSkeleton(structureGeometry);
    outputs.output5 = skeleton;

    currentOutput = 6;
    if (!eligibleExerciseLookup) {
      eligibleExerciseLookup = await getEligibleExerciseLookup();
    }
    startTimingStage('fillGenerationMs');
    if (boundPlanMode || config.deterministicFillsEnabled) {
      const resolverStartedAt = monotonicNow();
      const deterministic = boundPlanMode
        ? resolveBoundPlanWeeklyPlanFills({
          boundPlan,
          skeleton,
          eligibleExerciseLookup,
        })
        : resolveDeterministicWeeklyPlanFills({
          generatedPlanText: outputs.output2,
          skeleton,
          eligibleExerciseLookup,
        });
      const deterministicDurationMs = normalizeDurationMs(
        monotonicNow() - resolverStartedAt
      );
      fillResolutionObservability.resolverVersion = deterministic.resolverVersion;
      fillResolutionObservability.deterministicFieldCount =
        deterministic.deterministicallyResolvedFieldCount;
      fillResolutionObservability.totalFieldCount = deterministic.totalFieldCount;
      fillResolutionObservability.unresolvedFieldCount = deterministic.unresolvedFieldCount;
      fillResolutionObservability.unresolvedRate = deterministic.totalFieldCount > 0
        ? deterministic.unresolvedFieldCount / deterministic.totalFieldCount
        : 0;
      fillResolutionObservability.fallbackRequired = deterministic.fallbackRequired;
      fillResolutionObservability.fallbackFieldCount = deterministic.unresolvedFieldCount;
      outputs.output6 = {
        geometryHash: deterministic.geometryHash,
        resolverVersion: deterministic.resolverVersion,
        providerFills: deterministic.providerFills,
        totalFieldCount: deterministic.totalFieldCount,
        deterministicallyResolvedFieldCount:
          deterministic.deterministicallyResolvedFieldCount,
        unresolvedFieldCount: deterministic.unresolvedFieldCount,
        fallbackRequired: deterministic.fallbackRequired,
        fallbackEligible: deterministic.fallbackEligible,
        unresolved: deterministic.unresolved,
        normalizationDecisions: deterministic.normalizationDecisions,
        timing: { deterministicResolutionMs: deterministicDurationMs },
      };
      rawFillOutput = deterministic.providerFills;

      if (deterministic.fallbackRequired) {
        if (!deterministic.fallbackEligible) {
          const error = new Error('Deterministic fills contain non-fallback-eligible unresolved fields');
          error.code = 'DETERMINISTIC_UNRESOLVED_NOT_FALLBACK_ELIGIBLE';
          error.details = deterministic.unresolved;
          throw error;
        }
        currentOutput = 7;
        const fallbackStartedAt = monotonicNow();
        let fallback;
        try {
          fallback = await resolveWeeklyPlanFillFallback({
            provider: aiProvider,
            geometryHash: skeleton.geometryHash,
            unresolved: deterministic.unresolved,
            model: config.models.call3,
            timeoutMs: config.timeouts.call3,
            maxOutputTokens: config.maxOutputTokens.call3,
          });
        } catch (error) {
          fillResolutionObservability.fallbackDurationMs = normalizeDurationMs(
            monotonicNow() - fallbackStartedAt
          );
          fillResolutionObservability.fallbackValidationOutcome = 'REQUEST_FAILED';
          if (error.fillFallbackRequest) {
            artifactSidecars.output6b = {
              schemaVersion: 1,
              geometryHash: skeleton.geometryHash,
              systemMessage: error.fillFallbackRequest.systemMessage,
              input: error.fillFallbackRequest.payload,
              structuredOutput: {
                formatName: error.fillFallbackRequest.formatName,
                schema: error.fillFallbackRequest.schema,
              },
              model: config.models.call3,
              maxOutputTokens: config.maxOutputTokens.call3,
            };
          }
          throw error;
        }
        const fallbackDurationMs = normalizeDurationMs(
          monotonicNow() - fallbackStartedAt
        );
        const fallbackModel = fallback.result.model || config.models.call3;
        const fallbackUsage = buildAiUsageCall({
          call: 3,
          stage: 'CALL_3_FILL_FALLBACK',
          model: fallbackModel,
          usage: fallback.result.usage,
          durationMs: fallbackDurationMs,
        });
        modelsUsed.push(fallbackModel);
        aiUsageCalls.push(fallbackUsage);
        fillResolutionObservability.fallbackDurationMs = fallbackDurationMs;
        fillResolutionObservability.fallbackInputTokens = fallbackUsage.inputTokens;
        fillResolutionObservability.fallbackOutputTokens = fallbackUsage.outputTokens;
        fillResolutionObservability.fallbackCostUsd = fallbackUsage.estimatedCostUsd;
        artifactSidecars.output6b = {
          schemaVersion: 1,
          geometryHash: skeleton.geometryHash,
          systemMessage: fallback.request.systemMessage,
          input: fallback.request.payload,
          structuredOutput: {
            formatName: fallback.request.formatName,
            schema: fallback.request.schema,
          },
          model: config.models.call3,
          maxOutputTokens: config.maxOutputTokens.call3,
        };
        artifactSidecars.output6c = fallback.result.value;
        failureReceived = fallback.result.value;
        try {
          rawFillOutput = mergeWeeklyPlanFillFallback({
            providerFills: deterministic.providerFills,
            unresolved: deterministic.unresolved,
            fallbackOutput: fallback.result.value,
          });
          fillResolutionObservability.fallbackValidationOutcome = 'PASSED';
        } catch (error) {
          fillResolutionObservability.fallbackValidationOutcome = 'FAILED';
          throw error;
        }
      }
    } else {
      buildCompactExerciseLookup({
        generatedPlanText: outputs.output2,
        eligibleExerciseLookup,
      });
      const fillRequest = buildFillExtractionRequest({
        generatedPlanText: outputs.output2,
        skeleton,
      });
      outputs.output6 = {
        mode: 'LEGACY_FULL_AI_CALL_3',
        modelInput: renderFillModelInputArtifact({
          fillRequest,
          model: config.models.call3,
          maxOutputTokens: config.maxOutputTokens.call3,
        }),
      };
      currentOutput = 7;
      const call3StartedAt = monotonicNow();
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
          durationMs: monotonicNow() - call3StartedAt,
        })
      );
      rawFillOutput = call3.value;
    }

    currentOutput = 7;
    failureReceived = rawFillOutput;
    fillOutput = normalizeSimpleWeeklyPlanProviderFills(
      rawFillOutput,
      skeleton
    );
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
    reportProgressSafely(onProgress, 'VALIDATING_PROGRAM');
    startTimingStage('validationMs');
    const finalValidation = await validateFinalWeeklyPlan({
      completedDocument: outputs.output7,
      runtimeUserId: userId,
      preflight: finalPreflight,
    });
    outputs.output8 = {
      ...finalValidation,
      aiUsage: buildAiUsageReport(aiUsageCalls),
    };
    closeTimingStage();
  } catch (error) {
    closeTimingStage();
    blockingError = markFailureOutputs(
      outputs,
      currentOutput,
      error,
      Array.isArray(error?.details) ? error.details : null,
      failureReceived
    );
  }

  const complexity = summarizeCompletedDocument(outputs.output7);
  outputs.output8 = {
    ...outputs.output8,
    aiUsage: buildAiUsageReport(aiUsageCalls),
    fillResolution: fillResolutionObservability,
    // Only emitted in BOUND_PLAN mode so the GEOMETRY_ONLY rollback path keeps
    // producing byte-identical Output 08.
    ...(boundPlanMode ? { attempts: attemptLedger } : {}),
    timing: {
      totalDurationMs: null,
      stageDurations,
      generationContext: {
        sessionsPerWeek: Number.isSafeInteger(prompt?.sessionsPerWeek)
          ? prompt.sessionsPerWeek
          : null,
        durationPerSession: Number.isSafeInteger(prompt?.durationPerSession)
          ? prompt.durationPerSession
          : null,
        ...complexity,
      },
      persistenceOutcome: outputs.output8?.valid === true
        ? 'PENDING'
        : 'NOT_ATTEMPTED',
    },
  };

  const artifacts = await writeArtifacts({
    outputs,
    sidecars: artifactSidecars,
    attemptSidecars,
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
    pipelineDurationMs: normalizeDurationMs(monotonicNow() - pipelineStartedAt),
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
