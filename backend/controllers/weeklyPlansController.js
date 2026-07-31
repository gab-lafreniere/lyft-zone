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
} = require('../services/weeklyPlansService');

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
  try {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
    }

    const pipelineResult = await runSimpleWeeklyPlanAiPipeline({ userId });
    if (
      pipelineResult?.valid !== true ||
      pipelineResult?.output8?.valid !== true ||
      !pipelineResult.completedDocument ||
      !pipelineResult.output8.metrics ||
      typeof pipelineResult.generatedPlanText !== 'string'
    ) {
      throw new ApiError(
        422,
        'AI_WEEKLY_PLAN_INVALID_OUTPUT',
        'AI weekly plan generation did not produce a valid plan'
      );
    }

    const createdPlan = await createWeeklyPlan(
      {
        ...pipelineResult.completedDocument,
        userId,
        source: 'AI',
      },
      { initialStatus: 'PUBLISHED' }
    );
    const name = String(
      createdPlan?.builderPayload?.programName ||
        pipelineResult.completedDocument.name ||
        ''
    );
    let presentation;

    try {
      presentation = buildSimpleWeeklyPlanResultPresentation({
        generatedPlanText: pipelineResult.generatedPlanText,
        completedDocument: pipelineResult.completedDocument,
      });
    } catch (_error) {
      presentation = buildSimpleWeeklyPlanResultPresentationFallback({
        ...pipelineResult.completedDocument,
        name,
      });
    }

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
  getWeeklyPlanDetailsHandler,
  listWeeklyPlansHandler,
  openOrCreateEditDraftHandler,
  publishWeeklyPlanDraftHandler,
  unbookmarkWeeklyPlanHandler,
  updateWeeklyPlanDraftHandler,
  projectPublicMetrics,
};
