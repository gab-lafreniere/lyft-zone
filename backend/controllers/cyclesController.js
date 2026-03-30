const { ApiError } = require('../services/usersService');
const {
  createCycle,
  createCycleFromWeeklyPlan,
  createPlanForCycle,
  extendCycleDraft,
  getCycleDetails,
  getCycleFull,
  getHomeDashboard,
  getProgramsOverview,
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  rescheduleUpcomingCycle,
  updateCycleDraft,
} = require('../services/cyclesService');

function handleError(res, error) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
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

async function createCycleHandler(req, res) {
  try {
    const cycle = await createCycle(req.body || {});
    return res.status(201).json({ cycle });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createCycleFromWeeklyPlanHandler(req, res) {
  try {
    const response = await createCycleFromWeeklyPlan(req.body || {});
    return res.status(201).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function createPlanForCycleHandler(req, res) {
  try {
    const plan = await createPlanForCycle(req.params.cycleId, req.body || {});
    return res.status(201).json({ plan });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getProgramsOverviewHandler(req, res) {
  try {
    const response = await getProgramsOverview(req.query.userId, req.query.timezone);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function getHomeDashboardHandler(req, res) {
  try {
    const response = await getHomeDashboard(req.query.userId, req.query.timezone);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
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
    return handleError(res, error);
  }
}

async function openOrCreateCycleEditDraftHandler(req, res) {
  try {
    const response = await openOrCreateCycleEditDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateCycleDraftHandler(req, res) {
  try {
    const response = await updateCycleDraft(req.params.cycleId, req.params.planId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function publishCycleDraftHandler(req, res) {
  try {
    const response = await publishCycleDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function rescheduleUpcomingCycleHandler(req, res) {
  try {
    const response = await rescheduleUpcomingCycle(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function extendCycleDraftHandler(req, res) {
  try {
    const response = await extendCycleDraft(req.params.cycleId, req.body || {});
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

async function getCycleFullHandler(req, res) {
  try {
    const response = await getCycleFull(req.params.cycleId);
    return res.status(200).json(response);
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createCycleFromWeeklyPlanHandler,
  createCycleHandler,
  createPlanForCycleHandler,
  extendCycleDraftHandler,
  getCycleDetailsHandler,
  getCycleFullHandler,
  getHomeDashboardHandler,
  getProgramsOverviewHandler,
  openOrCreateCycleEditDraftHandler,
  publishCycleDraftHandler,
  rescheduleUpcomingCycleHandler,
  updateCycleDraftHandler,
};
