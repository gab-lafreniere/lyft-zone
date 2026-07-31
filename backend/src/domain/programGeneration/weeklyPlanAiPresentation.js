const AI_WEEKLY_PLAN_PRESENTATION_SCHEMA_VERSION = 1;
const STRATEGY_SUMMARY_MAX_LENGTH = 500;
const SPLIT_TYPE_MAX_LENGTH = 64;
const WORKOUT_NAME_MAX_LENGTH = 160;
const WORKOUT_FOCUS_MAX_LENGTH = 160;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalString(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizePositiveInteger(value, fallback = null) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : fallback;
}

function normalizeNonNegativeInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

function normalizeStringList(value) {
  const seen = new Set();

  return toArray(value).reduce((result, entry) => {
    const normalized = normalizeOptionalString(entry, WORKOUT_NAME_MAX_LENGTH);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }, []);
}

function buildFocusAreas(context) {
  const priorities = context?.musclePriorityProfile || {};
  const primary = normalizeOptionalString(
    priorities.primaryFocus,
    WORKOUT_NAME_MAX_LENGTH
  );
  const deprioritized = normalizeOptionalString(
    priorities.deprioritizedArea,
    WORKOUT_NAME_MAX_LENGTH
  );

  return {
    primary: primary ? [primary] : [],
    secondary: normalizeStringList(priorities.secondaryFocuses),
    deprioritized: deprioritized ? [deprioritized] : [],
  };
}

function buildEntriesByOrderIndex(entries, orderIndexKey) {
  return toArray(entries).reduce((result, entry, index) => {
    const orderIndex = normalizePositiveInteger(entry?.[orderIndexKey], index + 1);
    if (!result.has(orderIndex)) {
      result.set(orderIndex, entry);
    }
    return result;
  }, new Map());
}

function countWorkoutExercises(workout) {
  return toArray(workout?.blocks).reduce(
    (total, block) => total + toArray(block?.exercises).length,
    0
  );
}

function countWorkoutWorkingSets(workout) {
  return toArray(workout?.blocks).reduce(
    (workoutTotal, block) =>
      workoutTotal +
      toArray(block?.exercises).reduce(
        (blockTotal, exercise) =>
          blockTotal +
          toArray(exercise?.setTemplates).filter(
            (setTemplate) =>
              typeof setTemplate?.setType === 'string' &&
              setTemplate.setType.trim().toUpperCase() === 'WORKING'
          ).length,
        0
      ),
    0
  );
}

function resolveExerciseCount(analyticsWorkout, generatedPlanWorkout) {
  const directCount = normalizeNonNegativeInteger(analyticsWorkout?.exerciseCount);
  if (directCount !== null) {
    return directCount;
  }

  const strengthExerciseCount = normalizeNonNegativeInteger(
    analyticsWorkout?.strengthExerciseCount
  );
  const cardioExerciseCount = normalizeNonNegativeInteger(
    analyticsWorkout?.cardioExerciseCount
  );

  if (strengthExerciseCount !== null && cardioExerciseCount !== null) {
    return strengthExerciseCount + cardioExerciseCount;
  }

  return countWorkoutExercises(generatedPlanWorkout);
}

function resolveWorkingSetCount(analyticsWorkout, generatedPlanWorkout) {
  return (
    normalizeNonNegativeInteger(analyticsWorkout?.workingSetCount) ??
    countWorkoutWorkingSets(generatedPlanWorkout)
  );
}

function buildWorkoutPresentation({
  generatedPlanWorkout,
  generatedAIWorkout,
  analyticsWorkout,
  orderIndex,
}) {
  return {
    orderIndex,
    name: normalizeOptionalString(
      generatedPlanWorkout?.name,
      WORKOUT_NAME_MAX_LENGTH
    ),
    focus: normalizeOptionalString(
      generatedAIWorkout?.focus,
      WORKOUT_FOCUS_MAX_LENGTH
    ),
    calculatedDurationMinutes: normalizeNonNegativeInteger(
      analyticsWorkout?.calculatedDurationMinutes
    ),
    exerciseCount: resolveExerciseCount(
      analyticsWorkout,
      generatedPlanWorkout
    ),
    workingSetCount: resolveWorkingSetCount(
      analyticsWorkout,
      generatedPlanWorkout
    ),
  };
}

function buildAIWeeklyPlanPresentation({
  context = null,
  generatedAIOutput = null,
  generatedPlanDocument = null,
  analytics = null,
} = {}) {
  const generatedAIWorkoutsByOrderIndex = buildEntriesByOrderIndex(
    generatedAIOutput?.workouts,
    'orderIndex'
  );
  const analyticsWorkoutsByOrderIndex = buildEntriesByOrderIndex(
    analytics?.workouts,
    'workoutOrderIndex'
  );
  const orderedPlanWorkouts = toArray(generatedPlanDocument?.workouts)
    .map((workout, index) => ({
      workout,
      originalIndex: index,
      orderIndex: normalizePositiveInteger(workout?.orderIndex, index + 1),
    }))
    .sort(
      (left, right) =>
        left.orderIndex - right.orderIndex ||
        left.originalIndex - right.originalIndex
    );

  return {
    schemaVersion: AI_WEEKLY_PLAN_PRESENTATION_SCHEMA_VERSION,
    strategySummary: normalizeOptionalString(
      generatedAIOutput?.strategySummary,
      STRATEGY_SUMMARY_MAX_LENGTH
    ),
    splitType: normalizeOptionalString(
      generatedAIOutput?.splitType,
      SPLIT_TYPE_MAX_LENGTH
    ),
    focusAreas: buildFocusAreas(context),
    workouts: orderedPlanWorkouts.map(({ workout, orderIndex }) =>
      buildWorkoutPresentation({
        generatedPlanWorkout: workout,
        generatedAIWorkout:
          generatedAIWorkoutsByOrderIndex.get(orderIndex) || null,
        analyticsWorkout:
          analyticsWorkoutsByOrderIndex.get(orderIndex) || null,
        orderIndex,
      })
    ),
  };
}

module.exports = {
  AI_WEEKLY_PLAN_PRESENTATION_SCHEMA_VERSION,
  buildAIWeeklyPlanPresentation,
};
