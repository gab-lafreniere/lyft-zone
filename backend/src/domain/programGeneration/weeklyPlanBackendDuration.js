const {
  DURATION_ALIGNMENT_STATUS,
  calculateDurationAlignment,
} = require('./weeklyPlanEvaluationPolicy');

class WeeklyPlanBackendDurationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WeeklyPlanBackendDurationError';
    this.code = code;
    this.details = details;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
    );
  }

  return value;
}

function assertOrderIndex(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WeeklyPlanBackendDurationError(
      'INVALID_WORKOUT_ORDER_INDEX',
      'A positive integer workout orderIndex is required',
      { path }
    );
  }
}

function buildUniqueWorkoutMap(workouts, path) {
  const result = new Map();

  toArray(workouts).forEach((workout, index) => {
    const orderIndex = workout?.workoutOrderIndex ?? workout?.orderIndex;
    assertOrderIndex(orderIndex, `${path}[${index}]`);

    if (result.has(orderIndex)) {
      throw new WeeklyPlanBackendDurationError(
        'DUPLICATE_WORKOUT_ORDER_INDEX',
        'Workout orderIndex values must be unique',
        { path: `${path}[${index}]`, workoutOrderIndex: orderIndex }
      );
    }

    result.set(orderIndex, workout);
  });

  return result;
}

function applyBackendCalculatedDurationsToPlanDocument(
  planDocument,
  analytics
) {
  if (!planDocument || typeof planDocument !== 'object') {
    throw new WeeklyPlanBackendDurationError(
      'INVALID_PLAN_DOCUMENT',
      'A normalized weekly plan document is required'
    );
  }

  const documentWorkouts = toArray(planDocument.workouts);
  const analyticsWorkouts = toArray(analytics?.workouts);
  const documentByOrderIndex = buildUniqueWorkoutMap(
    documentWorkouts,
    'planDocument.workouts'
  );
  const analyticsByOrderIndex = buildUniqueWorkoutMap(
    analyticsWorkouts,
    'analytics.workouts'
  );

  if (documentByOrderIndex.size !== analyticsByOrderIndex.size) {
    throw new WeeklyPlanBackendDurationError(
      'WORKOUT_DURATION_COVERAGE_MISMATCH',
      'Backend Analytics must contain exactly one duration for every workout',
      {
        documentWorkoutCount: documentByOrderIndex.size,
        analyticsWorkoutCount: analyticsByOrderIndex.size,
      }
    );
  }

  analyticsByOrderIndex.forEach((_workout, orderIndex) => {
    if (!documentByOrderIndex.has(orderIndex)) {
      throw new WeeklyPlanBackendDurationError(
        'ANALYTICS_WORKOUT_NOT_FOUND',
        'Backend Analytics references a workout absent from the plan document',
        { workoutOrderIndex: orderIndex }
      );
    }
  });

  return {
    ...cloneValue(planDocument),
    workouts: documentWorkouts.map((workout) => {
      const analyticsWorkout = analyticsByOrderIndex.get(workout.orderIndex);

      if (!analyticsWorkout) {
        throw new WeeklyPlanBackendDurationError(
          'WORKOUT_ANALYTICS_MISSING',
          'Backend Analytics duration is missing for a workout',
          { workoutOrderIndex: workout.orderIndex }
        );
      }

      const calculatedDurationMinutes =
        analyticsWorkout.calculatedDurationMinutes;
      if (
        !Number.isSafeInteger(calculatedDurationMinutes) ||
        calculatedDurationMinutes < 0
      ) {
        throw new WeeklyPlanBackendDurationError(
          'INVALID_BACKEND_CALCULATED_DURATION',
          'Backend calculatedDurationMinutes must be a non-negative integer',
          { workoutOrderIndex: workout.orderIndex }
        );
      }

      return {
        ...cloneValue(workout),
        estimatedDurationMinutes: calculatedDurationMinutes,
      };
    }),
  };
}

function buildIntegerDurationRanges(requestedDurationMinutes) {
  if (
    !Number.isSafeInteger(requestedDurationMinutes) ||
    requestedDurationMinutes < 1
  ) {
    throw new WeeklyPlanBackendDurationError(
      'INVALID_REQUESTED_DURATION',
      'A positive integer requested duration is required'
    );
  }

  const upperProbe = Math.ceil(requestedDurationMinutes * 1.05) + 1;
  const acceptable = [];
  const preferred = [];

  for (let minutes = 0; minutes <= upperProbe; minutes += 1) {
    const alignment = calculateDurationAlignment({
      requestedDurationMinutes,
      calculatedDurationMinutes: minutes,
    });

    if (!alignment.requiresCorrection) {
      acceptable.push(minutes);
    }
    if (
      alignment.durationAlignmentStatus ===
      DURATION_ALIGNMENT_STATUS.PREFERRED
    ) {
      preferred.push(minutes);
    }
  }

  if (!acceptable.length || !preferred.length) {
    throw new WeeklyPlanBackendDurationError(
      'DURATION_RANGE_UNAVAILABLE',
      'Evaluation Policy did not produce integer duration ranges'
    );
  }

  return {
    acceptableDurationMinutes: {
      minimum: Math.min(...acceptable),
      maximum: Math.max(...acceptable),
    },
    preferredDurationMinutes: {
      minimum: Math.min(...preferred),
      maximum: Math.max(...preferred),
    },
  };
}

function buildDurationCorrectionDetails(analytics) {
  return toArray(analytics?.workouts)
    .filter((workout) => workout?.durationRequiresCorrection === true)
    .map((workout) => {
      const ranges = buildIntegerDurationRanges(
        workout.requestedDurationMinutes
      );
      const isUnderTarget =
        workout.durationAlignmentStatus ===
        DURATION_ALIGNMENT_STATUS.CORRECTION_REQUIRED_UNDER_TARGET;
      const minimumMinutesToAcceptableRange = isUnderTarget
        ? Math.max(
            0,
            ranges.acceptableDurationMinutes.minimum -
              workout.calculatedDurationMinutes
          )
        : Math.max(
            0,
            workout.calculatedDurationMinutes -
              ranges.acceptableDurationMinutes.maximum
          );

      return {
        workoutOrderIndex: workout.workoutOrderIndex,
        requestedDurationMinutes: workout.requestedDurationMinutes,
        calculatedDurationMinutes: workout.calculatedDurationMinutes,
        durationDifferenceMinutes: workout.durationDifferenceMinutes,
        durationUtilizationRatio: workout.durationUtilizationRatio,
        durationAlignmentStatus: workout.durationAlignmentStatus,
        ...ranges,
        direction: isUnderTarget ? 'INCREASE' : 'DECREASE',
        minimumMinutesToAcceptableRange,
        backendDurationCalculation: cloneValue(workout.durationCalculation),
      };
    });
}

function evaluateWeeklyPlanDurationGate(analytics) {
  if (!analytics || !Array.isArray(analytics.workouts)) {
    throw new WeeklyPlanBackendDurationError(
      'INVALID_WEEKLY_PLAN_ANALYTICS',
      'Backend Analytics workouts are required for the duration gate'
    );
  }

  const corrections = buildDurationCorrectionDetails(analytics);
  return {
    ok: corrections.length === 0,
    correctionRequired: corrections.length > 0,
    workouts: corrections,
  };
}

module.exports = {
  WeeklyPlanBackendDurationError,
  applyBackendCalculatedDurationsToPlanDocument,
  buildDurationCorrectionDetails,
  buildIntegerDurationRanges,
  evaluateWeeklyPlanDurationGate,
};
