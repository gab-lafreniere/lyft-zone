const test = require('node:test');
const assert = require('node:assert/strict');

const {
  _test: { getExercisePoolErrorStatus },
} = require('../../controllers/usersController');

test('users controller maps expected exercise pool errors to non-500 statuses', () => {
  assert.equal(getExercisePoolErrorStatus('PROFILE_NOT_READY'), 409);
  assert.equal(getExercisePoolErrorStatus('UNSUPPORTED_PROFILE_SCHEMA_VERSION'), 422);
  assert.equal(getExercisePoolErrorStatus('VALIDATION_ERROR'), 400);
});
