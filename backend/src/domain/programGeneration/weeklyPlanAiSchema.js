const Ajv = require('ajv');

const AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION = 4;
const AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION = 4;
const AI_WEEKLY_PLAN_BODY_PARTS = Object.freeze([
  'abs',
  'back',
  'biceps',
  'calves',
  'chest',
  'glutes',
  'hamstrings',
  'quadriceps',
  'shoulders',
  'triceps',
]);
const AI_WEEKLY_PLAN_OMISSION_REASON_CODES = Object.freeze([
  'explicit_deprioritization',
  'confirmed_constraint',
  'limited_by_eligible_pool',
  'specialization_tradeoff',
  'session_structure_tradeoff',
  'other',
]);

const AI_WEEKLY_PLAN_LIMITS = Object.freeze({
  planNameMaxLength: 80,
  strategySummaryMaxLength: 1000,
  workoutMaxCount: 7,
  blocksPerWorkoutMaxCount: 12,
  exercisesPerBlockMaxCount: 2,
  setTemplatesMaxCount: 6,
  exerciseNameMaxLength: 120,
  notesMaxLength: 240,
  restSecondsMin: 30,
  restSecondsMax: 300,
  targetRirMin: 0,
  targetRirMax: 4,
  repsMin: 1,
  repsMax: 100,
  explanationMaxLength: 600,
  durationSecondsMax: 86400,
});

const AI_WEEKLY_PLAN_BLOCK_TYPES = Object.freeze(['SINGLE', 'SUPERSET', 'CARDIO']);
const AI_WEEKLY_PLAN_SET_TYPES = Object.freeze(['WORKING']);
const AI_WEEKLY_PLAN_SPLIT_TYPES = Object.freeze([
  'full_body',
  'upper_lower',
  'push_pull_legs',
  'body_part_split',
  'hybrid',
  'custom',
]);
const AI_WEEKLY_PLAN_PROGRESSION_TYPES = Object.freeze([
  'double_progression',
  'linear_progression',
  'rir_based',
  'maintenance',
]);
const AI_WEEKLY_PLAN_HEART_RATE_TARGET_MODES = Object.freeze(['none', 'avg_bpm', 'zone']);

let compiledValidator = null;

function nullable(schema) {
  return {
    ...schema,
    type: Array.isArray(schema.type) ? Array.from(new Set([...schema.type, 'null'])) : [schema.type, 'null'],
  };
}

function buildStringSchema(minLength, maxLength) {
  return {
    type: 'string',
    minLength,
    maxLength,
  };
}

function buildMachineSettingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'value'],
    properties: {
      key: buildStringSchema(1, 60),
      value: {
        anyOf: [
          buildStringSchema(1, 80),
          {
            type: 'number',
          },
        ],
      },
    },
  };
}

function buildCardioPrescriptionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'durationMinutes',
      'heartRateTargetMode',
      'heartRateTargetValue',
      'machineSettings',
      'notes',
    ],
    properties: {
      durationMinutes: {
        type: 'integer',
        minimum: 1,
        maximum: 120,
      },
      heartRateTargetMode: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_HEART_RATE_TARGET_MODES,
      },
      heartRateTargetValue: nullable({
        type: 'integer',
        minimum: 1,
        maximum: 240,
      }),
      machineSettings: {
        type: 'array',
        maxItems: 2,
        items: buildMachineSettingSchema(),
      },
      notes: nullable(buildStringSchema(1, AI_WEEKLY_PLAN_LIMITS.notesMaxLength)),
    },
  };
}

function buildRepCountSchema() {
  return {
    type: 'integer',
    minimum: AI_WEEKLY_PLAN_LIMITS.repsMin,
    maximum: AI_WEEKLY_PLAN_LIMITS.repsMax,
  };
}

function buildSetTemplateVariant(repTargetProperties) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'setIndex',
      'setType',
      'targetReps',
      'minReps',
      'maxReps',
      'targetSeconds',
      'targetRir',
      'tempo',
      'restSeconds',
    ],
    properties: {
      setIndex: {
        type: 'integer',
        minimum: 1,
        maximum: AI_WEEKLY_PLAN_LIMITS.setTemplatesMaxCount,
      },
      setType: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_SET_TYPES,
      },
      ...repTargetProperties,
      targetRir: {
        type: 'number',
        minimum: AI_WEEKLY_PLAN_LIMITS.targetRirMin,
        maximum: AI_WEEKLY_PLAN_LIMITS.targetRirMax,
      },
      tempo: {
        type: 'string',
        pattern: '^[0-9]{4}$',
      },
      restSeconds: {
        type: 'integer',
        minimum: AI_WEEKLY_PLAN_LIMITS.restSecondsMin,
        maximum: AI_WEEKLY_PLAN_LIMITS.restSecondsMax,
      },
    },
  };
}

function buildSetTemplateSchema() {
  return {
    anyOf: [
      buildSetTemplateVariant({
        targetReps: buildRepCountSchema(),
        minReps: { type: 'null' },
        maxReps: { type: 'null' },
        targetSeconds: { type: 'null' },
      }),
      buildSetTemplateVariant({
        targetReps: { type: 'null' },
        minReps: buildRepCountSchema(),
        maxReps: buildRepCountSchema(),
        targetSeconds: { type: 'null' },
      }),
      buildSetTemplateVariant({
        targetReps: { type: 'null' },
        minReps: { type: 'null' },
        maxReps: { type: 'null' },
        targetSeconds: {
          type: 'integer',
          minimum: 1,
          maximum: AI_WEEKLY_PLAN_LIMITS.durationSecondsMax,
        },
      }),
    ],
  };
}

function buildExerciseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'exerciseId',
      'exerciseName',
      'orderIndex',
      'bodyParts',
      'muscleFocus',
      'defaultTempo',
      'defaultRestSeconds',
      'defaultTargetRir',
      'setTemplates',
      'cardioPrescription',
      'notes',
    ],
    properties: {
      exerciseId: buildStringSchema(1, 120),
      exerciseName: buildStringSchema(1, AI_WEEKLY_PLAN_LIMITS.exerciseNameMaxLength),
      orderIndex: {
        type: 'integer',
        minimum: 1,
        maximum: AI_WEEKLY_PLAN_LIMITS.exercisesPerBlockMaxCount,
      },
      bodyParts: {
        type: 'array',
        maxItems: 10,
        items: buildStringSchema(1, 80),
      },
      muscleFocus: {
        type: 'array',
        maxItems: 20,
        items: buildStringSchema(1, 100),
      },
      defaultTempo: nullable({
        type: 'string',
        pattern: '^[0-9]{4}$',
      }),
      defaultRestSeconds: nullable({
        type: 'integer',
        minimum: AI_WEEKLY_PLAN_LIMITS.restSecondsMin,
        maximum: AI_WEEKLY_PLAN_LIMITS.restSecondsMax,
      }),
      defaultTargetRir: nullable({
        type: 'number',
        minimum: AI_WEEKLY_PLAN_LIMITS.targetRirMin,
        maximum: AI_WEEKLY_PLAN_LIMITS.targetRirMax,
      }),
      setTemplates: {
        type: 'array',
        maxItems: AI_WEEKLY_PLAN_LIMITS.setTemplatesMaxCount,
        items: buildSetTemplateSchema(),
      },
      cardioPrescription: nullable(buildCardioPrescriptionSchema()),
      notes: nullable(buildStringSchema(1, AI_WEEKLY_PLAN_LIMITS.notesMaxLength)),
    },
  };
}

function buildBlockSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['orderIndex', 'blockType', 'exercises'],
    properties: {
      orderIndex: {
        type: 'integer',
        minimum: 1,
        maximum: AI_WEEKLY_PLAN_LIMITS.blocksPerWorkoutMaxCount,
      },
      blockType: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_BLOCK_TYPES,
      },
      exercises: {
        type: 'array',
        maxItems: AI_WEEKLY_PLAN_LIMITS.exercisesPerBlockMaxCount,
        items: buildExerciseSchema(),
      },
    },
  };
}

function buildWorkoutSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'orderIndex', 'focus', 'blocks'],
    properties: {
      name: buildStringSchema(1, 80),
      orderIndex: {
        type: 'integer',
        minimum: 1,
        maximum: AI_WEEKLY_PLAN_LIMITS.workoutMaxCount,
      },
      focus: buildStringSchema(1, 160),
      blocks: {
        type: 'array',
        minItems: 1,
        maxItems: AI_WEEKLY_PLAN_LIMITS.blocksPerWorkoutMaxCount,
        items: buildBlockSchema(),
      },
    },
  };
}

function buildOmittedBodyPartSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['area', 'reasonCode', 'explanation'],
    properties: {
      area: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_BODY_PARTS,
      },
      reasonCode: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_OMISSION_REASON_CODES,
      },
      explanation: buildStringSchema(
        1,
        AI_WEEKLY_PLAN_LIMITS.explanationMaxLength
      ),
    },
  };
}

function buildMuscleDistributionDebugSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['rationale', 'omittedBodyParts'],
    properties: {
      rationale: buildStringSchema(
        1,
        AI_WEEKLY_PLAN_LIMITS.explanationMaxLength
      ),
      omittedBodyParts: {
        type: 'array',
        maxItems: AI_WEEKLY_PLAN_BODY_PARTS.length,
        items: buildOmittedBodyPartSchema(),
      },
    },
  };
}

function buildProgressionModelSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'summary'],
    properties: {
      type: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_PROGRESSION_TYPES,
      },
      summary: buildStringSchema(1, 500),
    },
  };
}

function buildSummaryPolicySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: {
      summary: buildStringSchema(1, 500),
    },
  };
}

function buildWeeklyPlanAiJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'planName',
      'sessionsPerWeek',
      'strategySummary',
      'splitType',
      'workouts',
      'muscleDistributionDebug',
      'progressionModel',
      'cautionHandling',
      'notesPolicy',
    ],
    properties: {
      schemaVersion: {
        type: 'integer',
        enum: [AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION],
      },
      planName: buildStringSchema(1, AI_WEEKLY_PLAN_LIMITS.planNameMaxLength),
      sessionsPerWeek: {
        type: 'integer',
        minimum: 1,
        maximum: AI_WEEKLY_PLAN_LIMITS.workoutMaxCount,
      },
      strategySummary: buildStringSchema(1, AI_WEEKLY_PLAN_LIMITS.strategySummaryMaxLength),
      splitType: {
        type: 'string',
        enum: AI_WEEKLY_PLAN_SPLIT_TYPES,
      },
      workouts: {
        type: 'array',
        minItems: 1,
        maxItems: AI_WEEKLY_PLAN_LIMITS.workoutMaxCount,
        items: buildWorkoutSchema(),
      },
      muscleDistributionDebug: buildMuscleDistributionDebugSchema(),
      progressionModel: buildProgressionModelSchema(),
      cautionHandling: buildSummaryPolicySchema(),
      notesPolicy: buildSummaryPolicySchema(),
    },
  };
}

function getValidator() {
  if (!compiledValidator) {
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    compiledValidator = ajv.compile(buildWeeklyPlanAiJsonSchema());
  }

  return compiledValidator;
}

function normalizeSchemaPath(instancePath = '', additionalProperty = null) {
  const segments = String(instancePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let path = '';
  segments.forEach((segment) => {
    if (/^\d+$/.test(segment)) {
      path += `[${segment}]`;
      return;
    }

    path += path ? `.${segment}` : segment;
  });

  if (additionalProperty) {
    path += path ? `.${additionalProperty}` : additionalProperty;
  }

  return path || 'root';
}

function mapAjvKeywordToIssueCode(keyword) {
  switch (keyword) {
    case 'additionalProperties':
      return 'UNKNOWN_FIELD';
    case 'required':
      return 'REQUIRED';
    case 'enum':
      return 'INVALID_ENUM';
    case 'type':
      return 'INVALID_TYPE';
    case 'minItems':
      return 'MIN_ITEMS_REQUIRED';
    case 'maxItems':
      return 'MAX_ITEMS_EXCEEDED';
    case 'minLength':
      return 'STRING_TOO_SHORT';
    case 'maxLength':
      return 'STRING_TOO_LONG';
    case 'minimum':
      return 'VALUE_TOO_SMALL';
    case 'maximum':
      return 'VALUE_TOO_LARGE';
    case 'pattern':
      return 'INVALID_FORMAT';
    default:
      return 'SCHEMA_VALIDATION_FAILED';
  }
}

function formatAjvError(error) {
  const additionalProperty = error.keyword === 'additionalProperties'
    ? error.params?.additionalProperty
    : null;
  const missingProperty = error.keyword === 'required'
    ? error.params?.missingProperty
    : null;
  const path = normalizeSchemaPath(error.instancePath, additionalProperty || missingProperty);

  return {
    code: mapAjvKeywordToIssueCode(error.keyword),
    path,
    message: error.message || 'Schema validation failed',
    expected: error.params || undefined,
    actual: undefined,
  };
}

function validateWeeklyPlanAiOutputSchema(payload = {}) {
  const validate = getValidator();
  const ok = validate(payload);

  return {
    ok,
    value: ok ? payload : null,
    issues: ok ? [] : (validate.errors || []).map(formatAjvError),
  };
}

module.exports = {
  AI_WEEKLY_PLAN_BLOCK_TYPES,
  AI_WEEKLY_PLAN_BODY_PARTS,
  AI_WEEKLY_PLAN_LIMITS,
  AI_WEEKLY_PLAN_OMISSION_REASON_CODES,
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  AI_WEEKLY_PLAN_SET_TYPES,
  buildWeeklyPlanAiJsonSchema,
  validateWeeklyPlanAiOutputSchema,
};
