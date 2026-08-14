function adaptSimpleWeeklyPlanStructureToLegacyGeometry(
  structure,
  { sessionsPerWeek }
) {
  const workouts = [];

  for (
    let workoutIndex = 1;
    workoutIndex <= sessionsPerWeek;
    workoutIndex += 1
  ) {
    const workout = structure[`workout_${workoutIndex}`];
    workouts.push({
      name: workout.name,
      blocks: workout.blocks.map((block) => {
        if (block.type === 'SINGLE') {
          return {
            blockType: 'SINGLE',
            roundCount: null,
            setCounts: [block.setCount],
          };
        }
        if (block.type === 'SUPERSET') {
          return {
            blockType: 'SUPERSET',
            roundCount: block.setCount,
            setCounts: [block.setCount, block.setCount],
          };
        }
        if (block.type === 'CARDIO') {
          return {
            blockType: 'CARDIO',
            roundCount: null,
            setCounts: [0],
          };
        }
        throw new TypeError(`Unsupported block type: ${block.type}`);
      }),
    });
  }

  return {
    schemaVersion: 1,
    planName: structure.planName,
    workouts,
  };
}

class BoundPlanGeometryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'BoundPlanGeometryError';
    this.code = code;
    this.details = details == null
      ? []
      : Array.isArray(details) ? details : [details];
  }
}

// Projects a verified BoundPlan onto the geometry contract Step 05 already consumes.
//
// Unlike adaptSimpleWeeklyPlanStructureToLegacyGeometry, this never invents exercise
// arity: every count comes from what Call #1 actually created and Call #2 bound.
// roundCount is derived here rather than requested from the binder, so the binder is
// never asked to decide how many rounds a superset has.
//
// Callers must run verifyBoundPlan first. The assertions below therefore guard
// against a projection bug, not against source formatting drift.
function adaptBoundPlanToGeometry(boundPlan) {
  const workouts = (boundPlan?.workouts || []).map((workout, workoutIndex) => ({
    name: String(workout.name || '').trim(),
    blocks: (workout.blocks || []).map((block, blockIndex) => {
      const exercises = block.exercises || [];
      const coordinates = {
        workout: workoutIndex + 1,
        block: blockIndex + 1,
        blockType: block.blockType || block.type,
      };

      if (block.type === 'CARDIO') {
        if (exercises.length !== 1) {
          throw new BoundPlanGeometryError(
            'BOUND_PLAN_GEOMETRY_CARDIO_ARITY',
            'CARDIO blocks must hold exactly one exercise',
            { ...coordinates, received: exercises.length }
          );
        }
        return { blockType: 'CARDIO', roundCount: null, setCounts: [0] };
      }

      const setCounts = exercises.map((exercise) => exercise.sets);
      if (setCounts.some((count) => !Number.isInteger(count) || count < 1)) {
        throw new BoundPlanGeometryError(
          'BOUND_PLAN_GEOMETRY_SET_COUNT_INVALID',
          'Strength exercises must carry a positive integer set count',
          { ...coordinates, received: setCounts }
        );
      }

      if (block.type === 'SINGLE') {
        if (exercises.length !== 1) {
          throw new BoundPlanGeometryError(
            'BOUND_PLAN_GEOMETRY_SINGLE_ARITY',
            'SINGLE blocks must hold exactly one exercise',
            { ...coordinates, received: exercises.length }
          );
        }
        return { blockType: 'SINGLE', roundCount: null, setCounts };
      }

      if (block.type === 'SUPERSET') {
        if (exercises.length < 2) {
          throw new BoundPlanGeometryError(
            'BOUND_PLAN_GEOMETRY_SUPERSET_ARITY',
            'SUPERSET blocks must hold at least two exercises',
            { ...coordinates, received: exercises.length }
          );
        }
        // Product decision D4: lanes are never padded and the coach's prescription
        // is never modified. Unequal lanes must already have failed verification.
        if (new Set(setCounts).size !== 1) {
          throw new BoundPlanGeometryError(
            'BOUND_PLAN_GEOMETRY_SUPERSET_SET_COUNT_UNEQUAL',
            'SUPERSET lanes must share one set count',
            { ...coordinates, received: setCounts }
          );
        }
        return {
          blockType: 'SUPERSET',
          roundCount: setCounts[0],
          setCounts,
        };
      }

      throw new BoundPlanGeometryError(
        'BOUND_PLAN_GEOMETRY_UNSUPPORTED_BLOCK_TYPE',
        `Unsupported block type: ${block.type}`,
        coordinates
      );
    }),
  }));

  return {
    schemaVersion: 1,
    planName: String(boundPlan?.planName || '').trim(),
    workouts,
  };
}

module.exports = {
  BoundPlanGeometryError,
  adaptBoundPlanToGeometry,
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
};
