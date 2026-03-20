const { ApiError } = require('../services/usersService');
const {
  createWeeklyPlan,
  getWeeklyPlanDetails,
  listVisibleWeeklyPlans,
  openOrCreateEditDraft,
  publishWeeklyPlanDraft,
  setWeeklyPlanBookmark,
  updateWeeklyPlanDraft,
} = require('../services/weeklyPlansService');

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

async function createWeeklyPlanHandler(req, res) {
  try {
    const weeklyPlan = await createWeeklyPlan(req.body || {});
    return res.status(201).json(weeklyPlan);
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
  createWeeklyPlanHandler,
  getWeeklyPlanDetailsHandler,
  listWeeklyPlansHandler,
  openOrCreateEditDraftHandler,
  publishWeeklyPlanDraftHandler,
  unbookmarkWeeklyPlanHandler,
  updateWeeklyPlanDraftHandler,
};

