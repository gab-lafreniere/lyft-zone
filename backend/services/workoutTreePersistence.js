'use strict';

const { ApiError } = require('./usersService');

const SENTINEL_ORDER_OFFSET = 1000000;

function stableValue(value) {
  if (value?.constructor?.name === 'DbNull') {
    return '__PRISMA_DB_NULL__';
  }
  if (value?.constructor?.name === 'JsonNull') {
    return '__PRISMA_JSON_NULL__';
  }

  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function scalarValuesEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function identityConflict(entityName, orderIndex) {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    `Ambiguous ${entityName} identity at orderIndex ${orderIndex}`
  );
}

function matchRows(existingRows = [], incomingRows = [], entityName, indexField) {
  const existingById = new Map(existingRows.filter((row) => row.id).map((row) => [row.id, row]));
  const existingByIndex = new Map(existingRows.map((row) => [row[indexField], row]));
  const matchedIds = new Set();
  const pairs = [];
  const creates = [];

  incomingRows.forEach((incoming) => {
    const exactMatch = incoming.id ? existingById.get(incoming.id) : null;

    if (exactMatch) {
      if (matchedIds.has(exactMatch.id)) {
        throw identityConflict(entityName, incoming[indexField]);
      }
      matchedIds.add(exactMatch.id);
      pairs.push({ existing: exactMatch, incoming });
      return;
    }

    // An unknown id is an explicit new entity. Positional fallback is reserved
    // for legacy/id-less payloads so a newly-created row cannot steal another
    // logical entity's persistence identity merely because it occupies its slot.
    if (incoming.id) {
      creates.push(incoming);
      return;
    }

    const fallbackMatch = existingByIndex.get(incoming[indexField]) || null;
    if (fallbackMatch && matchedIds.has(fallbackMatch.id)) {
      throw identityConflict(entityName, incoming[indexField]);
    }
    if (fallbackMatch) {
      matchedIds.add(fallbackMatch.id);
      pairs.push({ existing: fallbackMatch, incoming });
      return;
    }

    creates.push(incoming);
  });

  return {
    pairs,
    creates,
    deletes: existingRows.filter((row) => !matchedIds.has(row.id)),
  };
}

async function deleteIds(model, ids) {
  if (!ids.length) {
    return;
  }

  await model.deleteMany({ where: { id: { in: ids } } });
}

async function moveChangedOrderRows(model, pairs, indexField) {
  const ids = pairs
    .filter(({ existing, incoming }) => existing[indexField] !== incoming[indexField])
    .map(({ existing }) => existing.id);

  if (!ids.length) {
    return;
  }

  await model.updateMany({
    where: { id: { in: ids } },
    data: { [indexField]: { increment: SENTINEL_ORDER_OFFSET } },
  });
}

async function updateChangedRows(model, pairs, buildScalarData) {
  const changedPairs = pairs.filter(
    ({ existing, incoming }) =>
      !scalarValuesEqual(buildScalarData(existing), buildScalarData(incoming))
  );

  // Interactive Prisma transactions share one connection. Keep distinct
  // per-row updates ordered on that connection; batching the independent
  // create/delete cases provides the material round-trip win, while issuing
  // concurrent client.query calls here is deprecated by node-postgres.
  for (const { existing, incoming } of changedPairs) {
    await model.update({
      where: { id: existing.id },
      data: buildScalarData(incoming),
    });
  }
}

function correlateCreatedRows(incomingRows, createdRows, parentField, parentId, indexField) {
  return incomingRows.map((incoming) => {
    const created = createdRows.find(
      (row) => row[parentField] === parentId && row[indexField] === incoming[indexField]
    );

    if (!created?.id) {
      throw new ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        `Unable to resolve created row at ${indexField} ${incoming[indexField]}`
      );
    }

    return { incoming, id: created.id };
  });
}

async function patchWorkoutBlockTree(options) {
  const {
    workoutId,
    existingBlocks = [],
    incomingBlocks = [],
    blockModel,
    exerciseModel,
    setModel,
    blockParentField,
    exerciseParentField,
    setParentField,
    buildBlockScalarData,
    buildExerciseScalarData,
    buildSetScalarData,
  } = options;

  const blockMatches = matchRows(existingBlocks, incomingBlocks, 'block', 'orderIndex');
  const existingExerciseGroups = blockMatches.pairs.map((blockPair) => {
    const exerciseMatches = matchRows(
      blockPair.existing.exercises || [],
      blockPair.incoming.exercises || [],
      'exercise row',
      'orderIndex'
    );
    const setGroups = exerciseMatches.pairs.map((exercisePair) => ({
      exercisePair,
      setMatches: matchRows(
        exercisePair.existing.setTemplates || [],
        exercisePair.incoming.setTemplates || [],
        'set template',
        'setIndex'
      ),
    }));

    return { blockPair, exerciseMatches, setGroups };
  });

  const deletedSetIds = existingExerciseGroups.flatMap(({ setGroups }) =>
    setGroups.flatMap(({ setMatches }) => setMatches.deletes.map((row) => row.id))
  );
  const deletedExerciseIds = existingExerciseGroups.flatMap(({ exerciseMatches }) =>
    exerciseMatches.deletes.map((row) => row.id)
  );
  const deletedBlockIds = blockMatches.deletes.map((row) => row.id);

  // Delete only the lowest still-matched descendants explicitly. Removed
  // exercises/blocks rely on their existing database cascades for children.
  await deleteIds(setModel, deletedSetIds);
  await deleteIds(exerciseModel, deletedExerciseIds);
  await deleteIds(blockModel, deletedBlockIds);

  const exercisePairs = existingExerciseGroups.flatMap(
    ({ exerciseMatches }) => exerciseMatches.pairs
  );
  const setPairs = existingExerciseGroups.flatMap(({ setGroups }) =>
    setGroups.flatMap(({ setMatches }) => setMatches.pairs)
  );

  // Unique(parentId, orderIndex) constraints make direct swaps unsafe. One
  // batched sentinel shift frees only the rows whose order actually changes;
  // each row then receives its final scalar update below.
  await moveChangedOrderRows(setModel, setPairs, 'setIndex');
  await moveChangedOrderRows(exerciseModel, exercisePairs, 'orderIndex');
  await moveChangedOrderRows(blockModel, blockMatches.pairs, 'orderIndex');

  await updateChangedRows(setModel, setPairs, buildSetScalarData);
  await updateChangedRows(exerciseModel, exercisePairs, buildExerciseScalarData);
  await updateChangedRows(blockModel, blockMatches.pairs, buildBlockScalarData);

  let createdBlockLinks = [];
  if (blockMatches.creates.length) {
    const createdBlocks = await blockModel.createManyAndReturn({
      data: blockMatches.creates.map((block) => ({
        [blockParentField]: workoutId,
        ...buildBlockScalarData(block),
      })),
    });
    createdBlockLinks = correlateCreatedRows(
      blockMatches.creates,
      createdBlocks,
      blockParentField,
      workoutId,
      'orderIndex'
    );
  }

  const exercisesToCreate = [
    ...existingExerciseGroups.flatMap(({ blockPair, exerciseMatches }) =>
      exerciseMatches.creates.map((incoming) => ({
        incoming,
        parentId: blockPair.existing.id,
      }))
    ),
    ...createdBlockLinks.flatMap(({ incoming: block, id: parentId }) =>
      (block.exercises || []).map((incoming) => ({ incoming, parentId }))
    ),
  ];

  let createdExerciseLinks = [];
  if (exercisesToCreate.length) {
    const createdExercises = await exerciseModel.createManyAndReturn({
      data: exercisesToCreate.map(({ incoming, parentId }) => ({
        [exerciseParentField]: parentId,
        ...buildExerciseScalarData(incoming),
      })),
    });
    createdExerciseLinks = exercisesToCreate.map(({ incoming, parentId }) => {
      const [link] = correlateCreatedRows(
        [incoming],
        createdExercises,
        exerciseParentField,
        parentId,
        'orderIndex'
      );
      return link;
    });
  }

  const setsToCreate = [
    ...existingExerciseGroups.flatMap(({ setGroups }) =>
      setGroups.flatMap(({ exercisePair, setMatches }) =>
        setMatches.creates.map((incoming) => ({
          incoming,
          parentId: exercisePair.existing.id,
        }))
      )
    ),
    ...createdExerciseLinks.flatMap(({ incoming: exercise, id: parentId }) =>
      (exercise.setTemplates || []).map((incoming) => ({ incoming, parentId }))
    ),
  ];

  if (setsToCreate.length) {
    await setModel.createMany({
      data: setsToCreate.map(({ incoming, parentId }) => ({
        [setParentField]: parentId,
        ...buildSetScalarData(incoming),
      })),
    });
  }
}

module.exports = {
  matchRows,
  patchWorkoutBlockTree,
  scalarValuesEqual,
};
