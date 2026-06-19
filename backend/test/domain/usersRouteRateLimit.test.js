const test = require('node:test');
const assert = require('node:assert/strict');

const usersRouter = require('../../routes/users');

function findRoute(path, method) {
  return usersRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  );
}

test('users router applies movement constraint analyze rate limit only to analyze route', () => {
  const analyzeRoute = findRoute(
    '/:userId/settings/training-profile/movement-constraints/analyze',
    'post'
  );
  const settingsRoute = findRoute('/:userId/settings', 'get');
  const updateTrainingProfileRoute = findRoute('/:userId/settings/training-profile', 'patch');

  assert.ok(analyzeRoute);
  assert.ok(settingsRoute);
  assert.ok(updateTrainingProfileRoute);
  assert.deepEqual(
    analyzeRoute.route.stack.map((layer) => layer.handle.name),
    ['movementConstraintAnalyzeRateLimitMiddleware', 'analyzeMovementConstraintSettingsHandler']
  );
  assert.deepEqual(
    settingsRoute.route.stack.map((layer) => layer.handle.name),
    ['getUserSettingsHandler']
  );
  assert.deepEqual(
    updateTrainingProfileRoute.route.stack.map((layer) => layer.handle.name),
    ['updateTrainingProfileSettingsHandler']
  );
});
