const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
} = require('../../src/domain/weeklyPlans/weeklyPlanMetrics');
const {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  calculateDurationAlignment,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

const MAX_POLICY_SERIALIZED_BYTES = 6000;

function assertDeepFrozen(value, path = 'root') {
  if (!value || typeof value !== 'object') {
    return;
  }

  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  Object.entries(value).forEach(([key, child]) => {
    assertDeepFrozen(child, `${path}.${key}`);
  });
}

function assertJsonDtoValue(value, path = 'root') {
  assert.notEqual(typeof value, 'function', `${path} must not contain a function`);
  assert.notEqual(value, undefined, `${path} must not contain undefined`);

  if (Array.isArray(value)) {
    value.forEach((child, index) => assertJsonDtoValue(child, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      assertJsonDtoValue(child, `${path}.${key}`);
    });
  }
}

test('Evaluation Policy V1 exports the exact deterministic identity and duration descriptor', () => {
  assert.equal(
    WEEKLY_PLAN_EVALUATION_POLICY_ID,
    'lyft_zone_weekly_plan_evaluation_policy'
  );
  assert.equal(WEEKLY_PLAN_EVALUATION_POLICY_VERSION, 1);
  assert.equal(WEEKLY_PLAN_EVALUATION_POLICY.id, WEEKLY_PLAN_EVALUATION_POLICY_ID);
  assert.equal(
    WEEKLY_PLAN_EVALUATION_POLICY.version,
    WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  );
  assert.equal(WEEKLY_PLAN_EVALUATION_POLICY.scope, 'ai_weekly_plan_builder_v1');
  assert.strictEqual(
    WEEKLY_PLAN_EVALUATION_POLICY.duration.calculation,
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.id,
    'historical_weekly_plan_metrics_v1'
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.blocks.SINGLE.restIntervalMultiplier,
    1.15
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.blocks.SINGLE.fixedBlockSeconds,
    90
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.blocks.SUPERSET.restIntervalMultiplier,
    1.15
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.blocks.SUPERSET.fixedBlockSeconds,
    90
  );
  assert.equal(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR.blocks.CARDIO.secondsPerMinute,
    60
  );
});

test('Evaluation Policy V1 is deeply frozen, JSON-safe, deterministic, and compact', () => {
  assertDeepFrozen(DURATION_ALIGNMENT_STATUS, 'DURATION_ALIGNMENT_STATUS');
  assertDeepFrozen(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR, 'durationDescriptor');
  assertDeepFrozen(WEEKLY_PLAN_EVALUATION_POLICY, 'evaluationPolicy');
  assertJsonDtoValue(WEEKLY_PLAN_EVALUATION_POLICY);

  const firstSerialization = JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY);
  const secondSerialization = JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY);
  const serializedBytes = Buffer.byteLength(firstSerialization, 'utf8');

  assert.equal(firstSerialization, secondSerialization);
  assert.deepEqual(JSON.parse(firstSerialization), WEEKLY_PLAN_EVALUATION_POLICY);
  assert.equal(firstSerialization.includes('undefined'), false);
  assert.doesNotMatch(firstSerialization, /\bfunction\b|=>|require\s*\(|\[native code\]/);
  assert.ok(
    serializedBytes <= MAX_POLICY_SERIALIZED_BYTES,
    `serialized policy is ${serializedBytes} bytes; budget is ${MAX_POLICY_SERIALIZED_BYTES}`
  );
});

test('Evaluation Policy V1 locks descriptive coaching analytics without adding calculators', () => {
  assert.deepEqual(WEEKLY_PLAN_EVALUATION_POLICY.volume.direct.taxonomies, [
    { taxonomy: 'target_muscle', sourceField: 'targetMuscles' },
    { taxonomy: 'muscle_focus', sourceField: 'muscleFocus' },
    { taxonomy: 'body_part', sourceField: 'bodyParts' },
  ]);
  assert.deepEqual(WEEKLY_PLAN_EVALUATION_POLICY.volume.indirect, {
    taxonomy: 'secondary_muscle',
    sourceField: 'secondaryMuscles',
    deduplicateKeysPerExercise: true,
    excludeKeysPresentInAnyDirectTaxonomy: true,
    contribution: 'full_working_set_count_per_key',
    coefficient: null,
    combinedWithDirect: false,
  });
  assert.equal(WEEKLY_PLAN_EVALUATION_POLICY.volume.countedSetType, 'WORKING');
  assert.equal(
    WEEKLY_PLAN_EVALUATION_POLICY.frequency.deduplicateWithinWorkout,
    true
  );
  assert.equal(
    WEEKLY_PLAN_EVALUATION_POLICY.frequency.secondaryCountsAsDirect,
    false
  );
  assert.deepEqual(
    WEEKLY_PLAN_EVALUATION_POLICY.targetResolution.resolutionOrder,
    ['muscle_focus', 'body_part', 'target_muscle']
  );
  assert.deepEqual(
    {
      durationContribution:
        WEEKLY_PLAN_EVALUATION_POLICY.cardio.durationContribution,
      directVolumeContribution:
        WEEKLY_PLAN_EVALUATION_POLICY.cardio.directVolumeContribution,
      indirectVolumeContribution:
        WEEKLY_PLAN_EVALUATION_POLICY.cardio.indirectVolumeContribution,
      directFrequencyContribution:
        WEEKLY_PLAN_EVALUATION_POLICY.cardio.directFrequencyContribution,
    },
    {
      durationContribution: 'prescribed_duration_minutes',
      directVolumeContribution: 0,
      indirectVolumeContribution: 0,
      directFrequencyContribution: 0,
    }
  );
});

test('calculateDurationAlignment classifies every requested boundary exactly', () => {
  const cases = [
    {
      calculatedDurationMinutes: 84,
      status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET,
      requiresCorrection: true,
    },
    {
      calculatedDurationMinutes: 85,
      status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 89,
      status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 90,
      status: DURATION_ALIGNMENT_STATUS.PREFERRED,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 100,
      status: DURATION_ALIGNMENT_STATUS.PREFERRED,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 101,
      status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 105,
      status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET,
      requiresCorrection: false,
    },
    {
      calculatedDurationMinutes: 106,
      status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET,
      requiresCorrection: true,
    },
  ];

  cases.forEach(({ calculatedDurationMinutes, status, requiresCorrection }) => {
    assert.deepEqual(
      calculateDurationAlignment({
        requestedDurationMinutes: 100,
        calculatedDurationMinutes,
      }),
      {
        requestedDurationMinutes: 100,
        calculatedDurationMinutes,
        durationDifferenceMinutes: calculatedDurationMinutes - 100,
        durationUtilizationRatio: calculatedDurationMinutes / 100,
        durationAlignmentStatus: status,
        requiresCorrection,
      }
    );
  });
});

test('calculateDurationAlignment returns unavailable for invalid requested duration', () => {
  const cases = [
    { value: undefined, normalized: null },
    { value: null, normalized: null },
    { value: Number.NaN, normalized: null },
    { value: Number.POSITIVE_INFINITY, normalized: null },
    { value: 0, normalized: 0 },
    { value: -1, normalized: -1 },
    { value: '60', normalized: null },
  ];

  cases.forEach(({ value, normalized }) => {
    assert.deepEqual(
      calculateDurationAlignment({
        requestedDurationMinutes: value,
        calculatedDurationMinutes: 60,
      }),
      {
        requestedDurationMinutes: normalized,
        calculatedDurationMinutes: 60,
        durationDifferenceMinutes: null,
        durationUtilizationRatio: null,
        durationAlignmentStatus: DURATION_ALIGNMENT_STATUS.UNAVAILABLE,
        requiresCorrection: false,
      }
    );
  });
});

test('calculateDurationAlignment returns unavailable for invalid calculated duration', () => {
  const cases = [
    { value: undefined, normalized: null },
    { value: null, normalized: null },
    { value: Number.NaN, normalized: null },
    { value: Number.NEGATIVE_INFINITY, normalized: null },
    { value: -1, normalized: -1 },
    { value: '58', normalized: null },
  ];

  cases.forEach(({ value, normalized }) => {
    assert.deepEqual(
      calculateDurationAlignment({
        requestedDurationMinutes: 60,
        calculatedDurationMinutes: value,
      }),
      {
        requestedDurationMinutes: 60,
        calculatedDurationMinutes: normalized,
        durationDifferenceMinutes: null,
        durationUtilizationRatio: null,
        durationAlignmentStatus: DURATION_ALIGNMENT_STATUS.UNAVAILABLE,
        requiresCorrection: false,
      }
    );
  });
});

test('zero calculated minutes with a valid target requires an under-target correction', () => {
  assert.deepEqual(
    calculateDurationAlignment({
      requestedDurationMinutes: 60,
      calculatedDurationMinutes: 0,
    }),
    {
      requestedDurationMinutes: 60,
      calculatedDurationMinutes: 0,
      durationDifferenceMinutes: -60,
      durationUtilizationRatio: 0,
      durationAlignmentStatus:
        DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET,
      requiresCorrection: true,
    }
  );
});

test('duration difference is exact and the exposed ratio is rounded to four decimals', () => {
  assert.deepEqual(
    calculateDurationAlignment({
      requestedDurationMinutes: 60,
      calculatedDurationMinutes: 58,
    }),
    {
      requestedDurationMinutes: 60,
      calculatedDurationMinutes: 58,
      durationDifferenceMinutes: -2,
      durationUtilizationRatio: 0.9667,
      durationAlignmentStatus: DURATION_ALIGNMENT_STATUS.PREFERRED,
      requiresCorrection: false,
    }
  );
});

test('classification uses the unrounded ratio and does not mutate input', () => {
  const input = Object.freeze({
    requestedDurationMinutes: 100000,
    calculatedDurationMinutes: 89999,
  });
  const first = calculateDurationAlignment(input);
  const second = calculateDurationAlignment(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, {
    requestedDurationMinutes: 100000,
    calculatedDurationMinutes: 89999,
  });
  assert.equal(first.durationUtilizationRatio, 0.9);
  assert.equal(
    first.durationAlignmentStatus,
    DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET
  );
  assert.equal(first.requiresCorrection, false);
});
