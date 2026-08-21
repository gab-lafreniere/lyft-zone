const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DAY_OF_WEEK_VALUES,
  DURATION_PER_SESSION_VALUES,
  SESSIONS_PER_WEEK_VALUES,
  SPACED_DEFAULT_TRAINING_DAYS,
  getTrainingProfileAvailabilityOptions,
  normalizeDurationPerSession,
  normalizePreferredTrainingDays,
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

test('preferred training days use the locked spaced defaults for one through seven sessions', () => {
  assert.deepEqual(SPACED_DEFAULT_TRAINING_DAYS, {
    1: ['MONDAY'],
    2: ['MONDAY', 'THURSDAY'],
    3: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    4: ['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY'],
    5: ['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    6: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    7: DAY_OF_WEEK_VALUES,
  });
});

test('normalizePreferredTrainingDays accepts null and returns canonical weekday order', () => {
  assert.equal(normalizePreferredTrainingDays(null, 3), null);
  assert.deepEqual(
    normalizePreferredTrainingDays(['FRIDAY', 'MONDAY', 'WEDNESDAY'], 3),
    ['MONDAY', 'WEDNESDAY', 'FRIDAY']
  );
});

test('normalizePreferredTrainingDays rejects type, enum, duplicate, and count errors', () => {
  assert.throws(() => normalizePreferredTrainingDays('MONDAY', 1), /array or null/);
  assert.throws(() => normalizePreferredTrainingDays(['FUNDAY'], 1), /invalid DayOfWeek/);
  assert.throws(
    () => normalizePreferredTrainingDays(['MONDAY', 'MONDAY'], 2),
    /duplicate/
  );
  assert.throws(
    () => normalizePreferredTrainingDays(['MONDAY', 'WEDNESDAY'], 3),
    /exactly sessionsPerWeek/
  );
});

test('frontend and backend spaced default tables stay identical', () => {
  const frontendSource = fs.readFileSync(
    path.join(
      __dirname,
      '../../../frontend/src/features/onboarding/trainingDayDefaults.js'
    ),
    'utf8'
  );
  const match = frontendSource.match(
    /export const SPACED_DEFAULT_TRAINING_DAYS = (\{[\s\S]*?\n\});/
  );

  assert.ok(match, 'frontend spaced default table must remain a JSON-compatible literal');
  assert.deepEqual(JSON.parse(match[1]), SPACED_DEFAULT_TRAINING_DAYS);
});
