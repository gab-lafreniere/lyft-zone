const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
  TEXTUAL_DURATION_INTENT,
  TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
  WeeklyPlanTrainingMetricsPromptProjectionError,
  buildWeeklyPlanTrainingMetricsPromptProjection,
} = require('../../src/domain/programGeneration/weeklyPlanTrainingMetricsPromptProjection');

test('textual duration guidance is compact and qualitative', () => {
  const guidance = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 90,
  });

  assert.equal(TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION, 1);
  assert.deepEqual(guidance, {
    requestedMinutes: 90,
    durationIntent: TEXTUAL_DURATION_INTENT,
  });
  assert.equal(
    JSON.stringify(guidance).length <=
      MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
    true
  );
});

test('textual guidance has no duration ranges, calculation contract, or correction gate', () => {
  const guidance = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 90,
  });
  const serialized = JSON.stringify(guidance);

  [
    /acceptableDurationMinutes/,
    /preferredDurationMinutes/,
    /methodId/,
    /contributors/,
    /restRules/,
    /backend/,
    /correction/i,
    /77/,
    /94/,
  ].forEach((pattern) => assert.doesNotMatch(serialized, pattern));
});

test('textual guidance module does not import backend duration, metrics, or policy', () => {
  const source = fs.readFileSync(
    require.resolve(
      '../../src/domain/programGeneration/weeklyPlanTrainingMetricsPromptProjection'
    ),
    'utf8'
  );

  [
    /weeklyPlanBackendDuration/,
    /weeklyPlanMetrics/,
    /weeklyPlanEvaluationPolicy/,
  ].forEach((pattern) => assert.doesNotMatch(source, pattern));
});

test('guidance is deterministic and rejects invalid inputs', () => {
  const first = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 45,
  });
  const second = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 45,
  });
  assert.deepEqual(first, second);

  for (const requestedDurationMinutes of [null, 0, 45.5]) {
    assert.throws(
      () =>
        buildWeeklyPlanTrainingMetricsPromptProjection({
          requestedDurationMinutes,
        }),
      WeeklyPlanTrainingMetricsPromptProjectionError
    );
  }
});
