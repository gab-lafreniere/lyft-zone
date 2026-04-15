const { ApiError } = require('../services/usersService');
const {
  createCycle,
  createCycleFromWeeklyPlan,
  createPlanForCycle,
  deleteCycle,
  extendCycleDraft,
  getCanonicalHomeDashboard,
  getCycleDetails,
  getCycleFull,
  getHomeDashboard,
  getProgramOverviewV2,
  getProgramsOverview,
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  rescheduleUpcomingCycle,
  updateCycleDraft,
  updateUpcomingDraftTimeline,
} = require('../services/cyclesService');

const DEFAULT_INTERNAL_ERROR = {
  code: 'INTERNAL_SERVER_ERROR',
  message: 'An unexpected error occurred',
};

function buildErrorContext(req, operation, error) {
  return {
    operation,
    route: `${req.method} ${req.originalUrl}`,
    cycleId: req.params?.cycleId || null,
    planId: req.params?.planId || null,
    userId: req.body?.userId || req.query?.userId || null,
    timezone: req.body?.timezone || req.query?.timezone || null,
    errorCode: error?.code || null,
    errorMessage: error?.message || null,
  };
}

function handleError(req, res, error, operation, internalError = DEFAULT_INTERNAL_ERROR) {
  const context = buildErrorContext(req, operation, error);

  if (error instanceof ApiError) {
    console.warn('[cyclesController]', {
      ...context,
      status: error.status,
      errorType: 'ApiError',
    });

    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  console.error('[cyclesController]', {
    ...context,
    status: 500,
    errorType: error?.name || 'Error',
    stack: error?.stack || null,
  });

  return res.status(500).json({
    error: {
      code: internalError.code,
      message: internalError.message,
    },
  });
}

async function createCycleHandler(req, res) {
  try {
    const cycle = await createCycle(req.body || {});
    return res.status(201).json({ cycle });
  } catch (error) {
    return handleError(req, res, error, 'create_cycle');
  }
}

async function createCycleFromWeeklyPlanHandler(req, res) {
  try {
    const response = await createCycleFromWeeklyPlan(req.body || {});
    return res.status(201).json(response);
  } catch (error) {
    return handleError(req, res, error, 'create_cycle_from_weekly_plan');
  }
}

async function createPlanForCycleHandler(req, res) {
  try {
    const plan = await createPlanForCycle(req.params.cycleId, req.body || {});
    return res.status(201).json({ plan });
  } catch (error) {
    return handleError(req, res, error, 'create_plan_for_cycle');
  }
}

async function getProgramsOverviewHandler(req, res) {
  try {
    const response = await getProgramsOverview(req.query.userId, req.query.timezone);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_programs_overview');
  }
}

async function getProgramOverviewV2Handler(req, res) {
  try {
    const response = await getProgramOverviewV2(req.query.userId, req.query.timezone);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_program_overview_v2');
  }
}

async function getHomeDashboardHandler(req, res) {
  try {
    const response = await getHomeDashboard(req.query.userId, req.query.timezone);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_home_dashboard');
  }
}

async function getCanonicalHomeDashboardHandler(req, res) {
  try {
    const response = await getCanonicalHomeDashboard(
      req.query.userId,
      req.query.timezone,
      req.query.selectedDate
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_canonical_home_dashboard');
  }
}

async function getCycleDetailsHandler(req, res) {
  try {
    const response = await getCycleDetails(
      req.params.cycleId,
      req.query.userId,
      req.query.timezone
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_cycle_details');
  }
}

async function openOrCreateCycleEditDraftHandler(req, res) {
  try {
    const response = await openOrCreateCycleEditDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'open_cycle_edit_draft', {
      code: 'CYCLE_BUILDER_OPEN_INTERNAL',
      message: 'An unexpected error occurred while opening this cycle draft.',
    });
  }
}

async function updateCycleDraftHandler(req, res) {
  try {
    const response = await updateCycleDraft(req.params.cycleId, req.params.planId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'update_cycle_draft', {
      code: 'CYCLE_DRAFT_SAVE_INTERNAL',
      message: 'An unexpected error occurred while saving this cycle draft.',
    });
  }
}

async function updateUpcomingDraftTimelineHandler(req, res) {
  try {
    const response = await updateUpcomingDraftTimeline(
      req.params.cycleId,
      req.params.planId,
      req.body || {}
    );
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'update_upcoming_draft_timeline', {
      code: 'CYCLE_TIMELINE_SAVE_INTERNAL',
      message: 'An unexpected error occurred while saving this cycle timeline.',
    });
  }
}

async function publishCycleDraftHandler(req, res) {
  try {
    const response = await publishCycleDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'publish_cycle_draft', {
      code: 'CYCLE_PUBLISH_INTERNAL',
      message: 'An unexpected error occurred while publishing this cycle.',
    });
  }
}

async function rescheduleUpcomingCycleHandler(req, res) {
  try {
    const response = await rescheduleUpcomingCycle(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'reschedule_upcoming_cycle');
  }
}

async function extendCycleDraftHandler(req, res) {
  try {
    const response = await extendCycleDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'extend_cycle_draft');
  }
}

async function deleteCycleHandler(req, res) {
  try {
    const response = await deleteCycle(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'delete_cycle');
  }
}

async function getCycleFullHandler(req, res) {
  try {
    const response = await getCycleFull(req.params.cycleId);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(req, res, error, 'get_cycle_full');
  }
}

module.exports = {
  createCycleFromWeeklyPlanHandler,
  createCycleHandler,
  createPlanForCycleHandler,
  deleteCycleHandler,
  extendCycleDraftHandler,
  getCanonicalHomeDashboardHandler,
  getCycleDetailsHandler,
  getCycleFullHandler,
  getHomeDashboardHandler,
  getProgramOverviewV2Handler,
  getProgramsOverviewHandler,
  openOrCreateCycleEditDraftHandler,
  publishCycleDraftHandler,
  rescheduleUpcomingCycleHandler,
  updateCycleDraftHandler,
  updateUpcomingDraftTimelineHandler,
};
