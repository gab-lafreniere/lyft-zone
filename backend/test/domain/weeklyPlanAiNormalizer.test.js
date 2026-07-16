const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWeeklyPlanAiGenerationMetadata,
  normalizeWeeklyPlanAiOutput,
} = require('../../src/domain/programGeneration/weeklyPlanAiNormalizer');

function createSetTemplate(index = 1, overrides = {}) {
  return {
    setIndex: index,
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

function createStrengthExercise(exerciseId, orderIndex, overrides = {}) {
  return {
    exerciseId,
    exerciseName: `AI Name ${exerciseId}`,
    orderIndex,
    bodyParts: ['ai_body_part'],
    muscleFocus: ['ai_focus'],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    setTemplates: [createSetTemplate()],
    cardioPrescription: null,
    notes: null,
    ...overrides,
  };
}

function createCardioExercise(overrides = {}) {
  return {
    exerciseId: 'ex_bike',
    exerciseName: 'AI Bike',
    orderIndex: 1,
    bodyParts: [],
    muscleFocus: [],
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    setTemplates: [],
    cardioPrescription: {
      durationMinutes: 20,
      heartRateTargetMode: 'none',
      heartRateTargetValue: null,
      machineSettings: [],
      notes: null,
    },
    notes: null,
    ...overrides,
  };
}

function createAIOutput() {
  return {
    schemaVersion: 1,
    planName: 'AI Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Simple full body plan.',
    splitType: 'full_body',
    workouts: [
      {
        name: 'Full Body',
        orderIndex: 1,
        estimatedDurationMinutes: 60,
        focus: 'Balanced strength plus easy cardio',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [
              createStrengthExercise('ex_bench', 1, {
                exerciseName: 'AI Bench Name',
                notes: 'Keep shoulder blades set.',
              }),
            ],
          },
          {
            orderIndex: 2,
            blockType: 'SUPERSET',
            exercises: [
              createStrengthExercise('ex_row', 1, {
                setTemplates: [createSetTemplate(1), createSetTemplate(2)],
              }),
              createStrengthExercise('ex_curl', 2, {
                setTemplates: [createSetTemplate(1), createSetTemplate(2)],
              }),
            ],
          },
          {
            orderIndex: 3,
            blockType: 'CARDIO',
            exercises: [createCardioExercise()],
          },
        ],
      },
    ],
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
      summary: 'Use notes only when useful.',
    },
  };
}

function createContext() {
  return {
    exercisePoolItems: [
      {
        exerciseId: 'ex_bench',
        name: 'Canonical Bench',
        bodyParts: ['Chest'],
        muscleFocus: ['Upper_Chest'],
      },
      {
        exerciseId: 'ex_row',
        name: 'Canonical Row',
        bodyParts: ['Back'],
        muscleFocus: ['Lats'],
      },
      {
        exerciseId: 'ex_curl',
        name: 'Canonical Curl',
        bodyParts: ['Biceps'],
        muscleFocus: ['biceps_long_head'],
      },
      {
        exerciseId: 'ex_bike',
        name: 'Canonical Bike',
        bodyParts: [],
        muscleFocus: [],
        cardioModality: 'stationary_bike',
      },
    ],
  };
}

test('normalizeWeeklyPlanAiOutput maps AI output to createWeeklyPlan document', () => {
  const document = normalizeWeeklyPlanAiOutput(createAIOutput(), {
    context: createContext(),
  });

  assert.equal(document.name, 'AI Draft');
  assert.equal(document.sessionsPerWeek, 1);
  assert.equal(document.workouts[0].name, 'Full Body');
  assert.equal(document.workouts[0].notes, 'Balanced strength plus easy cardio');
  assert.equal(document.strategySummary, undefined);
  assert.equal(document.volumeTargets, undefined);
});

test('normalizeWeeklyPlanAiOutput maps SINGLE, SUPERSET, and CARDIO blocks', () => {
  const document = normalizeWeeklyPlanAiOutput(createAIOutput(), {
    context: createContext(),
  });
  const [single, superset, cardio] = document.workouts[0].blocks;

  assert.equal(single.blockType, 'SINGLE');
  assert.equal(single.restStrategy, 'AFTER_EXERCISE');
  assert.equal(single.exercises[0].intensificationMethod, 'NONE');
  assert.equal(single.exercises[0].defaultTargetRpe, null);
  assert.equal(single.exercises[0].setTemplates[0].targetRpe, null);

  assert.equal(superset.blockType, 'SUPERSET');
  assert.equal(superset.restStrategy, 'AFTER_ROUND');
  assert.equal(superset.roundCount, 2);

  assert.equal(cardio.blockType, 'CARDIO');
  assert.equal(cardio.restStrategy, 'NONE');
  assert.deepEqual(cardio.exercises[0].setTemplates, []);
  assert.equal(cardio.exercises[0].cardioPrescription.durationMinutes, 20);
});

test('normalizeWeeklyPlanAiOutput prefers canonical pool metadata when available', () => {
  const document = normalizeWeeklyPlanAiOutput(createAIOutput(), {
    context: createContext(),
  });
  const exercise = document.workouts[0].blocks[0].exercises[0];

  assert.equal(exercise.exerciseName, 'Canonical Bench');
  assert.deepEqual(exercise.bodyParts, ['chest']);
  assert.deepEqual(exercise.muscleFocus, ['upper_chest']);
});

test('buildWeeklyPlanAiGenerationMetadata extracts audit fields without raw output', () => {
  const metadata = buildWeeklyPlanAiGenerationMetadata(createAIOutput());

  assert.equal(metadata.aiContractVersion, 1);
  assert.equal(metadata.aiOutputSchemaVersion, 1);
  assert.equal(metadata.strategySummary, 'Simple full body plan.');
  assert.equal(metadata.splitType, 'full_body');
  assert.equal(metadata.workouts, undefined);
});
