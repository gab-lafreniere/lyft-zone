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
      ...workoutKeys,
    ]);
    assert.deepEqual(schema.required, ['planName', ...workoutKeys]);
    assert.equal(schema.additionalProperties, false);
    workoutKeys.forEach((workoutKey) => {
      assert.equal(
        schema.properties[workoutKey].properties.blocks.minItems,
        1
      );
    });
  }
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
