'use strict';

const {
  normalizeNullableNumber,
  normalizeNullableInteger,
  normalizeNullableString,
} = require('../utils/normalizers');

function toSetPersistence(setTemplate = {}) {
  return {
    id: setTemplate.id,
    setIndex: setTemplate.setIndex,
    setType: setTemplate.setType || 'WORKING',
    targetReps: normalizeNullableInteger(setTemplate.targetReps),
    minReps: normalizeNullableInteger(setTemplate.minReps),
    maxReps: normalizeNullableInteger(setTemplate.maxReps),
    targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
    targetRir: normalizeNullableNumber(setTemplate.targetRir),
    targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
    tempo: normalizeNullableString(setTemplate.tempo),
    restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
    notes: normalizeNullableString(setTemplate.notes),
  };
}

function toExercisePersistence(exercise = {}) {
  return {
    id: exercise.id,
    exerciseId: exercise.exerciseId || null,
    exerciseName: exercise.exerciseName || exercise.exercise?.name || '',
    bodyParts: Array.isArray(exercise.bodyParts)
      ? exercise.bodyParts
      : Array.isArray(exercise.exercise?.bodyParts)
        ? exercise.exercise.bodyParts
        : [],
    muscleFocus: Array.isArray(exercise.muscleFocus)
      ? exercise.muscleFocus
      : Array.isArray(exercise.exercise?.targetMuscles)
        ? exercise.exercise.targetMuscles
        : [],
    orderIndex: exercise.orderIndex,
    executionNotes: normalizeNullableString(exercise.executionNotes),
    defaultTempo: normalizeNullableString(exercise.defaultTempo),
    defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
    defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
    defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
    intensificationMethod: exercise.intensificationMethod || 'NONE',
    cardioPrescription: exercise.cardioPrescription ?? null,
    notes: normalizeNullableString(exercise.notes),
  };
}

function toBlockPersistence(block = {}) {
  return {
    id: block.id,
    orderIndex: block.orderIndex,
    blockType: block.blockType,
    label: normalizeNullableString(block.label),
    roundCount: normalizeNullableInteger(block.roundCount),
    restStrategy: block.restStrategy || null,
    restSeconds: normalizeNullableInteger(block.restSeconds),
    notes: normalizeNullableString(block.notes),
  };
}

function toOpaqueBlockPersistence(block = {}) {
  return {
    ...toBlockPersistence(block),
    exercises: (Array.isArray(block.exercises) ? block.exercises : []).map((exercise) => ({
      ...toExercisePersistence(exercise),
      setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : []).map(
        toSetPersistence
      ),
    })),
  };
}

function toWorkoutPersistence(workout = {}, options = {}) {
  const result = {
    id: workout.id,
    name: workout.name,
    orderIndex: workout.orderIndex,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: normalizeNullableString(workout.notes),
  };

  if (options.includeScheduledDay) {
    result.scheduledDay = workout.scheduledDay || null;
  }

  return result;
}

function toCycleBuilderExercise(exercise, index) {
  const setTemplates = Array.isArray(exercise.setTemplates) ? exercise.setTemplates : [];

  return {
    id: exercise.id,
    label: `A${index + 1}`,
    name: exercise.exerciseName || exercise.exercise?.name || '',
    exerciseId: exercise.exerciseId,
    bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
    muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
    tempo: exercise.defaultTempo || setTemplates[0]?.tempo || '3010',
    sets: setTemplates.map((setTemplate) => ({
      id: setTemplate.id,
      reps:
        setTemplate.targetReps ??
        setTemplate.maxReps ??
        setTemplate.minReps ??
        8,
      rpe: Number(setTemplate.targetRir ?? 2),
      persistence: toSetPersistence(setTemplate),
    })),
    notes: exercise.notes || exercise.executionNotes || '',
    persistence: toExercisePersistence(exercise),
  };
}

function toCycleBuilderBlock(block) {
  if (block.blockType === 'CARDIO') {
    const cardioExercise = block.exercises[0];

    return {
      id: block.id,
      type: 'cardio',
      exercise: cardioExercise?.exerciseName || cardioExercise?.exercise?.name || '',
      exerciseId: cardioExercise?.exerciseId || null,
      exerciseRowId: cardioExercise?.id,
      cardioPrescription: cardioExercise?.cardioPrescription || null,
      notes: block.notes || cardioExercise?.notes || '',
      exercisePersistence: toExercisePersistence(cardioExercise),
      persistence: toBlockPersistence(block),
    };
  }

  if (block.blockType === 'SUPERSET') {
    const exercises = block.exercises.map(toCycleBuilderExercise);

    return {
      id: block.id,
      type: 'superset',
      sets: Math.max(1, exercises[0]?.sets?.length || block.roundCount || 1),
      rest: `${block.restSeconds || 120}s`,
      exercises,
      notes: block.notes || '',
      persistence: toBlockPersistence(block),
    };
  }

  if (block.blockType !== 'SINGLE') {
    return {
      id: block.id,
      type: 'unsupported',
      persistence: {
        opaqueBlock: toOpaqueBlockPersistence(block),
      },
    };
  }

  const singleExercise = block.exercises[0];

  return {
    id: block.id,
    type: 'single',
    exercise: singleExercise?.exerciseName || singleExercise?.exercise?.name || '',
    exerciseId: singleExercise?.exerciseId || null,
    exerciseRowId: singleExercise?.id,
    bodyParts: Array.isArray(singleExercise?.bodyParts) ? singleExercise.bodyParts : [],
    muscleFocus: Array.isArray(singleExercise?.muscleFocus) ? singleExercise.muscleFocus : [],
    tempo: singleExercise?.defaultTempo || singleExercise?.setTemplates?.[0]?.tempo || '3010',
    rest: `${block.restSeconds || singleExercise?.defaultRestSeconds || 120}s`,
    sets: Array.isArray(singleExercise?.setTemplates)
      ? singleExercise.setTemplates.map((setTemplate) => ({
        id: setTemplate.id,
        reps:
          setTemplate.targetReps ??
          setTemplate.maxReps ??
          setTemplate.minReps ??
          8,
        rpe: Number(setTemplate.targetRir ?? 2),
        persistence: toSetPersistence(setTemplate),
      }))
      : [],
    notes: block.notes || singleExercise?.notes || '',
    exercisePersistence: toExercisePersistence(singleExercise),
    persistence: toBlockPersistence(block),
  };
}

function toCycleBuilderWorkout(workout) {
  return {
    id: workout.id,
    contentRevision: workout.contentRevision,
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay,
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
    notes: workout.notes,
    blocks: workout.blocks.map(toCycleBuilderBlock),
    persistence: toWorkoutPersistence(workout, { includeScheduledDay: true }),
  };
}

module.exports = {
  toCycleBuilderWorkout,
  toBlockPersistence,
  toExercisePersistence,
  toOpaqueBlockPersistence,
  toSetPersistence,
  toWorkoutPersistence,
};
