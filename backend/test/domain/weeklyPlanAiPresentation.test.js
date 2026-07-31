const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_WEEKLY_PLAN_PRESENTATION_SCHEMA_VERSION,
  buildAIWeeklyPlanPresentation,
} = require('../../src/domain/programGeneration/weeklyPlanAiPresentation');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInputs() {
  return {
    context: {
      musclePriorityProfile: {
        primaryFocus: 'upper_chest',
        secondaryFocuses: ['back', 'rear_delts', 'back'],
        deprioritizedArea: 'quads',
        weights: {
          primary: 1,
          secondary: 0.7,
          deprioritized: 0.35,
        },
        perAreaWeights: {
          upper_chest: 1,
          back: 0.7,
          rear_delts: 0.7,
          quads: 0.35,
        },
        privateProfileSnapshot: 'PRIVATE_PROFILE_SENTINEL',
      },
      generationContext: 'PRIVATE_GENERATION_CONTEXT_SENTINEL',
      poolSnapshot: 'PRIVATE_POOL_SENTINEL',
    },
    generatedAIOutput: {
      strategySummary: '  Prioritize the upper chest with balanced back work.  ',
      splitType: 'upper_lower',
      provider: {
        model: 'PRIVATE_MODEL_SENTINEL',
        responseId: 'PRIVATE_RESPONSE_ID_SENTINEL',
      },
      prompt: 'PRIVATE_PROMPT_SENTINEL',
      workouts: [
        {
          orderIndex: 2,
          name: 'AI Lower',
          focus: 'Quads and posterior chain',
          estimatedDurationMinutes: 999,
        },
        {
          orderIndex: 1,
          name: 'AI Upper',
          focus: 'Upper chest and back',
          estimatedDurationMinutes: 888,
        },
      ],
    },
    generatedPlanDocument: {
      name: 'Persisted final plan',
      workouts: [
        {
          orderIndex: 2,
          name: 'Lower A',
          estimatedDurationMinutes: 999,
          notes: 'PRIVATE_INTERNAL_NOTE_SENTINEL',
          blocks: [
            {
              blockType: 'SINGLE',
              exercises: [
                {
                  exerciseId: 'PRIVATE_EXERCISE_ID_SENTINEL',
                  setTemplates: [
                    { setType: 'WARMUP' },
                    { setType: 'WORKING' },
                  ],
                },
              ],
            },
          ],
        },
        {
          orderIndex: 1,
          name: 'Upper A',
          estimatedDurationMinutes: 888,
          blocks: [
            {
              blockType: 'SUPERSET',
              exercises: [
                {
                  exerciseId: 'ex_press',
                  setTemplates: [
                    { setType: 'WARMUP' },
                    { setType: 'WORKING' },
                    { setType: 'WORKING' },
                  ],
                },
                {
                  exerciseId: 'ex_row',
                  setTemplates: [
                    { setType: 'WORKING' },
                    { setType: 'DROPSHIP' },
                  ],
                },
              ],
            },
            {
              blockType: 'CARDIO',
              exercises: [
                {
                  exerciseId: 'ex_bike',
                  setTemplates: [],
                },
              ],
            },
          ],
        },
      ],
    },
    analytics: {
      schemaVersion: 2,
      prompt: 'PRIVATE_ANALYTICS_SENTINEL',
      workouts: [
        {
          workoutOrderIndex: 2,
          calculatedDurationMinutes: 41,
          strengthExerciseCount: 1,
          cardioExerciseCount: 0,
          workingSetCount: 1,
          durationDifferenceMinutes: -19,
        },
        {
          workoutOrderIndex: 1,
          calculatedDurationMinutes: 58,
          strengthExerciseCount: 2,
          cardioExerciseCount: 1,
          workingSetCount: 3,
          durationDifferenceMinutes: -2,
        },
      ],
    },
  };
}

test('buildAIWeeklyPlanPresentation returns the exact versioned public contract', () => {
  const presentation = buildAIWeeklyPlanPresentation(createInputs());

  assert.equal(AI_WEEKLY_PLAN_PRESENTATION_SCHEMA_VERSION, 1);
  assert.deepEqual(presentation, {
    schemaVersion: 1,
    strategySummary: 'Prioritize the upper chest with balanced back work.',
    splitType: 'upper_lower',
    focusAreas: {
      primary: ['upper_chest'],
      secondary: ['back', 'rear_delts'],
      deprioritized: ['quads'],
    },
    workouts: [
      {
        orderIndex: 1,
        name: 'Upper A',
        focus: 'Upper chest and back',
        calculatedDurationMinutes: 58,
        exerciseCount: 3,
        workingSetCount: 3,
      },
      {
        orderIndex: 2,
        name: 'Lower A',
        focus: 'Quads and posterior chain',
        calculatedDurationMinutes: 41,
        exerciseCount: 1,
        workingSetCount: 1,
      },
    ],
  });
});

test('strategySummary and splitType come only from the final AI output', () => {
  const inputs = createInputs();
  inputs.generatedPlanDocument.strategySummary = 'PRIVATE_DOCUMENT_STRATEGY';
  inputs.analytics.plan = { splitType: 'private_analytics_split' };

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.equal(
    presentation.strategySummary,
    'Prioritize the upper chest with balanced back work.'
  );
  assert.equal(presentation.splitType, 'upper_lower');
  assert.doesNotMatch(
    JSON.stringify(presentation),
    /PRIVATE_DOCUMENT_STRATEGY|private_analytics_split/
  );
});

test('strategySummary is normalized to a short public string', () => {
  const inputs = createInputs();
  inputs.generatedAIOutput.strategySummary = `  ${'x'.repeat(700)}  `;

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.equal(presentation.strategySummary.length, 500);
  assert.equal(presentation.strategySummary, 'x'.repeat(500));
});

test('focusAreas is an explicit allowlist of final context priorities', () => {
  const presentation = buildAIWeeklyPlanPresentation(createInputs());

  assert.deepEqual(Object.keys(presentation.focusAreas).sort(), [
    'deprioritized',
    'primary',
    'secondary',
  ]);
  assert.deepEqual(presentation.focusAreas, {
    primary: ['upper_chest'],
    secondary: ['back', 'rear_delts'],
    deprioritized: ['quads'],
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(presentation.focusAreas, 'weights'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      presentation.focusAreas,
      'perAreaWeights'
    ),
    false
  );
});

test('workout durations come only from final backend Analytics', () => {
  const presentation = buildAIWeeklyPlanPresentation(createInputs());

  assert.deepEqual(
    presentation.workouts.map((workout) => workout.calculatedDurationMinutes),
    [58, 41]
  );
  assert.doesNotMatch(JSON.stringify(presentation), /888|999/);
});

test('workouts and their AI focus are paired and sorted by orderIndex', () => {
  const presentation = buildAIWeeklyPlanPresentation(createInputs());

  assert.deepEqual(
    presentation.workouts.map(({ orderIndex, name, focus }) => ({
      orderIndex,
      name,
      focus,
    })),
    [
      {
        orderIndex: 1,
        name: 'Upper A',
        focus: 'Upper chest and back',
      },
      {
        orderIndex: 2,
        name: 'Lower A',
        focus: 'Quads and posterior chain',
      },
    ]
  );
});

test('exercise counts use final Analytics when available', () => {
  const inputs = createInputs();
  inputs.analytics.workouts[1].strengthExerciseCount = 7;
  inputs.analytics.workouts[1].cardioExerciseCount = 2;

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.equal(presentation.workouts[0].exerciseCount, 9);
});

test('exercise counts fall back deterministically to final plan structure', () => {
  const inputs = createInputs();
  delete inputs.analytics.workouts[1].strengthExerciseCount;
  delete inputs.analytics.workouts[1].cardioExerciseCount;

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.equal(presentation.workouts[0].exerciseCount, 3);
});

test('workingSetCount fallback counts only WORKING set templates', () => {
  const inputs = createInputs();
  delete inputs.analytics.workouts[1].workingSetCount;

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.equal(presentation.workouts[0].workingSetCount, 3);
});

test('missing optional inputs produce safe nulls, empty lists, and zero counts', () => {
  assert.deepEqual(buildAIWeeklyPlanPresentation(), {
    schemaVersion: 1,
    strategySummary: null,
    splitType: null,
    focusAreas: {
      primary: [],
      secondary: [],
      deprioritized: [],
    },
    workouts: [],
  });

  const presentation = buildAIWeeklyPlanPresentation({
    generatedPlanDocument: {
      workouts: [{ orderIndex: 1, blocks: [] }],
    },
  });

  assert.deepEqual(presentation.workouts, [
    {
      orderIndex: 1,
      name: null,
      focus: null,
      calculatedDurationMinutes: null,
      exerciseCount: 0,
      workingSetCount: 0,
    },
  ]);
});

test('estimatedDurationMinutes is never used when Analytics duration is absent', () => {
  const inputs = createInputs();
  inputs.analytics.workouts = [];

  const presentation = buildAIWeeklyPlanPresentation(inputs);

  assert.deepEqual(
    presentation.workouts.map((workout) => workout.calculatedDurationMinutes),
    [null, null]
  );
});

test('the builder is deterministic and does not mutate any input', () => {
  const inputs = createInputs();
  const originals = clone(inputs);

  const first = buildAIWeeklyPlanPresentation(inputs);
  const second = buildAIWeeklyPlanPresentation(inputs);

  assert.deepEqual(first, second);
  assert.deepEqual(inputs, originals);
});

test('the builder returns only allowlisted keys and no forbidden data', () => {
  const presentation = buildAIWeeklyPlanPresentation(createInputs());

  assert.deepEqual(Object.keys(presentation).sort(), [
    'focusAreas',
    'schemaVersion',
    'splitType',
    'strategySummary',
    'workouts',
  ]);
  presentation.workouts.forEach((workout) => {
    assert.deepEqual(Object.keys(workout).sort(), [
      'calculatedDurationMinutes',
      'exerciseCount',
      'focus',
      'name',
      'orderIndex',
      'workingSetCount',
    ]);
  });

  assert.doesNotMatch(
    JSON.stringify(presentation),
    /PRIVATE_|prompt|provider|model|responseId|generationContext|poolSnapshot|exerciseId|estimatedDurationMinutes|durationDifference|notes/i
  );
});
