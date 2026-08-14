const {
  normalizeCardioPrescription,
} = require('../../../services/cardioPrescription');

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function issue(path, code, message, received, expected) {
  return {
    path,
    code,
    message,
    received,
    expected,
  };
}

function unknownProperties(value, allowed) {
  if (!isPlainObject(value)) {
    return [];
  }
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

function resolvePointer(root, pointer) {
  if (pointer === '') {
    return root;
  }
  return String(pointer)
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((value, segment) => value?.[segment], root);
}

function blockForSlot(skeleton, slot) {
  const match = String(slot.pointer).match(/^\/workouts\/(\d+)\/blocks\/(\d+)/);
  return match
    ? skeleton.document.workouts?.[Number(match[1])]?.blocks?.[Number(match[2])]
    : null;
}

function validateNumberRange(value, { nullable, minimum, maximum }) {
  if (nullable && value === null) {
    return true;
  }
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validateExerciseDefaults(value, slot, skeleton) {
  const path = `$/fills/${slot.id}`;
  if (!isPlainObject(value)) {
    return [issue(
      path,
      'INVALID_EXERCISE_DEFAULTS',
      'exerciseDefaults must be an object',
      value,
      { type: 'object' }
    )];
  }

  const errors = [];
  const required = ['tempo', 'restSeconds', 'targetRir', 'targetRpe'];
  const extras = unknownProperties(value, required);
  if (extras.length) {
    errors.push(issue(
      path,
      'UNKNOWN_EXERCISE_DEFAULT_FIELD',
      'exerciseDefaults contains unknown fields',
      extras,
      required
    ));
  }
  required.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(issue(
        `${path}/${field}`,
        'MISSING_EXERCISE_DEFAULT_FIELD',
        `${field} is required`,
        undefined,
        { required: true }
      ));
    }
  });
  // null means the source prescribed no usable tempo. The domain already represents and
  // defaults that case; inventing digits here would fabricate a coaching value.
  if (
    value.tempo !== null &&
    (typeof value.tempo !== 'string' || !/^\d{4}$/.test(value.tempo))
  ) {
    errors.push(issue(
      `${path}/tempo`,
      'INVALID_TEMPO',
      'tempo must be null or contain exactly four digits',
      value.tempo,
      { nullable: true, pattern: '^\\d{4}$' }
    ));
  }

  const block = blockForSlot(skeleton, slot);
  const restMayBeNull = block?.blockType === 'SUPERSET';
  if (
    !(
      (restMayBeNull && value.restSeconds === null) ||
      (Number.isInteger(value.restSeconds) &&
        value.restSeconds >= 0 &&
        value.restSeconds <= 600)
    )
  ) {
    errors.push(issue(
      `${path}/restSeconds`,
      'INVALID_DEFAULT_REST_SECONDS',
      restMayBeNull
        ? 'restSeconds must be null or an integer from 0 to 600'
        : 'restSeconds must be an integer from 0 to 600',
      value.restSeconds,
      { nullable: restMayBeNull, minimum: 0, maximum: 600 }
    ));
  }
  if (!validateNumberRange(value.targetRir, {
    nullable: true,
    minimum: 0,
    maximum: 4,
  })) {
    errors.push(issue(
      `${path}/targetRir`,
      'INVALID_DEFAULT_TARGET_RIR',
      'targetRir must be null or a number from 0 to 4',
      value.targetRir,
      { nullable: true, minimum: 0, maximum: 4 }
    ));
  }
  if (!validateNumberRange(value.targetRpe, {
    nullable: true,
    minimum: 1,
    maximum: 10,
  })) {
    errors.push(issue(
      `${path}/targetRpe`,
      'INVALID_DEFAULT_TARGET_RPE',
      'targetRpe must be null or a number from 1 to 10',
      value.targetRpe,
      { nullable: true, minimum: 1, maximum: 10 }
    ));
  }
  if (value.targetRir != null && value.targetRpe != null) {
    errors.push(issue(
      path,
      'RIR_AND_RPE_ARE_MUTUALLY_EXCLUSIVE',
      'targetRir and targetRpe cannot both be set',
      { targetRir: value.targetRir, targetRpe: value.targetRpe },
      { maximumNonNullTargets: 1 }
    ));
  }
  return errors;
}

function validateStrengthSetTarget(value, slot) {
  const path = `$/fills/${slot.id}`;
  if (!isPlainObject(value)) {
    return [issue(
      path,
      'INVALID_STRENGTH_SET_TARGET',
      'strengthSetTarget must be an object',
      value,
      { type: 'object' }
    )];
  }

  const common = ['mode', 'targetRir', 'notes'];
  const fieldsByMode = {
    reps: [...common, 'targetReps'],
    repRange: [...common, 'minReps', 'maxReps'],
    seconds: [...common, 'targetSeconds'],
  };
  const allowed = fieldsByMode[value.mode];
  const errors = [];

  if (!allowed) {
    return [issue(
      `${path}/mode`,
      'INVALID_STRENGTH_TARGET_MODE',
      'mode must be reps, repRange, or seconds',
      value.mode,
      Object.keys(fieldsByMode)
    )];
  }
  const extras = unknownProperties(value, allowed);
  if (extras.length) {
    errors.push(issue(
      path,
      'MULTIPLE_OR_UNKNOWN_STRENGTH_TARGETS',
      'Set target must contain exactly the fields for its selected mode',
      extras,
      allowed
    ));
  }
  allowed.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(issue(
        `${path}/${field}`,
        'MISSING_STRENGTH_TARGET_FIELD',
        `${field} is required for ${value.mode}`,
        undefined,
        { required: true }
      ));
    }
  });
  if (!validateNumberRange(value.targetRir, {
    nullable: true,
    minimum: 0,
    maximum: 4,
  })) {
    errors.push(issue(
      `${path}/targetRir`,
      'INVALID_SET_TARGET_RIR',
      'targetRir must be null or a number from 0 to 4',
      value.targetRir,
      { nullable: true, minimum: 0, maximum: 4 }
    ));
  }
  if (
    value.notes !== null &&
    (typeof value.notes !== 'string' || value.notes.length > 1000)
  ) {
    errors.push(issue(
      `${path}/notes`,
      'INVALID_SET_NOTES',
      'notes must be null or a string of at most 1000 characters',
      value.notes,
      { nullable: true, maxLength: 1000 }
    ));
  }

  if (value.mode === 'reps' && (!Number.isInteger(value.targetReps) || value.targetReps <= 0)) {
    errors.push(issue(
      `${path}/targetReps`,
      'INVALID_TARGET_REPS',
      'targetReps must be a positive integer',
      value.targetReps,
      { minimum: 1 }
    ));
  }
  if (
    value.mode === 'repRange' &&
    (
      !Number.isInteger(value.minReps) ||
      value.minReps <= 0 ||
      !Number.isInteger(value.maxReps) ||
      value.maxReps <= 0 ||
      value.minReps > value.maxReps
    )
  ) {
    errors.push(issue(
      path,
      'INVALID_REP_RANGE',
      'minReps and maxReps must be positive integers with minReps <= maxReps',
      { minReps: value.minReps, maxReps: value.maxReps },
      { minimum: 1, relation: 'minReps <= maxReps' }
    ));
  }
  if (
    value.mode === 'seconds' &&
    (!Number.isInteger(value.targetSeconds) || value.targetSeconds <= 0)
  ) {
    errors.push(issue(
      `${path}/targetSeconds`,
      'INVALID_TARGET_SECONDS',
      'targetSeconds must be a positive integer',
      value.targetSeconds,
      { minimum: 1 }
    ));
  }
  return errors;
}

function validateSimpleWeeklyPlanFills({
  skeleton,
  fillOutput,
  eligibleExerciseLookup = {},
}) {
  const errors = [];
  const normalizedFills = {};
  const rootAllowed = ['schemaVersion', 'geometryHash', 'fills'];

  if (!isPlainObject(fillOutput)) {
    return {
      valid: false,
      errors: [issue(
        '$',
        'INVALID_FILL_OUTPUT',
        'Fill output must be an object',
        fillOutput,
        { type: 'object' }
      )],
      normalizedFills: null,
    };
  }
  const rootExtras = unknownProperties(fillOutput, rootAllowed);
  if (rootExtras.length) {
    errors.push(issue(
      '$',
      'UNKNOWN_FILL_OUTPUT_PROPERTY',
      'Fill output contains unknown properties',
      rootExtras,
      rootAllowed
    ));
  }
  if (fillOutput.schemaVersion !== 1) {
    errors.push(issue(
      '$/schemaVersion',
      'INVALID_FILL_SCHEMA_VERSION',
      'schemaVersion must be exactly 1',
      fillOutput.schemaVersion,
      1
    ));
  }
  if (fillOutput.geometryHash !== skeleton.geometryHash) {
    errors.push(issue(
      '$/geometryHash',
      'FILL_GEOMETRY_HASH_MISMATCH',
      'Fill geometryHash must match the skeleton',
      fillOutput.geometryHash,
      skeleton.geometryHash
    ));
  }

  const fills = isPlainObject(fillOutput.fills) ? fillOutput.fills : {};
  if (!isPlainObject(fillOutput.fills)) {
    errors.push(issue(
      '$/fills',
      'INVALID_FILLS',
      'fills must be an object',
      fillOutput.fills,
      { type: 'object' }
    ));
  }

  const slots = Array.isArray(skeleton.slots) ? skeleton.slots : [];
  const slotsById = new Map();
  slots.forEach((slot) => {
    if (slotsById.has(slot.id)) {
      errors.push(issue(
        '$/slots',
        'DUPLICATE_SLOT_ID',
        'Skeleton slot IDs must be unique',
        slot.id,
        { unique: true }
      ));
    }
    slotsById.set(slot.id, slot);
  });

  Object.keys(fills).forEach((slotId) => {
    if (!slotsById.has(slotId)) {
      errors.push(issue(
        `$/fills/${slotId}`,
        'UNKNOWN_FILL_SLOT',
        'Fill references an unknown slot',
        slotId,
        Array.from(slotsById.keys())
      ));
    }
  });
  slots.forEach((slot) => {
    if (slot.required && !Object.prototype.hasOwnProperty.call(fills, slot.id)) {
      errors.push(issue(
        `$/fills/${slot.id}`,
        'MISSING_REQUIRED_FILL',
        'Every required slot must be filled exactly once',
        undefined,
        { required: true }
      ));
    }
  });

  slots.forEach((slot) => {
    if (!Object.prototype.hasOwnProperty.call(fills, slot.id)) {
      return;
    }
    const value = fills[slot.id];
    const path = `$/fills/${slot.id}`;
    const block = blockForSlot(skeleton, slot);

    if (slot.kind === 'exerciseId') {
      const lookupItem = typeof value === 'string'
        ? eligibleExerciseLookup[value]
        : null;
      if (!lookupItem || lookupItem.exerciseId !== value) {
        errors.push(issue(
          path,
          'EXERCISE_ID_OUTSIDE_ELIGIBLE_LOOKUP',
          'exerciseId must exist in the injected eligible lookup',
          value,
          { enumSource: 'eligibleExerciseIds' }
        ));
      } else {
        const expectedTrainingType =
          block?.blockType === 'CARDIO' ? 'cardio' : 'strength';
        if (String(lookupItem.trainingType || '').toLowerCase() !== expectedTrainingType) {
          errors.push(issue(
            path,
            'EXERCISE_TRAINING_TYPE_MISMATCH',
            `${block?.blockType} requires a ${expectedTrainingType} exercise`,
            lookupItem.trainingType,
            expectedTrainingType
          ));
        }
      }
      normalizedFills[slot.id] = value;
      return;
    }

    if (slot.kind === 'exerciseDefaults') {
      errors.push(...validateExerciseDefaults(value, slot, skeleton));
      normalizedFills[slot.id] = value;
      return;
    }

    if (slot.kind === 'blockRestSeconds') {
      if (!Number.isInteger(value) || value < 0 || value > 600) {
        errors.push(issue(
          path,
          'INVALID_BLOCK_REST_SECONDS',
          'blockRestSeconds must be an integer from 0 to 600',
          value,
          { minimum: 0, maximum: 600 }
        ));
      }
      normalizedFills[slot.id] = value;
      return;
    }

    if (slot.kind === 'strengthSetTarget') {
      errors.push(...validateStrengthSetTarget(value, slot));
      normalizedFills[slot.id] = value;
      return;
    }

    if (slot.kind === 'exerciseNotes') {
      if (
        value !== null &&
        (typeof value !== 'string' || value.length > 1000)
      ) {
        errors.push(issue(
          path,
          'INVALID_EXERCISE_NOTES',
          'exerciseNotes must be null or a string of at most 1000 characters',
          value,
          { nullable: true, maxLength: 1000 }
        ));
      }
      normalizedFills[slot.id] = value;
      return;
    }

    if (slot.kind === 'cardioPrescription') {
      const exercisePrefix = slot.id.replace(/\.cardio$/, '');
      const exerciseId = fills[`${exercisePrefix}.id`];
      const lookupItem = eligibleExerciseLookup[exerciseId];
      try {
        normalizedFills[slot.id] = normalizeCardioPrescription(value, {
          path,
          modality: lookupItem?.cardioModality,
        });
      } catch (error) {
        errors.push(issue(
          path,
          'INVALID_CARDIO_PRESCRIPTION',
          error.message || 'cardioPrescription is invalid',
          value,
          { contract: 'sharedCardioPrescription' }
        ));
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    normalizedFills: errors.length === 0 ? normalizedFills : null,
  };
}

module.exports = {
  resolvePointer,
  validateSimpleWeeklyPlanFills,
};
