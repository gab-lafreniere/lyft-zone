const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BoundPlanGeometryError,
  adaptBoundPlanToGeometry,
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');

const FIXTURES = path.join(__dirname, '../../fixtures/simpleWeeklyPlanPipeline');

const LEGACY_STRUCTURES = [
  ['fixture-a', path.join(FIXTURES, 'real-call3-fixtures/fixture-a/04-output-ai_extracted-structure.json')],
  ['fixture-b', path.join(FIXTURES, 'real-call3-fixtures/fixture-b/04-output-ai_extracted-structure.json')],
  ['smoke-202258', path.join(FIXTURES, 'bound-plan/smoke-202258/legacy-04-structure.json')],
  ['smoke-203739', path.join(FIXTURES, 'bound-plan/smoke-203739/legacy-04-structure.json')],
  ['smoke-203907', path.join(FIXTURES, 'bound-plan/smoke-203907/legacy-04-structure.json')],
];

function loadLegacy(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sessionsOf(structure) {
  return Object.keys(structure).filter((key) => /^workout_\d+$/.test(key)).length;
}

function exercise(sets) {
  return {
    exerciseId: 'exr_placeholder',
    sets,
    reps: null,
    rir: null,
    rpe: null,
    tempo: null,
    rest: null,
    duration: null,
    intensity: null,
    machineSettings: null,
    notes: null,
  };
}

// Expands a legacy geometry-only structure into the BoundPlan it is equivalent to
// under the legacy adapter's own hardcoded arity assumptions. Any divergence in the
// resulting geometry hash would mean the new adapter changed Step 05's input.
function legacyStructureToEquivalentBoundPlan(structure) {
  const workouts = [];
  for (let index = 1; index <= sessionsOf(structure); index += 1) {
    const legacyWorkout = structure[`workout_${index}`];
    workouts.push({
      name: legacyWorkout.name,
      blocks: legacyWorkout.blocks.map((block) => {
        if (block.type === 'CARDIO') {
          return { type: 'CARDIO', restAfterRound: null, exercises: [exercise(null)] };
        }
        if (block.type === 'SUPERSET') {
          return {
            type: 'SUPERSET',
            restAfterRound: '60 sec',
            exercises: [exercise(block.setCount), exercise(block.setCount)],
          };
        }
        return {
          type: 'SINGLE',
          restAfterRound: null,
          exercises: [exercise(block.setCount)],
        };
      }),
    });
  }
  return { schemaVersion: 1, planName: structure.planName, workouts };
}

test('the bound plan adapter reproduces legacy geometry byte for byte', () => {
  LEGACY_STRUCTURES.forEach(([id, file]) => {
    const structure = loadLegacy(file);
    const legacyGeometry = adaptSimpleWeeklyPlanStructureToLegacyGeometry(
      structure,
      { sessionsPerWeek: sessionsOf(structure) }
    );
    const boundGeometry = adaptBoundPlanToGeometry(
      legacyStructureToEquivalentBoundPlan(structure)
    );

    assert.deepEqual(boundGeometry, legacyGeometry, `${id} geometry must match`);
    assert.equal(
      buildSimpleWeeklyPlanSkeleton(boundGeometry).geometryHash,
      buildSimpleWeeklyPlanSkeleton(legacyGeometry).geometryHash,
      `${id} geometryHash must be identical`
    );
  });
});

test('every legacy corpus structure still produces a valid skeleton', () => {
  LEGACY_STRUCTURES.forEach(([id, file]) => {
    const structure = loadLegacy(file);
    const skeleton = buildSimpleWeeklyPlanSkeleton(
      adaptBoundPlanToGeometry(legacyStructureToEquivalentBoundPlan(structure))
    );
    assert.match(skeleton.geometryHash, /^sha256:[0-9a-f]{64}$/, id);
    assert.ok(skeleton.slots.length > 0, id);
  });
});

test('roundCount is derived from lane set counts, never supplied by the binder', () => {
  const boundPlan = {
    schemaVersion: 1,
    planName: 'p',
    workouts: [{
      name: 'w',
      blocks: [{
        type: 'SUPERSET',
        restAfterRound: '60 sec',
        exercises: [exercise(4), exercise(4)],
      }],
    }],
  };

  const geometry = adaptBoundPlanToGeometry(boundPlan);
  assert.equal(geometry.workouts[0].blocks[0].roundCount, 4);
  assert.deepEqual(geometry.workouts[0].blocks[0].setCounts, [4, 4]);
  assert.equal(
    JSON.stringify(boundPlan).includes('roundCount'),
    false,
    'the binder contract carries no roundCount field'
  );
});

test('exercise arity comes from the bound plan and is never fabricated', () => {
  const geometry = adaptBoundPlanToGeometry({
    schemaVersion: 1,
    planName: 'p',
    workouts: [{
      name: 'w',
      blocks: [
        { type: 'SINGLE', restAfterRound: null, exercises: [exercise(3)] },
        { type: 'CARDIO', restAfterRound: null, exercises: [exercise(null)] },
      ],
    }],
  });

  assert.deepEqual(geometry.workouts[0].blocks[0].setCounts, [3]);
  assert.deepEqual(geometry.workouts[0].blocks[1].setCounts, [0]);
  assert.equal(geometry.workouts[0].blocks[1].roundCount, null);
});

test('the adapter itself is arity agnostic beyond two lanes', () => {
  const geometry = adaptBoundPlanToGeometry({
    schemaVersion: 1,
    planName: 'p',
    workouts: [{
      name: 'w',
      blocks: [{
        type: 'SUPERSET',
        restAfterRound: '60 sec',
        exercises: [exercise(3), exercise(3), exercise(3)],
      }],
    }],
  });

  // The backend can represent a giant set today; only the D5 policy gate in
  // verifyBoundPlan blocks it, because the Manual Builder is limited to two lanes.
  assert.deepEqual(geometry.workouts[0].blocks[0].setCounts, [3, 3, 3]);
  assert.equal(geometry.workouts[0].blocks[0].roundCount, 3);
});

test('unequal SUPERSET lanes throw instead of being padded (D4)', () => {
  assert.throws(
    () => adaptBoundPlanToGeometry({
      schemaVersion: 1,
      planName: 'p',
      workouts: [{
        name: 'w',
        blocks: [{
          type: 'SUPERSET',
          restAfterRound: '60 sec',
          exercises: [exercise(4), exercise(3)],
        }],
      }],
    }),
    (error) => {
      assert.ok(error instanceof BoundPlanGeometryError);
      assert.equal(
        error.code,
        'BOUND_PLAN_GEOMETRY_SUPERSET_SET_COUNT_UNEQUAL'
      );
      assert.deepEqual(error.details[0].received, [4, 3]);
      return true;
    }
  );
});

test('projection bugs surface as coded errors with coordinates', () => {
  const cases = [
    [{ type: 'SINGLE', exercises: [exercise(3), exercise(3)] }, 'BOUND_PLAN_GEOMETRY_SINGLE_ARITY'],
    [{ type: 'CARDIO', exercises: [exercise(null), exercise(null)] }, 'BOUND_PLAN_GEOMETRY_CARDIO_ARITY'],
    [{ type: 'SUPERSET', exercises: [exercise(3)] }, 'BOUND_PLAN_GEOMETRY_SUPERSET_ARITY'],
    [{ type: 'SINGLE', exercises: [exercise(0)] }, 'BOUND_PLAN_GEOMETRY_SET_COUNT_INVALID'],
    [{ type: 'CIRCUIT', exercises: [exercise(3)] }, 'BOUND_PLAN_GEOMETRY_UNSUPPORTED_BLOCK_TYPE'],
  ];

  cases.forEach(([block, expectedCode]) => {
    assert.throws(
      () => adaptBoundPlanToGeometry({
        schemaVersion: 1,
        planName: 'p',
        workouts: [{ name: 'w', blocks: [{ restAfterRound: null, ...block }] }],
      }),
      (error) => {
        assert.equal(error.code, expectedCode);
        assert.equal(error.details[0].workout, 1);
        assert.equal(error.details[0].block, 1);
        return true;
      },
      expectedCode
    );
  });
});
