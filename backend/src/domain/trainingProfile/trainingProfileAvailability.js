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

const SESSION_VALUE_SET = new Set(SESSIONS_PER_WEEK_VALUES);
const DURATION_VALUE_SET = new Set(DURATION_PER_SESSION_VALUES);

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

function getTrainingProfileAvailabilityOptions() {
  return {
    sessionsPerWeek: [...SESSIONS_PER_WEEK_VALUES],
    durationPerSession: [...DURATION_PER_SESSION_VALUES],
  };
}

module.exports = {
  DURATION_PER_SESSION_VALUES,
  SESSIONS_PER_WEEK_VALUES,
  getTrainingProfileAvailabilityOptions,
  normalizeDurationPerSession,
  normalizeSessionsPerWeek,
};
