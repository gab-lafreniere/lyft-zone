const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
} = require('../weeklyPlans/weeklyPlanMetrics');

const WEEKLY_PLAN_EVALUATION_POLICY_ID =
  'lyft_zone_weekly_plan_evaluation_policy';
const WEEKLY_PLAN_EVALUATION_POLICY_VERSION = 1;
const DURATION_UTILIZATION_RATIO_DECIMALS = 4;
const DURATION_ALIGNMENT_THRESHOLD = Object.freeze({
  ACCEPTABLE_MIN: 0.85,
  PREFERRED_MIN: 0.9,
  PREFERRED_MAX: 1,
  ACCEPTABLE_MAX: 1.05,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const DURATION_ALIGNMENT_STATUS = deepFreeze({
  CORRECTION_REQUIRED_UNDER_TARGET: 'correction_required_under_target',
  ACCEPTABLE_UNDER_TARGET: 'acceptable_under_target',
  PREFERRED: 'preferred',
  ACCEPTABLE_OVER_TARGET: 'acceptable_over_target',
  CORRECTION_REQUIRED_OVER_TARGET: 'correction_required_over_target',
  UNAVAILABLE: 'unavailable',
});

const WEEKLY_PLAN_EVALUATION_POLICY = deepFreeze({
  id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
  version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  scope: 'ai_weekly_plan_builder_v1',
  duration: {
    target: {
      field: 'durationPerSession',
      semantics: 'target_minutes_per_workout',
    },
    calculation: WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
    alignment: {
      differenceOperation: 'calculated_minus_requested',
      ratioOperation: 'calculated_divided_by_requested',
      classificationRatio: 'unrounded',
      exposedRatioDecimals: DURATION_UTILIZATION_RATIO_DECIMALS,
      bands: [
        {
          status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET,
          minInclusive: null,
          minExclusive: null,
          maxInclusive: null,
          maxExclusive: DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MIN,
          requiresCorrection: true,
        },
        {
          status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET,
          minInclusive: DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MIN,
          minExclusive: null,
          maxInclusive: null,
          maxExclusive: DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MIN,
          requiresCorrection: false,
        },
        {
          status: DURATION_ALIGNMENT_STATUS.PREFERRED,
          minInclusive: DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MIN,
          minExclusive: null,
          maxInclusive: DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MAX,
          maxExclusive: null,
          requiresCorrection: false,
        },
        {
          status: DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET,
          minInclusive: null,
          minExclusive: DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MAX,
          maxInclusive: DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MAX,
          maxExclusive: null,
          requiresCorrection: false,
        },
        {
          status: DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET,
          minInclusive: null,
          minExclusive: DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MAX,
          maxInclusive: null,
          maxExclusive: null,
          requiresCorrection: true,
        },
      ],
      unavailable: {
        status: DURATION_ALIGNMENT_STATUS.UNAVAILABLE,
        when: [
          'requested_duration_missing_non_finite_or_non_positive',
          'calculated_duration_missing_non_finite_or_negative',
        ],
        requiresCorrection: false,
      },
    },
  },
  volume: {
    authority: 'weeklyPlanAnalytics',
    methodId: 'full_direct_sets_separate_indirect_v1',
    countedSetType: 'WORKING',
    setTypeNormalization: 'trim_uppercase',
    cardioCounts: false,
    direct: {
      taxonomies: [
        { taxonomy: 'target_muscle', sourceField: 'targetMuscles' },
        { taxonomy: 'muscle_focus', sourceField: 'muscleFocus' },
        { taxonomy: 'body_part', sourceField: 'bodyParts' },
      ],
      deduplicateKeysPerExercise: true,
      contribution: 'full_working_set_count_per_key',
      collapseAcrossTaxonomies: false,
    },
    indirect: {
      taxonomy: 'secondary_muscle',
      sourceField: 'secondaryMuscles',
      deduplicateKeysPerExercise: true,
      excludeKeysPresentInAnyDirectTaxonomy: true,
      contribution: 'full_working_set_count_per_key',
      coefficient: null,
      combinedWithDirect: false,
    },
  },
  frequency: {
    authority: 'weeklyPlanAnalytics',
    methodId: 'deduplicated_workout_exposure_v1',
    unit: 'distinct_workouts',
    directExposureTrigger: 'direct_working_sets_greater_than_zero',
    deduplicateWithinWorkout: true,
    secondaryCountsAsDirect: false,
    indirectReportedSeparately: true,
  },
  targetResolution: {
    authority: 'weeklyPlanAnalytics',
    methodId: 'exact_match_no_tolerance_v1',
    appliesTo: ['volumeTargets', 'frequencyTargets'],
    keyNormalization: 'trim_lowercase',
    match: 'exact_normalized_key',
    resolutionOrder: ['muscle_focus', 'body_part', 'target_muscle'],
    generatedValueSource: 'direct_only',
    comparisonTolerance: null,
    comparisonStatuses: [
      'below_target',
      'within_target',
      'above_target',
      'unavailable',
    ],
    unresolvedStatus: 'unavailable',
  },
  cardio: {
    eligibilitySource: 'pool_snapshot_allowed_training_types',
    cardioRoleNoneForbidsGeneration: true,
    preferredModalitiesAreSoft: true,
    durationContribution: 'prescribed_duration_minutes',
    directVolumeContribution: 0,
    indirectVolumeContribution: 0,
    directFrequencyContribution: 0,
  },
});

function normalizeFiniteDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value === 0 ? 0 : value;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function classifyDurationUtilizationRatio(ratio) {
  if (ratio < DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MIN) {
    return DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET;
  }

  if (ratio < DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MIN) {
    return DURATION_ALIGNMENT_STATUS.ACCEPTABLE_UNDER_TARGET;
  }

  if (ratio <= DURATION_ALIGNMENT_THRESHOLD.PREFERRED_MAX) {
    return DURATION_ALIGNMENT_STATUS.PREFERRED;
  }

  if (ratio <= DURATION_ALIGNMENT_THRESHOLD.ACCEPTABLE_MAX) {
    return DURATION_ALIGNMENT_STATUS.ACCEPTABLE_OVER_TARGET;
  }

  return DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_OVER_TARGET;
}

function calculateDurationAlignment({
  requestedDurationMinutes,
  calculatedDurationMinutes,
} = {}) {
  const normalizedRequestedDurationMinutes = normalizeFiniteDuration(
    requestedDurationMinutes
  );
  const normalizedCalculatedDurationMinutes = normalizeFiniteDuration(
    calculatedDurationMinutes
  );
  const hasValidRequestedDuration =
    normalizedRequestedDurationMinutes != null &&
    normalizedRequestedDurationMinutes > 0;
  const hasValidCalculatedDuration =
    normalizedCalculatedDurationMinutes != null &&
    normalizedCalculatedDurationMinutes >= 0;

  if (!hasValidRequestedDuration || !hasValidCalculatedDuration) {
    return {
      requestedDurationMinutes: normalizedRequestedDurationMinutes,
      calculatedDurationMinutes: normalizedCalculatedDurationMinutes,
      durationDifferenceMinutes: null,
      durationUtilizationRatio: null,
      durationAlignmentStatus: DURATION_ALIGNMENT_STATUS.UNAVAILABLE,
      requiresCorrection: false,
    };
  }

  const durationDifferenceMinutes =
    normalizedCalculatedDurationMinutes - normalizedRequestedDurationMinutes;
  const unroundedDurationUtilizationRatio =
    normalizedCalculatedDurationMinutes / normalizedRequestedDurationMinutes;
  const durationAlignmentStatus = classifyDurationUtilizationRatio(
    unroundedDurationUtilizationRatio
  );
  const requiresCorrection = WEEKLY_PLAN_EVALUATION_POLICY.duration.alignment.bands.some(
    (band) =>
      band.status === durationAlignmentStatus && band.requiresCorrection === true
  );

  return {
    requestedDurationMinutes: normalizedRequestedDurationMinutes,
    calculatedDurationMinutes: normalizedCalculatedDurationMinutes,
    durationDifferenceMinutes,
    durationUtilizationRatio: roundTo(
      unroundedDurationUtilizationRatio,
      DURATION_UTILIZATION_RATIO_DECIMALS
    ),
    durationAlignmentStatus,
    requiresCorrection,
  };
}

module.exports = {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  calculateDurationAlignment,
};
