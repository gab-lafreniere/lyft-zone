const SESSIONS_PER_WEEK_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
const DURATION_PER_SESSION_VALUES = Object.freeze([
  15,
  30,
  45,
  60,
  75,
  90,
  105,
  120,
]);
const DAY_OF_WEEK_VALUES = Object.freeze([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
const SPACED_DEFAULT_TRAINING_DAYS = Object.freeze({
  1: Object.freeze(['MONDAY']),
  2: Object.freeze(['MONDAY', 'THURSDAY']),
  3: Object.freeze(['MONDAY', 'WEDNESDAY', 'FRIDAY']),
  4: Object.freeze(['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY']),
  5: Object.freeze(['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']),
  6: Object.freeze(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  7: DAY_OF_WEEK_VALUES,
});

const SESSION_VALUE_SET = new Set(SESSIONS_PER_WEEK_VALUES);
const DURATION_VALUE_SET = new Set(DURATION_PER_SESSION_VALUES);
const DAY_OF_WEEK_SET = new Set(DAY_OF_WEEK_VALUES);

function normalizeExactInteger(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeSessionsPerWeek(value) {
  const normalized = normalizeExactInteger(value);
  return SESSION_VALUE_SET.has(normalized) ? normalized : null;
}

function normalizeDurationPerSession(value) {
  const normalized = normalizeExactInteger(value);
  return DURATION_VALUE_SET.has(normalized) ? normalized : null;
}

function normalizePreferredTrainingDays(value, sessionsPerWeek) {
  if (value == null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new TypeError('preferredTrainingDays must be an array or null');
  }

  const normalizedSessionsPerWeek = normalizeSessionsPerWeek(sessionsPerWeek);
  if (normalizedSessionsPerWeek == null) {
    throw new TypeError('sessionsPerWeek must be valid before preferredTrainingDays can be validated');
  }

  const seen = new Set();
  value.forEach((day) => {
    if (typeof day !== 'string' || !DAY_OF_WEEK_SET.has(day)) {
      throw new TypeError('preferredTrainingDays contains an invalid DayOfWeek value');
    }
    if (seen.has(day)) {
      throw new TypeError('preferredTrainingDays cannot contain duplicate days');
    }
    seen.add(day);
  });

  if (seen.size !== normalizedSessionsPerWeek) {
    throw new TypeError('preferredTrainingDays must contain exactly sessionsPerWeek days');
  }

  return DAY_OF_WEEK_VALUES.filter((day) => seen.has(day));
}

function getTrainingProfileAvailabilityOptions() {
  return {
    sessionsPerWeek: [...SESSIONS_PER_WEEK_VALUES],
    durationPerSession: [...DURATION_PER_SESSION_VALUES],
  };
}

module.exports = {
  DAY_OF_WEEK_VALUES,
  DURATION_PER_SESSION_VALUES,
  SESSIONS_PER_WEEK_VALUES,
  SPACED_DEFAULT_TRAINING_DAYS,
  getTrainingProfileAvailabilityOptions,
  normalizeDurationPerSession,
  normalizePreferredTrainingDays,
  normalizeSessionsPerWeek,
};
