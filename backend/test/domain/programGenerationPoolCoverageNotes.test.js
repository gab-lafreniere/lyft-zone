const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProgramGenerationPoolCoverageNotes,
} = require('../../src/domain/programGeneration/programGenerationPromptInputBuilder');

function createPool(strengthExercises = []) {
  return {
    strengthExercises,
    cardioExercises: [],
  };
}

function createExercise(exerciseId, bodyParts = [], muscleFocus = []) {
  return {
    exerciseId,
    bodyParts,
    muscleFocus,
  };
}

function findNote(notes, taxonomy, area) {
  return notes.find(
    (note) => note.taxonomy === taxonomy && note.area === area
  );
}

test('coverage thresholds count unique exerciseId values once per exact taxonomy area', () => {
  const cases = [
    { count: 0, expectedLevel: 'unavailable' },
    { count: 1, expectedLevel: 'severely_limited' },
    { count: 2, expectedLevel: 'limited' },
    { count: 3, expectedLevel: null },
  ];

  cases.forEach(({ count, expectedLevel }) => {
    const exercises = Array.from({ length: count }, (_, index) =>
      createExercise(`ex_${index}`, ['chest', 'chest'], ['upper_chest'])
    );
    if (count === 1) {
      exercises.push(
        createExercise('ex_0', ['chest'], ['upper_chest', 'upper_chest'])
      );
    }
    const notes = buildProgramGenerationPoolCoverageNotes({
      eligibleExercisePool: createPool(exercises),
      musclePriorities: { primary: 'chest' },
    });
    const note = findNote(notes, 'bodyPart', 'chest');

    if (expectedLevel) {
      assert.deepEqual(note, {
        taxonomy: 'bodyPart',
        area: 'chest',
        eligibleExerciseCount: count,
        coverageLevel: expectedLevel,
      });
    } else {
      assert.equal(note, undefined);
    }
  });
});

test('coverage notes preserve priority order, ignore composites and non-priority focuses, skip deprioritized body parts, and cap at three', () => {
  const pool = createPool([
    createExercise('ex_back', ['back'], ['glute_med']),
  ]);
  const before = structuredClone(pool);
  const notes = buildProgramGenerationPoolCoverageNotes({
    eligibleExercisePool: pool,
    musclePriorities: {
      primary: 'upper_body',
      secondary: ['upper_chest', 'back', 'rear_delts'],
      deprioritized: 'chest',
    },
  });

  assert.deepEqual(notes, [
    {
      taxonomy: 'muscleFocus',
      area: 'upper_chest',
      eligibleExerciseCount: 0,
      coverageLevel: 'unavailable',
    },
    {
      taxonomy: 'bodyPart',
      area: 'back',
      eligibleExerciseCount: 1,
      coverageLevel: 'severely_limited',
    },
    {
      taxonomy: 'muscleFocus',
      area: 'rear_delts',
      eligibleExerciseCount: 0,
      coverageLevel: 'unavailable',
    },
  ]);
  assert.equal(notes.length, 3);
  assert.equal(findNote(notes, 'bodyPart', 'upper_body'), undefined);
  assert.equal(findNote(notes, 'bodyPart', 'chest'), undefined);
  assert.equal(findNote(notes, 'muscleFocus', 'glute_med'), undefined);
  assert.deepEqual(pool, before);
});

test('general body-part notes sort by severity then canonical order and are omitted when coverage is sufficient', () => {
  const sparseNotes = buildProgramGenerationPoolCoverageNotes({
    eligibleExercisePool: createPool([
      createExercise('ex_chest_1', ['chest']),
      createExercise('ex_chest_2', ['chest']),
      createExercise('ex_back', ['back']),
    ]),
    musclePriorities: {},
  });

  assert.deepEqual(
    sparseNotes.map((note) => [note.area, note.coverageLevel]),
    [
      ['shoulders', 'unavailable'],
      ['biceps', 'unavailable'],
      ['triceps', 'unavailable'],
    ]
  );

  const fullyCoveredExercises = Array.from({ length: 3 }, (_, index) =>
    createExercise(
      `ex_full_${index}`,
      [
        'chest',
        'back',
        'shoulders',
        'biceps',
        'triceps',
        'quadriceps',
        'hamstrings',
        'glutes',
        'calves',
        'abs',
      ],
      ['upper_chest']
    )
  );
  const noNotes = buildProgramGenerationPoolCoverageNotes({
    eligibleExercisePool: createPool(fullyCoveredExercises),
    musclePriorities: { primary: 'upper_chest' },
  });
  assert.deepEqual(noNotes, []);
});
