const { ApiError } = require('./usersService');

const CARDIO_TRAINING_TYPE = 'cardio';
const HEART_RATE_TARGET_MODES = new Set(['none', 'avg_bpm', 'zone']);
const CARDIO_MACHINE_SETTINGS_BY_MODALITY = {
  treadmill_walk: new Set(['speed', 'incline']),
  incline_treadmill_walk: new Set(['speed', 'incline']),
  stationary_bike: new Set(['resistance']),
  recumbent_bike: new Set(['resistance']),
  stair_climber: new Set(['level']),
  elliptical: new Set(['resistance']),
  rowing_machine: new Set(['pace']),
};

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeInt(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeMachineSettings(value, modality, path) {
  const allowedSettings = CARDIO_MACHINE_SETTINGS_BY_MODALITY[modality] || new Set();
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, settingValue]) => ({ key, value: settingValue }))
      : [];

  if (entries.length > 2) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${path}.machineSettings cannot contain more than 2 entries`);
  }

  // Canonical backend shape: [{ key, value }], constrained by modality allowlist.
  return entries.map((entry, index) => {
    const key = normalizeOptionalString(entry?.key ?? entry?.name)?.toLowerCase();
    if (!key || !allowedSettings.has(key)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${path}.machineSettings[${index}].key is invalid`);
    }

    const settingValue = entry?.value;
    if (
      settingValue == null ||
      (typeof settingValue !== 'string' && typeof settingValue !== 'number')
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${path}.machineSettings[${index}].value is invalid`);
    }

    return {
      key,
      value: settingValue,
    };
  });
}

function normalizeCardioPrescription(value, options = {}) {
  const path = options.path || 'cardioPrescription';
  const modality = normalizeOptionalString(options.modality);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${path} is required`);
  }

  const durationMinutes = normalizeInt(value.durationMinutes, null);
  if (durationMinutes == null || durationMinutes <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${path}.durationMinutes must be a positive integer`);
  }

  const heartRateTargetMode = normalizeOptionalString(value.heartRateTargetMode)?.toLowerCase() || 'none';
  if (!HEART_RATE_TARGET_MODES.has(heartRateTargetMode)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${path}.heartRateTargetMode is invalid`);
  }

  let heartRateTargetValue = null;
  if (heartRateTargetMode === 'avg_bpm') {
    heartRateTargetValue = normalizeInt(value.heartRateTargetValue, null);
    if (heartRateTargetValue == null || heartRateTargetValue <= 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${path}.heartRateTargetValue must be an integer bpm`);
    }
  }

  if (heartRateTargetMode === 'zone') {
    heartRateTargetValue = normalizeInt(value.heartRateTargetValue, null);
    if (heartRateTargetValue == null || heartRateTargetValue < 1 || heartRateTargetValue > 5) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${path}.heartRateTargetValue must be an integer from 1 to 5`);
    }
  }

  return {
    durationMinutes,
    heartRateTargetMode,
    heartRateTargetValue,
    machineSettings: normalizeMachineSettings(value.machineSettings, modality, path),
    notes: normalizeOptionalString(value.notes),
  };
}

function isCardioExercise(exercise) {
  return String(exercise?.trainingType || '').toLowerCase() === CARDIO_TRAINING_TYPE;
}

function validateAndNormalizeCardioBlocks(workouts = [], exerciseById = new Map(), options = {}) {
  const mode = options.mode || 'draft';
  const basePath = options.path || 'workouts';

  workouts.forEach((workout, workoutIndex) => {
    const workoutPath = `${basePath}[${workoutIndex}]`;

    (Array.isArray(workout.blocks) ? workout.blocks : []).forEach((block, blockIndex) => {
      const blockPath = `${workoutPath}.blocks[${blockIndex}]`;
      const exercises = Array.isArray(block.exercises) ? block.exercises : [];

      if (block.blockType === 'CARDIO') {
        if (exercises.length !== 1) {
          throw new ApiError(400, 'VALIDATION_ERROR', `cardio blocks must contain exactly one exercise in ${blockPath}`);
        }

        const exercise = exercises[0];
        const exercisePath = `${blockPath}.exercises[0]`;
        const libraryExercise = exerciseById.get(exercise.exerciseId);

        if (mode === 'publish' && (!exercise.exerciseId || !exercise.exerciseName)) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `exerciseId and exerciseName are required for published cardio blocks in ${exercisePath}`
          );
        }

        if (exercise.exerciseId && !isCardioExercise(libraryExercise)) {
          throw new ApiError(400, 'VALIDATION_ERROR', `CARDIO blocks require a cardio exercise in ${exercisePath}`);
        }

        if ((Array.isArray(exercise.setTemplates) ? exercise.setTemplates : []).length > 0) {
          throw new ApiError(400, 'VALIDATION_ERROR', `CARDIO blocks cannot contain setTemplates in ${exercisePath}`);
        }

        if (exercise.exerciseId || mode === 'publish') {
          exercise.cardioPrescription = normalizeCardioPrescription(exercise.cardioPrescription, {
            path: `${exercisePath}.cardioPrescription`,
            modality: libraryExercise?.cardioModality,
          });
        }

        return;
      }

      exercises.forEach((exercise, exerciseIndex) => {
        const libraryExercise = exerciseById.get(exercise.exerciseId);
        if (isCardioExercise(libraryExercise)) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `cardio exercises are only allowed in CARDIO blocks in ${blockPath}.exercises[${exerciseIndex}]`
          );
        }
      });
    });
  });
}

module.exports = {
  CARDIO_MACHINE_SETTINGS_BY_MODALITY,
  normalizeCardioPrescription,
  validateAndNormalizeCardioBlocks,
};
