const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
} = require('../weeklyPlans/weeklyPlanMetrics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  calculateDurationAlignment,
} = require('./weeklyPlanEvaluationPolicy');
const {
  calculateWeeklyPlanAnalytics,
} = require('./weeklyPlanAnalytics');

const TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION = 1;
const MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS = 6000;

class WeeklyPlanTrainingMetricsPromptProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WeeklyPlanTrainingMetricsPromptProjectionError';
  }
}

function invalidProjection(message) {
  return new WeeklyPlanTrainingMetricsPromptProjectionError(message);
}

function getFiniteUpperBound(band = {}) {
  if (Number.isFinite(band.maxInclusive)) {
    return band.maxInclusive;
  }
  if (Number.isFinite(band.maxExclusive)) {
    return band.maxExclusive;
  }
  return null;
}

function buildIntegerRange(values, label) {
  if (!values.length) {
    throw invalidProjection(`${label} duration range is unavailable`);
  }

  const minimum = values[0];
  const maximum = values[values.length - 1];
  if (values.length !== maximum - minimum + 1) {
    throw invalidProjection(`${label} duration range is not contiguous`);
  }

  return { minimum, maximum };
}

function projectDurationRanges(
  requestedMinutes,
  evaluationPolicy,
  calculateAlignment
) {
  if (!Number.isInteger(requestedMinutes) || requestedMinutes <= 0) {
    throw invalidProjection('A positive integer requested duration is required');
  }

  const bands = evaluationPolicy?.duration?.alignment?.bands;
  if (!Array.isArray(bands) || bands.length === 0) {
    throw invalidProjection('Canonical duration alignment bands are required');
  }

  const acceptableBands = bands.filter(
    (band) => band?.requiresCorrection === false
  );
  const finiteUpperBounds = acceptableBands
    .map(getFiniteUpperBound)
    .filter(Number.isFinite);

  if (
    acceptableBands.length === 0 ||
    finiteUpperBounds.length !== acceptableBands.length
  ) {
    throw invalidProjection('Canonical non-correction bands must be bounded');
  }

  const maximumRatio = Math.max(...finiteUpperBounds);
  const maximumCandidateMinutes = Math.ceil(requestedMinutes * maximumRatio) + 1;
  const acceptableMinutes = [];
  const preferredMinutes = [];

  for (let minutes = 0; minutes <= maximumCandidateMinutes; minutes += 1) {
    const alignment = calculateAlignment({
      requestedDurationMinutes: requestedMinutes,
      calculatedDurationMinutes: minutes,
    });
    const matchingBand = acceptableBands.find(
      (band) => band.status === alignment.durationAlignmentStatus
    );

    if (matchingBand) {
      acceptableMinutes.push(minutes);
      if (matchingBand.status === 'preferred') {
        preferredMinutes.push(minutes);
      }
    }
  }

  return {
    requestedMinutes,
    acceptableMinutes: buildIntegerRange(acceptableMinutes, 'Acceptable'),
    preferredMinutes: buildIntegerRange(preferredMinutes, 'Preferred'),
  };
}

function parseTempoFromDescriptor(value, tempoDescriptor = {}) {
  const maxDigits = tempoDescriptor.maxDigits;
  if (!Number.isInteger(maxDigits) || maxDigits <= 0) {
    throw invalidProjection('Canonical tempo descriptor is invalid');
  }

  const digits = String(value || '').replace(/\D/g, '').slice(0, maxDigits);
  if (!digits) {
    return 0;
  }

  const normalized =
    digits.length === 3 ? `${digits}0` : digits.padEnd(maxDigits, '0');
  return normalized
    .split('')
    .reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);
}

function buildDurationExample(durationDescriptor) {
  const setCount = 3;
  const repsPerSet = 8;
  const tempo = '3010';
  const restSeconds = 150;
  const single = durationDescriptor.blocks.SINGLE;
  const secondsPerMinute = durationDescriptor.blocks.CARDIO.secondsPerMinute;
  const tempoSecondsPerRep = parseTempoFromDescriptor(
    tempo,
    durationDescriptor.tempo
  );
  const tutSeconds = setCount * repsPerSet * tempoSecondsPerRep;
  const restOccurrences = Math.max(setCount - 1, 0);
  const rawRestSeconds = restSeconds * restOccurrences;
  const adjustedRestSeconds = rawRestSeconds * single.restIntervalMultiplier;
  const totalSeconds =
    tutSeconds + adjustedRestSeconds + single.fixedBlockSeconds;
  const minutesBeforeRounding = totalSeconds / secondsPerMinute;

  return {
    blockType: 'SINGLE',
    inputs: { setCount, repsPerSet, tempo, restSeconds },
    tempoSecondsPerRep,
    tutSeconds,
    restOccurrences,
    rawRestSeconds,
    adjustedRestSeconds,
    fixedBlockSeconds: single.fixedBlockSeconds,
    totalSeconds,
    minutesBeforeRounding,
    roundedMinutes: Math.round(minutesBeforeRounding),
  };
}

function createWorkingSet(setIndex) {
  return {
    setIndex,
    setType: 'WORKING',
    targetReps: 10,
    minReps: null,
    maxReps: null,
    tempo: '2011',
    restSeconds: 60,
  };
}

function buildAnalyticsProbe(evaluationPolicy, calculateAnalytics) {
  const exerciseId = 'training_metrics_guidance_face_pull';
  const bodyParts = ['shoulders', 'back'];
  const muscleFocus = ['rear_delts', 'upper_back'];
  const generatedAIOutput = {
    volumeTargets: {
      bodyParts: bodyParts.map((area) => ({ area, targetSetsPerWeek: 2 })),
      muscleFocuses: muscleFocus.map((area) => ({ area, targetSetsPerWeek: 2 })),
    },
    frequencyTargets: {
      bodyParts: bodyParts.map((area) => ({ area, targetSessionsPerWeek: 1 })),
      muscleFocuses: muscleFocus.map((area) => ({ area, targetSessionsPerWeek: 1 })),
    },
  };
  const generatedPlanDocument = {
    name: 'Training metrics guidance probe',
    sessionsPerWeek: 1,
    workouts: [
      {
        name: 'Probe workout',
        orderIndex: 1,
        estimatedDurationMinutes: 1,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            restSeconds: 60,
            exercises: [
              {
                exerciseId,
                exerciseName: 'Face Pull',
                orderIndex: 1,
                defaultTempo: '2011',
                defaultRestSeconds: 60,
                setTemplates: [createWorkingSet(1), createWorkingSet(2)],
              },
            ],
          },
        ],
      },
    ],
  };
  const context = {
    availability: { sessionsPerWeek: 1, durationPerSession: 30 },
    evaluationPolicy,
    exercisePoolItems: [
      {
        exerciseId,
        bodyParts,
        muscleFocus,
        targetMuscles: ['posterior_deltoid'],
        secondaryMuscles: ['trapezius_middle'],
      },
    ],
  };

  return calculateAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context,
  });
}

function findMetric(analytics, taxonomy, key) {
  return analytics.muscleMetrics.find(
    (entry) => entry.taxonomy === taxonomy && entry.key === key
  );
}

function firstResolvedTaxonomy(group) {
  return group.items[0]?.resolvedTaxonomy || null;
}

function buildTargetGuidance(evaluationPolicy, calculateAnalytics) {
  const analytics = buildAnalyticsProbe(evaluationPolicy, calculateAnalytics);
  const volumePolicy = evaluationPolicy.volume;
  const frequencyPolicy = evaluationPolicy.frequency;
  const targetPolicy = evaluationPolicy.targetResolution;
  const bodyParts = ['shoulders', 'back'];
  const muscleFocus = ['rear_delts', 'upper_back'];

  return {
    methods: {
      volume: analytics.methods.muscleVolume,
      frequency: analytics.methods.frequency,
      comparison: analytics.methods.targetComparison,
    },
    countedSetType: volumePolicy.countedSetType,
    setTypeNormalization: volumePolicy.setTypeNormalization,
    fullWorkingSetCreditPerKey:
      volumePolicy.direct.contribution === 'full_working_set_count_per_key',
    divideCreditAcrossKeys: false,
    frequencyUnit: frequencyPolicy.unit,
    deduplicateWithinWorkout: frequencyPolicy.deduplicateWithinWorkout,
    exactNormalizedKeyMatch: targetPolicy.match,
    comparisonTolerance: targetPolicy.comparisonTolerance,
    generatedValueSource: targetPolicy.generatedValueSource,
    groups: [
      {
        targetGroup: 'volumeTargets.bodyParts',
        taxonomy: firstResolvedTaxonomy(
          analytics.targetComparisons.volume.bodyParts
        ),
        generatedMetric: 'directWorkingSets',
      },
      {
        targetGroup: 'volumeTargets.muscleFocuses',
        taxonomy: firstResolvedTaxonomy(
          analytics.targetComparisons.volume.muscleFocuses
        ),
        generatedMetric: 'directWorkingSets',
      },
      {
        targetGroup: 'frequencyTargets.bodyParts',
        taxonomy: firstResolvedTaxonomy(
          analytics.targetComparisons.frequency.bodyParts
        ),
        generatedMetric: 'directWorkoutCount',
      },
      {
        targetGroup: 'frequencyTargets.muscleFocuses',
        taxonomy: firstResolvedTaxonomy(
          analytics.targetComparisons.frequency.muscleFocuses
        ),
        generatedMetric: 'directWorkoutCount',
      },
    ],
    forbiddenTargetAuthorities: [
      'targetMuscles',
      'secondaryMuscles',
      'muscleActivation',
      'normalizedShare',
    ],
    example: {
      exercise: 'Face Pull',
      workingSets: 2,
      bodyParts: Object.fromEntries(
        bodyParts.map((key) => [
          key,
          findMetric(analytics, 'body_part', key).directWorkingSets,
        ])
      ),
      muscleFocus: Object.fromEntries(
        muscleFocus.map((key) => [
          key,
          findMetric(analytics, 'muscle_focus', key).directWorkingSets,
        ])
      ),
      directFrequency: Object.fromEntries(
        [...bodyParts.map((key) => ['body_part', key]), ...muscleFocus.map((key) => ['muscle_focus', key])]
          .map(([taxonomy, key]) => [
            key,
            findMetric(analytics, taxonomy, key).directWorkoutCount,
          ])
      ),
    },
  };
}

function buildWeeklyPlanTrainingMetricsPromptProjection(
  { requestedDurationMinutes, evaluationPolicy = WEEKLY_PLAN_EVALUATION_POLICY } = {},
  dependencies = {}
) {
  const durationDescriptor =
    dependencies.durationDescriptor ||
    evaluationPolicy?.duration?.calculation ||
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR;
  const calculateAnalytics =
    dependencies.calculateWeeklyPlanAnalytics || calculateWeeklyPlanAnalytics;
  const calculateAlignment =
    dependencies.calculateDurationAlignment || calculateDurationAlignment;

  if (
    !durationDescriptor ||
    typeof durationDescriptor !== 'object' ||
    !durationDescriptor.blocks?.SINGLE ||
    !durationDescriptor.blocks?.SUPERSET ||
    !durationDescriptor.blocks?.CARDIO
  ) {
    throw invalidProjection('Canonical duration descriptor is required');
  }

  const single = durationDescriptor.blocks.SINGLE;
  const superset = durationDescriptor.blocks.SUPERSET;
  const cardio = durationDescriptor.blocks.CARDIO;
  const guidance = {
    schemaVersion: TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
    duration: {
      methodId: durationDescriptor.id,
      declaredDuration: {
        field: durationDescriptor.output.field,
        contributesToBackendDuration: false,
      },
      repetitions: {
        valuePrecedence: [...durationDescriptor.repetitions.valuePrecedence],
        selectionOperation: durationDescriptor.repetitions.selectionOperation,
        invalidBehavior: durationDescriptor.repetitions.nonPositiveOrNonFiniteBehavior,
      },
      tempo: { ...durationDescriptor.tempo },
      blocks: {
        SINGLE: {
          formula: `tutSeconds + restSeconds * restOccurrences * ${single.restIntervalMultiplier} + ${single.fixedBlockSeconds}`,
          setCountSource: single.setCountSource,
          tempoSourcePrecedence: [...single.tempoSourcePrecedence],
          restSourcePrecedence: [...single.restSourcePrecedence],
          restOccurrences: single.restOccurrences,
          restIntervalMultiplier: single.restIntervalMultiplier,
          fixedBlockSeconds: single.fixedBlockSeconds,
        },
        SUPERSET: {
          formula: `allLaneTutSeconds + blockRestSeconds * restOccurrences * ${superset.restIntervalMultiplier} + ${superset.fixedBlockSeconds}`,
          roundCountSourcePrecedence: [...superset.roundCountSourcePrecedence],
          laneSetWindow: superset.laneSetWindow,
          tempoSourcePrecedence: [...superset.tempoSourcePrecedence],
          restSource: superset.restSource,
          restOccurrences: superset.restOccurrences,
          betweenLaneRest: superset.betweenLaneRest,
          restIntervalMultiplier: superset.restIntervalMultiplier,
          fixedBlockSeconds: superset.fixedBlockSeconds,
        },
        CARDIO: {
          formula: `truncatedDurationMinutes * ${cardio.secondsPerMinute}`,
          durationSource: cardio.durationSource,
          durationSourceOperation: cardio.durationSourceOperation,
          secondsPerMinute: cardio.secondsPerMinute,
          fixedBlockSeconds: cardio.fixedBlockSeconds,
        },
      },
      workoutTotal: {
        operation: 'sum_all_block_seconds_then_round_once',
        rounding: durationDescriptor.output.rounding,
        nonPositiveTotalBehavior: durationDescriptor.output.nonPositiveTotalBehavior,
      },
      ranges: projectDurationRanges(
        requestedDurationMinutes,
        evaluationPolicy,
        calculateAlignment
      ),
      example: buildDurationExample(durationDescriptor),
    },
    targets: buildTargetGuidance(evaluationPolicy, calculateAnalytics),
    declarationOnlyChanges: {
      fields: [
        'estimatedDurationMinutes',
        'planName',
        'focus',
        'strategySummary',
        'rationales',
        'other prose',
      ],
      changeBackendMetrics: false,
      validMetricCorrection: false,
    },
  };

  if (JSON.stringify(guidance).length > MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS) {
    throw invalidProjection('Training Metrics Guidance exceeds its size limit');
  }

  return guidance;
}

module.exports = {
  MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
  TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
  WeeklyPlanTrainingMetricsPromptProjectionError,
  buildWeeklyPlanTrainingMetricsPromptProjection,
};
