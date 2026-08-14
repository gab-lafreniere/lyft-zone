const Ajv = require('ajv');

const {
  PROVIDER_ENTITY_GROUP_KEYS,
  buildCanonicalProviderEntities,
} = require('./providerEntityGrouping');

const SIMPLE_WEEKLY_PLAN_FILL_VERSION = 1;
const SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION = 4;
const FILL_KINDS = Object.freeze([
  'exerciseId',
  'exerciseDefaults',
  'blockRestSeconds',
  'strengthSetTarget',
  'exerciseNotes',
  'cardioPrescription',
]);
const STRENGTH_TARGET_MODES = Object.freeze([
  'reps',
  'repRange',
  'seconds',
]);

const simpleWeeklyPlanFillSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'geometryHash', 'fills'],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: SIMPLE_WEEKLY_PLAN_FILL_VERSION,
    },
    geometryHash: {
      type: 'string',
      pattern: '^sha256:[0-9a-f]{64}$',
    },
    fills: {
      type: 'object',
    },
  },
});

function nullable(schema) {
  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}

function buildProviderObjectSchema(
  properties,
  required = Object.keys(properties)
) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function buildExerciseIdProviderValueSchema() {
  return {
    type: 'string',
    minLength: 1,
  };
}

function buildExerciseNotesProviderValueSchema() {
  return nullable({
    type: 'string',
    maxLength: 1000,
  });
}

function buildExerciseDefaultsProviderSchema() {
  return buildProviderObjectSchema({
    // null is the canonical "tempo unspecified" representation across the domain:
    // the skeleton initialises defaultTempo to null, Prisma stores it nullable, and
    // mapVersionToBuilderPayload applies the 3010 presentation default when it is null.
    // A qualitative source tempo such as "controlled" is an absence, not an ambiguity,
    // so it must not be forced into a four-digit value.
    tempo: nullable({
      type: 'string',
      pattern: '^[0-9]{4}$',
    }),
    restSeconds: nullable({
      type: 'integer',
      minimum: 0,
      maximum: 600,
    }),
    targetRir: nullable({
      type: 'number',
      minimum: 0,
      maximum: 4,
    }),
    targetRpe: nullable({
      type: 'number',
      minimum: 1,
      maximum: 10,
    }),
  });
}

function buildStrengthSetTargetProviderSchemas() {
  const commonProperties = {
    targetRir: nullable({
      type: 'number',
      minimum: 0,
      maximum: 4,
    }),
    notes: buildExerciseNotesProviderValueSchema(),
  };

  return [
    buildProviderObjectSchema({
      mode: { type: 'string', const: 'reps' },
      targetReps: { type: 'integer', minimum: 1 },
      ...commonProperties,
    }),
    buildProviderObjectSchema({
      mode: { type: 'string', const: 'repRange' },
      minReps: { type: 'integer', minimum: 1 },
      maxReps: { type: 'integer', minimum: 1 },
      ...commonProperties,
    }),
    buildProviderObjectSchema({
      mode: { type: 'string', const: 'seconds' },
      targetSeconds: { type: 'integer', minimum: 1 },
      ...commonProperties,
    }),
  ];
}

function buildCardioPrescriptionProviderSchema() {
  return buildProviderObjectSchema({
    durationMinutes: {
      type: 'integer',
      minimum: 1,
    },
    heartRateTargetMode: {
      type: 'string',
      enum: ['none', 'avg_bpm', 'zone'],
    },
    heartRateTargetValue: nullable({
      type: 'integer',
      minimum: 1,
      maximum: 240,
    }),
    machineSettings: {
      type: 'array',
      maxItems: 2,
      items: buildProviderObjectSchema({
        key: {
          type: 'string',
          minLength: 1,
        },
        value: {
          anyOf: [
            { type: 'string' },
            { type: 'number' },
          ],
        },
      }),
    },
    notes: buildExerciseNotesProviderValueSchema(),
  });
}

function buildStrengthExerciseProviderSchema() {
  return buildProviderObjectSchema({
    exerciseId: buildExerciseIdProviderValueSchema(),
    defaults: buildExerciseDefaultsProviderSchema(),
    sets: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        anyOf: buildStrengthSetTargetProviderSchemas(),
      },
    },
    notes: buildExerciseNotesProviderValueSchema(),
  });
}

function buildCardioExerciseProviderSchema() {
  return buildProviderObjectSchema({
    exerciseId: buildExerciseIdProviderValueSchema(),
    prescription: buildCardioPrescriptionProviderSchema(),
    notes: buildExerciseNotesProviderValueSchema(),
  });
}

function buildBlockRestProviderSchema() {
  return buildProviderObjectSchema({
    value: {
      type: 'integer',
      minimum: 0,
      maximum: 600,
    },
  });
}

// pinGeometryHash embeds the run's hash as a const. That is a real guard on the
// provider-facing Structured Output contract, but it makes the schema unique per
// generation. Compiling a unique schema retains its generated validator source for the
// process lifetime (measured at ~87 KB per generation on a shared Ajv instance, and no
// better on a throwaway one). Internal validation therefore compiles a hash-free
// schema, which the shared instance can reuse; the geometryHash is still checked
// exactly, by identity, in normalizeSimpleWeeklyPlanProviderFills before AJV runs.
function buildSimpleWeeklyPlanFillProviderSchema(
  skeleton = {},
  { pinGeometryHash = true } = {}
) {
  const entities = buildCanonicalProviderEntities(skeleton);

  return buildProviderObjectSchema({
    schemaVersion: {
      type: 'integer',
      const: SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
    },
    geometryHash: pinGeometryHash
      ? {
        type: 'string',
        const: skeleton.geometryHash,
      }
      : {
        type: 'string',
        pattern: '^sha256:[0-9a-f]{64}$',
      },
    fills: buildProviderObjectSchema({
      strengthExercises: {
        type: 'array',
        minItems: entities.strengthExercises.length,
        maxItems: entities.strengthExercises.length,
        items: buildStrengthExerciseProviderSchema(),
      },
      cardioExercises: {
        type: 'array',
        minItems: entities.cardioExercises.length,
        maxItems: entities.cardioExercises.length,
        items: buildCardioExerciseProviderSchema(),
      },
      blockRests: {
        type: 'array',
        minItems: entities.blockRests.length,
        maxItems: entities.blockRests.length,
        items: buildBlockRestProviderSchema(),
      },
    }),
  });
}

const providerOutputAjv = new Ajv({
  allErrors: true,
  strict: false,
});

function providerFillError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = Array.isArray(details) ? details : [details];
  return error;
}

function assertProviderArrayCount(fills, key, expected) {
  const entries = fills?.[key];
  const received = Array.isArray(entries) ? entries.length : null;
  if (!Array.isArray(entries) || received !== expected) {
    const message =
      `Provider fill group ${key} count ${received ?? 'missing'} does not match expected count ${expected}`;
    throw providerFillError('PROVIDER_FILL_COUNT_MISMATCH', message, {
      path: `$/fills/${key}`,
      code: 'PROVIDER_FILL_COUNT_MISMATCH',
      message,
      received,
      expected,
    });
  }
}

function normalizeSimpleWeeklyPlanProviderFills(value = {}, skeleton = {}) {
  if (value.schemaVersion !== SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION) {
    const message =
      `Provider fill schemaVersion ${value.schemaVersion ?? 'missing'} does not match ${SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION}`;
    throw providerFillError('PROVIDER_FILL_VERSION_MISMATCH', message, {
      path: '$/schemaVersion',
      code: 'PROVIDER_FILL_VERSION_MISMATCH',
      message,
      received: value.schemaVersion ?? null,
      expected: SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
    });
  }
  if (value.geometryHash !== skeleton.geometryHash) {
    const message = 'Provider fill geometryHash does not match the skeleton';
    throw providerFillError('PROVIDER_FILL_GEOMETRY_HASH_MISMATCH', message, {
      path: '$/geometryHash',
      code: 'PROVIDER_FILL_GEOMETRY_HASH_MISMATCH',
      message,
      received: value.geometryHash ?? null,
      expected: skeleton.geometryHash,
    });
  }

  const entities = buildCanonicalProviderEntities(skeleton);
  PROVIDER_ENTITY_GROUP_KEYS.forEach((key) => {
    assertProviderArrayCount(value.fills, key, entities[key].length);
  });

  const validateOutput = providerOutputAjv.compile(
    buildSimpleWeeklyPlanFillProviderSchema(skeleton, { pinGeometryHash: false })
  );
  if (!validateOutput(value)) {
    const message = 'Provider entity-local fills do not match the v4 contract';
    throw providerFillError('INVALID_ENTITY_LOCAL_PROVIDER_FILL', message, {
      path: '$',
      code: 'INVALID_ENTITY_LOCAL_PROVIDER_FILL',
      message,
      schemaErrors: structuredClone(validateOutput.errors || []),
    });
  }

  value.fills.strengthExercises.forEach((exercise, index) => {
    const expected = entities.strengthExercises[index].setSlots.length;
    const received = exercise.sets.length;
    if (received !== expected) {
      const path = `$/fills/strengthExercises/${index}/sets`;
      const message =
        `Provider strength exercise ${index} returned ${received} sets; expected ${expected}`;
      throw providerFillError(
        'PROVIDER_STRENGTH_SET_COUNT_MISMATCH',
        message,
        {
          path,
          code: 'PROVIDER_STRENGTH_SET_COUNT_MISMATCH',
          message,
          canonicalEntityIndex: index,
          received,
          expected,
        }
      );
    }
  });

  const valuesBySlotId = new Map();
  value.fills.strengthExercises.forEach((exercise, index) => {
    const entity = entities.strengthExercises[index];
    valuesBySlotId.set(entity.exerciseIdSlot.id, exercise.exerciseId);
    valuesBySlotId.set(entity.defaultsSlot.id, exercise.defaults);
    exercise.sets.forEach((setTarget, setIndex) => {
      valuesBySlotId.set(entity.setSlots[setIndex].id, setTarget);
    });
    valuesBySlotId.set(entity.notesSlot.id, exercise.notes);
  });
  value.fills.cardioExercises.forEach((exercise, index) => {
    const entity = entities.cardioExercises[index];
    valuesBySlotId.set(entity.exerciseIdSlot.id, exercise.exerciseId);
    valuesBySlotId.set(
      entity.cardioPrescriptionSlot.id,
      exercise.prescription
    );
    valuesBySlotId.set(entity.notesSlot.id, exercise.notes);
  });
  value.fills.blockRests.forEach((blockRest, index) => {
    valuesBySlotId.set(entities.blockRests[index].restSlot.id, blockRest.value);
  });

  const slots = Array.isArray(skeleton.slots) ? skeleton.slots : [];
  return {
    schemaVersion: SIMPLE_WEEKLY_PLAN_FILL_VERSION,
    geometryHash: value.geometryHash,
    fills: Object.fromEntries(
      slots.map((slot) => [slot.id, valuesBySlotId.get(slot.id)])
    ),
  };
}

module.exports = {
  FILL_KINDS,
  PROVIDER_ENTITY_GROUP_KEYS,
  SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
  SIMPLE_WEEKLY_PLAN_FILL_VERSION,
  STRENGTH_TARGET_MODES,
  buildCanonicalProviderEntities,
  buildSimpleWeeklyPlanFillProviderSchema,
  normalizeSimpleWeeklyPlanProviderFills,
  simpleWeeklyPlanFillSchema,
};
