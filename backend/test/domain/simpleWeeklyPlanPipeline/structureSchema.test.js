const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureSchema');

test('dynamic structure schema exposes exactly the requested workout keys', () => {
  for (const sessionsPerWeek of [1, 3, 7]) {
    const schema = buildSimpleWeeklyPlanStructureSchema(sessionsPerWeek);
    const workoutKeys = Array.from(
      { length: sessionsPerWeek },
      (_, index) => `workout_${index + 1}`
    );

    assert.deepEqual(Object.keys(schema.properties), [
      'planName',
      'presentation',
      ...workoutKeys,
    ]);
    assert.deepEqual(schema.required, [
      'planName',
      'presentation',
      ...workoutKeys,
    ]);
    assert.equal(schema.additionalProperties, false);
    workoutKeys.forEach((workoutKey) => {
      assert.equal(
        schema.properties[workoutKey].properties.blocks.minItems,
        1
      );
    });
  }
});

test('presentation contract is nullable, bounded, and strictly extractive', () => {
  const schema = buildSimpleWeeklyPlanStructureSchema(3);
  const presentation = schema.properties.presentation.anyOf[0];

  assert.deepEqual(presentation.required, [
    'title',
    'summary',
    'progression',
    'coachingNotes',
  ]);
  assert.equal(presentation.additionalProperties, false);
  assert.equal(presentation.properties.title.anyOf[0].maxLength, 70);
  assert.equal(presentation.properties.summary.anyOf[0].maxLength, 220);
  assert.equal(presentation.properties.progression.anyOf[0].maxLength, 300);
  assert.equal(presentation.properties.coachingNotes.maxItems, 3);
  assert.equal(presentation.properties.coachingNotes.items.maxLength, 160);
});

test('presentation kill switch restores the Phase 1A structure schema', () => {
  const schema = buildSimpleWeeklyPlanStructureSchema(2, {
    presentationContractEnabled: false,
  });
  assert.deepEqual(Object.keys(schema.properties), [
    'planName',
    'workout_1',
    'workout_2',
  ]);
  assert.equal(schema.required.includes('presentation'), false);
});

test('dynamic structure schema contains only the simple Output #4 block contract', () => {
  const schema = buildSimpleWeeklyPlanStructureSchema(3);
  const serialized = JSON.stringify(schema);
  const blockProperties =
    schema.properties.workout_1.properties.blocks.items.properties;

  assert.deepEqual(Object.keys(blockProperties), ['type', 'setCount']);
  for (const forbidden of [
    'schemaVersion',
    'workouts',
    'blockType',
    'roundCount',
    'setCounts',
    'exerciseId',
    'exerciseName',
  ]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, forbidden);
  }
});

test('dynamic structure schema rejects unsupported workout counts', () => {
  for (const value of [undefined, 0, 8, 1.5]) {
    assert.throws(
      () => buildSimpleWeeklyPlanStructureSchema(value),
      /sessionsPerWeek/
    );
  }
});
