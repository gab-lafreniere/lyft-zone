const {
  prepareAIWeeklyPlanDraftForCreate,
} = require('../../../services/weeklyPlansService');
const {
  aggregateWeeklyPlanMetrics,
  computeWeeklyPlanWorkoutMetrics,
} = require('../weeklyPlans/weeklyPlanMetrics');

function summarizeWeeklyPlan(document = {}) {
  const workouts = Array.isArray(document.workouts) ? document.workouts : [];
  let blockCount = 0;
  let exerciseCount = 0;
  let setTemplateCount = 0;

  workouts.forEach((workout) => {
    const blocks = Array.isArray(workout.blocks) ? workout.blocks : [];
    blockCount += blocks.length;
    blocks.forEach((block) => {
      const exercises = Array.isArray(block.exercises) ? block.exercises : [];
      exerciseCount += exercises.length;
      exercises.forEach((exercise) => {
        setTemplateCount += Array.isArray(exercise.setTemplates)
          ? exercise.setTemplates.length
          : 0;
      });
    });
  });

  return {
    workoutCount: workouts.length,
    blockCount,
    exerciseCount,
    setTemplateCount,
  };
}

function buildWeeklyPlanMetrics(document = {}) {
  const workouts = Array.isArray(document.workouts) ? document.workouts : [];
  const workoutMetrics = workouts.map((workout, index) => {
    const metrics = computeWeeklyPlanWorkoutMetrics(workout);
    return {
      workoutIndex: index + 1,
      name: String(workout?.name || ''),
      exerciseCount: metrics.exerciseCount,
      setCount: metrics.setCount,
      estimatedDurationMinutes: metrics.estimatedDurationMinutes,
      totalTUTMinutes: metrics.totalTUTMinutes,
      totalTUTSeconds: metrics.totalTUTSeconds,
      muscleDistribution: metrics.muscleDistribution,
    };
  });
  const weeklyMetrics = aggregateWeeklyPlanMetrics(workouts);
  const strengthWorkouts = workoutMetrics.filter(
    (metrics) => metrics.setCount > 0
  );

  return {
    weekly: {
      totalExerciseCount: weeklyMetrics.totalExerciseCount,
      totalSetCount: weeklyMetrics.totalSetCount,
      averageDurationMinutes: weeklyMetrics.averageDurationMinutes,
      averageTUTMinutes:
        strengthWorkouts.length > 0
          ? Math.round(
            strengthWorkouts.reduce(
              (sum, metrics) => sum + metrics.totalTUTMinutes,
              0
            ) / strengthWorkouts.length
          )
          : 0,
      totalTUTSeconds: workoutMetrics.reduce(
        (sum, metrics) => sum + metrics.totalTUTSeconds,
        0
      ),
      muscleDistribution: weeklyMetrics.muscleDistribution,
    },
    workouts: workoutMetrics,
  };
}

async function validateFinalWeeklyPlan({
  completedDocument,
  runtimeUserId,
  preflight = prepareAIWeeklyPlanDraftForCreate,
}) {
  const summary = summarizeWeeklyPlan(completedDocument);

  try {
    await preflight({
      userId: runtimeUserId,
      source: 'AI',
      ...completedDocument,
    });

    return {
      valid: true,
      validationStage: 'FINAL_WEEKLY_PLAN_VALIDATION',
      validator: {
        name: 'prepareAIWeeklyPlanDraftForCreate',
        mode: 'draft',
      },
      errors: [],
      warnings: [],
      summary,
      metrics: buildWeeklyPlanMetrics(completedDocument),
    };
  } catch (error) {
    return {
      valid: false,
      validationStage: 'FINAL_WEEKLY_PLAN_VALIDATION',
      validator: {
        name: 'prepareAIWeeklyPlanDraftForCreate',
        mode: 'draft',
      },
      errors: [
        {
          path: error?.path || null,
          code: error?.code || 'FINAL_WEEKLY_PLAN_VALIDATION_FAILED',
          message: error?.message || 'Final weekly plan validation failed',
          received: error?.received,
          expected: error?.expected,
        },
      ],
      warnings: error?.path
        ? []
        : [
          {
            code: 'LIMITED_VALIDATOR_ERROR_GRANULARITY',
            message:
              'The current Weekly Plan preflight does not always provide a structured path.',
          },
        ],
      summary,
    };
  }
}

module.exports = {
  buildWeeklyPlanMetrics,
  summarizeWeeklyPlan,
  validateFinalWeeklyPlan,
};
