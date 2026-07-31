const TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION = 1;
const MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS = 6000;
const TEXTUAL_DURATION_INTENT =
  'Use the available session time productively without padding or unnecessary work.';

class WeeklyPlanTrainingMetricsPromptProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WeeklyPlanTrainingMetricsPromptProjectionError';
  }
}

function invalidProjection(message) {
  return new WeeklyPlanTrainingMetricsPromptProjectionError(message);
}

function buildWeeklyPlanTrainingMetricsPromptProjection({
  requestedDurationMinutes,
} = {}) {
  if (
    !Number.isSafeInteger(requestedDurationMinutes) ||
    requestedDurationMinutes < 1
  ) {
    throw invalidProjection('A positive integer requested duration is required');
  }
  const guidance = {
    requestedMinutes: requestedDurationMinutes,
    durationIntent: TEXTUAL_DURATION_INTENT,
  };

  if (JSON.stringify(guidance).length > MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS) {
    throw invalidProjection('Training Metrics Guidance exceeds its size limit');
  }

  return guidance;
}

module.exports = {
  MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
  TEXTUAL_DURATION_INTENT,
  TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
  WeeklyPlanTrainingMetricsPromptProjectionError,
  buildWeeklyPlanTrainingMetricsPromptProjection,
};
