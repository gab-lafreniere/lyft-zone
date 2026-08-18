// Shared, Prisma-agnostic diff/apply engine for the two whole-document draft
// autosave paths (Cycle's Plan/PlanWeek/Workout tree and Weekly Plan's
// WeeklyPlanVersion/WeeklyPlanWorkout tree). Extracted from cyclesService.js,
// where this logic was originally built and proven against
// cyclesServiceDraftDiffScope.test.js.
//
// This module never touches Prisma directly. Callers inject:
//   - `options.extraExerciseFields(exercise) => object` -- extra scalar
//     fields to fold into the normalized/comparable exercise shape. Cycle
//     passes nothing (BlockExercise carries no exercise-name/body-part
//     fields of its own -- that data lives on the related Exercise row).
//     Weekly Plan passes a mapper for exerciseName/bodyParts/muscleFocus,
//     which *are* columns on WeeklyPlanBlockExercise.
//   - an `adapter` to applyWorkoutFinalState -- `createWorkout(parentId,
//     workout)`, `updateWorkout(workoutId, workout)`, `replaceBlocks(
//     workoutId, blocks)`. Each service supplies a small concrete adapter
//     wrapping its own Prisma model names (`workout` vs `weeklyPlanWorkout`,
//     `blockExercises` vs `exercises`, etc).
//
// Weekly Plan calls diffWorkoutList directly on a flat workout list (no week
// wrapper). Cycle's diffCycleDraft (still in cyclesService.js -- week-level
// matching/create/delete is cycle-only) calls it once per matched week pair.

const { ApiError } = require('./usersService');
const {
  normalizeNullableNumber,
  normalizeNullableInteger,
  normalizeNullableString: normalizeOptionalString,
} = require('../utils/normalizers');

function noExtraExerciseFields() {
  return {};
}

function compareByIndex(primaryKey, secondaryKey = null) {
  return (left, right) => {
    const primaryDelta = Number(left?.[primaryKey] || 0) - Number(right?.[primaryKey] || 0);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }

    if (!secondaryKey) {
      return 0;
    }

    return Number(left?.[secondaryKey] || 0) - Number(right?.[secondaryKey] || 0);
  };
}

function normalizeSetTemplateForPersistence(setTemplate = {}, setIndex, options = {}) {
  const normalized = {
    setIndex,
    setType: setTemplate.setType || 'WORKING',
    targetReps: normalizeNullableInteger(setTemplate.targetReps),
    minReps: normalizeNullableInteger(setTemplate.minReps),
    maxReps: normalizeNullableInteger(setTemplate.maxReps),
    targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
    targetRir: normalizeNullableNumber(setTemplate.targetRir),
    targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
    tempo: normalizeOptionalString(setTemplate.tempo),
    restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
    notes: normalizeOptionalString(setTemplate.notes),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(setTemplate.id);
  }

  return normalized;
}

function normalizeExerciseForPersistence(exercise = {}, orderIndex, options = {}) {
  const extraExerciseFields = options.extraExerciseFields || noExtraExerciseFields;

  const normalized = {
    orderIndex,
    exerciseId: normalizeOptionalString(exercise.exerciseId),
    ...extraExerciseFields(exercise),
    executionNotes: normalizeOptionalString(exercise.executionNotes),
    defaultTempo: normalizeOptionalString(exercise.defaultTempo),
    defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
    defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
    defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
    intensificationMethod: exercise.intensificationMethod || 'NONE',
    cardioPrescription: exercise.cardioPrescription ?? null,
    notes: normalizeOptionalString(exercise.notes),
    setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : [])
      .slice()
      .sort(compareByIndex('setIndex'))
      .map((setTemplate, index) =>
        normalizeSetTemplateForPersistence(setTemplate, index + 1, options)
      ),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(exercise.id);
  }

  return normalized;
}

function normalizeBlockForPersistence(block = {}, orderIndex, options = {}) {
  const normalized = {
    orderIndex,
    blockType: block.blockType,
    label: normalizeOptionalString(block.label),
    roundCount: normalizeNullableInteger(block.roundCount),
    restStrategy: block.restStrategy || null,
    restSeconds: normalizeNullableInteger(block.restSeconds),
    notes: normalizeOptionalString(block.notes),
    exercises: (Array.isArray(block.exercises) ? block.exercises : [])
      .slice()
      .sort(compareByIndex('orderIndex'))
      .map((exercise, index) =>
        normalizeExerciseForPersistence(exercise, index + 1, options)
      ),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(block.id);
  }

  return normalized;
}

function normalizeWorkoutForPersistence(workout = {}, orderIndex, options = {}) {
  const normalized = {
    name: String(workout.name || '').trim(),
    orderIndex,
    scheduledDay: workout.scheduledDay || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: normalizeOptionalString(workout.notes),
    blocks: (Array.isArray(workout.blocks) ? workout.blocks : [])
      .slice()
      .sort(compareByIndex('orderIndex'))
      .map((block, index) => normalizeBlockForPersistence(block, index + 1, options)),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(workout.id);
  }

  return normalized;
}

function normalizeWorkoutScalarFields(workout) {
  return JSON.stringify({
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: workout.notes || null,
  });
}

function normalizeWorkoutContentScalarFields(workout) {
  return JSON.stringify({
    name: workout.name,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: workout.notes || null,
  });
}

function normalizeWorkoutBlockFields(workout, options = {}) {
  const extraExerciseFields = options.extraExerciseFields || noExtraExerciseFields;

  return JSON.stringify(
    (Array.isArray(workout.blocks) ? workout.blocks : []).map((block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label || null,
      roundCount: normalizeNullableInteger(block.roundCount),
      restStrategy: block.restStrategy || null,
      restSeconds: normalizeNullableInteger(block.restSeconds),
      notes: block.notes || null,
      exercises: (Array.isArray(block.exercises) ? block.exercises : []).map((exercise) => ({
        orderIndex: exercise.orderIndex,
        exerciseId: exercise.exerciseId || null,
        ...extraExerciseFields(exercise),
        executionNotes: exercise.executionNotes || null,
        defaultTempo: exercise.defaultTempo || null,
        defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
        defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
        defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
        intensificationMethod: exercise.intensificationMethod || 'NONE',
        cardioPrescription: exercise.cardioPrescription || null,
        notes: exercise.notes || null,
        setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : []).map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          setType: setTemplate.setType || 'WORKING',
          targetReps: normalizeNullableInteger(setTemplate.targetReps),
          minReps: normalizeNullableInteger(setTemplate.minReps),
          maxReps: normalizeNullableInteger(setTemplate.maxReps),
          targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
          targetRir: normalizeNullableNumber(setTemplate.targetRir),
          targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
          tempo: setTemplate.tempo || null,
          restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
          notes: setTemplate.notes || null,
        })),
      })),
    }))
  );
}

function buildIdentityConflictError(level, descriptor) {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    `Ambiguous ${level} identity in draft payload for ${descriptor}`
  );
}

function matchIncomingWorkouts(existingWorkouts = [], incomingWorkouts = [], parentLabel) {
  const existingById = new Map(existingWorkouts.map((workout) => [workout.id, workout]));
  const existingByOrderIndex = new Map(
    existingWorkouts.map((workout) => [workout.orderIndex, workout])
  );
  const matchedExistingIds = new Set();
  const pairs = [];
  const creates = [];
  const missingIdWorkouts = [];

  incomingWorkouts.forEach((workout) => {
    if (workout.id) {
      const matched = existingById.get(workout.id) || null;
      const fallbackMatch = existingByOrderIndex.get(workout.orderIndex) || null;

      if (matched) {
        matchedExistingIds.add(matched.id);
        pairs.push({ existingWorkout: matched, incomingWorkout: workout });
      } else if (fallbackMatch && !matchedExistingIds.has(fallbackMatch.id)) {
        matchedExistingIds.add(fallbackMatch.id);
        pairs.push({ existingWorkout: fallbackMatch, incomingWorkout: workout });
      } else {
        creates.push(workout);
      }

      return;
    }

    missingIdWorkouts.push(workout);
  });

  missingIdWorkouts.forEach((workout) => {
    const fallbackMatch = existingByOrderIndex.get(workout.orderIndex) || null;

    if (fallbackMatch && matchedExistingIds.has(fallbackMatch.id)) {
      throw buildIdentityConflictError(
        'workout',
        `${parentLabel}, orderIndex ${workout.orderIndex}`
      );
    }

    if (fallbackMatch) {
      matchedExistingIds.add(fallbackMatch.id);
      pairs.push({ existingWorkout: fallbackMatch, incomingWorkout: workout });
      return;
    }

    creates.push(workout);
  });

  const deletes = existingWorkouts.filter((workout) => !matchedExistingIds.has(workout.id));
  return { pairs, creates, deletes };
}

function diffWorkoutList(existingWorkouts, incomingWorkouts, parentLabel, options = {}) {
  const workoutMatches = matchIncomingWorkouts(existingWorkouts, incomingWorkouts, parentLabel);
  const matchedWorkoutIds = new Set(
    workoutMatches.pairs.map(({ existingWorkout }) => existingWorkout.id)
  );
  const finalWorkoutOrder = incomingWorkouts.map((workout) => {
    const matchedPair = workoutMatches.pairs.find(
      ({ incomingWorkout }) => incomingWorkout === workout
    );
    return {
      incomingWorkout: workout,
      existingWorkout: matchedPair?.existingWorkout || null,
      isNew: !matchedPair,
    };
  });
  const reorderedExistingWorkouts = finalWorkoutOrder
    .filter((entry) => entry.existingWorkout)
    .map((entry) => entry.existingWorkout.id);
  const originalExistingWorkouts = existingWorkouts
    .filter((workout) => matchedWorkoutIds.has(workout.id))
    .map((workout) => workout.id);

  return {
    workoutCreates: workoutMatches.creates,
    workoutDeletes: workoutMatches.deletes,
    workoutUpdates: workoutMatches.pairs.map(({ existingWorkout, incomingWorkout }) => {
      const contentScalarChanged =
        normalizeWorkoutContentScalarFields(existingWorkout) !==
        normalizeWorkoutContentScalarFields(incomingWorkout);

      return {
        existingWorkout,
        incomingWorkout,
        scalarChanged:
          normalizeWorkoutScalarFields(existingWorkout) !==
          normalizeWorkoutScalarFields(incomingWorkout),
        contentScalarChanged,
        blockChanged:
          normalizeWorkoutBlockFields(existingWorkout, options) !==
          normalizeWorkoutBlockFields(incomingWorkout, options),
      };
    }),
    finalWorkoutOrder,
    reorderChanged:
      originalExistingWorkouts.length !== reorderedExistingWorkouts.length ||
      originalExistingWorkouts.some((workoutId, index) => workoutId !== reorderedExistingWorkouts[index]),
  };
}

// `adapter` is `{ createWorkout(parentId, workout), updateWorkout(workoutId,
// workout), replaceBlocks(workoutId, blocks) }`. Deletes are the caller's
// responsibility (they typically need a pre-delete integrity check -- e.g.
// Cycle's scheduled-session-reference guard -- that has no shared
// equivalent), so there is no `deleteWorkouts` call inside this function;
// callers invoke `adapter.deleteWorkouts` themselves before this runs.
async function applyWorkoutFinalState(
  adapter,
  parentId,
  finalWorkoutOrder = [],
  workoutUpdates = [],
  options = {}
) {
  const forceOrderReset = Boolean(options.forceOrderReset);
  const workoutUpdatesById = new Map(
    workoutUpdates.map((entry) => [entry.existingWorkout.id, entry])
  );

  for (let index = 0; index < finalWorkoutOrder.length; index += 1) {
    const entry = finalWorkoutOrder[index];
    const finalOrderIndex = index + 1;

    if (entry.isNew) {
      await adapter.createWorkout(parentId, {
        ...entry.incomingWorkout,
        orderIndex: finalOrderIndex,
      });
      continue;
    }

    const updateEntry = workoutUpdatesById.get(entry.existingWorkout.id);
    const incomingWorkout = {
      ...updateEntry.incomingWorkout,
      orderIndex: finalOrderIndex,
    };
    const shouldUpdateWorkoutScalars =
      forceOrderReset ||
      updateEntry.scalarChanged ||
      updateEntry.existingWorkout.orderIndex !== finalOrderIndex;

    if (shouldUpdateWorkoutScalars) {
      await adapter.updateWorkout(entry.existingWorkout.id, incomingWorkout);
    }

    if (updateEntry.blockChanged) {
      await adapter.replaceBlocks(
        entry.existingWorkout.id,
        incomingWorkout.blocks,
        entry.existingWorkout.blocks
      );
    }

    if (
      typeof adapter.incrementContentRevision === 'function' &&
      (updateEntry.contentScalarChanged || updateEntry.blockChanged)
    ) {
      await adapter.incrementContentRevision(entry.existingWorkout.id);
    }
  }
}

module.exports = {
  compareByIndex,
  normalizeSetTemplateForPersistence,
  normalizeExerciseForPersistence,
  normalizeBlockForPersistence,
  normalizeWorkoutForPersistence,
  normalizeWorkoutScalarFields,
  normalizeWorkoutContentScalarFields,
  normalizeWorkoutBlockFields,
  matchIncomingWorkouts,
  diffWorkoutList,
  applyWorkoutFinalState,
};
