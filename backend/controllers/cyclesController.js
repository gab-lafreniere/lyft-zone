const { ApiError } = require('../services/usersService');
const { createCycle, createPlanForCycle, getCycleFull } = require('../services/cyclesService');

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

async function createPlanForCycleHandler(req, res) {
  try {
    const plan = await createPlanForCycle(req.params.cycleId, req.body || {});
    return res.status(201).json({ plan });
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
  createCycleHandler,
  createPlanForCycleHandler,
  getCycleFullHandler,
};
