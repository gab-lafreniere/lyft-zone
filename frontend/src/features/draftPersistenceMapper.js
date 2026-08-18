function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function normalizeNumeric(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTempoValue(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4) || null;
}

function parseRestSeconds(value) {
  const parsed = Number.parseInt(String(value || "").replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getExerciseName(value) {
  if (value && typeof value === "object") {
    return String(value.name || "").trim();
  }

  return String(value || "").trim();
}

function hasEditIntent(value, field) {
  return Boolean(value?.editIntent?.[field]);
}

function normalizeMachineSettings(value) {
  return Array.isArray(value)
    ? value
        .map((setting) => ({
          key: String(setting?.key || "").trim().toLowerCase(),
          value: String(setting?.value ?? ""),
        }))
        .filter((setting) => setting.key || setting.value)
    : [];
}

function normalizeCardioPrescriptionForApi(value = {}, backing = {}) {
  return {
    ...backing,
    durationMinutes: normalizeNumeric(value.durationMinutes, null),
    heartRateTargetMode: value.heartRateTargetMode || undefined,
    heartRateTargetValue: normalizeNumeric(value.heartRateTargetValue, null),
    machineSettings: normalizeMachineSettings(value.machineSettings),
    notes: value.notes ? String(value.notes) : null,
  };
}

function mapSetTemplate(set, index, options = {}) {
  const backing = set?.persistence || null;
  const isPersisted = Boolean(backing);
  const reps = normalizeNumeric(set?.reps, null);
  const rir = normalizeNumeric(set?.rpe, 2);
  const result = isPersisted
    ? { ...backing }
    : {
        setType: "WORKING",
        targetReps: reps,
        minReps: reps,
        maxReps: reps,
        targetSeconds: null,
        targetRir: rir,
        targetRpe: null,
        tempo: options.tempo,
        restSeconds: options.restSeconds,
        notes: null,
      };

  result.id = set?.id || backing?.id || undefined;
  result.setIndex = index + 1;

  if (hasEditIntent(set, "reps")) {
    result.targetReps = reps;
    result.minReps = reps;
    result.maxReps = reps;
  }

  if (hasEditIntent(set, "rir")) {
    result.targetRir = rir;
  }

  if (options.tempoEdited) {
    result.tempo = options.tempo;
  }

  if (options.restEdited) {
    result.restSeconds = options.restSeconds;
  }

  return result;
}

function mapExercise(exercise, index, options = {}) {
  const backing = exercise?.persistence || null;
  const isPersisted = Boolean(backing);
  const result = isPersisted
    ? { ...backing }
    : {
        executionNotes: null,
        defaultTempo: options.tempo,
        defaultRestSeconds: options.restSeconds,
        defaultTargetRir: null,
        defaultTargetRpe: null,
        intensificationMethod: "NONE",
        cardioPrescription: null,
        notes: null,
      };

  result.id = exercise?.id || backing?.id || undefined;
  result.exerciseId = exercise?.exerciseId || null;
  result.exerciseName = String(exercise?.name || "").trim();
  result.bodyParts = normalizeStringArray(exercise?.bodyParts);
  result.muscleFocus = normalizeStringArray(exercise?.muscleFocus);
  result.orderIndex = index + 1;

  if (hasEditIntent(exercise, "notes")) {
    result.executionNotes = exercise.notes || null;
    result.notes = exercise.notes || null;
  }

  if (hasEditIntent(exercise, "tempo")) {
    result.defaultTempo = options.tempo;
  }

  if (options.restEdited) {
    result.defaultRestSeconds = options.restSeconds;
  }

  result.setTemplates = Array.isArray(exercise?.sets)
    ? exercise.sets.map((set, setIndex) =>
        mapSetTemplate(set, setIndex, {
          tempo: options.tempo,
          tempoEdited: hasEditIntent(exercise, "tempo"),
          restSeconds: options.restSeconds,
          restEdited: options.restEdited,
        })
      )
    : [];

  return result;
}

function mapCardioBlockToApi(block, index) {
  const blockBacking = block.persistence || null;
  const exerciseBacking = block.exercisePersistence || null;
  const cardioEdited = hasEditIntent(block, "cardioPrescription");
  const cardioPrescription = cardioEdited || !exerciseBacking
    ? normalizeCardioPrescriptionForApi(
        block.cardioPrescription || {},
        exerciseBacking?.cardioPrescription || {}
      )
    : exerciseBacking.cardioPrescription;
  const blockResult = blockBacking
    ? { ...blockBacking }
    : {
        blockType: "CARDIO",
        label: null,
        roundCount: null,
        restStrategy: "NONE",
        restSeconds: null,
        notes: null,
      };
  const exerciseResult = exerciseBacking
    ? { ...exerciseBacking }
    : {
        bodyParts: [],
        muscleFocus: [],
        executionNotes: null,
        defaultTempo: null,
        defaultRestSeconds: null,
        defaultTargetRir: null,
        defaultTargetRpe: null,
        intensificationMethod: "NONE",
        notes: null,
      };

  blockResult.id = block.id || blockBacking?.id || undefined;
  blockResult.orderIndex = index + 1;
  blockResult.blockType = "CARDIO";
  exerciseResult.id = block.exerciseRowId || exerciseBacking?.id || undefined;
  exerciseResult.exerciseId = block.exerciseId || block.exercise?.exerciseId || null;
  exerciseResult.exerciseName = getExerciseName(block.exercise);
  exerciseResult.orderIndex = 1;
  exerciseResult.cardioPrescription = cardioPrescription;
  exerciseResult.setTemplates = [];
  blockResult.exercises = [exerciseResult];

  return blockResult;
}

function mapSingleBlockToApi(block, index) {
  const blockBacking = block.persistence || null;
  const blockResult = blockBacking
    ? { ...blockBacking }
    : {
        blockType: "SINGLE",
        label: null,
        roundCount: null,
        restStrategy: "AFTER_EXERCISE",
        restSeconds: parseRestSeconds(block.rest),
        notes: block.notes || null,
      };
  const tempo = normalizeTempoValue(block.tempo);
  const restSeconds = parseRestSeconds(block.rest);
  const exercise = {
    id: block.exerciseRowId,
    name: block.exercise,
    exerciseId: block.exerciseId,
    bodyParts: block.bodyParts,
    muscleFocus: block.muscleFocus,
    notes: block.notes,
    sets: block.sets,
    persistence: block.exercisePersistence,
    editIntent: {
      notes: hasEditIntent(block, "notes"),
      tempo: hasEditIntent(block, "tempo"),
    },
  };

  blockResult.id = block.id || blockBacking?.id || undefined;
  blockResult.orderIndex = index + 1;
  blockResult.blockType = "SINGLE";

  if (hasEditIntent(block, "rest")) {
    blockResult.restSeconds = restSeconds;
  }

  if (hasEditIntent(block, "notes")) {
    blockResult.notes = block.notes || null;
  }

  blockResult.exercises = [
    mapExercise(exercise, 0, {
      tempo,
      restSeconds,
      restEdited: hasEditIntent(block, "rest"),
    }),
  ];

  return blockResult;
}

function mapSupersetBlockToApi(block, index) {
  const blockBacking = block.persistence || null;
  const blockResult = blockBacking
    ? { ...blockBacking }
    : {
        blockType: "SUPERSET",
        label: null,
        roundCount: normalizeNumeric(block.sets, 1),
        restStrategy: "AFTER_ROUND",
        restSeconds: parseRestSeconds(block.rest),
        notes: block.notes || null,
      };
  const restSeconds = parseRestSeconds(block.rest);
  const restEdited = hasEditIntent(block, "rest");

  blockResult.id = block.id || blockBacking?.id || undefined;
  blockResult.orderIndex = index + 1;
  blockResult.blockType = "SUPERSET";

  if (hasEditIntent(block, "roundCount")) {
    blockResult.roundCount = normalizeNumeric(block.sets, 1);
  }

  if (restEdited) {
    blockResult.restSeconds = restSeconds;
  }

  if (hasEditIntent(block, "notes")) {
    blockResult.notes = block.notes || null;
  }

  blockResult.exercises = (block.exercises || []).map((exercise, exerciseIndex) =>
    mapExercise(exercise, exerciseIndex, {
      tempo: normalizeTempoValue(exercise.tempo),
      restSeconds,
      restEdited,
    })
  );

  return blockResult;
}

export function mapBuilderBlockToApi(block, index) {
  if (block?.persistence?.opaqueBlock) {
    return block.persistence.opaqueBlock;
  }

  if (block.type === "cardio") {
    return mapCardioBlockToApi(block, index);
  }

  if (block.type === "superset") {
    return mapSupersetBlockToApi(block, index);
  }

  return mapSingleBlockToApi(block, index);
}

export function mapBuilderWorkoutToApi(workout, index, options = {}) {
  const backing = workout.persistence || {};
  const result = {
    id: workout.id || backing.id,
    name: String(workout.name || "").trim(),
    orderIndex: index + 1,
    estimatedDurationMinutes: backing.estimatedDurationMinutes ?? null,
    notes: backing.notes ?? null,
    blocks: (workout.blocks || []).map(mapBuilderBlockToApi),
  };

  if (options.includeScheduledDay) {
    result.scheduledDay = Object.prototype.hasOwnProperty.call(workout, "scheduledDay")
      ? workout.scheduledDay || null
      : backing.scheduledDay || null;
  }

  return result;
}
