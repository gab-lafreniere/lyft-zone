const BOUND_PLAN_SCHEMA_VERSION = 1;
const BOUND_PLAN_FORMAT_NAME = 'simple_weekly_plan_bound_plan_v1';
const BOUND_PLAN_BLOCK_TYPES = Object.freeze([
  'SINGLE',
  'SUPERSET',
  'CARDIO',
]);
const {
  buildPresentationSchema,
} = require('./structureSchema');

// Structured Outputs runs with strict: true (services/simpleWeeklyPlanAiProvider.js).
// Under strict mode every property must appear in `required`, so optionality is
// expressed as an explicit null union, exactly as fillSchema.js already does.
function nullable(schema) {
  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}

function closedObject(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

// A verbatim span is copied from the source plan. It is never normalized by the
// binder; the backend owns every conversion. Keeping these as opaque strings is
// what makes span verification possible.
function verbatimSpan() {
  return nullable({ type: 'string', minLength: 1, maxLength: 1000 });
}

function buildMachineSettingSchema() {
  return closedObject({
    key: { type: 'string', minLength: 1, maxLength: 40 },
    value: { type: 'string', minLength: 1, maxLength: 80 },
  });
}

function buildBoundExerciseSchema() {
  return closedObject({
    // Verbatim, and additionally required to be an exact eligible-pool member.
    exerciseId: { type: 'string', minLength: 1, maxLength: 120 },
    // The only numeric field the binder returns. Structural cardinality cannot be
    // a span because it sizes setTemplates before the skeleton and geometryHash exist.
    sets: nullable({ type: 'integer', minimum: 1, maximum: 10 }),
    reps: verbatimSpan(),
    rir: verbatimSpan(),
    rpe: verbatimSpan(),
    tempo: verbatimSpan(),
    // Exercise-scoped rest only. Round-scoped rest belongs to the block.
    rest: verbatimSpan(),
    duration: verbatimSpan(),
    intensity: verbatimSpan(),
    machineSettings: nullable({
      type: 'array',
      maxItems: 2,
      items: buildMachineSettingSchema(),
    }),
    notes: verbatimSpan(),
  });
}

function buildBoundBlockSchema() {
  return closedObject({
    // The binder reads the relationship Call #1 already created. It does not
    // decide that two exercises should become a superset.
    type: { type: 'string', enum: BOUND_PLAN_BLOCK_TYPES },
    // Non-null only when Call #1 scoped a rest to the whole superset round.
    // Carrying scope here is what removes prose rest-scope parsing from the backend.
    restAfterRound: verbatimSpan(),
    exercises: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: buildBoundExerciseSchema(),
    },
  });
}

function buildBoundWorkoutSchema() {
  return closedObject({
    name: { type: 'string', minLength: 1, maxLength: 200 },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: buildBoundBlockSchema(),
    },
  });
}

// Deliberately NOT parameterised by sessionsPerWeek.
//
// The legacy structure schema required exactly workout_1..workout_N, which forced
// the binder to fabricate a workout whenever Call #1 produced fewer. Workout count
// is a Call #1 constraint (programGenerationProfileNarrative.js states it to the
// coach); the binder must report what the source contains and let the backend
// compare. See product decision D1.
function buildSimpleWeeklyPlanBoundPlanSchema({
  presentationContractEnabled = true,
} = {}) {
  return closedObject({
    schemaVersion: {
      type: 'integer',
      const: BOUND_PLAN_SCHEMA_VERSION,
    },
    planName: { type: 'string', minLength: 1, maxLength: 200 },
    ...(presentationContractEnabled
      ? { presentation: buildPresentationSchema() }
      : {}),
    workouts: {
      type: 'array',
      minItems: 1,
      maxItems: 7,
      items: buildBoundWorkoutSchema(),
    },
  });
}

module.exports = {
  BOUND_PLAN_BLOCK_TYPES,
  BOUND_PLAN_FORMAT_NAME,
  BOUND_PLAN_SCHEMA_VERSION,
  buildSimpleWeeklyPlanBoundPlanSchema,
};
