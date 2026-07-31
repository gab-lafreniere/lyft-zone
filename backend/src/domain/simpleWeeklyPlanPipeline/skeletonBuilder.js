const { computeGeometryHash } = require('./geometryLock');

const SLOT_TYPES = Object.freeze({
  exerciseId: {
    type: 'string',
    enumSource: 'eligibleExerciseIds',
  },
  exerciseDefaults: {
    type: 'object',
    fields: {
      tempo: 'fourDigitTempo',
      restSeconds: 'integerOrNull',
      targetRir: 'numberOrNull',
      targetRpe: 'numberOrNull',
    },
  },
  blockRestSeconds: {
    type: 'integer',
    minimum: 0,
    maximum: 600,
  },
  strengthSetTarget: {
    type: 'object',
    modes: ['reps', 'repRange', 'seconds'],
  },
  exerciseNotes: {
    type: ['string', 'null'],
    maxLength: 1000,
  },
  cardioPrescription: {
    type: 'object',
    contract: 'sharedCardioPrescription',
  },
});

function createStrengthSet(setIndex) {
  return {
    setIndex,
    setType: 'WORKING',
    targetReps: null,
    minReps: null,
    maxReps: null,
    targetSeconds: null,
    targetRir: null,
    targetRpe: null,
    tempo: null,
    restSeconds: null,
    notes: null,
  };
}

function createExercise(orderIndex, setCount, cardio = false) {
  return {
    exerciseId: null,
    exerciseName: null,
    bodyParts: [],
    muscleFocus: [],
    orderIndex,
    executionNotes: null,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    notes: null,
    cardioPrescription: null,
    setTemplates: cardio
      ? []
      : Array.from(
        { length: setCount },
        (_, setIndex) => createStrengthSet(setIndex + 1)
      ),
  };
}

function addExerciseSlots({
  slots,
  workoutIndex,
  blockIndex,
  exerciseIndex,
  setCount,
  blockType,
}) {
  const prefix = `w${workoutIndex + 1}.b${blockIndex + 1}.e${exerciseIndex + 1}`;
  const pointer =
    `/workouts/${workoutIndex}/blocks/${blockIndex}/exercises/${exerciseIndex}`;

  slots.push({
    id: `${prefix}.id`,
    pointer: `${pointer}/exerciseId`,
    kind: 'exerciseId',
    required: true,
  });

  if (blockType === 'CARDIO') {
    slots.push({
      id: `${prefix}.cardio`,
      pointer: `${pointer}/cardioPrescription`,
      kind: 'cardioPrescription',
      required: true,
    });
  } else {
    slots.push({
      id: `${prefix}.defaults`,
      pointer,
      kind: 'exerciseDefaults',
      required: true,
    });
    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      slots.push({
        id: `${prefix}.s${setIndex + 1}`,
        pointer: `${pointer}/setTemplates/${setIndex}`,
        kind: 'strengthSetTarget',
        required: true,
      });
    }
  }

  slots.push({
    id: `${prefix}.notes`,
    pointer: `${pointer}/notes`,
    kind: 'exerciseNotes',
    required: false,
  });
}

function buildSimpleWeeklyPlanSkeleton(structure) {
  const slots = [];
  const document = {
    name: structure.planName.trim(),
    sessionsPerWeek: structure.workouts.length,
    workouts: structure.workouts.map((workout, workoutIndex) => ({
      name: workout.name.trim(),
      orderIndex: workoutIndex + 1,
      estimatedDurationMinutes: null,
      notes: null,
      blocks: workout.blocks.map((block, blockIndex) => {
        const cardio = block.blockType === 'CARDIO';
        const exercises = block.setCounts.map((setCount, exerciseIndex) => {
          addExerciseSlots({
            slots,
            workoutIndex,
            blockIndex,
            exerciseIndex,
            setCount,
            blockType: block.blockType,
          });
          return createExercise(exerciseIndex + 1, setCount, cardio);
        });

        if (block.blockType === 'SUPERSET') {
          slots.push({
            id: `w${workoutIndex + 1}.b${blockIndex + 1}.rest`,
            pointer: `/workouts/${workoutIndex}/blocks/${blockIndex}/restSeconds`,
            kind: 'blockRestSeconds',
            required: true,
          });
        }

        return {
          orderIndex: blockIndex + 1,
          blockType: block.blockType,
          label: null,
          roundCount: block.roundCount,
          restStrategy:
            block.blockType === 'CARDIO'
              ? 'NONE'
              : block.blockType === 'SUPERSET'
                ? 'AFTER_ROUND'
                : 'AFTER_EXERCISE',
          restSeconds: null,
          notes: null,
          exercises,
        };
      }),
    })),
  };

  return {
    schemaVersion: 1,
    geometryHash: computeGeometryHash(document),
    document,
    slotTypes: SLOT_TYPES,
    slots,
  };
}

module.exports = {
  SLOT_TYPES,
  buildSimpleWeeklyPlanSkeleton,
  createStrengthSet,
};
