const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWeeklyPlanAiJsonSchema,
  validateWeeklyPlanAiOutputSchema,
} = require('../../src/domain/programGeneration/weeklyPlanAiSchema');

const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = new Set([
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSetTemplate(overrides = {}) {
  return {
    setIndex: 1,
    setType: 'WORKING',
    targetReps: 10,
    minReps: null,
    maxReps: null,
    targetRir: 2,
    tempo: '3010',
    restSeconds: 120,
    ...overrides,
  };
}

function createExercise(overrides = {}) {
  return {
    exerciseId: 'ex_bench',
    exerciseName: 'Dumbbell Bench Press',
    orderIndex: 1,
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    setTemplates: [createSetTemplate()],
    cardioPrescription: null,
    notes: null,
    ...overrides,
  };
}

function createWorkout(index = 1, overrides = {}) {
  return {
    name: `Workout ${index}`,
    orderIndex: index,
    estimatedDurationMinutes: 60,
    focus: 'Upper push',
    blocks: [
      {
        orderIndex: 1,
        blockType: 'SINGLE',
        exercises: [createExercise()],
      },
    ],
    ...overrides,
  };
}

function createValidAIOutput(overrides = {}) {
  return {
    schemaVersion: 1,
    planName: 'AI Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Simple full body plan.',
    splitType: 'full_body',
    workouts: [createWorkout()],
    volumeTargets: {
      perMuscle: [],
    },
    frequencyTargets: {
      perMuscle: [],
    },
    progressionModel: {
      type: 'double_progression',
      summary: 'Add reps before load.',
    },
    cautionHandling: {
      summary: 'Respect blocked constraints and keep cautions soft.',
    },
    notesPolicy: {
      summary: 'Use notes only when they add useful coaching context.',
    },
    ...overrides,
  };
}

function createOutputWithSetTemplate(overrides = {}) {
  const payload = clone(createValidAIOutput());
  payload.workouts[0].blocks[0].exercises[0].setTemplates = [
    createSetTemplate(overrides),
  ];
  return payload;
}

function findUnsupportedKeywords(value, path = 'root', matches = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findUnsupportedKeywords(entry, `${path}[${index}]`, matches)
    );
    return matches;
  }

  if (!value || typeof value !== 'object') {
    return matches;
  }

  Object.entries(value).forEach(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    if (UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS.has(key)) {
      matches.push(entryPath);
    }
    findUnsupportedKeywords(entry, entryPath, matches);
  });

  return matches;
}

test('validateWeeklyPlanAiOutputSchema accepts a minimal valid AI output', () => {
  const result = validateWeeklyPlanAiOutputSchema(createValidAIOutput());

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('setTemplate schema uses two complete nested anyOf variants', () => {
  const schema = buildWeeklyPlanAiJsonSchema();
  const setTemplateSchema =
    schema.properties.workouts.items.properties.blocks.items.properties.exercises
      .items.properties.setTemplates.items;
  const requiredFields = [
    'setIndex',
    'setType',
    'targetReps',
    'minReps',
    'maxReps',
    'targetRir',
    'tempo',
    'restSeconds',
  ];

  assert.equal(schema.anyOf, undefined);
  assert.equal(setTemplateSchema.anyOf.length, 2);
  setTemplateSchema.anyOf.forEach((variant) => {
    assert.equal(variant.type, 'object');
    assert.equal(variant.additionalProperties, false);
    assert.deepEqual(variant.required, requiredFields);
    assert.deepEqual(Object.keys(variant.properties), requiredFields);
  });
});

test('validateWeeklyPlanAiOutputSchema accepts an exact repetition target', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createOutputWithSetTemplate({
      targetReps: 10,
      minReps: null,
      maxReps: null,
    })
  );

  assert.equal(result.ok, true);
});

test('validateWeeklyPlanAiOutputSchema accepts a complete repetition range', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createOutputWithSetTemplate({
      targetReps: null,
      minReps: 8,
      maxReps: 12,
    })
  );

  assert.equal(result.ok, true);
});

test('validateWeeklyPlanAiOutputSchema rejects an ambiguous repetition prescription', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createOutputWithSetTemplate({
      targetReps: 10,
      minReps: 8,
      maxReps: 12,
    })
  );

  assert.equal(result.ok, false);
});

test('validateWeeklyPlanAiOutputSchema rejects a missing repetition prescription', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createOutputWithSetTemplate({
      targetReps: null,
      minReps: null,
      maxReps: null,
    })
  );

  assert.equal(result.ok, false);
});

test('validateWeeklyPlanAiOutputSchema rejects partial repetition ranges', () => {
  const cases = [
    { targetReps: null, minReps: 8, maxReps: null },
    { targetReps: null, minReps: null, maxReps: 12 },
  ];

  cases.forEach((entry) => {
    assert.equal(
      validateWeeklyPlanAiOutputSchema(createOutputWithSetTemplate(entry)).ok,
      false
    );
  });
});

test('validateWeeklyPlanAiOutputSchema leaves inverted ranges to semantic validation', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createOutputWithSetTemplate({
      targetReps: null,
      minReps: 12,
      maxReps: 8,
    })
  );

  assert.equal(result.ok, true);
});

test('validateWeeklyPlanAiOutputSchema rejects unknown fields', () => {
  const payload = createValidAIOutput({
    unexpected: true,
  });
  const result = validateWeeklyPlanAiOutputSchema(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'UNKNOWN_FIELD'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects zero workouts', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createValidAIOutput({
      workouts: [],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.path === 'workouts'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects more than seven workouts', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createValidAIOutput({
      sessionsPerWeek: 7,
      workouts: Array.from({ length: 8 }, (_, index) => createWorkout(index + 1)),
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'MAX_ITEMS_EXCEEDED'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects a workout without blocks', () => {
  const result = validateWeeklyPlanAiOutputSchema(
    createValidAIOutput({
      workouts: [createWorkout(1, { blocks: [] })],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.path === 'workouts[0].blocks'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects unsupported block types', () => {
  const giantSetPayload = clone(createValidAIOutput());
  giantSetPayload.workouts[0].blocks[0].blockType = 'GIANT_SET';

  const circuitPayload = clone(createValidAIOutput());
  circuitPayload.workouts[0].blocks[0].blockType = 'CIRCUIT';

  assert.equal(validateWeeklyPlanAiOutputSchema(giantSetPayload).ok, false);
  assert.equal(validateWeeklyPlanAiOutputSchema(circuitPayload).ok, false);
});

test('validateWeeklyPlanAiOutputSchema rejects notes that are too long', () => {
  const payload = clone(createValidAIOutput());
  payload.workouts[0].blocks[0].exercises[0].notes = 'x'.repeat(241);

  const result = validateWeeklyPlanAiOutputSchema(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'STRING_TOO_LONG'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects invalid tempo', () => {
  const payload = clone(createValidAIOutput());
  payload.workouts[0].blocks[0].exercises[0].setTemplates[0].tempo = '30X0';

  const result = validateWeeklyPlanAiOutputSchema(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_FORMAT'), true);
});

test('validateWeeklyPlanAiOutputSchema rejects RIR outside 0-4', () => {
  const payload = clone(createValidAIOutput());
  payload.workouts[0].blocks[0].exercises[0].setTemplates[0].targetRir = 5;

  const result = validateWeeklyPlanAiOutputSchema(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'VALUE_TOO_LARGE'), true);
});

test('weekly plan schema excludes unsupported Structured Outputs keywords', () => {
  assert.deepEqual(findUnsupportedKeywords(buildWeeklyPlanAiJsonSchema()), []);
});
