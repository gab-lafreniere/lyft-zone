const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DURATION_PER_SESSION_VALUES,
  SESSIONS_PER_WEEK_VALUES,
  getTrainingProfileAvailabilityOptions,
  normalizeDurationPerSession,
  normalizeSessionsPerWeek,
} = require('../../src/domain/trainingProfile/trainingProfileAvailability');

test('availability values preserve the exact ordered Settings contract', () => {
  assert.deepEqual(SESSIONS_PER_WEEK_VALUES, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(DURATION_PER_SESSION_VALUES, [15, 30, 45, 60, 75, 90, 105, 120]);
  assert.deepEqual(getTrainingProfileAvailabilityOptions(), {
    sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
    durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
  });
});

test('availability normalization accepts exact numeric values without rounding', () => {
  assert.equal(normalizeSessionsPerWeek('4'), 4);
  assert.equal(normalizeDurationPerSession('75'), 75);
  assert.equal(normalizeSessionsPerWeek(4.5), null);
  assert.equal(normalizeDurationPerSession(50), null);
  assert.equal(normalizeDurationPerSession(60.5), null);
});
