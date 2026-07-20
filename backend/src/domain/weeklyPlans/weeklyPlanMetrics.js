const WEEKLY_PLAN_DURATION_METHOD_ID = 'historical_weekly_plan_metrics_v1';
const DURATION_SECONDS_PER_MINUTE = 60;
const DURATION_REST_INTERVAL_MULTIPLIER = 1.15;
const DURATION_FIXED_BLOCK_SECONDS = 90;
const DURATION_TEMPO_MAX_DIGITS = 4;
const DURATION_TEMPO_THREE_DIGIT_LENGTH = 3;
const DURATION_BLOCK_TYPE = Object.freeze({
  SINGLE: 'SINGLE',
  SUPERSET: 'SUPERSET',
  CARDIO: 'CARDIO',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR = deepFreeze({
  id: WEEKLY_PLAN_DURATION_METHOD_ID,
  output: {
    field: 'estimatedDurationMinutes',
    unit: 'minutes',
    rounding: 'nearest_integer_half_up_after_workout_total',
    nonPositiveTotalBehavior: 'zero',
  },
  tempo: {
    digitExtraction: 'first_four_decimal_digits',
    maxDigits: DURATION_TEMPO_MAX_DIGITS,
    threeDigitBehavior: 'append_zero',
    otherShortLengthBehavior: 'right_pad_zero',
    missingBehavior: 'zero_seconds_per_rep',
    secondsPerRepOperation: 'sum_normalized_digits',
  },
  repetitions: {
    valuePrecedence: ['targetReps', 'maxReps', 'minReps', 'zero'],
    selectionOperation: 'nullish_precedence_then_number_conversion',
    nonPositiveOrNonFiniteBehavior: 'zero',
  },
  blocks: {
    [DURATION_BLOCK_TYPE.SINGLE]: {
      exerciseSelection: 'first_exercise',
      includeWhen: [
        'exercise_id_present',
        'exercise_name_non_empty',
        'set_template_count_positive',
      ],
      setCountSource: 'all_set_templates',
      tempoSourcePrecedence: ['exercise.defaultTempo', 'firstSet.tempo'],
      tempoSourceOperation: 'nullish_precedence',
      tutOperation: 'sum_selected_reps_times_tempo_seconds',
      restSourcePrecedence: [
        'block.restSeconds',
        'exercise.defaultRestSeconds',
        'firstSet.restSeconds',
        'zero',
      ],
      restSourceOperation: 'nullish_precedence_then_finite_number_truncate',
      restOccurrences: 'max_set_count_minus_one_zero',
      restIntervalMultiplier: DURATION_REST_INTERVAL_MULTIPLIER,
      fixedBlockSeconds: DURATION_FIXED_BLOCK_SECONDS,
    },
    [DURATION_BLOCK_TYPE.SUPERSET]: {
      exerciseSelection: 'all_populated_exercises',
      populatedExerciseRequires: ['exercise_id_present', 'exercise_name_non_empty'],
      roundCountSourcePrecedence: [
        'block.roundCount',
        'firstPopulatedExercise.setTemplates.length',
        'zero',
      ],
      roundCountSourceOperation: 'truthy_precedence_then_clamp_min_zero',
      laneSetWindow: 'first_round_count_set_templates',
      tempoSourcePrecedence: ['exercise.defaultTempo', 'laneFirstSet.tempo'],
      tempoSourceOperation: 'nullish_precedence',
      tutOperation: 'sum_all_populated_lane_tut_seconds',
      setCountOperation: 'round_count_times_populated_lane_count',
      restSource: 'block.restSeconds',
      restSourceOperation: 'finite_number_truncate_else_zero',
      restOccurrences: 'max_round_count_minus_one_zero',
      restIntervalMultiplier: DURATION_REST_INTERVAL_MULTIPLIER,
      fixedBlockSeconds: DURATION_FIXED_BLOCK_SECONDS,
      betweenLaneRest: false,
    },
    [DURATION_BLOCK_TYPE.CARDIO]: {
      exerciseSelection: 'first_exercise',
      includeWhen: [
        'exercise_id_present',
        'exercise_name_non_empty',
        'positive_duration_minutes',
      ],
      durationSource: 'cardioPrescription.durationMinutes',
      durationSourceOperation: 'finite_number_truncate_else_zero',
      durationOperation: 'truncated_minutes_times_seconds_per_minute',
      secondsPerMinute: DURATION_SECONDS_PER_MINUTE,
      fixedBlockSeconds: 0,
      setCountContribution: 0,
      tutSecondsContribution: 0,
    },
  },
  unsupportedBlocks: {
    definition: 'block_type_other_than_single_superset_or_cardio',
    behavior: 'ignored',
  },
});

const SUPPORTED_BODY_PARTS = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'quadriceps', label: 'Quads' },
  { key: 'hamstrings', label: 'Hamstrings' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'calves', label: 'Calves' },
  { key: 'abs', label: 'Abs' },
];

function normalizeInt(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value) {
  return normalizeArray(value)
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function roundDisplayMinutes(totalSeconds) {
  if (totalSeconds <= 0) {
    return 0;
  }

  return Math.round(totalSeconds / DURATION_SECONDS_PER_MINUTE);
}

function parseTempoToSecondsPerRep(value) {
  const digits = String(value || '')
    .replace(/\D/g, '')
    .slice(0, DURATION_TEMPO_MAX_DIGITS);

  if (!digits) {
    return 0;
  }

  const normalized =
    digits.length === DURATION_TEMPO_THREE_DIGIT_LENGTH
      ? `${digits}0`
      : digits.padEnd(DURATION_TEMPO_MAX_DIGITS, '0');

  return normalized
    .split('')
    .reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);
}

function getSetReps(setTemplate) {
  const reps = Number(
    setTemplate?.targetReps ??
      setTemplate?.maxReps ??
      setTemplate?.minReps ??
      0
  );

  return Number.isFinite(reps) && reps > 0 ? reps : 0;
}

function normalizeBodyPartsForMetrics(value) {
  const supportedKeys = new Set(SUPPORTED_BODY_PARTS.map((part) => part.key));

  return normalizeStringArray(value).filter((entry) => supportedKeys.has(entry));
}

function createDistributionAccumulator() {
  return Object.fromEntries(
    SUPPORTED_BODY_PARTS.map(({ key }) => [key, { rawSets: 0, normalizedShare: 0 }])
  );
}

function addDistributionContribution(accumulator, bodyParts, setCount) {
  const normalized = normalizeBodyPartsForMetrics(bodyParts);

  if (!normalized.length || setCount <= 0) {
    return;
  }

  const sharePerBodyPart = 1 / normalized.length;
  normalized.forEach((bodyPart) => {
    accumulator[bodyPart].rawSets += setCount;
    accumulator[bodyPart].normalizedShare += setCount * sharePerBodyPart;
  });
}

function finalizeDistribution(accumulator, totalRealSets) {
  if (totalRealSets <= 0) {
    return SUPPORTED_BODY_PARTS.map(({ key, label }) => ({
      key,
      label,
      rawSets: 0,
      normalizedShare: 0,
      percentageOfWorkout: 0,
    }));
  }

  return SUPPORTED_BODY_PARTS.map(({ key, label }) => ({
    key,
    label,
    rawSets: accumulator[key].rawSets,
    normalizedShare: accumulator[key].normalizedShare,
    percentageOfWorkout: Math.min(
      100,
      (accumulator[key].normalizedShare / totalRealSets) * 100
    ),
  }));
}

function computeWeeklyPlanWorkoutMetrics(workout) {
  if (!workout || !Array.isArray(workout.blocks) || workout.blocks.length === 0) {
    return {
      exerciseCount: 0,
      setCount: 0,
      estimatedDurationMinutes: 0,
      totalTUTMinutes: 0,
      totalTUTSeconds: 0,
      hasContent: false,
      muscleDistribution: finalizeDistribution(createDistributionAccumulator(), 0),
    };
  }

  let exerciseCount = 0;
  let setCount = 0;
  let totalTUTSeconds = 0;
  let totalDurationSeconds = 0;
  const distribution = createDistributionAccumulator();

  workout.blocks.forEach((block) => {
    const exercises = normalizeArray(block.exercises);

    if (block.blockType === DURATION_BLOCK_TYPE.CARDIO) {
      const cardioExercise = exercises[0];
      const durationMinutes = normalizeInt(
        cardioExercise?.cardioPrescription?.durationMinutes,
        0
      );

      if (
        !cardioExercise?.exerciseId ||
        !String(cardioExercise.exerciseName || '').trim() ||
        durationMinutes <= 0
      ) {
        return;
      }

      exerciseCount += 1;
      totalDurationSeconds += durationMinutes * DURATION_SECONDS_PER_MINUTE;
      return;
    }

    if (block.blockType === DURATION_BLOCK_TYPE.SINGLE) {
      const primaryExercise = exercises[0];
      if (!primaryExercise?.exerciseId || !String(primaryExercise.exerciseName || '').trim()) {
        return;
      }

      const setTemplates = normalizeArray(primaryExercise.setTemplates);
      const blockSetCount = setTemplates.length;

      if (blockSetCount <= 0) {
        return;
      }

      const tempoValue =
        primaryExercise.defaultTempo ??
        setTemplates[0]?.tempo ??
        null;
      const tempoSecondsPerRep = parseTempoToSecondsPerRep(tempoValue);
      const blockTUTSeconds = setTemplates.reduce(
        (sum, setTemplate) => sum + getSetReps(setTemplate) * tempoSecondsPerRep,
        0
      );

      exerciseCount += 1;
      setCount += blockSetCount;
      totalTUTSeconds += blockTUTSeconds;
      totalDurationSeconds +=
        blockTUTSeconds +
        (normalizeInt(
          block.restSeconds ??
            primaryExercise.defaultRestSeconds ??
            setTemplates[0]?.restSeconds,
          0
        ) *
          Math.max(0, blockSetCount - 1) *
          DURATION_REST_INTERVAL_MULTIPLIER) +
        DURATION_FIXED_BLOCK_SECONDS;

      addDistributionContribution(distribution, primaryExercise.bodyParts, blockSetCount);
      return;
    }

    if (block.blockType !== DURATION_BLOCK_TYPE.SUPERSET) {
      return;
    }

    const populatedExercises = exercises.filter(
      (exercise) => exercise.exerciseId && String(exercise.exerciseName || '').trim()
    );
    const populatedLaneCount = populatedExercises.length;

    if (populatedLaneCount <= 0) {
      return;
    }

    const supersetSetCount = Math.max(
      0,
      block.roundCount || populatedExercises[0]?.setTemplates?.length || 0
    );

    if (supersetSetCount <= 0) {
      return;
    }

    const blockTUTSeconds = populatedExercises.reduce((sum, exercise) => {
      const laneSets = normalizeArray(exercise.setTemplates).slice(0, supersetSetCount);
      const laneTempoSecondsPerRep = parseTempoToSecondsPerRep(
        exercise.defaultTempo ?? laneSets[0]?.tempo
      );

      return (
        sum +
        laneSets.reduce(
          (laneSum, setTemplate) => laneSum + getSetReps(setTemplate) * laneTempoSecondsPerRep,
          0
        )
      );
    }, 0);

    exerciseCount += populatedLaneCount;
    setCount += supersetSetCount * populatedLaneCount;
    totalTUTSeconds += blockTUTSeconds;
    totalDurationSeconds +=
      blockTUTSeconds +
      (normalizeInt(block.restSeconds, 0) *
        Math.max(0, supersetSetCount - 1) *
        DURATION_REST_INTERVAL_MULTIPLIER) +
      DURATION_FIXED_BLOCK_SECONDS;

    populatedExercises.forEach((exercise) => {
      addDistributionContribution(distribution, exercise.bodyParts, supersetSetCount);
    });
  });

  return {
    exerciseCount,
    setCount,
    estimatedDurationMinutes: roundDisplayMinutes(totalDurationSeconds),
    totalTUTMinutes: roundDisplayMinutes(totalTUTSeconds),
    totalTUTSeconds,
    hasContent: exerciseCount > 0,
    muscleDistribution: finalizeDistribution(distribution, setCount),
  };
}

function aggregateWeeklyPlanMetrics(workouts = []) {
  const workoutMetrics = workouts.map((workout) => computeWeeklyPlanWorkoutMetrics(workout));
  const nonEmptyWorkouts = workoutMetrics.filter((metrics) => metrics.hasContent);
  const distribution = createDistributionAccumulator();

  const totalExerciseCount = workoutMetrics.reduce((sum, metrics) => sum + metrics.exerciseCount, 0);
  const totalSetCount = workoutMetrics.reduce((sum, metrics) => sum + metrics.setCount, 0);
  const totalDurationMinutes = workoutMetrics.reduce(
    (sum, metrics) => sum + metrics.estimatedDurationMinutes,
    0
  );

  workoutMetrics.forEach((metrics) => {
    metrics.muscleDistribution.forEach((entry) => {
      distribution[entry.key].rawSets += entry.rawSets;
      distribution[entry.key].normalizedShare += entry.normalizedShare;
    });
  });

  return {
    totalExerciseCount,
    totalSetCount,
    averageDurationMinutes:
      nonEmptyWorkouts.length > 0
        ? Math.round(totalDurationMinutes / nonEmptyWorkouts.length)
        : 0,
    averageTUTMinutes:
      nonEmptyWorkouts.length > 0
        ? Math.round(
            nonEmptyWorkouts.reduce((sum, metrics) => sum + metrics.totalTUTMinutes, 0) /
              nonEmptyWorkouts.length
          )
        : 0,
    muscleDistribution: finalizeDistribution(distribution, totalSetCount),
  };
}

module.exports = {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
  WEEKLY_PLAN_DURATION_METHOD_ID,
  aggregateWeeklyPlanMetrics,
  computeWeeklyPlanWorkoutMetrics,
};
