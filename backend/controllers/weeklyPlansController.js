const { performance } = require('node:perf_hooks');
const { ApiError } = require('../services/usersService');
const {
  runSimpleWeeklyPlanAiPipeline,
} = require('../services/simpleWeeklyPlanAiOrchestrator');
const {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
} = require('../src/domain/simpleWeeklyPlanPipeline/resultPresentation');
const {
  createWeeklyPlan,
  deleteWeeklyPlan,
  getWeeklyPlanDetails,
  listVisibleWeeklyPlans,
  openOrCreateEditDraft,
  publishWeeklyPlanDraft,
  setWeeklyPlanBookmark,
  updateWeeklyPlanDraft,
  updateWeeklyPlanWorkoutContent,
} = require('../services/weeklyPlansService');
const {
  rewriteWeeklyPlanPipelineOutput8,
} = require('../services/weeklyPlanPipelineArtifactWriter');
const {
  advanceGenerationProgress,
  beginGenerationProgress,
  failGenerationProgress,
  finishGenerationProgress,
  readGenerationProgress,
} = require('../services/weeklyPlanAiProgressRegistry');

const GENERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeGenerationId(value) {
  const generationId = String(value || '').trim();
  if (!generationId) {
    return null;
  }
  if (!GENERATION_ID_PATTERN.test(generationId)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'generationId must be a URL-safe identifier of at most 128 characters'
    );
  }
  return generationId;
}

function reportProgressBestEffort(operation, context) {
  try {
    return operation();
  } catch (error) {
    console.warn('[weeklyPlanAiProgress]', {
      ...context,
      error: error?.message || String(error),
    });
    return null;
  }
}

function normalizeDurationMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

async function finalizeOutput8BestEffort(
  pipelineResult,
  { totalDurationMs, persistenceMs, persistenceOutcome }
) {
  if (!pipelineResult?.runDirectory || !pipelineResult?.output8) {
    return;
  }
  const finalizedOutput8 = {
    ...pipelineResult.output8,
    timing: {
      ...(pipelineResult.output8.timing || {}),
      totalDurationMs: normalizeDurationMs(totalDurationMs),
      stageDurations: {
        ...(pipelineResult.output8.timing?.stageDurations || {}),
        persistenceMs: normalizeDurationMs(persistenceMs),
      },
      persistenceOutcome,
    },
  };
  pipelineResult.output8 = finalizedOutput8;
  try {
    await rewriteWeeklyPlanPipelineOutput8({
      runDirectory: pipelineResult.runDirectory,
      output8: finalizedOutput8,
    });
  } catch (error) {
    console.warn('[weeklyPlansController] Output 8 finalization failed', {
      runId: pipelineResult.runId || null,
      persistenceOutcome,
      error: error?.message || String(error),
    });
  }
}

function normalizeMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function projectPublicMetrics(metrics) {
  const weekly = metrics?.weekly || {};

  return {
    totalExercises: normalizeMetric(weekly.totalExerciseCount),
    strengthSets: normalizeMetric(weekly.totalSetCount),
    averageDurationMinutes: normalizeMetric(weekly.averageDurationMinutes),
    averageTUTMinutes: normalizeMetric(weekly.averageTUTMinutes),
    weeklyMuscleDistribution: Array.isArray(weekly.muscleDistribution)
      ? weekly.muscleDistribution.map((entry) => ({
        key: String(entry?.key || ''),
        label: String(entry?.label || ''),
        rawSets: normalizeMetric(entry?.rawSets),
        percentage: normalizeMetric(entry?.percentageOfWorkout),
      }))
      : [],
  };
}

function handleError(res, error) {
  if (error instanceof ApiError || (error?.status && error?.code)) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details || undefined,
      },
    });
  }

  console.error(error);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

async function createWeeklyPlanHandler(req, res) {
  try {
    const weeklyPlan = await createWeeklyPlan(req.body || {});
    return res.status(201).json(weeklyPlan);
  } catch (error) {
    return handleError(res, error);
  }
}

async function createAIWeeklyPlanDraftHandler(req, res) {
  let generationId = null;
  let progressEnabled = false;
  const generationStartedAt = performance.now();
  try {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
    }

    generationId = normalizeGenerationId(req.body?.generationId);
    if (generationId) {
      progressEnabled = Boolean(reportProgressBestEffort(
        () => beginGenerationProgress({ generationId, userId }),
        { generationId, operation: 'begin' }
      ));
    }

    const pipelineResult = await runSimpleWeeklyPlanAiPipeline({
      userId,
      ...(progressEnabled
        ? {
            onProgress: (stage) => reportProgressBestEffort(
              () => advanceGenerationProgress(generationId, stage),
              { generationId, operation: 'advance', stage }
            ),
          }
        : {}),
    });
    if (
      pipelineResult?.valid !== true ||
      pipelineResult?.output8?.valid !== true ||
      !pipelineResult.completedDocument ||
      !pipelineResult.output8.metrics ||
      typeof pipelineResult.generatedPlanText !== 'string'
    ) {
      await finalizeOutput8BestEffort(pipelineResult, {
        totalDurationMs: performance.now() - generationStartedAt,
        persistenceMs: null,
        persistenceOutcome: 'NOT_ATTEMPTED',
      });
      throw new ApiError(
        422,
        'AI_WEEKLY_PLAN_INVALID_OUTPUT',
        'AI weekly plan generation did not produce a valid plan'
      );
    }

    if (progressEnabled) {
      reportProgressBestEffort(
        () => advanceGenerationProgress(generationId, 'SAVING_PROGRAM'),
        { generationId, operation: 'advance', stage: 'SAVING_PROGRAM' }
      );
    }
    let presentation;

    try {
      presentation = buildSimpleWeeklyPlanResultPresentation({
        generatedPlanText: pipelineResult.generatedPlanText,
        completedDocument: pipelineResult.completedDocument,
        boundPresentation: pipelineResult.boundPresentation,
        presentationContractEnabled:
          pipelineResult.presentationContractEnabled !== false,
      });
    } catch (_error) {
      presentation = buildSimpleWeeklyPlanResultPresentationFallback(
        pipelineResult.completedDocument
      );
    }
    const persistenceStartedAt = performance.now();
    let createdPlan;
    try {
      createdPlan = await createWeeklyPlan(
        {
          ...pipelineResult.completedDocument,
          userId,
          source: 'AI',
          generationContext: {
            schemaVersion: 1,
            presentation,
            sourceWorkoutNames: Array.isArray(pipelineResult.sourceWorkoutNames)
              ? pipelineResult.sourceWorkoutNames
              : [],
          },
        },
        { initialStatus: 'PUBLISHED' }
      );
    } catch (persistenceError) {
      await finalizeOutput8BestEffort(pipelineResult, {
        totalDurationMs: performance.now() - generationStartedAt,
        persistenceMs: performance.now() - persistenceStartedAt,
        persistenceOutcome: 'FAILED',
      });
      throw persistenceError;
    }
    await finalizeOutput8BestEffort(pipelineResult, {
      totalDurationMs: performance.now() - generationStartedAt,
      persistenceMs: performance.now() - persistenceStartedAt,
      persistenceOutcome: 'SUCCEEDED',
    });
    if (progressEnabled) {
      reportProgressBestEffort(
        () => finishGenerationProgress(generationId),
        { generationId, operation: 'finish' }
      );
    }
    const name = String(
      createdPlan?.builderPayload?.programName ||
        pipelineResult.completedDocument.name ||
        ''
    );
    return res.status(201).json({
      weeklyPlanParentId: createdPlan.weeklyPlanParentId,
      weeklyPlanVersionId: createdPlan.weeklyPlanVersionId,
      name,
      status: 'PUBLISHED',
      source: 'ai',
      metrics: projectPublicMetrics(pipelineResult.output8.metrics),
      presentation,
    });
  } catch (error) {
    if (progressEnabled) {
      reportProgressBestEffort(
        () => failGenerationProgress(generationId),
        { generationId, operation: 'fail' }
      );
    }
    return handleError(res, error);
  }
}

async function getAIWeeklyPlanDraftProgressHandler(req, res) {
  try {
    const generationId = normalizeGenerationId(req.params.generationId);
    const userId = String(req.query?.userId || '').trim();
    if (!userId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
    }
    const progress = readGenerationProgress({ generationId, userId });
    if (!progress) {
      throw new ApiError(
        404,
        'AI_GENERATION_PROGRESS_NOT_FOUND',
        'Generation progress was not found'
      );
    }
    return res.status(200).json(progress);
  } catch (error) {
    return handleError(res, error);
  }
}

async function listWeeklyPlansHandler(req, res) {
  try {
    const items = await listVisibleWeeklyPlans(req.query.userId);
    return res.status(200).json({ items });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteWeeklyPlanHandler(req, res) {
  try {
    const response = await deleteWeeklyPlan(
      req.params.weeklyPlanParentId,
      req.body?.userId || req.query.userId
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function getWeeklyPlanDetailsHandler(req, res) {
  try {
    const weeklyPlan = await getWeeklyPlanDetails(req.params.weeklyPlanParentId, req.query.userId);
    return res.status(200).json(weeklyPlan);
  } catch (error) {
    return handleError(res, error);
  }
}

async function openOrCreateEditDraftHandler(req, res) {
  try {
    const draft = await openOrCreateEditDraft(req.params.weeklyPlanParentId, req.body?.userId || req.query.userId);
    return res.status(200).json(draft);
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateWeeklyPlanDraftHandler(req, res) {
  try {
    const draft = await updateWeeklyPlanDraft(
      req.params.weeklyPlanParentId,
      req.params.versionId,
      req.body || {}
    );
    return res.status(200).json(draft);
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateWeeklyPlanWorkoutContentHandler(req, res) {
  try {
    const workout = await updateWeeklyPlanWorkoutContent(
      req.params.weeklyPlanParentId,
      req.params.versionId,
      req.params.workoutId,
      req.body || {}
    );
    return res.status(200).json(workout);
  } catch (error) {
    return handleError(res, error);
  }
}

async function publishWeeklyPlanDraftHandler(req, res) {
  try {
    const response = await publishWeeklyPlanDraft(req.params.weeklyPlanParentId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function bookmarkWeeklyPlanHandler(req, res) {
  try {
    const response = await setWeeklyPlanBookmark(
      req.params.weeklyPlanParentId,
      req.body?.userId || req.query.userId,
      true
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function unbookmarkWeeklyPlanHandler(req, res) {
  try {
    const response = await setWeeklyPlanBookmark(
      req.params.weeklyPlanParentId,
      req.body?.userId || req.query.userId,
      false
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  bookmarkWeeklyPlanHandler,
  createAIWeeklyPlanDraftHandler,
  createWeeklyPlanHandler,
  deleteWeeklyPlanHandler,
  getAIWeeklyPlanDraftProgressHandler,
  getWeeklyPlanDetailsHandler,
  listWeeklyPlansHandler,
  openOrCreateEditDraftHandler,
  publishWeeklyPlanDraftHandler,
  unbookmarkWeeklyPlanHandler,
  updateWeeklyPlanDraftHandler,
  updateWeeklyPlanWorkoutContentHandler,
  projectPublicMetrics,
};
