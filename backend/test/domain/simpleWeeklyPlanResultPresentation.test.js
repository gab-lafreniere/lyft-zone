const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
} = require('../../src/domain/simpleWeeklyPlanPipeline/resultPresentation');

function createCompletedDocument() {
  return {
    name: 'Balanced Hypertrophy',
    workouts: [
      {
        name: 'Lower A',
        orderIndex: 2,
        blocks: [
          {
            exercises: [
              { muscleFocus: ['glutes', 'hamstrings'] },
            ],
          },
        ],
      },
      {
        name: 'Upper A',
        orderIndex: 1,
        blocks: [
          {
            exercises: [
              { muscleFocus: ['upper_chest', 'back', 'upper_chest'] },
            ],
          },
        ],
      },
    ],
  };
}

test('builds the small deterministic public presentation contract', () => {
  const input = {
    completedDocument: createCompletedDocument(),
    generatedPlanText: [
      'Balanced Hypertrophy',
      '',
      '## Summary',
      'Two balanced sessions distribute training stress across the week.',
      '',
      '## Constraints',
      'Use only comfortable ranges of motion.',
      '',
      '## Progression',
      'Add repetitions before increasing the load.',
      '',
      '## Practical Notes',
      'Keep technique consistent between sessions.',
      '',
      'Workout 1 — Upper A',
      '1. Incline Press (exr_press): 4 sets of 8 reps, 2 RIR, tempo 3010, rest 120 seconds.',
    ].join('\n'),
  };

  const first = buildSimpleWeeklyPlanResultPresentation(input);
  const second = buildSimpleWeeklyPlanResultPresentation(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    title: 'Balanced Hypertrophy',
    summary: 'Two balanced sessions distribute training stress across the week.',
    weeklyStructure: ['Upper A', 'Lower A'],
    musclePriorities: ['glutes', 'hamstrings', 'upper_chest', 'back'],
    constraintNotes: ['Use only comfortable ranges of motion.'],
    progression: 'Add repetitions before increasing the load.',
    coachingNotes: ['Keep technique consistent between sessions.'],
  });
  assert.doesNotMatch(
    JSON.stringify(first),
    /exr_press|Incline Press|4 sets|8 reps|RIR|tempo|rest 120/i
  );
});

test('uncertain or prescription-like text is omitted instead of invented', () => {
  const presentation = buildSimpleWeeklyPlanResultPresentation({
    completedDocument: createCompletedDocument(),
    generatedPlanText: [
      'Progression',
      '3 sets of 10 reps at 2 RIR with tempo 3010 and rest 90 seconds.',
      'Workout 1 — Upper A',
    ].join('\n'),
  });

  assert.equal(presentation.summary, null);
  assert.equal(presentation.progression, null);
  assert.deepEqual(presentation.constraintNotes, []);
  assert.deepEqual(presentation.coachingNotes, []);
});

test('fallback is exact and contains no generated plan text', () => {
  assert.deepEqual(
    buildSimpleWeeklyPlanResultPresentationFallback(createCompletedDocument()),
    {
      title: 'Balanced Hypertrophy',
      summary: null,
      weeklyStructure: [],
      musclePriorities: [],
      constraintNotes: [],
      progression: null,
      coachingNotes: [],
    }
  );
});
