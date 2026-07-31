const SIMPLE_WEEKLY_PLAN_BLOCK_TYPES = Object.freeze([
  'SINGLE',
  'SUPERSET',
  'CARDIO',
]);

function assertSessionsPerWeek(sessionsPerWeek) {
  if (
    !Number.isInteger(sessionsPerWeek) ||
    sessionsPerWeek < 1 ||
    sessionsPerWeek > 7
  ) {
    throw new TypeError('sessionsPerWeek must be an integer from 1 to 7');
  }
}

function buildSimpleWeeklyPlanStructureSchema(sessionsPerWeek) {
  assertSessionsPerWeek(sessionsPerWeek);

  const properties = {
    planName: {
      type: 'string',
      minLength: 1,
    },
  };
  const required = ['planName'];

  for (let workoutIndex = 1; workoutIndex <= sessionsPerWeek; workoutIndex += 1) {
    const workoutKey = `workout_${workoutIndex}`;
    required.push(workoutKey);
    properties[workoutKey] = {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'blocks'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
        },
        blocks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'setCount'],
            properties: {
              type: {
                type: 'string',
                enum: SIMPLE_WEEKLY_PLAN_BLOCK_TYPES,
              },
              setCount: {
                type: 'integer',
                minimum: 1,
                maximum: 10,
              },
            },
          },
        },
      },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

module.exports = {
  SIMPLE_WEEKLY_PLAN_BLOCK_TYPES,
  buildSimpleWeeklyPlanStructureSchema,
};
