const { normalizeCardioPrescription } = require('../../../services/cardioPrescription');
const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
} = require('./weeklyPlanAiSchema');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeStringArray(value) {
  return toArray(value)
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInt(value) {
  const normalized = normalizeNumber(value);
  return normalized == null ? null : Math.trunc(normalized);
}

function buildPoolItemByExerciseId(exercisePoolItems = []) {
  return new Map(
    toArray(exercisePoolItems)
      .filter((item) => item?.exerciseId)
      .map((item) => [String(item.exerciseId).trim(), item])
  );
}

function getCanonicalExerciseFields(aiExercise = {}, poolItem = null) {
  return {
    exerciseId: normalizeOptionalString(aiExercise.exerciseId),
    exerciseName:
      normalizeOptionalString(poolItem?.name) ||
      normalizeOptionalString(aiExercise.exerciseName) ||
      '',
    bodyParts: normalizeStringArray(
      toArray(poolItem?.bodyParts).length ? poolItem.bodyParts : aiExercise.bodyParts
    ),
    muscleFocus: normalizeStringArray(
      toArray(poolItem?.muscleFocus).length ? poolItem.muscleFocus : aiExercise.muscleFocus
    ),
  };
}

function normalizeSetTemplate(setTemplate = {}) {
  return {
    setIndex: normalizeInt(setTemplate.setIndex),
    setType: String(setTemplate.setType || 'WORKING').trim().toUpperCase(),
    targetReps: normalizeInt(setTemplate.targetReps),
    minReps: normalizeInt(setTemplate.minReps),
    maxReps: normalizeInt(setTemplate.maxReps),
    targetSeconds: null,
    targetRir: normalizeNumber(setTemplate.targetRir),
    targetRpe: null,
    tempo: normalizeOptionalString(setTemplate.tempo),
    restSeconds: normalizeInt(setTemplate.restSeconds),
    notes: null,
  };
}

function getBlockRestSeconds(aiBlock = {}) {
  const firstExercise = toArray(aiBlock.exercises)[0] || {};
  const firstSetTemplate = toArray(firstExercise.setTemplates)[0] || {};

  return normalizeInt(firstExercise.defaultRestSeconds ?? firstSetTemplate.restSeconds);
}

function normalizeStrengthExercise(aiExercise = {}, poolItem = null) {
  const canonical = getCanonicalExerciseFields(aiExercise, poolItem);

  return {
    ...canonical,
    orderIndex: normalizeInt(aiExercise.orderIndex),
    executionNotes: normalizeOptionalString(aiExercise.notes),
    defaultTempo: normalizeOptionalString(aiExercise.defaultTempo),
    defaultRestSeconds: normalizeInt(aiExercise.defaultRestSeconds),
    defaultTargetRir: normalizeNumber(aiExercise.defaultTargetRir),
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    notes: normalizeOptionalString(aiExercise.notes),
    cardioPrescription: null,
    setTemplates: toArray(aiExercise.setTemplates)
      .slice()
      .sort((left, right) => left.setIndex - right.setIndex)
      .map(normalizeSetTemplate),
  };
}

function normalizeCardioExercise(aiExercise = {}, poolItem = null, path = 'cardioPrescription') {
  const canonical = getCanonicalExerciseFields(aiExercise, poolItem);

  return {
    ...canonical,
    bodyParts: canonical.bodyParts,
    muscleFocus: canonical.muscleFocus,
    orderIndex: normalizeInt(aiExercise.orderIndex),
    executionNotes: null,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    notes: normalizeOptionalString(aiExercise.notes),
    cardioPrescription: normalizeCardioPrescription(aiExercise.cardioPrescription, {
      path,
      modality: poolItem?.cardioModality,
    }),
    setTemplates: [],
  };
}

function normalizeBlock(aiBlock = {}, poolItemByExerciseId = new Map(), workoutIndex, blockIndex) {
  const blockType = String(aiBlock.blockType || '').trim().toUpperCase();
  const exercises = toArray(aiBlock.exercises)
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex);

  if (blockType === 'CARDIO') {
    const exercise = exercises[0] || {};
    const exerciseId = normalizeOptionalString(exercise.exerciseId);
    const poolItem = poolItemByExerciseId.get(exerciseId);

    return {
      orderIndex: normalizeInt(aiBlock.orderIndex),
      blockType,
      label: null,
      roundCount: null,
      restStrategy: 'NONE',
      restSeconds: null,
      notes: null,
      exercises: [
        normalizeCardioExercise(
          exercise,
          poolItem,
          `workouts[${workoutIndex}].blocks[${blockIndex}].exercises[0].cardioPrescription`
        ),
      ],
    };
  }

  const normalizedExercises = exercises.map((exercise) => {
    const exerciseId = normalizeOptionalString(exercise.exerciseId);
    return normalizeStrengthExercise(exercise, poolItemByExerciseId.get(exerciseId));
  });

  return {
    orderIndex: normalizeInt(aiBlock.orderIndex),
    blockType,
    label: null,
    roundCount: blockType === 'SUPERSET' ? normalizedExercises[0]?.setTemplates?.length || null : null,
    restStrategy: blockType === 'SUPERSET' ? 'AFTER_ROUND' : 'AFTER_EXERCISE',
    restSeconds: getBlockRestSeconds(aiBlock),
    notes: null,
    exercises: normalizedExercises,
  };
}

function normalizeWorkout(aiWorkout = {}, poolItemByExerciseId = new Map(), workoutIndex) {
  return {
    name: String(aiWorkout.name || '').trim(),
    orderIndex: normalizeInt(aiWorkout.orderIndex),
    estimatedDurationMinutes: normalizeInt(aiWorkout.estimatedDurationMinutes),
    notes: normalizeOptionalString(aiWorkout.focus),
    blocks: toArray(aiWorkout.blocks)
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((block, blockIndex) =>
        normalizeBlock(block, poolItemByExerciseId, workoutIndex, blockIndex)
      ),
  };
}

function normalizeWeeklyPlanAiOutput(aiOutput = {}, options = {}) {
  const poolItemByExerciseId = buildPoolItemByExerciseId(
    options.exercisePoolItems || options.context?.exercisePoolItems || []
  );

  return {
    name: String(aiOutput.planName || '').trim(),
    sessionsPerWeek: normalizeInt(aiOutput.sessionsPerWeek),
    workouts: toArray(aiOutput.workouts)
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((workout, workoutIndex) =>
        normalizeWorkout(workout, poolItemByExerciseId, workoutIndex)
      ),
  };
}

function buildWeeklyPlanAiGenerationMetadata(aiOutput = {}) {
  return {
    aiContractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    aiOutputSchemaVersion: aiOutput.schemaVersion ?? null,
    strategySummary: aiOutput.strategySummary || null,
    splitType: aiOutput.splitType || null,
    volumeTargets: aiOutput.volumeTargets || null,
    frequencyTargets: aiOutput.frequencyTargets || null,
    progressionModel: aiOutput.progressionModel || null,
    cautionHandling: aiOutput.cautionHandling || null,
    notesPolicy: aiOutput.notesPolicy || null,
  };
}

module.exports = {
  buildPoolItemByExerciseId,
  buildWeeklyPlanAiGenerationMetadata,
  normalizeWeeklyPlanAiOutput,
};
