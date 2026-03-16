const { ApiError, createUser, upsertUserProfile } = require('../services/usersService');

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

async function createUserHandler(req, res) {
  try {
    const user = await createUser(req.body || {});
    return res.status(201).json({ user });
  } catch (error) {
    return handleError(res, error);
  }
}

async function upsertUserProfileHandler(req, res) {
  try {
    const profile = await upsertUserProfile(req.params.userId, req.body || {});
    return res.status(200).json({ profile });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createUserHandler,
  upsertUserProfileHandler,
};
