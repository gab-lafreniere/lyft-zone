const {
  aggregateWeeklyPlanMetrics,
  computeWeeklyPlanWorkoutMetrics,
} = require('../weeklyPlans/weeklyPlanMetrics');
const {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
  calculateDurationAlignment,
} = require('./weeklyPlanEvaluationPolicy');

const WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION = 2;
const DIRECT_TAXONOMIES = Object.freeze([
  'target_muscle',
  'muscle_focus',
  'body_part',
]);
const TAXONOMY_ORDER = Object.freeze([
  ...DIRECT_TAXONOMIES,
  'secondary_muscle',
]);
const SUPPORTED_BLOCK_TYPES = new Set(['SINGLE', 'SUPERSET', 'CARDIO']);

class WeeklyPlanAnalyticsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WeeklyPlanAnalyticsError';
    this.code = code;
    this.details = details;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeKeys(values) {
  return Array.from(
    new Set(toArray(values).map(normalizeKey).filter(Boolean))
  ).sort();
}

function normalizeFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInt(value, fallback = null) {
  const normalized = normalizeFiniteNumber(value);
  return normalized == null ? fallback : Math.trunc(normalized);
}

function roundTo(value, decimals) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sortByOrderIndex(items) {
  return toArray(items)
    .map((value, originalIndex) => ({ value, originalIndex }))
    .sort((left, right) => {
      const leftOrder = normalizeInt(left.value?.orderIndex, left.originalIndex + 1);
      const rightOrder = normalizeInt(right.value?.orderIndex, right.originalIndex + 1);
      return leftOrder - rightOrder || left.originalIndex - right.originalIndex;
    });
}

function buildPoolItemByExerciseId(context = {}) {
  const result = new Map();

  toArray(context?.exercisePoolItems).forEach((item) => {
    const exerciseId = String(item?.exerciseId ?? '').trim();
    if (exerciseId && !result.has(exerciseId)) {
      result.set(exerciseId, item);
    }
  });

  return result;
}

function createProjectionAccumulator() {
  return new Map();
}

function projectionId(taxonomy, key) {
  return `${taxonomy}\u0000${key}`;
}

function compareStrings(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function addProjectionContribution(
  accumulator,
  { taxonomy, key, directWorkingSets = 0, indirectWorkingSets = 0, workoutOrderIndex }
) {
  const id = projectionId(taxonomy, key);
  let entry = accumulator.get(id);

  if (!entry) {
    entry = {
      taxonomy,
      key,
      directWorkingSets: 0,
      indirectWorkingSets: 0,
      directWorkoutIndexes: new Set(),
      indirectWorkoutIndexes: new Set(),
    };
    accumulator.set(id, entry);
  }

  entry.directWorkingSets += directWorkingSets;
  entry.indirectWorkingSets += indirectWorkingSets;

  if (directWorkingSets > 0) {
    entry.directWorkoutIndexes.add(workoutOrderIndex);
  }
  if (indirectWorkingSets > 0) {
    entry.indirectWorkoutIndexes.add(workoutOrderIndex);
  }
}

function compareProjectionEntries(left, right) {
  const taxonomyDifference =
    TAXONOMY_ORDER.indexOf(left.taxonomy) - TAXONOMY_ORDER.indexOf(right.taxonomy);
  return taxonomyDifference || compareStrings(left.key, right.key);
}

function finalizeWorkoutProjections(accumulator) {
  return Array.from(accumulator.values())
    .map((entry) => ({
      taxonomy: entry.taxonomy,
      key: entry.key,
      directWorkingSets: entry.directWorkingSets,
      indirectWorkingSets: entry.indirectWorkingSets,
    }))
    .sort(compareProjectionEntries);
}

function finalizeMuscleMetrics(accumulator) {
  return Array.from(accumulator.values())
    .map((entry) => ({
      taxonomy: entry.taxonomy,
      key: entry.key,
      directWorkingSets: entry.directWorkingSets,
      indirectWorkingSets: entry.indirectWorkingSets,
      directWorkoutCount: entry.directWorkoutIndexes.size,
      indirectWorkoutCount: entry.indirectWorkoutIndexes.size,
    }))
    .sort(compareProjectionEntries);
}

function countWorkingSets(exercise = {}) {
  return toArray(exercise.setTemplates).filter(
    (setTemplate) => String(setTemplate?.setType || '').trim().toUpperCase() === 'WORKING'
  ).length;
}

function buildExerciseProjectionKeys(poolItem = {}) {
  const direct = {
    target_muscle: normalizeKeys(poolItem.targetMuscles),
    muscle_focus: normalizeKeys(poolItem.muscleFocus),
    body_part: normalizeKeys(poolItem.bodyParts),
  };
  const directKeySet = new Set(DIRECT_TAXONOMIES.flatMap((taxonomy) => direct[taxonomy]));
  const indirect = normalizeKeys(poolItem.secondaryMuscles).filter(
    (key) => !directKeySet.has(key)
  );

  return {
    direct,
    indirect,
    hasDirectMetadata: DIRECT_TAXONOMIES.some((taxonomy) => direct[taxonomy].length > 0),
  };
}

function addExerciseProjections({
  globalAccumulator,
  workoutAccumulator,
  poolItem,
  workingSetCount,
  workoutOrderIndex,
}) {
  const keys = buildExerciseProjectionKeys(poolItem);

  DIRECT_TAXONOMIES.forEach((taxonomy) => {
    keys.direct[taxonomy].forEach((key) => {
      const contribution = {
        taxonomy,
        key,
        directWorkingSets: workingSetCount,
        workoutOrderIndex,
      };
      addProjectionContribution(globalAccumulator, contribution);
      addProjectionContribution(workoutAccumulator, contribution);
    });
  });

  keys.indirect.forEach((key) => {
    const contribution = {
      taxonomy: 'secondary_muscle',
      key,
      indirectWorkingSets: workingSetCount,
      workoutOrderIndex,
    };
    addProjectionContribution(globalAccumulator, contribution);
    addProjectionContribution(workoutAccumulator, contribution);
  });

  return keys.hasDirectMetadata;
}

function getCardioDurationMinutes(block = {}) {
  const exercise = toArray(block.exercises)[0];
  const durationMinutes = normalizeInt(exercise?.cardioPrescription?.durationMinutes, 0);

  if (
    !exercise?.exerciseId ||
    !String(exercise.exerciseName || '').trim() ||
    durationMinutes <= 0
  ) {
    return 0;
  }

  return durationMinutes;
}

function buildProjectionLookup(muscleMetrics) {
  const lookup = new Map();

  muscleMetrics.forEach((entry) => {
    lookup.set(projectionId(entry.taxonomy, entry.key), entry);
  });

  return lookup;
}

function resolveComparisonStatus(generatedValue, targetValue) {
  if (generatedValue < targetValue) {
    return 'below_target';
  }
  if (generatedValue > targetValue) {
    return 'above_target';
  }
  return 'within_target';
}

function buildTargetComparisonItems(
  targets,
  projectionLookup,
  taxonomy,
  valueKey,
  targetValueKey
) {
  return toArray(targets)
    .map((target, targetIndex) => {
      const area = normalizeKey(target?.area);
      const targetValue = normalizeFiniteNumber(target?.[targetValueKey]);
      const projection = area
        ? projectionLookup.get(projectionId(taxonomy, area)) || null
        : null;

      if (!projection || targetValue == null) {
        return {
          targetIndex,
          area,
          resolvedTaxonomy: taxonomy,
          targetValue,
          generatedDirectValue: null,
          difference: null,
          absoluteDifference: null,
          relativeDifference: null,
          status: 'unavailable',
        };
      }

      const generatedDirectValue = projection[valueKey];
      const difference = generatedDirectValue - targetValue;

      return {
        targetIndex,
        area,
        resolvedTaxonomy: projection.taxonomy,
        targetValue,
        generatedDirectValue,
        difference,
        absoluteDifference: Math.abs(difference),
        relativeDifference:
          targetValue === 0 ? null : roundTo(difference / targetValue, 4),
        status: resolveComparisonStatus(generatedDirectValue, targetValue),
      };
    })
    .sort((left, right) => compareStrings(left.area, right.area) || left.targetIndex - right.targetIndex);
}

function summarizeTargetComparisons(items) {
  const summary = {
    targetCount: items.length,
    belowTargetCount: 0,
    withinTargetCount: 0,
    aboveTargetCount: 0,
    unavailableCount: 0,
  };

  items.forEach((item) => {
    switch (item.status) {
      case 'below_target':
        summary.belowTargetCount += 1;
        break;
      case 'within_target':
        summary.withinTargetCount += 1;
        break;
      case 'above_target':
        summary.aboveTargetCount += 1;
        break;
      default:
        summary.unavailableCount += 1;
    }
  });

  return summary;
}

function combineTargetComparisonSummaries(groups) {
  return Object.values(groups).reduce(
    (overall, group) => {
      Object.keys(overall).forEach((key) => {
        overall[key] += group.summary[key];
      });
      return overall;
    },
    summarizeTargetComparisons([])
  );
}

function buildExplicitTargetComparisonGroup({
  targets,
  projectionLookup,
  taxonomy,
  valueKey,
  targetValueKey,
}) {
  const items = buildTargetComparisonItems(
    targets,
    projectionLookup,
    taxonomy,
    valueKey,
    targetValueKey
  );

  return {
    items,
    summary: summarizeTargetComparisons(items),
  };
}

function buildTargetComparisons(generatedAIOutput, muscleMetrics) {
  const projectionLookup = buildProjectionLookup(muscleMetrics);
  const volume = {
    bodyParts: buildExplicitTargetComparisonGroup({
      targets: generatedAIOutput?.volumeTargets?.bodyParts,
      projectionLookup,
      taxonomy: 'body_part',
      valueKey: 'directWorkingSets',
      targetValueKey: 'targetSetsPerWeek',
    }),
    muscleFocuses: buildExplicitTargetComparisonGroup({
      targets: generatedAIOutput?.volumeTargets?.muscleFocuses,
      projectionLookup,
      taxonomy: 'muscle_focus',
      valueKey: 'directWorkingSets',
      targetValueKey: 'targetSetsPerWeek',
    }),
  };
  const frequency = {
    bodyParts: buildExplicitTargetComparisonGroup({
      targets: generatedAIOutput?.frequencyTargets?.bodyParts,
      projectionLookup,
      taxonomy: 'body_part',
      valueKey: 'directWorkoutCount',
      targetValueKey: 'targetSessionsPerWeek',
    }),
    muscleFocuses: buildExplicitTargetComparisonGroup({
      targets: generatedAIOutput?.frequencyTargets?.muscleFocuses,
      projectionLookup,
      taxonomy: 'muscle_focus',
      valueKey: 'directWorkoutCount',
      targetValueKey: 'targetSessionsPerWeek',
    }),
  };

  return {
    volume: {
      ...volume,
      overallSummary: combineTargetComparisonSummaries(volume),
    },
    frequency: {
      ...frequency,
      overallSummary: combineTargetComparisonSummaries(frequency),
    },
  };
}

function assertGeneratedPlanDocument(generatedPlanDocument) {
  if (
    !generatedPlanDocument ||
    typeof generatedPlanDocument !== 'object' ||
    Array.isArray(generatedPlanDocument) ||
    !Array.isArray(generatedPlanDocument.workouts)
  ) {
    throw new WeeklyPlanAnalyticsError(
      'INVALID_GENERATED_PLAN_DOCUMENT',
      'generatedPlanDocument.workouts must be an array'
    );
  }
}

function hasCanonicalEvaluationPolicyIdentity(evaluationPolicy) {
  return (
    evaluationPolicy &&
    typeof evaluationPolicy === 'object' &&
    !Array.isArray(evaluationPolicy) &&
    evaluationPolicy.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    evaluationPolicy.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  );
}

function assertCanonicalEvaluationPolicy(context) {
  if (!hasCanonicalEvaluationPolicyIdentity(context?.evaluationPolicy)) {
    throw new WeeklyPlanAnalyticsError(
      'INVALID_WEEKLY_PLAN_EVALUATION_POLICY',
      'Weekly Plan Analytics V2 requires the canonical evaluation policy identity'
    );
  }
}

function createDurationAlignmentStatusCounts() {
  return Object.values(DURATION_ALIGNMENT_STATUS).reduce((counts, status) => {
    counts[status] = 0;
    return counts;
  }, {});
}

function copyDurationAlignmentStatusCounts(statusCounts = {}) {
  return Object.values(DURATION_ALIGNMENT_STATUS).reduce((counts, status) => {
    counts[status] = statusCounts[status];
    return counts;
  }, {});
}

function calculateWeeklyPlanAnalytics({
  generatedAIOutput = null,
  generatedPlanDocument,
  context,
} = {}) {
  assertGeneratedPlanDocument(generatedPlanDocument);
  assertCanonicalEvaluationPolicy(context);

  const poolItemByExerciseId = buildPoolItemByExerciseId(context);
  const globalProjectionAccumulator = createProjectionAccumulator();
  const unresolvedExerciseIds = new Set();
  const uniqueExerciseIds = new Set();
  let totalStrengthWorkingSets = 0;
  let attributedStrengthWorkingSets = 0;
  let blockCount = 0;
  let strengthExerciseCount = 0;
  let cardioExerciseCount = 0;
  let totalSetTemplateCount = 0;
  let workingSetCount = 0;
  let singleBlockCount = 0;
  let supersetBlockCount = 0;
  let cardioBlockCount = 0;
  let cardioDurationMinutes = 0;
  let hasUnattributedStrengthExercise = false;
  const requestedDurationMinutes = context.availability?.durationPerSession;
  const requestedDurationProbe = calculateDurationAlignment({
    requestedDurationMinutes,
    calculatedDurationMinutes: 0,
  });
  const hasValidRequestedDuration =
    requestedDurationProbe.durationAlignmentStatus !==
    DURATION_ALIGNMENT_STATUS.UNAVAILABLE;
  const requestedDurationMinutesPerWorkout =
    requestedDurationProbe.requestedDurationMinutes;

  const orderedWorkouts = sortByOrderIndex(generatedPlanDocument.workouts);
  const workoutAnalytics = orderedWorkouts.map(({ value: workout, originalIndex }) => {
    const workoutOrderIndex = normalizeInt(workout?.orderIndex, originalIndex + 1);
    const historicalMetrics = computeWeeklyPlanWorkoutMetrics(workout);
    const workoutProjectionAccumulator = createProjectionAccumulator();
    let workoutStrengthExerciseCount = 0;
    let workoutCardioExerciseCount = 0;
    let workoutWorkingSetCount = 0;
    let workoutSetTemplateCount = 0;
    let workoutSupersetCount = 0;
    let workoutCardioDurationMinutes = 0;
    const blocks = toArray(workout?.blocks);

    blockCount += blocks.length;

    blocks.forEach((block, blockIndex) => {
      const blockType = String(block?.blockType || '').trim().toUpperCase();
      if (!SUPPORTED_BLOCK_TYPES.has(blockType)) {
        throw new WeeklyPlanAnalyticsError(
          'UNSUPPORTED_BLOCK_TYPE',
          'weekly plan analytics received an unsupported block type',
          {
            path: `workouts[${originalIndex}].blocks[${blockIndex}].blockType`,
            blockType,
          }
        );
      }

      const exercises = toArray(block.exercises);

      if (blockType === 'CARDIO') {
        cardioBlockCount += 1;
        workoutCardioExerciseCount += exercises.length;
        cardioExerciseCount += exercises.length;
        const blockCardioDurationMinutes = getCardioDurationMinutes(block);
        workoutCardioDurationMinutes += blockCardioDurationMinutes;
        cardioDurationMinutes += blockCardioDurationMinutes;

        exercises.forEach((exercise) => {
          const exerciseId = String(exercise?.exerciseId ?? '').trim();
          if (exerciseId) {
            uniqueExerciseIds.add(exerciseId);
          }
        });
        return;
      }

      if (blockType === 'SINGLE') {
        singleBlockCount += 1;
      } else {
        supersetBlockCount += 1;
        workoutSupersetCount += 1;
      }

      exercises.forEach((exercise) => {
        workoutStrengthExerciseCount += 1;
        strengthExerciseCount += 1;

        const exerciseId = String(exercise?.exerciseId ?? '').trim();
        if (exerciseId) {
          uniqueExerciseIds.add(exerciseId);
        }

        const setTemplateCount = toArray(exercise?.setTemplates).length;
        const exerciseWorkingSetCount = countWorkingSets(exercise);
        workoutSetTemplateCount += setTemplateCount;
        totalSetTemplateCount += setTemplateCount;
        workoutWorkingSetCount += exerciseWorkingSetCount;
        workingSetCount += exerciseWorkingSetCount;
        totalStrengthWorkingSets += exerciseWorkingSetCount;

        if (exerciseWorkingSetCount <= 0) {
          return;
        }

        const poolItem = poolItemByExerciseId.get(exerciseId);
        const attributed = poolItem
          ? addExerciseProjections({
              globalAccumulator: globalProjectionAccumulator,
              workoutAccumulator: workoutProjectionAccumulator,
              poolItem,
              workingSetCount: exerciseWorkingSetCount,
              workoutOrderIndex,
            })
          : false;

        if (attributed) {
          attributedStrengthWorkingSets += exerciseWorkingSetCount;
        } else {
          hasUnattributedStrengthExercise = true;
          if (exerciseId) {
            unresolvedExerciseIds.add(exerciseId);
          }
        }
      });
    });

    const declaredEstimatedDurationMinutes = normalizeFiniteNumber(
      workout?.estimatedDurationMinutes
    );
    const calculatedDurationMinutes = historicalMetrics.estimatedDurationMinutes;
    const durationAlignment = calculateDurationAlignment({
      requestedDurationMinutes,
      calculatedDurationMinutes,
    });
    const muscleProjections = finalizeWorkoutProjections(workoutProjectionAccumulator);

    return {
      workoutOrderIndex,
      blockCount: blocks.length,
      strengthExerciseCount: workoutStrengthExerciseCount,
      cardioExerciseCount: workoutCardioExerciseCount,
      workingSetCount: workoutWorkingSetCount,
      totalSetTemplateCount: workoutSetTemplateCount,
      requestedDurationMinutes: durationAlignment.requestedDurationMinutes,
      calculatedDurationMinutes,
      durationDifferenceMinutes: durationAlignment.durationDifferenceMinutes,
      durationUtilizationRatio: durationAlignment.durationUtilizationRatio,
      durationAlignmentStatus: durationAlignment.durationAlignmentStatus,
      durationRequiresCorrection: durationAlignment.requiresCorrection,
      declaredEstimatedDurationMinutes,
      declaredDurationDifferenceMinutes:
        declaredEstimatedDurationMinutes == null
          ? null
          : calculatedDurationMinutes - declaredEstimatedDurationMinutes,
      estimatedDurationMinutes: calculatedDurationMinutes,
      supersetCount: workoutSupersetCount,
      cardioDurationMinutes: workoutCardioDurationMinutes,
      muscleProjections,
      muscleExposure: {
        direct: muscleProjections
          .filter((entry) => entry.directWorkingSets > 0)
          .map(({ taxonomy, key }) => ({ taxonomy, key })),
        indirect: muscleProjections
          .filter((entry) => entry.indirectWorkingSets > 0)
          .map(({ taxonomy, key }) => ({ taxonomy, key })),
      },
    };
  });

  const historicalAggregate = aggregateWeeklyPlanMetrics(
    orderedWorkouts.map(({ value }) => value)
  );
  const muscleMetrics = finalizeMuscleMetrics(globalProjectionAccumulator);
  const targetComparisons = buildTargetComparisons(generatedAIOutput, muscleMetrics);
  const calculatedDurations = workoutAnalytics.map(
    (workout) => workout.calculatedDurationMinutes
  );
  const declaredDurations = workoutAnalytics.map(
    (workout) => workout.declaredEstimatedDurationMinutes
  );
  const hasCompleteDeclaredDuration = declaredDurations.every((value) => value != null);
  const calculatedDurationMinutesTotal = calculatedDurations.reduce(
    (sum, value) => sum + value,
    0
  );
  const calculatedDurationMinutesAverage = historicalAggregate.averageDurationMinutes;
  const requestedDurationMinutesTotal = hasValidRequestedDuration
    ? requestedDurationMinutesPerWorkout * workoutAnalytics.length
    : null;
  const declaredEstimatedDurationMinutesTotal = hasCompleteDeclaredDuration
    ? declaredDurations.reduce((sum, value) => sum + value, 0)
    : null;
  const durationDifferenceMinutesTotal =
    requestedDurationMinutesTotal == null
      ? null
      : calculatedDurationMinutesTotal - requestedDurationMinutesTotal;
  const declaredDurationDifferenceMinutesTotal =
    declaredEstimatedDurationMinutesTotal == null
      ? null
      : calculatedDurationMinutesTotal - declaredEstimatedDurationMinutesTotal;
  const durationAlignmentStatusCounts = createDurationAlignmentStatusCounts();
  let correctionRequiredWorkoutCount = 0;

  workoutAnalytics.forEach((workout) => {
    durationAlignmentStatusCounts[workout.durationAlignmentStatus] += 1;
    if (workout.durationRequiresCorrection) {
      correctionRequiredWorkoutCount += 1;
    }
  });
  const coverageRatio =
    totalStrengthWorkingSets === 0
      ? 1
      : roundTo(attributedStrengthWorkingSets / totalStrengthWorkingSets, 4);
  const sortedUnresolvedExerciseIds = Array.from(unresolvedExerciseIds).sort();
  const declaredSessionsPerWeek = normalizeInt(generatedPlanDocument.sessionsPerWeek, null);

  return {
    schemaVersion: WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
    status: hasUnattributedStrengthExercise ? 'partial' : 'complete',
    evaluationPolicy: {
      id: WEEKLY_PLAN_EVALUATION_POLICY_ID,
      version: WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
    },
    methods: {
      duration: 'historical_weekly_plan_metrics_v1',
      muscleVolume: 'full_direct_sets_separate_indirect_v1',
      frequency: 'deduplicated_workout_exposure_v1',
      targetComparison: 'exact_match_no_tolerance_v1',
    },
    plan: {
      workoutCount: workoutAnalytics.length,
      blockCount,
      exerciseCount: strengthExerciseCount + cardioExerciseCount,
      strengthExerciseCount,
      cardioExerciseCount,
      uniqueExerciseCount: uniqueExerciseIds.size,
      workingSetCount,
      totalSetTemplateCount,
      requestedDurationMinutesPerWorkout,
      requestedDurationMinutesTotal,
      calculatedDurationMinutesTotal,
      calculatedDurationMinutesAverage,
      declaredEstimatedDurationMinutesTotal,
      durationDifferenceMinutesTotal,
      declaredDurationDifferenceMinutesTotal,
      durationAlignmentStatusCounts,
      correctionRequiredWorkoutCount,
      estimatedDurationMinutesTotal: calculatedDurationMinutesTotal,
      estimatedDurationMinutesAverage: calculatedDurationMinutesAverage,
      minWorkoutDurationMinutes:
        calculatedDurations.length > 0 ? Math.min(...calculatedDurations) : 0,
      maxWorkoutDurationMinutes:
        calculatedDurations.length > 0 ? Math.max(...calculatedDurations) : 0,
      declaredSessionsPerWeek,
      sessionsMatchWorkoutCount:
        declaredSessionsPerWeek != null && declaredSessionsPerWeek === workoutAnalytics.length,
      splitType: normalizeKey(generatedAIOutput?.splitType) || null,
      singleBlockCount,
      supersetBlockCount,
      cardioBlockCount,
      cardioDurationMinutes,
      bodyPartDistribution: historicalAggregate.muscleDistribution,
    },
    workouts: workoutAnalytics,
    muscleMetrics,
    metadataCoverage: {
      totalStrengthWorkingSets,
      attributedStrengthWorkingSets,
      coverageRatio,
      unresolvedExerciseIds: sortedUnresolvedExerciseIds,
    },
    targetComparisons,
  };
}

function buildWeeklyPlanAnalyticsAuditSummary(analytics) {
  const volumeComparisons = analytics?.targetComparisons?.volume;
  const frequencyComparisons = analytics?.targetComparisons?.frequency;
  if (
    !analytics ||
    typeof analytics !== 'object' ||
    analytics.schemaVersion !== WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION ||
    !hasCanonicalEvaluationPolicyIdentity(analytics.evaluationPolicy) ||
    !analytics.plan ||
    !analytics.metadataCoverage ||
    !analytics.targetComparisons ||
    !volumeComparisons?.bodyParts?.summary ||
    !volumeComparisons?.muscleFocuses?.summary ||
    !volumeComparisons?.overallSummary ||
    !frequencyComparisons?.bodyParts?.summary ||
    !frequencyComparisons?.muscleFocuses?.summary ||
    !frequencyComparisons?.overallSummary
  ) {
    throw new WeeklyPlanAnalyticsError(
      'INVALID_WEEKLY_PLAN_ANALYTICS',
      'A valid weekly plan analytics result is required'
    );
  }

  const plan = analytics.plan;
  const metadataCoverage = analytics.metadataCoverage;

  return {
    schemaVersion: analytics.schemaVersion,
    status: analytics.status,
    evaluationPolicy: {
      id: analytics.evaluationPolicy.id,
      version: analytics.evaluationPolicy.version,
    },
    counts: {
      workoutCount: plan.workoutCount,
      blockCount: plan.blockCount,
      exerciseCount: plan.exerciseCount,
      strengthExerciseCount: plan.strengthExerciseCount,
      cardioExerciseCount: plan.cardioExerciseCount,
      uniqueExerciseCount: plan.uniqueExerciseCount,
      workingSetCount: plan.workingSetCount,
      totalSetTemplateCount: plan.totalSetTemplateCount,
      singleBlockCount: plan.singleBlockCount,
      supersetBlockCount: plan.supersetBlockCount,
      cardioBlockCount: plan.cardioBlockCount,
    },
    duration: {
      requestedDurationMinutesPerWorkout: plan.requestedDurationMinutesPerWorkout,
      requestedDurationMinutesTotal: plan.requestedDurationMinutesTotal,
      calculatedDurationMinutesTotal: plan.calculatedDurationMinutesTotal,
      calculatedDurationMinutesAverage: plan.calculatedDurationMinutesAverage,
      declaredEstimatedDurationMinutesTotal: plan.declaredEstimatedDurationMinutesTotal,
      durationDifferenceMinutesTotal: plan.durationDifferenceMinutesTotal,
      declaredDurationDifferenceMinutesTotal:
        plan.declaredDurationDifferenceMinutesTotal,
      estimatedDurationMinutesTotal: plan.estimatedDurationMinutesTotal,
      estimatedDurationMinutesAverage: plan.estimatedDurationMinutesAverage,
      minWorkoutDurationMinutes: plan.minWorkoutDurationMinutes,
      maxWorkoutDurationMinutes: plan.maxWorkoutDurationMinutes,
      cardioDurationMinutes: plan.cardioDurationMinutes,
      durationAlignmentStatusCounts: copyDurationAlignmentStatusCounts(
        plan.durationAlignmentStatusCounts
      ),
      correctionRequiredWorkoutCount: plan.correctionRequiredWorkoutCount,
    },
    muscleMetadata: {
      totalStrengthWorkingSets: metadataCoverage.totalStrengthWorkingSets,
      attributedStrengthWorkingSets: metadataCoverage.attributedStrengthWorkingSets,
      coverageRatio: metadataCoverage.coverageRatio,
      unresolvedExerciseCount: toArray(metadataCoverage.unresolvedExerciseIds).length,
    },
    targetComparisons: {
      volume: {
        bodyParts: {
          ...volumeComparisons.bodyParts.summary,
        },
        muscleFocuses: {
          ...volumeComparisons.muscleFocuses.summary,
        },
        overallSummary: {
          ...volumeComparisons.overallSummary,
        },
      },
      frequency: {
        bodyParts: {
          ...frequencyComparisons.bodyParts.summary,
        },
        muscleFocuses: {
          ...frequencyComparisons.muscleFocuses.summary,
        },
        overallSummary: {
          ...frequencyComparisons.overallSummary,
        },
      },
    },
  };
}

module.exports = {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
  WeeklyPlanAnalyticsError,
  buildWeeklyPlanAnalyticsAuditSummary,
  calculateWeeklyPlanAnalytics,
};
