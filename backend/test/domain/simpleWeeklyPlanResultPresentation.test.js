const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
  extractGeneralSections,
  isUnsafePresentationLine,
} = require('../../src/domain/simpleWeeklyPlanPipeline/resultPresentation');
const {
  FALLBACK_PROGRESSION,
} = require('../../src/domain/simpleWeeklyPlanPipeline/presentationText');

const REAL_PLAN = fs.readFileSync(path.join(
  __dirname,
  '../fixtures/simpleWeeklyPlanPipeline/bound-plan/creator-out-of-pool/02-output-ai_generated-plan.txt'
), 'utf8');

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
    generatedPlanText: REAL_PLAN,
  };

  const first = buildSimpleWeeklyPlanResultPresentation(input);
  const second = buildSimpleWeeklyPlanResultPresentation(input);

  assert.deepEqual(first, second);
  assert.equal(first.title, 'Balanced Hypertrophy');
  assert.equal(first.summary, null);
  assert.deepEqual(first.weeklyStructure, ['Upper A', 'Lower A']);
  assert.deepEqual(first.musclePriorities, [
    'glutes',
    'hamstrings',
    'upperchest',
    'back',
  ]);
  assert.deepEqual(first.constraintNotes, []);
  assert.equal(first.progression, FALLBACK_PROGRESSION);
  assert.equal(first.coachingNotes.length, 3);
  assert.match(first.coachingNotes[0], /those sets into shoulder/i);
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
  assert.equal(presentation.progression, FALLBACK_PROGRESSION);
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
      progression: FALLBACK_PROGRESSION,
      coachingNotes: [],
    }
  );
});

test('normal coaching vocabulary is retained while prescription shapes are rejected', () => {
  const safe =
    'Keep reps clean, sets consistent, rest controlled, tempo steady, and RIR appropriate.';
  assert.equal(isUnsafePresentationLine(safe), false);
  assert.deepEqual(
    extractGeneralSections(`## Coaching notes\n- ${safe}`).coachingNotes,
    [safe]
  );

  for (const unsafe of [
    'Use exr_incline_press next.',
    'exerciseId: exr_press',
    'Perform 4 x 8 with control.',
    'Complete **4** sets before moving on.',
    'Complete 4 sets before moving on.',
    'Stop at RIR 2.',
    'Use 3-0-1-0 tempo.',
    '1. Incline press',
    'A. Incline press',
    'Workout 2 Upper focus',
  ]) {
    assert.equal(isUnsafePresentationLine(unsafe), true, unsafe);
  }
});

test('unsafe lines are skipped without discarding the active section', () => {
  const sections = extractGeneralSections([
    '## Coaching notes',
    '4 sets of 8 reps.',
    'Keep the following reps controlled and repeatable.',
  ].join('\n'));
  assert.deepEqual(sections.coachingNotes, [
    'Keep the following reps controlled and repeatable.',
  ]);
});

test('real fixture heading vocabulary maps to the prescribed sections', () => {
  const headings = new Map([
    ['weekly structure', 'summary'],
    ['weekly split', 'summary'],
    ['weekly volume logic', 'summary'],
    ['overall weekly logic', 'summary'],
    ['notes', 'coachingNotes'],
    ['notes on execution', 'coachingNotes'],
    ['coaching note', 'coachingNotes'],
    ['training note', 'coachingNotes'],
    ['execution notes', 'coachingNotes'],
  ]);

  for (const [heading, target] of headings) {
    const sections = extractGeneralSections(
      `## ${heading}\nThis complete coaching sentence is long enough for extraction.`
    );
    assert.deepEqual(sections[target], [
      'This complete coaching sentence is long enough for extraction.',
    ]);
  }
});
