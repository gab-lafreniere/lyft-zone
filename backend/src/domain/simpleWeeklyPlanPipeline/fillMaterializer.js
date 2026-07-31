const { validateGeometryLock } = require('./geometryLock');

function pointerSegments(pointer) {
  return String(pointer)
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getPointerTarget(root, pointer) {
  return pointerSegments(pointer).reduce(
    (value, segment) => value?.[segment],
    root
  );
}

function setPointerValue(root, pointer, value) {
  const segments = pointerSegments(pointer);
  const property = segments.pop();
  const parent = segments.reduce((current, segment) => current[segment], root);
  parent[property] = value;
}

function applyExerciseDefaults(exercise, value) {
  exercise.defaultTempo = value.tempo;
  exercise.defaultRestSeconds = value.restSeconds;
  exercise.defaultTargetRir = value.targetRir;
  exercise.defaultTargetRpe = value.targetRpe;
}

function applyStrengthSetTarget(setTemplate, value) {
  setTemplate.targetReps = null;
  setTemplate.minReps = null;
  setTemplate.maxReps = null;
  setTemplate.targetSeconds = null;
  setTemplate.targetRir = value.targetRir;
  setTemplate.targetRpe = null;
  setTemplate.notes = value.notes;

  if (value.mode === 'reps') {
    setTemplate.targetReps = value.targetReps;
  } else if (value.mode === 'repRange') {
    setTemplate.minReps = value.minReps;
    setTemplate.maxReps = value.maxReps;
  } else if (value.mode === 'seconds') {
    setTemplate.targetSeconds = value.targetSeconds;
  }
}

function materializeSimpleWeeklyPlan({
  skeleton,
  normalizedFills,
  eligibleExerciseLookup = {},
}) {
  const document = structuredClone(skeleton.document);

  skeleton.slots.forEach((slot) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedFills, slot.id)) {
      return;
    }
    const value = normalizedFills[slot.id];

    if (slot.kind === 'exerciseId') {
      const lookupItem = eligibleExerciseLookup[value];
      const exercisePointer = slot.pointer.replace(/\/exerciseId$/, '');
      const exercise = getPointerTarget(document, exercisePointer);
      exercise.exerciseId = value;
      exercise.exerciseName = lookupItem.name;
      exercise.bodyParts = Array.isArray(lookupItem.bodyParts)
        ? [...lookupItem.bodyParts]
        : [];
      exercise.muscleFocus = Array.isArray(lookupItem.muscleFocus)
        ? [...lookupItem.muscleFocus]
        : [];
      return;
    }

    if (slot.kind === 'exerciseDefaults') {
      applyExerciseDefaults(getPointerTarget(document, slot.pointer), value);
      return;
    }

    if (slot.kind === 'strengthSetTarget') {
      applyStrengthSetTarget(getPointerTarget(document, slot.pointer), value);
      return;
    }

    if (slot.kind === 'exerciseNotes') {
      setPointerValue(document, slot.pointer, value);
      return;
    }

    setPointerValue(document, slot.pointer, value);
  });

  const geometryValidation = validateGeometryLock(
    document,
    skeleton.geometryHash
  );

  return {
    valid: geometryValidation.valid,
    document: geometryValidation.valid ? document : null,
    errors: geometryValidation.errors,
    geometryValidation,
  };
}

module.exports = {
  applyStrengthSetTarget,
  materializeSimpleWeeklyPlan,
};
