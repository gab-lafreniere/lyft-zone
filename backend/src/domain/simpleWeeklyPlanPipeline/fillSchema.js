const SIMPLE_WEEKLY_PLAN_FILL_VERSION = 1;
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

function buildProviderEntrySchema(kind, properties, required) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['slotId', 'kind', ...required],
    properties: {
      slotId: {
        type: 'string',
        minLength: 1,
      },
      kind: {
        type: 'string',
        const: kind,
      },
      ...properties,
    },
  };
}

function buildExerciseDefaultsProviderEntrySchema() {
  return buildProviderEntrySchema(
    'exerciseDefaults',
    {
      tempo: {
        type: 'string',
        pattern: '^[0-9]{4}$',
      },
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
    },
    ['tempo', 'restSeconds', 'targetRir', 'targetRpe']
  );
}

function buildStrengthSetTargetProviderEntrySchemas() {
  const commonProperties = {
    targetRir: nullable({
      type: 'number',
      minimum: 0,
      maximum: 4,
    }),
    notes: nullable({
      type: 'string',
      maxLength: 1000,
    }),
  };

  return [
      buildProviderEntrySchema(
        'strengthSetTarget',
        {
          mode: { type: 'string', const: 'reps' },
          targetReps: { type: 'integer', minimum: 1 },
          ...commonProperties,
        },
        ['mode', 'targetReps', 'targetRir', 'notes']
      ),
      buildProviderEntrySchema(
        'strengthSetTarget',
        {
          mode: { type: 'string', const: 'repRange' },
          minReps: { type: 'integer', minimum: 1 },
          maxReps: { type: 'integer', minimum: 1 },
          ...commonProperties,
        },
        ['mode', 'minReps', 'maxReps', 'targetRir', 'notes']
      ),
      buildProviderEntrySchema(
        'strengthSetTarget',
        {
          mode: { type: 'string', const: 'seconds' },
          targetSeconds: { type: 'integer', minimum: 1 },
          ...commonProperties,
        },
        ['mode', 'targetSeconds', 'targetRir', 'notes']
      ),
    ];
}

function buildCardioPrescriptionProviderEntrySchema() {
  return buildProviderEntrySchema(
    'cardioPrescription',
    {
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
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value'],
          properties: {
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
          },
        },
      },
      notes: nullable({
        type: 'string',
        maxLength: 1000,
      }),
    },
    [
      'durationMinutes',
      'heartRateTargetMode',
      'heartRateTargetValue',
      'machineSettings',
      'notes',
    ]
  );
}

function buildFillProviderEntrySchemas() {
  return [
    buildProviderEntrySchema(
      'exerciseId',
      {
        value: {
          type: 'string',
          minLength: 1,
        },
      },
      ['value']
    ),
    buildExerciseDefaultsProviderEntrySchema(),
    buildProviderEntrySchema(
      'blockRestSeconds',
      {
        value: {
          type: 'integer',
          minimum: 0,
          maximum: 600,
        },
      },
      ['value']
    ),
    ...buildStrengthSetTargetProviderEntrySchemas(),
    buildProviderEntrySchema(
      'exerciseNotes',
      {
        value: nullable({
          type: 'string',
          maxLength: 1000,
        }),
      },
      ['value']
    ),
    buildCardioPrescriptionProviderEntrySchema(),
  ];
}

function buildSimpleWeeklyPlanFillProviderSchema(skeleton = {}) {
  const slots = Array.isArray(skeleton.slots) ? skeleton.slots : [];

  return {
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
        const: skeleton.geometryHash,
      },
      fills: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          anyOf: buildFillProviderEntrySchemas(),
        },
      },
    },
  };
}

function providerEntryValue(entry) {
  switch (entry.kind) {
    case 'exerciseId':
    case 'blockRestSeconds':
    case 'exerciseNotes':
      return entry.value;
    case 'exerciseDefaults':
      return {
        tempo: entry.tempo,
        restSeconds: entry.restSeconds,
        targetRir: entry.targetRir,
        targetRpe: entry.targetRpe,
      };
    case 'strengthSetTarget': {
      const value = {
        mode: entry.mode,
        targetRir: entry.targetRir,
        notes: entry.notes,
      };
      if (entry.mode === 'reps') {
        value.targetReps = entry.targetReps;
      } else if (entry.mode === 'repRange') {
        value.minReps = entry.minReps;
        value.maxReps = entry.maxReps;
      } else if (entry.mode === 'seconds') {
        value.targetSeconds = entry.targetSeconds;
      }
      return value;
    }
    case 'cardioPrescription':
      return {
        durationMinutes: entry.durationMinutes,
        heartRateTargetMode: entry.heartRateTargetMode,
        heartRateTargetValue: entry.heartRateTargetValue,
        machineSettings: entry.machineSettings,
        notes: entry.notes,
      };
    default: {
      const error = new Error(`Unsupported provider fill kind: ${entry.kind}`);
      error.code = 'UNSUPPORTED_PROVIDER_FILL_KIND';
      throw error;
    }
  }
}

function normalizeSimpleWeeklyPlanProviderFills(value = {}) {
  if (!Array.isArray(value.fills)) {
    return value;
  }
  const fills = {};
  value.fills.forEach((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.slotId !== 'string' ||
      !entry.slotId
    ) {
      const error = new Error('Provider fill entry is invalid');
      error.code = 'INVALID_PROVIDER_FILL_ENTRY';
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(fills, entry.slotId)) {
      const error = new Error(`Duplicate provider fill slot: ${entry.slotId}`);
      error.code = 'DUPLICATE_PROVIDER_FILL_SLOT';
      throw error;
    }
    fills[entry.slotId] = providerEntryValue(entry);
  });
  return {
    schemaVersion: value.schemaVersion,
    geometryHash: value.geometryHash,
    fills,
  };
}

module.exports = {
  FILL_KINDS,
  SIMPLE_WEEKLY_PLAN_FILL_VERSION,
  STRENGTH_TARGET_MODES,
  buildSimpleWeeklyPlanFillProviderSchema,
  normalizeSimpleWeeklyPlanProviderFills,
  simpleWeeklyPlanFillSchema,
};
