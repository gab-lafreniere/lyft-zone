const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
  computeWeeklyPlanWorkoutMetrics,
} = require('../weeklyPlans/weeklyPlanMetrics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  calculateDurationAlignment,
} = require('./weeklyPlanEvaluationPolicy');
const {
  calculateWeeklyPlanAnalytics,
} = require('./weeklyPlanAnalytics');
const {
  deriveAIBlockRestSeconds,
  deriveAIBlockRestStrategy,
  deriveAIBlockRoundCount,
} = require('./weeklyPlanAiNormalizer');

const TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION = 2;
const MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS = 6000;
const REFERENCE_DURATION_MODULE_MINUTES = 15;
const MAX_DURATION_EXAMPLE_MODULES = 32;

class WeeklyPlanTrainingMetricsPromptProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WeeklyPlanTrainingMetricsPromptProjectionError';
  }
}

function invalidProjection(message) {
  return new WeeklyPlanTrainingMetricsPromptProjectionError(message);
}

function toPedagogicalNumber(value, label = 'Projected numeric value') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidProjection(`${label} must be finite`);
  }

  const stableValue = Number(value.toFixed(6));
  return Object.is(stableValue, -0) ? 0 : stableValue;
}

function assertValidDurationAlignment(alignment) {
  if (
    !alignment ||
    typeof alignment !== 'object' ||
    typeof alignment.durationAlignmentStatus !== 'string' ||
    !alignment.durationAlignmentStatus ||
    typeof alignment.requiresCorrection !== 'boolean'
  ) {
    throw invalidProjection('Canonical duration alignment result is invalid');
  }

  return alignment;
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
    const alignment = assertValidDurationAlignment(
      calculateAlignment({
        requestedDurationMinutes: requestedMinutes,
        calculatedDurationMinutes: minutes,
      })
    );
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

function projectDurationBudgets(ranges, secondsPerMinute) {
  if (!Number.isFinite(secondsPerMinute) || secondsPerMinute <= 0) {
    throw invalidProjection('Canonical seconds per minute are required');
  }

  const toSeconds = (range) => ({
    minimum: toPedagogicalNumber(
      range.minimum * secondsPerMinute,
      'Minimum duration budget'
    ),
    maximum: toPedagogicalNumber(
      range.maximum * secondsPerMinute,
      'Maximum duration budget'
    ),
  });

  return {
    planningOnly: true,
    acceptableSeconds: toSeconds(ranges.acceptableMinutes),
    preferredSeconds: toSeconds(ranges.preferredMinutes),
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

function createStrengthSets({ setCount, repsPerSet, tempo, restSeconds }) {
  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    setType: 'WORKING',
    targetReps: repsPerSet,
    minReps: null,
    maxReps: null,
    tempo,
    restSeconds,
  }));
}

function createStrengthLane({
  exerciseId,
  orderIndex,
  setCount,
  repsPerSet,
  tempo,
  restSeconds,
}) {
  return {
    exerciseId,
    exerciseName: exerciseId,
    orderIndex,
    defaultTempo: tempo,
    defaultRestSeconds: restSeconds,
    setTemplates: createStrengthSets({
      setCount,
      repsPerSet,
      tempo,
      restSeconds,
    }),
  };
}

function verifyProductionMinutes({
  label,
  workout,
  totalSeconds,
  secondsPerMinute,
  calculateWorkoutMetrics,
  enabled,
  expectedSetCount = null,
  expectedMovementSeconds = null,
}) {
  const roundedMinutes = Math.round(totalSeconds / secondsPerMinute);
  if (!enabled) {
    return roundedMinutes;
  }

  if (typeof calculateWorkoutMetrics !== 'function') {
    throw invalidProjection('Canonical workout metrics calculator is required');
  }

  const production = calculateWorkoutMetrics(workout);
  if (production.estimatedDurationMinutes !== roundedMinutes) {
    throw invalidProjection(`${label} disagrees with production duration`);
  }
  if (
    expectedSetCount != null &&
    production.setCount !== expectedSetCount
  ) {
    throw invalidProjection(`${label} disagrees with production set count`);
  }
  if (
    expectedMovementSeconds != null &&
    production.totalTUTSeconds !== expectedMovementSeconds
  ) {
    throw invalidProjection(`${label} disagrees with production movement time`);
  }
  return production.estimatedDurationMinutes;
}

function buildSingleExample({
  durationDescriptor,
  calculateWorkoutMetrics,
  verifyProduction,
  deriveRestSeconds,
  deriveRestStrategy,
}) {
  const inputs = {
    setCount: 3,
    repsPerSet: 8,
    tempo: '3010',
    restSeconds: 150,
  };
  const rawBlock = {
    blockType: 'SINGLE',
    exercises: [
      createStrengthLane({
        exerciseId: 'single_example',
        orderIndex: 1,
        ...inputs,
      }),
    ],
  };
  const single = durationDescriptor.blocks.SINGLE;
  const secondsPerMinute = durationDescriptor.blocks.CARDIO.secondsPerMinute;
  const secondsPerRepetition = parseTempoFromDescriptor(
    inputs.tempo,
    durationDescriptor.tempo
  );
  const setMovementSeconds = inputs.repsPerSet * secondsPerRepetition;
  const exerciseMovementSeconds = inputs.setCount * setMovementSeconds;
  const restIntervals = Math.max(inputs.setCount - 1, 0);
  const blockRestSeconds = deriveRestSeconds(rawBlock);
  const rawRestSeconds = blockRestSeconds * restIntervals;
  const adjustedRestSeconds =
    rawRestSeconds * single.restIntervalMultiplier;
  const blockTotalSeconds =
    exerciseMovementSeconds +
    adjustedRestSeconds +
    single.fixedBlockSeconds;
  const normalizedBlock = {
    ...rawBlock,
    roundCount: null,
    restStrategy: deriveRestStrategy(rawBlock.blockType),
    restSeconds: blockRestSeconds,
  };
  const roundedMinutes = verifyProductionMinutes({
    label: 'Canonical SINGLE example',
    workout: { blocks: [normalizedBlock] },
    totalSeconds: blockTotalSeconds,
    secondsPerMinute,
    calculateWorkoutMetrics,
    enabled: verifyProduction,
  });

  return {
    example: {
      inputs,
      secondsPerRepetition: toPedagogicalNumber(secondsPerRepetition),
      setMovementSeconds: toPedagogicalNumber(setMovementSeconds),
      exerciseMovementSeconds: toPedagogicalNumber(exerciseMovementSeconds),
      restIntervals: toPedagogicalNumber(restIntervals),
      rawRestSeconds: toPedagogicalNumber(rawRestSeconds),
      adjustedRestSeconds: toPedagogicalNumber(adjustedRestSeconds),
      fixedBlockSeconds: toPedagogicalNumber(single.fixedBlockSeconds),
      blockTotalSeconds: toPedagogicalNumber(blockTotalSeconds),
      unroundedMinutes: toPedagogicalNumber(
        blockTotalSeconds / secondsPerMinute
      ),
      roundedMinutes,
    },
    normalizedBlock,
  };
}

function buildSupersetExample({
  durationDescriptor,
  calculateWorkoutMetrics,
  verifyProduction,
  deriveRoundCount,
  deriveRestSeconds,
  deriveRestStrategy,
}) {
  const inputs = {
    setCountPerLane: 4,
    laneAOrderIndex: 1,
    laneAReps: 8,
    laneBOrderIndex: 2,
    laneBReps: 10,
    tempo: '3010',
    laneADefaultRestSeconds: 150,
    laneBDefaultRestSeconds: 150,
  };
  const rawBlock = {
    blockType: 'SUPERSET',
    exercises: [
      createStrengthLane({
        exerciseId: 'superset_lane_a',
        orderIndex: inputs.laneAOrderIndex,
        setCount: inputs.setCountPerLane,
        repsPerSet: inputs.laneAReps,
        tempo: inputs.tempo,
        restSeconds: inputs.laneADefaultRestSeconds,
      }),
      createStrengthLane({
        exerciseId: 'superset_lane_b',
        orderIndex: inputs.laneBOrderIndex,
        setCount: inputs.setCountPerLane,
        repsPerSet: inputs.laneBReps,
        tempo: inputs.tempo,
        restSeconds: inputs.laneBDefaultRestSeconds,
      }),
    ],
  };
  const superset = durationDescriptor.blocks.SUPERSET;
  const secondsPerMinute = durationDescriptor.blocks.CARDIO.secondsPerMinute;
  const secondsPerRepetition = parseTempoFromDescriptor(
    inputs.tempo,
    durationDescriptor.tempo
  );
  const rounds = deriveRoundCount(rawBlock);
  const laneAMovementSeconds =
    rounds * inputs.laneAReps * secondsPerRepetition;
  const laneBMovementSeconds =
    rounds * inputs.laneBReps * secondsPerRepetition;
  const restIntervals = Math.max(rounds - 1, 0);
  const blockRestSeconds = deriveRestSeconds(rawBlock);
  const rawRestSeconds = blockRestSeconds * restIntervals;
  const adjustedRestSeconds =
    rawRestSeconds * superset.restIntervalMultiplier;
  const blockTotalSeconds =
    laneAMovementSeconds +
    laneBMovementSeconds +
    adjustedRestSeconds +
    superset.fixedBlockSeconds;
  const normalizedBlock = {
    ...rawBlock,
    roundCount: rounds,
    restStrategy: deriveRestStrategy(rawBlock.blockType),
    restSeconds: blockRestSeconds,
  };
  const roundedMinutes = verifyProductionMinutes({
    label: 'Canonical SUPERSET example',
    workout: { blocks: [normalizedBlock] },
    totalSeconds: blockTotalSeconds,
    secondsPerMinute,
    calculateWorkoutMetrics,
    enabled: verifyProduction,
    expectedSetCount: rounds * rawBlock.exercises.length,
    expectedMovementSeconds:
      laneAMovementSeconds + laneBMovementSeconds,
  });

  return {
    example: {
      arithmeticOnly: true,
      copyPrescriptions: false,
      inputs,
      secondsPerRepetition: toPedagogicalNumber(secondsPerRepetition),
      laneAMovementSeconds: toPedagogicalNumber(laneAMovementSeconds),
      laneBMovementSeconds: toPedagogicalNumber(laneBMovementSeconds),
      rounds: toPedagogicalNumber(rounds),
      restIntervals: toPedagogicalNumber(restIntervals),
      rawRestSeconds: toPedagogicalNumber(rawRestSeconds),
      adjustedRestSeconds: toPedagogicalNumber(adjustedRestSeconds),
      fixedBlockSeconds: toPedagogicalNumber(superset.fixedBlockSeconds),
      betweenLaneRestSeconds: toPedagogicalNumber(
        superset.betweenLaneRest ? blockRestSeconds : 0
      ),
      blockTotalSeconds: toPedagogicalNumber(blockTotalSeconds),
      unroundedMinutes: toPedagogicalNumber(
        blockTotalSeconds / secondsPerMinute
      ),
      roundedMinutes,
    },
    normalizedBlock,
  };
}

function buildWorkoutExample({
  requestedDurationMinutes,
  supersetExample,
  supersetNormalizedBlock,
  calculateWorkoutMetrics,
  calculateAlignment,
  verifyProduction,
  secondsPerMinute,
}) {
  const moduleCount =
    requestedDurationMinutes / REFERENCE_DURATION_MODULE_MINUTES;
  if (
    !Number.isInteger(requestedDurationMinutes) ||
    requestedDurationMinutes <= 0 ||
    !Number.isInteger(moduleCount) ||
    moduleCount <= 0 ||
    !Number.isSafeInteger(moduleCount) ||
    moduleCount > MAX_DURATION_EXAMPLE_MODULES ||
    supersetExample.roundedMinutes !== REFERENCE_DURATION_MODULE_MINUTES
  ) {
    return null;
  }

  const workoutTotalSeconds =
    moduleCount * supersetExample.blockTotalSeconds;
  const unroundedMinutes = workoutTotalSeconds / secondsPerMinute;
  const roundedMinutes = Math.round(unroundedMinutes);

  if (
    !Number.isFinite(workoutTotalSeconds) ||
    !Number.isFinite(unroundedMinutes) ||
    !Number.isSafeInteger(roundedMinutes)
  ) {
    return null;
  }

  const productionRoundedMinutes = verifyProductionMinutes({
    label: 'Canonical repeated-module workout example',
    workout: {
      blocks: Array.from(
        { length: moduleCount },
        () => structuredClone(supersetNormalizedBlock)
      ),
    },
    totalSeconds: workoutTotalSeconds,
    secondsPerMinute,
    calculateWorkoutMetrics,
    enabled: verifyProduction,
  });
  if (productionRoundedMinutes !== roundedMinutes) {
    throw invalidProjection(
      'Canonical repeated-module workout example disagrees with production duration'
    );
  }

  const alignment = assertValidDurationAlignment(
    calculateAlignment({
      requestedDurationMinutes,
      calculatedDurationMinutes: roundedMinutes,
    })
  );

  if (
    alignment.requiresCorrection ||
    alignment.durationAlignmentStatus === 'unavailable'
  ) {
    return null;
  }

  return {
    arithmeticOnly: true,
    copyPrescriptions: false,
    requestedMinutes: requestedDurationMinutes,
    referenceExample: 'superset',
    referenceModuleMinutes: REFERENCE_DURATION_MODULE_MINUTES,
    moduleCount,
    workoutTotalSeconds: toPedagogicalNumber(workoutTotalSeconds),
    unroundedMinutes: toPedagogicalNumber(unroundedMinutes),
    roundedMinutes,
    alignmentStatus: alignment.durationAlignmentStatus,
    requiresCorrection: alignment.requiresCorrection,
  };
}

function buildOutputV2Normalization({
  deriveRoundCount,
  deriveRestSeconds,
  deriveRestStrategy,
}) {
  const supersetProbe = {
    blockType: 'SUPERSET',
    exercises: [
      createStrengthLane({
        exerciseId: 'lane_a',
        orderIndex: 1,
        setCount: 3,
        repsPerSet: 8,
        tempo: '3010',
        restSeconds: 120,
      }),
      createStrengthLane({
        exerciseId: 'lane_b',
        orderIndex: 2,
        setCount: 3,
        repsPerSet: 8,
        tempo: '3010',
        restSeconds: 60,
      }),
    ],
  };

  return {
    derivedBlockFields: [
      'block.roundCount',
      'block.restSeconds',
      'block.restStrategy',
    ],
    laneAOrderIndex: 1,
    strengthDefaultsAuthoritativeInValidOutput: [
      'exercise.defaultTempo',
      'exercise.defaultRestSeconds',
    ],
    SINGLE: {
      roundCount: null,
      restSource: 'laneA.defaultRestSeconds_then_laneA.firstSetTemplate.restSeconds',
      restStrategy: deriveRestStrategy('SINGLE'),
    },
    SUPERSET: {
      roundCountSource: 'laneA.setTemplates.length',
      restSource: 'laneA.defaultRestSeconds_then_laneA.firstSetTemplate.restSeconds',
      laneBControlsRest: false,
      sample: {
        laneADefaultRestSeconds: 120,
        laneBDefaultRestSeconds: 60,
        roundCount: deriveRoundCount(supersetProbe),
        blockRestSeconds: deriveRestSeconds(supersetProbe),
      },
      restStrategy: deriveRestStrategy('SUPERSET'),
    },
    CARDIO: {
      roundCount: null,
      restSeconds: null,
      restStrategy: deriveRestStrategy('CARDIO'),
    },
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
    coachingVolume: {
      authority: 'runtime_doctrine',
      useDirectAndIndirectContributions: true,
      purpose: 'exercise_selection_recoverability_and_program_appropriateness',
    },
    reportingVolume: {
      methods: {
        volume: analytics.methods.muscleVolume,
        frequency: analytics.methods.frequency,
        comparison: analytics.methods.targetComparison,
      },
      countedSetType: volumePolicy.countedSetType,
      setTypeNormalization: volumePolicy.setTypeNormalization,
      fullWorkingSetCreditPerBodyPart:
        volumePolicy.direct.contribution === 'full_working_set_count_per_key',
      fullWorkingSetCreditPerMuscleFocus:
        volumePolicy.direct.contribution === 'full_working_set_count_per_key',
      divideCreditAcrossKeys: false,
      sameSetAcrossTaxonomiesRequired: true,
      frequencyUnit: frequencyPolicy.unit,
      deduplicateWithinWorkout: frequencyPolicy.deduplicateWithinWorkout,
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
      forbiddenAuthorities: [
        'targetMuscles',
        'secondaryMuscles',
        'muscleActivation',
        'normalizedShare',
      ],
    },
    strategicAreas: {
      onlySignificantAreas: true,
      arraysMayBeEmpty: true,
      enumerateZeroValueAreas: false,
      declaredTargetsEqualProducedPlanReporting: true,
      exactNormalizedKeyMatch: targetPolicy.match,
      comparisonTolerance: targetPolicy.comparisonTolerance,
      generatedValueSource: targetPolicy.generatedValueSource,
    },
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
        [
          ...bodyParts.map((key) => ['body_part', key]),
          ...muscleFocus.map((key) => ['muscle_focus', key]),
        ].map(([taxonomy, key]) => [
          key,
          findMetric(analytics, taxonomy, key).directWorkoutCount,
        ])
      ),
    },
  };
}

function buildWeeklyPlanTrainingMetricsPromptProjection(
  {
    requestedDurationMinutes,
    evaluationPolicy = WEEKLY_PLAN_EVALUATION_POLICY,
  } = {},
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
  const calculateWorkoutMetrics =
    dependencies.computeWeeklyPlanWorkoutMetrics ||
    computeWeeklyPlanWorkoutMetrics;
  const deriveRoundCount =
    dependencies.deriveAIBlockRoundCount || deriveAIBlockRoundCount;
  const deriveRestSeconds =
    dependencies.deriveAIBlockRestSeconds || deriveAIBlockRestSeconds;
  const deriveRestStrategy =
    dependencies.deriveAIBlockRestStrategy || deriveAIBlockRestStrategy;

  if (
    !durationDescriptor ||
    typeof durationDescriptor !== 'object' ||
    !durationDescriptor.blocks?.SINGLE ||
    !durationDescriptor.blocks?.SUPERSET ||
    !durationDescriptor.blocks?.CARDIO
  ) {
    throw invalidProjection('Canonical duration descriptor is required');
  }

  const secondsPerMinute = durationDescriptor.blocks.CARDIO.secondsPerMinute;
  const ranges = projectDurationRanges(
    requestedDurationMinutes,
    evaluationPolicy,
    calculateAlignment
  );
  const verifyProduction = dependencies.durationDescriptor == null;
  const singleExample = buildSingleExample({
    durationDescriptor,
    calculateWorkoutMetrics,
    verifyProduction,
    deriveRestSeconds,
    deriveRestStrategy,
  });
  const supersetExample = buildSupersetExample({
    durationDescriptor,
    calculateWorkoutMetrics,
    verifyProduction,
    deriveRoundCount,
    deriveRestSeconds,
    deriveRestStrategy,
  });
  const guidance = {
    schemaVersion: TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
    duration: {
      methodId: durationDescriptor.id,
      outputV2Normalization: buildOutputV2Normalization({
        deriveRoundCount,
        deriveRestSeconds,
        deriveRestStrategy,
      }),
      repetitions: {
        valuePrecedence: [...durationDescriptor.repetitions.valuePrecedence],
        invalidBehavior:
          durationDescriptor.repetitions.nonPositiveOrNonFiniteBehavior,
      },
      tempo: { ...durationDescriptor.tempo },
      blocks: {
        SINGLE: {
          setCountSource: durationDescriptor.blocks.SINGLE.setCountSource,
          tempoSourcePrecedence: [
            ...durationDescriptor.blocks.SINGLE.tempoSourcePrecedence,
          ],
          restSourcePrecedence: [
            ...durationDescriptor.blocks.SINGLE.restSourcePrecedence,
          ],
          restIntervalMultiplier:
            toPedagogicalNumber(
              durationDescriptor.blocks.SINGLE.restIntervalMultiplier
            ),
          fixedBlockSeconds:
            toPedagogicalNumber(
              durationDescriptor.blocks.SINGLE.fixedBlockSeconds
            ),
        },
        SUPERSET: {
          laneSetWindow: durationDescriptor.blocks.SUPERSET.laneSetWindow,
          tempoSourcePrecedence: [
            ...durationDescriptor.blocks.SUPERSET.tempoSourcePrecedence,
          ],
          betweenLaneRest:
            durationDescriptor.blocks.SUPERSET.betweenLaneRest,
          restIntervalMultiplier:
            toPedagogicalNumber(
              durationDescriptor.blocks.SUPERSET.restIntervalMultiplier
            ),
          fixedBlockSeconds:
            toPedagogicalNumber(
              durationDescriptor.blocks.SUPERSET.fixedBlockSeconds
            ),
        },
        CARDIO: {
          durationSource: durationDescriptor.blocks.CARDIO.durationSource,
          secondsPerMinute: toPedagogicalNumber(secondsPerMinute),
          fixedBlockSeconds:
            toPedagogicalNumber(
              durationDescriptor.blocks.CARDIO.fixedBlockSeconds
            ),
        },
      },
      workoutTotal: {
        sumBlocksBeforeConversion: true,
        secondsPerMinute: toPedagogicalNumber(secondsPerMinute),
        roundOnceAfterWorkoutTotal: true,
        rounding: durationDescriptor.output.rounding,
      },
      ranges,
      budgets: projectDurationBudgets(ranges, secondsPerMinute),
      examples: {
        single: singleExample.example,
        superset: supersetExample.example,
        workout: buildWorkoutExample({
          requestedDurationMinutes,
          supersetExample: supersetExample.example,
          supersetNormalizedBlock: supersetExample.normalizedBlock,
          calculateWorkoutMetrics,
          calculateAlignment,
          verifyProduction,
          secondsPerMinute,
        }),
      },
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
