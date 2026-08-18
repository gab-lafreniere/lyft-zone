const test = require('node:test');
const assert = require('node:assert/strict');

const { patchWorkoutBlockTree } = require('../../services/workoutTreePersistence');

function createSet(id, setIndex, targetReps = 10) {
  return { id, setIndex, setType: 'WORKING', targetReps };
}

function createExercise(id, orderIndex, sets = [createSet(`${id}_set_1`, 1)]) {
  return {
    id,
    orderIndex,
    exerciseId: `library_${id}`,
    notes: null,
    setTemplates: sets,
  };
}

function createBlock(id, orderIndex, exercises = [createExercise(`${id}_exercise_1`, 1)]) {
  return {
    id,
    orderIndex,
    blockType: exercises.length > 1 ? 'SUPERSET' : 'SINGLE',
    notes: null,
    exercises,
  };
}

function createHarness() {
  const calls = [];
  let nextId = 1;
  const model = (name, parentField, indexField) => ({
    deleteMany: async ({ where }) => {
      calls.push({ name, operation: 'deleteMany', where });
      return { count: where.id.in.length };
    },
    updateMany: async ({ where, data }) => {
      calls.push({ name, operation: 'updateMany', where, data });
      return { count: where.id.in.length };
    },
    update: async ({ where, data }) => {
      calls.push({ name, operation: 'update', where, data });
      return { id: where.id, ...data };
    },
    createManyAndReturn: async ({ data }) => {
      calls.push({ name, operation: 'createManyAndReturn', data });
      return data.map((row) => ({ ...row, id: `${name}_new_${nextId++}` }));
    },
    createMany: async ({ data }) => {
      calls.push({ name, operation: 'createMany', data });
      return { count: data.length };
    },
    parentField,
    indexField,
  });

  return {
    calls,
    blockModel: model('block', 'workoutId', 'orderIndex'),
    exerciseModel: model('exercise', 'blockId', 'orderIndex'),
    setModel: model('set', 'exerciseId', 'setIndex'),
  };
}

function patch(harness, existingBlocks, incomingBlocks) {
  return patchWorkoutBlockTree({
    workoutId: 'workout_1',
    existingBlocks,
    incomingBlocks,
    blockModel: harness.blockModel,
    exerciseModel: harness.exerciseModel,
    setModel: harness.setModel,
    blockParentField: 'workoutId',
    exerciseParentField: 'blockId',
    setParentField: 'exerciseId',
    buildBlockScalarData: (block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      notes: block.notes ?? null,
    }),
    buildExerciseScalarData: (exercise) => ({
      orderIndex: exercise.orderIndex,
      exerciseId: exercise.exerciseId,
      notes: exercise.notes ?? null,
    }),
    buildSetScalarData: (setTemplate) => ({
      setIndex: setTemplate.setIndex,
      setType: setTemplate.setType,
      targetReps: setTemplate.targetReps ?? null,
    }),
  });
}

function callTargetsId(call, id) {
  return call?.where?.id === id || call?.where?.id?.in?.includes(id) || false;
}

test('a semantic no-op performs zero content mutations', async () => {
  const existing = [createBlock('block_1', 1)];
  const harness = createHarness();

  await patch(harness, existing, structuredClone(existing));

  assert.deepEqual(harness.calls, []);
});

test('changing one set scalar updates that persisted set row only', async () => {
  const existing = [createBlock('block_1', 1)];
  const incoming = structuredClone(existing);
  incoming[0].exercises[0].setTemplates[0].targetReps = 12;
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['set.update']
  );
  assert.equal(harness.calls[0].where.id, 'block_1_exercise_1_set_1');
});

test('adding two sets uses one batched create and preserves existing row ids', async () => {
  const existing = [createBlock('block_1', 1)];
  const incoming = structuredClone(existing);
  incoming[0].exercises[0].setTemplates.push(
    createSet(undefined, 2, 11),
    createSet(undefined, 3, 12)
  );
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['set.createMany']
  );
  assert.equal(harness.calls[0].data.length, 2);
  assert.equal(harness.calls[0].data[0].exerciseId, 'block_1_exercise_1');
});

test('removing one exercise deletes only that exercise subtree', async () => {
  const existing = [
    createBlock('block_1', 1, [
      createExercise('exercise_1', 1),
      createExercise('exercise_2', 2),
    ]),
  ];
  const incoming = structuredClone(existing);
  incoming[0].exercises.splice(1, 1);
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['exercise.deleteMany']
  );
  assert.deepEqual(harness.calls[0].where.id.in, ['exercise_2']);
  assert.equal(
    harness.calls.some((call) => call.name === 'set' && call.operation === 'deleteMany'),
    false,
    'the exercise cascade owns deletion of its sets'
  );
});

test('reordering blocks preserves ids and updates only changed order fields', async () => {
  const existing = [createBlock('block_1', 1), createBlock('block_2', 2)];
  const incoming = [
    { ...structuredClone(existing[1]), orderIndex: 1 },
    { ...structuredClone(existing[0]), orderIndex: 2 },
  ];
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['block.updateMany', 'block.update', 'block.update']
  );
  assert.deepEqual(harness.calls[0].where.id.in, ['block_2', 'block_1']);
  assert.deepEqual(
    harness.calls.slice(1).map((call) => call.where.id).sort(),
    ['block_1', 'block_2']
  );
});

test('a representative block/exercise/set edit performs three scalar updates', async () => {
  const existing = [createBlock('block_1', 1)];
  const incoming = structuredClone(existing);
  incoming[0].notes = 'updated block note';
  incoming[0].exercises[0].exerciseId = 'replacement_library_exercise';
  incoming[0].exercises[0].setTemplates[0].targetReps = 9;
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['set.update', 'exercise.update', 'block.update']
  );
});

test('a foreign block id is created in scope and never becomes an update or delete target', async () => {
  const foreignBlockId = 'block_from_another_workout';
  const existing = [createBlock('block_1', 1)];
  const incoming = [createBlock(foreignBlockId, 1)];
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.equal(
    harness.calls.some((call) => callTargetsId(call, foreignBlockId)),
    false,
    'a client-supplied out-of-scope block id must never be used in a Prisma where clause'
  );
  assert.equal(
    harness.calls.some(
      (call) => call.name === 'block' && call.operation === 'update'
    ),
    false
  );
  assert.deepEqual(
    harness.calls.find(
      (call) => call.name === 'block' && call.operation === 'deleteMany'
    ).where.id.in,
    ['block_1']
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.calls.find(
        (call) => call.name === 'block' && call.operation === 'createManyAndReturn'
      ).data[0],
      'id'
    ),
    false,
    'the database, not the foreign client id, assigns the created row id'
  );
});

test('a foreign set id is replaced in scope and never becomes an update or delete target', async () => {
  const foreignSetId = 'set_from_another_exercise';
  const existing = [createBlock('block_1', 1)];
  const incoming = structuredClone(existing);
  incoming[0].exercises[0].setTemplates[0].id = foreignSetId;
  const harness = createHarness();

  await patch(harness, existing, incoming);

  assert.equal(
    harness.calls.some((call) => callTargetsId(call, foreignSetId)),
    false,
    'a client-supplied out-of-scope set id must never be used in a Prisma where clause'
  );
  assert.deepEqual(
    harness.calls.map(({ name, operation }) => `${name}.${operation}`),
    ['set.deleteMany', 'set.createMany']
  );
  assert.deepEqual(harness.calls[0].where.id.in, ['block_1_exercise_1_set_1']);
  assert.equal(
    Object.prototype.hasOwnProperty.call(harness.calls[1].data[0], 'id'),
    false,
    'the database, not the foreign client id, assigns the created row id'
  );
});

// Current builders cannot produce this shape: set creation appends, superset
// growth appends to both lanes, exercise conversion appends A2, and new blocks
// carry explicit client-generated ids. Keep the safe failure covered so a
// future insert/reorder control cannot silently attach the wrong persisted row.
test('an id-less mid-list set insert fails deterministically before any mutation', async () => {
  const exercise = createExercise('exercise_1', 1, [
    createSet('set_1', 1, 8),
    createSet('set_2', 2, 10),
  ]);
  const existing = [createBlock('block_1', 1, [exercise])];
  const incoming = structuredClone(existing);
  incoming[0].exercises[0].setTemplates = [
    createSet('set_1', 1, 8),
    createSet(undefined, 2, 9),
    createSet('set_2', 3, 10),
  ];
  const harness = createHarness();

  await assert.rejects(
    patch(harness, existing, incoming),
    (error) =>
      error?.status === 400 &&
      error?.code === 'VALIDATION_ERROR' &&
      error?.message === 'Ambiguous set template identity at orderIndex 3'
  );

  assert.deepEqual(
    harness.calls,
    [],
    'identity validation must finish before the first Prisma mutation'
  );
});
