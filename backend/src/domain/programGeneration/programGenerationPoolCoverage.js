function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildEligibleExerciseCoverageCounts(
  exercises,
  field,
  canonicalValues
) {
  const counts = new Map(
    toArray(canonicalValues).map((area) => [area, new Set()])
  );

  toArray(exercises).forEach((exercise) => {
    if (
      typeof exercise?.exerciseId !== 'string' ||
      !exercise.exerciseId.trim()
    ) {
      return;
    }

    Array.from(new Set(toArray(exercise[field]))).forEach((area) => {
      if (counts.has(area)) {
        counts.get(area).add(exercise.exerciseId);
      }
    });
  });

  return new Map(
    Array.from(counts, ([area, exerciseIds]) => [
      area,
      exerciseIds.size,
    ])
  );
}

function resolveEligibleExerciseCoverageLevel(eligibleExerciseCount) {
  if (eligibleExerciseCount === 0) {
    return 'unavailable';
  }
  if (eligibleExerciseCount === 1) {
    return 'severely_limited';
  }
  if (eligibleExerciseCount === 2) {
    return 'limited';
  }
  return null;
}

module.exports = {
  buildEligibleExerciseCoverageCounts,
  resolveEligibleExerciseCoverageLevel,
};
