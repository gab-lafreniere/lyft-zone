const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompactExerciseLookup,
  buildEligibleExerciseLookup,
  findExerciseNameCandidates,
} = require('../../src/domain/simpleWeeklyPlanPipeline/compactExerciseLookup');

const eligibleExerciseLookup = {
  exr_incline_press: {
    exerciseId: 'exr_incline_press',
    name: 'Incline Dumbbell Press',
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    trainingType: 'strength',
    cardioModality: null,
  },
  exr_incline_machine_press: {
    exerciseId: 'exr_incline_machine_press',
    name: 'Incline Machine Press',
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    trainingType: 'strength',
    cardioModality: null,
  },
  exr_flat_press: {
    exerciseId: 'exr_flat_press',
    name: 'Flat Dumbbell Press',
    bodyParts: ['chest'],
    muscleFocus: [],
    trainingType: 'strength',
    cardioModality: null,
  },
  exr_cable_press: {
    exerciseId: 'exr_cable_press',
    name: 'Standing Cable Press',
    bodyParts: ['chest'],
    muscleFocus: [],
    trainingType: 'strength',
    cardioModality: null,
  },
  exr_row: {
    exerciseId: 'exr_row',
    name: 'Cable Row',
    bodyParts: ['back'],
    muscleFocus: ['mid_back'],
    trainingType: 'strength',
    cardioModality: null,
  },
};

test('eligible pool projection retains the enriched in-memory lookup fields', () => {
  const result = buildEligibleExerciseLookup({
    pool: {
      items: [
        {
          exerciseId: 'exr_row',
          name: 'Cable Row',
          trainingType: 'STRENGTH',
          attributes: {
            bodyParts: ['back'],
            muscleFocus: ['mid_back'],
            cardioModality: null,
          },
        },
      ],
    },
  });

  assert.deepEqual(result.exr_row, eligibleExerciseLookup.exr_row);
});

test('compact lookup sends only exact eligible IDs when every exercise has one', () => {
  const lookup = buildCompactExerciseLookup({
    generatedPlanText: [
      'SINGLE — Incline Dumbbell Press (exr_incline_press): 3 sets of 8 reps.',
      'SINGLE — Cable Row (exr_row): 3 sets of 10 reps.',
    ].join('\n'),
    eligibleExerciseLookup,
  });

  assert.deepEqual(
    lookup.items.map((item) => item.exerciseId),
    ['exr_incline_press', 'exr_row']
  );
  assert.equal(lookup.text.includes('exr_flat_press'), false);
  assert.equal(lookup.text.includes('bodyParts'), false);
  assert.deepEqual(lookup.unresolvedNames, []);
});

test('compact lookup rejects an exact ID outside the eligible pool', () => {
  assert.throws(
    () =>
      buildCompactExerciseLookup({
        generatedPlanText:
          'SINGLE — Unknown (exr_outside_pool): 3 sets of 10 reps.',
        eligibleExerciseLookup,
      }),
    (error) =>
      error.code === 'EXERCISE_ID_OUTSIDE_ELIGIBLE_POOL' &&
      error.details.exerciseIds[0] === 'exr_outside_pool'
  );
});

test('name fallback adds at most three eligible candidates for each unresolved name', () => {
  const lookup = buildCompactExerciseLookup({
    generatedPlanText:
      'SINGLE — Incline Dumbbell Press: 3 sets of 8–12 reps.',
    eligibleExerciseLookup,
  });
  const candidateIds =
    lookup.candidatesByName['Incline Dumbbell Press'];

  assert.ok(candidateIds);
  assert.ok(candidateIds.length > 0);
  assert.ok(candidateIds.length <= 3);
  assert.deepEqual(
    lookup.items.map((item) => item.exerciseId).sort(),
    [...candidateIds].sort()
  );
  assert.equal(lookup.items.some((item) => item.exerciseId === 'exr_row'), false);
  assert.equal(
    findExerciseNameCandidates(
      'press',
      eligibleExerciseLookup,
      99
    ).length,
    3
  );
});
