const SUPPORTED_BODY_PARTS = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "shoulders", label: "Shoulders" },
  { key: "biceps", label: "Biceps" },
  { key: "triceps", label: "Triceps" },
  { key: "quadriceps", label: "Quads" },
  { key: "hamstrings", label: "Hamstrings" },
  { key: "glutes", label: "Glutes" },
  { key: "calves", label: "Calves" },
  { key: "abs", label: "Abs" },
];

function roundDisplayMinutes(totalSeconds) {
  if (totalSeconds <= 0) {
    return 0;
  }

  return Math.round(totalSeconds / 60);
}

function parseRestToSeconds(value) {
  const parsed = Number.parseInt(String(value || "").replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBodyParts(bodyParts) {
  if (!Array.isArray(bodyParts)) {
    return [];
  }

  const supportedKeys = new Set(SUPPORTED_BODY_PARTS.map((part) => part.key));

  return bodyParts
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => supportedKeys.has(value));
}

function getSetReps(set) {
  const reps = Number(set?.reps);
  return Number.isFinite(reps) && reps > 0 ? reps : 0;
}

function createEmptyDistribution(totalRealSets = 0) {
  return SUPPORTED_BODY_PARTS.map(({ key, label }) => ({
    key,
    label,
    rawSets: 0,
    normalizedShare: 0,
    percentageOfWorkout: totalRealSets > 0 ? 0 : 0,
  }));
}

function createDistributionAccumulator() {
  return Object.fromEntries(
    SUPPORTED_BODY_PARTS.map(({ key }) => [key, { rawSets: 0, normalizedShare: 0 }])
  );
}

function addDistributionContribution(accumulator, bodyParts, setCount) {
  const normalized = normalizeBodyParts(bodyParts);

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
    return createEmptyDistribution();
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

export function parseTempoToSecondsPerRep(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);

  if (!digits) {
    return 0;
  }

  const normalized = digits.length === 3 ? `${digits}0` : digits.padEnd(4, "0");

  return normalized
    .split("")
    .reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);
}

export function computeWorkoutMetrics(workout) {
  if (!workout || !Array.isArray(workout.blocks) || workout.blocks.length === 0) {
    return {
      exerciseCount: 0,
      setCount: 0,
      estimatedDurationMinutes: 0,
      totalTUTMinutes: 0,
      totalTUTSeconds: 0,
      muscleDistribution: createEmptyDistribution(),
    };
  }

  let exerciseCount = 0;
  let setCount = 0;
  let totalTUTSeconds = 0;
  let totalDurationSeconds = 0;
  const distribution = createDistributionAccumulator();

  workout.blocks.forEach((block) => {
    if (block.type === "single") {
      if (!block.exerciseId) {
        return;
      }

      const blockSets = Array.isArray(block.sets) ? block.sets : [];
      const blockSetCount = blockSets.length;

      if (blockSetCount <= 0) {
        return;
      }

      const tempoSecondsPerRep = parseTempoToSecondsPerRep(block.tempo);
      const blockTUTSeconds = blockSets.reduce(
        (sum, set) => sum + getSetReps(set) * tempoSecondsPerRep,
        0
      );

      exerciseCount += 1;
      setCount += blockSetCount;
      totalTUTSeconds += blockTUTSeconds;
      totalDurationSeconds +=
        blockTUTSeconds +
        parseRestToSeconds(block.rest) * Math.max(0, blockSetCount - 1) * 1.15 +
        90;

      addDistributionContribution(distribution, block.bodyParts, blockSetCount);
      return;
    }

    if (block.type !== "superset") {
      return;
    }

    const populatedExercises = (block.exercises || []).filter((exercise) => exercise.exerciseId);
    const populatedLaneCount = populatedExercises.length;
    const supersetSetCount = Math.max(0, Number(block.sets) || 0);

    if (populatedLaneCount <= 0 || supersetSetCount <= 0) {
      return;
    }

    const blockTUTSeconds = populatedExercises.reduce((sum, exercise) => {
      const laneSets = Array.isArray(exercise.sets)
        ? exercise.sets.slice(0, supersetSetCount)
        : [];
      const laneTempoSecondsPerRep = parseTempoToSecondsPerRep(exercise.tempo);

      return (
        sum +
        laneSets.reduce(
          (laneSum, set) => laneSum + getSetReps(set) * laneTempoSecondsPerRep,
          0
        )
      );
    }, 0);

    exerciseCount += populatedLaneCount;
    setCount += supersetSetCount * populatedLaneCount;
    totalTUTSeconds += blockTUTSeconds;
    totalDurationSeconds +=
      blockTUTSeconds +
      parseRestToSeconds(block.rest) * Math.max(0, supersetSetCount - 1) * 1.15 +
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
    muscleDistribution: finalizeDistribution(distribution, setCount),
  };
}

export function aggregateWorkoutMetrics(workouts = []) {
  const workoutMetrics = workouts.map((workout) => computeWorkoutMetrics(workout));
  const nonEmptyWorkouts = workoutMetrics.filter((metrics) => metrics.setCount > 0);
  const distribution = createDistributionAccumulator();

  const totalExerciseCount = workoutMetrics.reduce(
    (sum, metrics) => sum + metrics.exerciseCount,
    0
  );
  const totalSetCount = workoutMetrics.reduce((sum, metrics) => sum + metrics.setCount, 0);
  const totalDurationMinutes = workoutMetrics.reduce(
    (sum, metrics) => sum + metrics.estimatedDurationMinutes,
    0
  );
  const totalTUTSeconds = workoutMetrics.reduce(
    (sum, metrics) => sum + metrics.totalTUTSeconds,
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
            nonEmptyWorkouts.reduce(
              (sum, metrics) => sum + metrics.totalTUTMinutes,
              0
            ) / nonEmptyWorkouts.length
          )
        : 0,
    totalTUTSeconds,
    muscleDistribution: finalizeDistribution(distribution, totalSetCount),
    nonEmptyWorkoutCount: nonEmptyWorkouts.length,
  };
}
