const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WeeklyPlanBackendDurationError,
  applyBackendCalculatedDurationsToPlanDocument,
  buildIntegerDurationRanges,
  evaluateWeeklyPlanDurationGate,
} = require('../../src/domain/programGeneration/weeklyPlanBackendDuration');
const {
  clone,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

function createAnalytics(overrides = {}) {
  return {
    workouts: [
      {
        workoutOrderIndex: 1,
        requestedDurationMinutes: 90,
        calculatedDurationMinutes: 76,
        durationDifferenceMinutes: -14,
        durationUtilizationRatio: 0.8444,
        durationAlignmentStatus: 'correction_required_under_target',
        durationRequiresCorrection: true,
        durationCalculation: {
          methodId: 'historical_weekly_plan_metrics_v1',
          blocks: [],
          workoutTotalSeconds: 4560,
          calculatedDurationMinutes: 76,
        },
        ...overrides,
      },
    ],
  };
}

test('duration ranges derive exact 90-minute Evaluation Policy boundaries', () => {
  assert.deepEqual(buildIntegerDurationRanges(90), {
    acceptableDurationMinutes: { minimum: 77, maximum: 94 },
    preferredDurationMinutes: { minimum: 81, maximum: 90 },
  });
});

test('backend durations are applied by orderIndex without mutation', () => {
  const document = createNormalizedDocument({
    estimatedDurationMinutes: null,
  });
  const before = clone(document);
  const result = applyBackendCalculatedDurationsToPlanDocument(
    document,
    createAnalytics({
      calculatedDurationMinutes: 77,
      durationRequiresCorrection: false,
    })
  );

  assert.equal(result.workouts[0].estimatedDurationMinutes, 77);
  assert.deepEqual(document, before);
  assert.notEqual(result, document);
});

for (const mutate of [
  (document) => {
    document.workouts.push(clone(document.workouts[0]));
  },
  (_document, analytics) => {
    analytics.workouts = [];
  },
  (_document, analytics) => {
    analytics.workouts[0].calculatedDurationMinutes = 1.5;
  },
  (_document, analytics) => {
    analytics.workouts[0].workoutOrderIndex = 2;
  },
]) {
  test('backend duration application fails closed for invalid mappings', () => {
    const document = createNormalizedDocument();
    const analytics = createAnalytics();
    mutate(document, analytics);

    assert.throws(
      () =>
        applyBackendCalculatedDurationsToPlanDocument(document, analytics),
      WeeklyPlanBackendDurationError
    );
  });
}

test('duration gate returns structured backend correction details', () => {
  const result = evaluateWeeklyPlanDurationGate(createAnalytics());

  assert.equal(result.ok, false);
  assert.equal(result.correctionRequired, true);
  assert.deepEqual(result.workouts[0].acceptableDurationMinutes, {
    minimum: 77,
    maximum: 94,
  });
  assert.deepEqual(result.workouts[0].preferredDurationMinutes, {
    minimum: 81,
    maximum: 90,
  });
  assert.equal(result.workouts[0].direction, 'INCREASE');
  assert.equal(result.workouts[0].minimumMinutesToAcceptableRange, 1);
});
