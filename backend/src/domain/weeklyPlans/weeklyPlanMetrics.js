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

  return Math.round(totalSeconds / 60);
}

function parseTempoToSecondsPerRep(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);

  if (!digits) {
    return 0;
  }

  const normalized = digits.length === 3 ? `${digits}0` : digits.padEnd(4, '0');

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

    if (block.blockType === 'CARDIO') {
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
      totalDurationSeconds += durationMinutes * 60;
      return;
    }

    if (block.blockType === 'SINGLE') {
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
          1.15) +
        90;

      addDistributionContribution(distribution, primaryExercise.bodyParts, blockSetCount);
      return;
    }

    if (block.blockType !== 'SUPERSET') {
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
      (normalizeInt(block.restSeconds, 0) * Math.max(0, supersetSetCount - 1) * 1.15) +
      90;

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
  aggregateWeeklyPlanMetrics,
  computeWeeklyPlanWorkoutMetrics,
};
