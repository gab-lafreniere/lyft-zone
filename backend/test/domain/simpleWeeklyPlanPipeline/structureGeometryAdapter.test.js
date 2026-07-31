const test = require('node:test');
const assert = require('node:assert/strict');

const {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');

test('adapter converts simple Output #4 blocks to internal legacy geometry', () => {
  const structure = {
    planName: 'Geometry',
    workout_1: {
      name: 'Workout',
      blocks: [
        { type: 'SINGLE', setCount: 3 },
        { type: 'SUPERSET', setCount: 3 },
        { type: 'CARDIO', setCount: 1 },
      ],
    },
  };

  assert.deepEqual(
    adaptSimpleWeeklyPlanStructureToLegacyGeometry(
      structure,
      { sessionsPerWeek: 1 }
    ),
    {
      schemaVersion: 1,
      planName: 'Geometry',
      workouts: [
        {
          name: 'Workout',
          blocks: [
            {
              blockType: 'SINGLE',
              roundCount: null,
              setCounts: [3],
            },
            {
              blockType: 'SUPERSET',
              roundCount: 3,
              setCounts: [3, 3],
            },
            {
              blockType: 'CARDIO',
              roundCount: null,
              setCounts: [0],
            },
          ],
        },
      ],
    }
  );
});

test('one SUPERSET remains one block and produces two internal lanes', () => {
  const adapted = adaptSimpleWeeklyPlanStructureToLegacyGeometry(
    {
      planName: 'Superset',
      workout_1: {
        name: 'Workout',
        blocks: [{ type: 'SUPERSET', setCount: 4 }],
      },
    },
    { sessionsPerWeek: 1 }
  );

  assert.equal(adapted.workouts[0].blocks.length, 1);
  assert.deepEqual(adapted.workouts[0].blocks[0].setCounts, [4, 4]);
});
