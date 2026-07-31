const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  buildWeeklyPlanAiJsonSchema,
  validateWeeklyPlanAiOutputSchema,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');
const {
  clone,
  createAiOutput,
  createSetTemplate,
} = require('./weeklyPlanAiV4Fixtures');

function withSetTemplate(setTemplate) {
  const output = createAiOutput();
  output.workouts[0].blocks[0].exercises[0].setTemplates = [setTemplate];
  return output;
}

test('Output V4 exports contract and schema version 4', () => {
  assert.equal(AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION, 4);
  assert.equal(AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION, 4);
  assert.equal(validateWeeklyPlanAiOutputSchema(createAiOutput()).ok, true);
});

test('V4 workout accepts absence of every AI duration field', () => {
  const workoutSchema =
    buildWeeklyPlanAiJsonSchema().properties.workouts.items;

  assert.deepEqual(workoutSchema.required, [
    'name',
    'orderIndex',
    'focus',
    'blocks',
  ]);
  assert.deepEqual(Object.keys(workoutSchema.properties), [
    'name',
    'orderIndex',
    'focus',
    'blocks',
  ]);
});

for (const field of [
  'estimatedDurationMinutes',
  'durationCalculationDebug',
]) {
  test(`V4 rejects legacy workout field ${field}`, () => {
    const output = createAiOutput();
    output.workouts[0][field] =
      field === 'estimatedDurationMinutes' ? 15 : {};
    const result = validateWeeklyPlanAiOutputSchema(output);

    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some(
        (issue) =>
          issue.code === 'UNKNOWN_FIELD' &&
          issue.path === `workouts[0].${field}`
      ),
      true
    );
  });
}

test('setTemplate schema has complete fixed, range, and temporal variants', () => {
  const schema = buildWeeklyPlanAiJsonSchema();
  const variants =
    schema.properties.workouts.items.properties.blocks.items.properties
      .exercises.items.properties.setTemplates.items.anyOf;

  assert.equal(variants.length, 3);
  variants.forEach((variant) => {
    assert.equal(variant.additionalProperties, false);
    assert.equal(variant.required.includes('targetSeconds'), true);
  });
});

test('targetSeconds alone is valid', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    withSetTemplate(
      createSetTemplate(1, {
        targetReps: null,
        minReps: null,
        maxReps: null,
        targetSeconds: 45,
      })
    )
  );
  assert.equal(result.ok, true);
});

test('targetSeconds combined with fixed repetitions is rejected', () => {
  assert.equal(
    validateWeeklyPlanAiOutputSchema(
      withSetTemplate(
        createSetTemplate(1, {
          targetReps: 10,
          targetSeconds: 45,
        })
      )
    ).ok,
    false
  );
});

test('targetSeconds combined with a repetition range is rejected', () => {
  assert.equal(
    validateWeeklyPlanAiOutputSchema(
      withSetTemplate(
        createSetTemplate(1, {
          targetReps: null,
          minReps: 8,
          maxReps: 12,
          targetSeconds: 45,
        })
      )
    ).ok,
    false
  );
});

test('missing every prescription mode is rejected', () => {
  assert.equal(
    validateWeeklyPlanAiOutputSchema(
      withSetTemplate(
        createSetTemplate(1, {
          targetReps: null,
          minReps: null,
          maxReps: null,
          targetSeconds: null,
        })
      )
    ).ok,
    false
  );
});

test('fixed repetitions and a complete repetition range remain valid', () => {
  const fixed = withSetTemplate(createSetTemplate());
  const range = withSetTemplate(
    createSetTemplate(1, {
      targetReps: null,
      minReps: 8,
      maxReps: 12,
    })
  );

  assert.equal(validateWeeklyPlanAiOutputSchema(fixed).ok, true);
  assert.equal(validateWeeklyPlanAiOutputSchema(range).ok, true);
});

test('inverted ranges pass schema and remain a semantic concern', () => {
  const output = withSetTemplate(
    createSetTemplate(1, {
      targetReps: null,
      minReps: 12,
      maxReps: 8,
    })
  );
  assert.equal(validateWeeklyPlanAiOutputSchema(output).ok, true);
});

test('unknown root fields and obsolete schema versions are rejected', () => {
  const unknown = createAiOutput({ unexpected: true });
  const obsolete = clone(createAiOutput());
  obsolete.schemaVersion = 3;

  assert.equal(validateWeeklyPlanAiOutputSchema(unknown).ok, false);
  assert.equal(validateWeeklyPlanAiOutputSchema(obsolete).ok, false);
});
