const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSimpleWeeklyPlanResultPresentation,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/resultPresentation');
const {
  validateCoachingNote,
  validateProgression,
  validateSummary,
  validateTitle,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/presentationText');
const {
  normalizeWorkoutNames,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/workoutNameNormalization');

const FIXTURE_ROOT = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline'
);
const FIXTURES = [
  ['fixture-a', 'real-call3-fixtures/fixture-a'],
  ['fixture-b', 'real-call3-fixtures/fixture-b'],
  ['creator-fewer-workouts', 'bound-plan/creator-fewer-workouts'],
  ['creator-out-of-pool', 'bound-plan/creator-out-of-pool'],
  ['creator-superset-unequal', 'bound-plan/creator-superset-unequal'],
  ['smoke-202258', 'bound-plan/smoke-202258'],
  ['smoke-203739', 'bound-plan/smoke-203739'],
  ['smoke-203907', 'bound-plan/smoke-203907'],
];

function loadFixture(relativeDirectory) {
  return fs.readFileSync(
    path.join(FIXTURE_ROOT, relativeDirectory, '02-output-ai_generated-plan.txt'),
    'utf8'
  );
}

function sourceWorkoutNames(text) {
  return Array.from(
    text.matchAll(/^#{1,2}\s+((?:Day|Session|Workout)\s+\d+\b.*)$/gim),
    (match) => match[1]
  );
}

function createCompletedDocument(text) {
  const rawNames = sourceWorkoutNames(text);
  const workouts = normalizeWorkoutNames(
    rawNames.map((name, index) => ({ name, orderIndex: index + 1, blocks: [] }))
  ).workouts;
  return {
    name: 'Fixture Hypertrophy Plan',
    sessionsPerWeek: workouts.length,
    workouts,
  };
}

function presentationStrings(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(presentationStrings);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(presentationStrings);
  }
  return [];
}

for (const [fixtureId, relativeDirectory] of FIXTURES) {
  test(`${fixtureId} produces deterministic, sanitized, bounded presentation`, () => {
    const generatedPlanText = loadFixture(relativeDirectory);
    const completedDocument = createCompletedDocument(generatedPlanText);
    const input = { generatedPlanText, completedDocument };
    const first = buildSimpleWeeklyPlanResultPresentation(input);
    const second = buildSimpleWeeklyPlanResultPresentation(input);

    assert.deepEqual(first, second);
    assert.equal(validateTitle(first.title).ok, true);
    if (first.summary !== null) {
      assert.equal(validateSummary(first.summary).ok, true);
    }
    assert.equal(validateProgression(first.progression).ok, true);
    first.coachingNotes.forEach((note) => {
      assert.equal(validateCoachingNote(note).ok, true);
    });

    presentationStrings(first).forEach((value) => {
      assert.doesNotMatch(value, /\*\*|__/);
      assert.doesNotMatch(value, /^\s*[-*•]\s+/);
      assert.doesNotMatch(value, /—|–/);
      assert.doesNotMatch(value, /[-:,]\s*$/);
    });
    assert.doesNotMatch(
      JSON.stringify(first),
      /\bexr_[A-Za-z0-9_-]+|\b\d+\s*(?:sets?|reps?)\b|\bRIR\s*\d|\b\d\s*-\s*\d\s*-\s*\d\s*-\s*\d\b/i
    );

    const normalizedNames = completedDocument.workouts.map((workout) => workout.name);
    assert.equal(
      new Set(normalizedNames.map((name) => name.toLowerCase())).size,
      normalizedNames.length
    );
    normalizedNames.forEach((name) => {
      assert.doesNotMatch(name, /^(?:Day|Session|Workout|Jour)\s*\d+\b/i);
    });
  });
}

for (const fixtureId of ['creator-fewer-workouts', 'smoke-203907']) {
  test(`${fixtureId} retains at least two real coaching notes`, () => {
    const relativeDirectory = FIXTURES.find(([id]) => id === fixtureId)[1];
    const generatedPlanText = loadFixture(relativeDirectory);
    const presentation = buildSimpleWeeklyPlanResultPresentation({
      generatedPlanText,
      completedDocument: createCompletedDocument(generatedPlanText),
    });
    assert.ok(presentation.coachingNotes.length >= 2);
  });
}
