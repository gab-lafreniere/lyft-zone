const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateSimpleWeeklyPlanStructure,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureValidation');

const fixturesDirectory = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline'
);
const realStructure = JSON.parse(
  fs.readFileSync(
    path.join(fixturesDirectory, '03-extracted-structure.json'),
    'utf8'
  )
);

function clone(value) {
  return structuredClone(value);
}

function validate(value, sessionsPerWeek = 3) {
  return validateSimpleWeeklyPlanStructure(value, { sessionsPerWeek });
}

test('three-day Output #4 fixture is valid', () => {
  assert.deepEqual(validate(realStructure), {
    valid: true,
    errors: [],
  });
});

test('setCount must be one integer from 1 to 10', () => {
  const zero = clone(realStructure);
  zero.workout_1.blocks[0].setCount = 0;
  const eleven = clone(realStructure);
  eleven.workout_1.blocks[0].setCount = 11;
  const array = clone(realStructure);
  array.workout_1.blocks[0].setCount = [4, 4];

  assert.equal(validate(zero).valid, false);
  assert.equal(validate(eleven).valid, false);
  assert.equal(validate(array).valid, false);
});

test('CARDIO requires setCount 1', () => {
  const value = {
    planName: 'Cardio',
    workout_1: {
      name: 'Cardio',
      blocks: [{ type: 'CARDIO', setCount: 2 }],
    },
  };
  const result = validate(value, 1);

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some(
      (error) => error.code === 'CARDIO_SET_COUNT_MUST_BE_ONE'
    ),
    true
  );
});

test('exact workout keys are required for sessionsPerWeek', () => {
  const missing = clone(realStructure);
  delete missing.workout_3;
  const extra = clone(realStructure);
  extra.workout_4 = clone(extra.workout_3);

  assert.equal(validate(missing).valid, false);
  assert.equal(validate(extra).valid, false);
});

test('empty blocks, unknown type, and extra properties are rejected', () => {
  const empty = clone(realStructure);
  empty.workout_1.blocks = [];
  const unknown = clone(realStructure);
  unknown.workout_1.blocks[0].type = 'GIANT_SET';
  const extra = clone(realStructure);
  extra.workout_1.unexpected = true;

  assert.equal(validate(empty).valid, false);
  assert.equal(validate(unknown).valid, false);
  assert.equal(validate(extra).valid, false);
});

test('legacy geometry and exercise fields are rejected from Output #4', () => {
  for (const [field, value] of [
    ['schemaVersion', 1],
    ['workouts', []],
    ['blockType', 'SINGLE'],
    ['roundCount', null],
    ['setCounts', [3]],
    ['exerciseId', 'exercise-id'],
    ['exerciseName', 'Exercise'],
  ]) {
    const structure = clone(realStructure);
    if (field === 'schemaVersion' || field === 'workouts') {
      structure[field] = value;
    } else {
      structure.workout_1.blocks[0][field] = value;
    }
    assert.equal(validate(structure).valid, false, field);
  }
});
