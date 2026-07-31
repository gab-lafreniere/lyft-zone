const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  computeGeometryHash,
  validateGeometryLock,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/geometryLock');

function structureWithAllBlockTypes() {
  return {
    schemaVersion: 1,
    planName: 'Geometry',
    workouts: [
      {
        name: 'Workout',
        blocks: [
          { blockType: 'SINGLE', roundCount: null, setCounts: [2] },
          { blockType: 'SUPERSET', roundCount: 3, setCounts: [3, 3] },
          { blockType: 'CARDIO', roundCount: null, setCounts: [0] },
        ],
      },
    ],
  };
}

test('skeleton deterministically creates indexes, block rules, cardinalities, and slots', () => {
  const skeleton = buildSimpleWeeklyPlanSkeleton(structureWithAllBlockTypes());
  const [single, superset, cardio] = skeleton.document.workouts[0].blocks;

  assert.equal(skeleton.document.sessionsPerWeek, 1);
  assert.deepEqual(
    skeleton.document.workouts[0].blocks.map((block) => block.orderIndex),
    [1, 2, 3]
  );
  assert.equal(single.restStrategy, 'AFTER_EXERCISE');
  assert.equal(single.exercises.length, 1);
  assert.equal(single.exercises[0].setTemplates.length, 2);
  assert.deepEqual(
    single.exercises[0].setTemplates.map((set) => set.setIndex),
    [1, 2]
  );
  assert.equal(superset.restStrategy, 'AFTER_ROUND');
  assert.equal(superset.roundCount, 3);
  assert.deepEqual(
    superset.exercises.map((exercise) => exercise.setTemplates.length),
    [3, 3]
  );
  assert.equal(cardio.restStrategy, 'NONE');
  assert.equal(cardio.exercises.length, 1);
  assert.deepEqual(cardio.exercises[0].setTemplates, []);

  const slotIds = skeleton.slots.map((slot) => slot.id);
  assert.equal(new Set(slotIds).size, slotIds.length);
  skeleton.slots.forEach((slot) => {
    assert.match(slot.pointer, /^\//);
  });
  assert.equal(computeGeometryHash(skeleton.document), skeleton.geometryHash);
  assert.equal(
    buildSimpleWeeklyPlanSkeleton(structureWithAllBlockTypes()).geometryHash,
    skeleton.geometryHash
  );
});

for (const [name, mutate] of [
  ['workout addition', (document) => document.workouts.push(structuredClone(document.workouts[0]))],
  ['block removal', (document) => document.workouts[0].blocks.pop()],
  ['blockType change', (document) => { document.workouts[0].blocks[0].blockType = 'SUPERSET'; }],
  ['exercise addition', (document) => document.workouts[0].blocks[0].exercises.push(structuredClone(document.workouts[0].blocks[0].exercises[0]))],
  ['set removal', (document) => document.workouts[0].blocks[0].exercises[0].setTemplates.pop()],
  ['index change', (document) => { document.workouts[0].blocks[0].orderIndex = 99; }],
  ['workout reordering', (document) => {
    document.workouts.push({
      ...structuredClone(document.workouts[0]),
      name: 'Second',
      orderIndex: 2,
    });
    document.sessionsPerWeek = 2;
    document.workouts.reverse();
  }],
]) {
  test(`geometry lock rejects ${name}`, () => {
    const skeleton = buildSimpleWeeklyPlanSkeleton(structureWithAllBlockTypes());
    const document = structuredClone(skeleton.document);
    mutate(document);

    assert.equal(
      validateGeometryLock(document, skeleton.geometryHash).valid,
      false
    );
  });
}
