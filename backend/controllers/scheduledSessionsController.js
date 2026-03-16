const { ApiError } = require('../services/usersService');
const {
  createScheduledSessions,
  listScheduledSessions,
} = require('../services/scheduledSessionsService');

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

async function createScheduledSessionsHandler(req, res) {
  try {
    const sessions = await createScheduledSessions(req.body || {});
    return res.status(201).json({ sessions });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listScheduledSessionsHandler(req, res) {
  try {
    const sessions = await listScheduledSessions(req.query || {});
    return res.status(200).json({ sessions });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createScheduledSessionsHandler,
  listScheduledSessionsHandler,
};
