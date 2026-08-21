const Ajv = require('ajv');
const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('./structureSchema');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
const validators = new Map();

function getValidator(sessionsPerWeek) {
  if (!validators.has(sessionsPerWeek)) {
    validators.set(
      sessionsPerWeek,
      ajv.compile(buildSimpleWeeklyPlanStructureSchema(sessionsPerWeek, {
        presentationContractEnabled: false,
      }))
    );
  }
  return validators.get(sessionsPerWeek);
}

function toPath(instancePath = '', property = null) {
  const base = instancePath || '';
  const suffix = property == null
    ? ''
    : `/${String(property).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  return `$${base}${suffix}`;
}

function schemaErrorToResult(error) {
  const property = error.keyword === 'additionalProperties'
    ? error.params.additionalProperty
    : error.keyword === 'required'
      ? error.params.missingProperty
      : null;

  return {
    path: toPath(error.instancePath, property),
    code: `STRUCTURE_${String(error.keyword || 'invalid').toUpperCase()}`,
    message: error.message || 'Structure validation failed',
    received: undefined,
    expected: error.params || null,
  };
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

function validateSimpleWeeklyPlanStructure(value, { sessionsPerWeek } = {}) {
  const validateSchema = getValidator(sessionsPerWeek);
  const structureOnly = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'presentation')
    )
    : value;
  // Presentation is deliberately excluded from plan validity. Structured Output
  // constrains it at the provider boundary, while this validator remains solely
  // responsible for the geometry contract.
  const schemaValid = validateSchema(structureOnly);
  const errors = schemaValid
    ? []
    : (validateSchema.errors || []).map(schemaErrorToResult);

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (
      let workoutIndex = 1;
      workoutIndex <= sessionsPerWeek;
      workoutIndex += 1
    ) {
      const workoutKey = `workout_${workoutIndex}`;
      const workout = value[workoutKey];
      if (!workout || typeof workout !== 'object' || Array.isArray(workout)) {
        continue;
      }

      if (!String(workout.name || '').trim()) {
        errors.push(issue(
          `$/${workoutKey}/name`,
          'WORKOUT_NAME_REQUIRED',
          'Workout name must not be blank',
          workout.name,
          { minLength: 1 }
        ));
      }

      (Array.isArray(workout.blocks) ? workout.blocks : []).forEach(
        (block, blockIndex) => {
          if (
            block &&
            typeof block === 'object' &&
            !Array.isArray(block) &&
            block.type === 'CARDIO' &&
            block.setCount !== 1
          ) {
            errors.push(issue(
              `$/${workoutKey}/blocks/${blockIndex}/setCount`,
              'CARDIO_SET_COUNT_MUST_BE_ONE',
              'CARDIO setCount must be exactly 1',
              block.setCount,
              1
            ));
          }
        }
      );
    }
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof value.planName === 'string' &&
    !value.planName.trim()
  ) {
    errors.push(issue(
      '$/planName',
      'PLAN_NAME_REQUIRED',
      'planName must not be blank',
      value.planName,
      { minLength: 1 }
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateSimpleWeeklyPlanStructure,
};
