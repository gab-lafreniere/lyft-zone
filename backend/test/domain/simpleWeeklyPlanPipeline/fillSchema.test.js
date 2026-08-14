const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');

const {
  PROVIDER_ENTITY_GROUP_KEYS,
  SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
  buildCanonicalProviderEntities,
  buildSimpleWeeklyPlanFillProviderSchema,
  normalizeSimpleWeeklyPlanProviderFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillSchema');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');

function collectConstNodes(value, path = '$', result = []) {
  if (!value || typeof value !== 'object') {
    return result;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'const')) {
    result.push({ path, node: value });
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectConstNodes(item, `${path}/${index}`, result)
    );
    return result;
  }
  Object.entries(value).forEach(([key, child]) =>
    collectConstNodes(child, `${path}/${key}`, result)
  );
  return result;
}

function buildSkeleton(workouts, planName = 'Entity-local fills') {
  return buildSimpleWeeklyPlanSkeleton({
    schemaVersion: 1,
    planName,
    workouts,
  });
}

function createMixedSkeleton() {
  return buildSkeleton([{
    name: 'Workout',
    blocks: [
      { blockType: 'SUPERSET', roundCount: 3, setCounts: [3, 3] },
      { blockType: 'CARDIO', roundCount: null, setCounts: [0] },
      { blockType: 'SUPERSET', roundCount: 2, setCounts: [2, 2] },
    ],
  }]);
}

function createRegressionSkeleton() {
  return buildSkeleton([
    {
      name: 'Chest',
      blocks: [
        { blockType: 'SINGLE', roundCount: null, setCounts: [4] },
        { blockType: 'SINGLE', roundCount: null, setCounts: [3] },
      ],
    },
    {
      name: 'Top-up',
      blocks: [
        { blockType: 'SINGLE', roundCount: null, setCounts: [4] },
      ],
    },
  ], '2x45 entity-local regression');
}

function target(mode = 'repRange') {
  if (mode === 'reps') {
    return { mode, targetReps: 10, targetRir: 2, notes: null };
  }
  if (mode === 'seconds') {
    return { mode, targetSeconds: 30, targetRir: 2, notes: null };
  }
  return {
    mode,
    minReps: 8,
    maxReps: 12,
    targetRir: 2,
    notes: null,
  };
}

function createProviderOutput(skeleton) {
  const entities = buildCanonicalProviderEntities(skeleton);
  return {
    schemaVersion: SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
    geometryHash: skeleton.geometryHash,
    fills: {
      strengthExercises: entities.strengthExercises.map((entity, index) => ({
        exerciseId: `ex_strength_${index + 1}`,
        defaults: {
          tempo: '3010',
          restSeconds: 90,
          targetRir: 2,
          targetRpe: null,
        },
        sets: entity.setSlots.map(() => target()),
        notes: null,
      })),
      cardioExercises: entities.cardioExercises.map((_, index) => ({
        exerciseId: `ex_cardio_${index + 1}`,
        prescription: {
          durationMinutes: 10,
          heartRateTargetMode: 'none',
          heartRateTargetValue: null,
          machineSettings: [],
          notes: null,
        },
        notes: null,
      })),
      blockRests: entities.blockRests.map((_, index) => ({
        value: 60 + index * 15,
      })),
    },
  };
}

function compileProviderSchema(skeleton) {
  return new Ajv({ allErrors: true, strict: false }).compile(
    buildSimpleWeeklyPlanFillProviderSchema(skeleton)
  );
}

test('provider v4 schema has exactly three entity-local arrays with canonical counts', () => {
  const skeleton = createMixedSkeleton();
  const entities = buildCanonicalProviderEntities(skeleton);
  const schema = buildSimpleWeeklyPlanFillProviderSchema(skeleton);
  const fillsSchema = schema.properties.fills;
  const modeNodes = collectConstNodes(schema).filter(({ path }) =>
    path.endsWith('/properties/mode')
  );

  assert.equal(SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION, 4);
  assert.equal(schema.properties.schemaVersion.const, 4);
  assert.equal(fillsSchema.type, 'object');
  assert.equal(fillsSchema.additionalProperties, false);
  assert.deepEqual(fillsSchema.required, PROVIDER_ENTITY_GROUP_KEYS);
  assert.deepEqual(
    Object.keys(fillsSchema.properties),
    PROVIDER_ENTITY_GROUP_KEYS
  );
  PROVIDER_ENTITY_GROUP_KEYS.forEach((key) => {
    assert.equal(fillsSchema.properties[key].type, 'array');
    assert.equal(fillsSchema.properties[key].minItems, entities[key].length);
    assert.equal(fillsSchema.properties[key].maxItems, entities[key].length);
  });
  const setsSchema =
    fillsSchema.properties.strengthExercises.items.properties.sets;
  assert.equal(setsSchema.minItems, 1);
  assert.equal(setsSchema.maxItems, 10);
  assert.deepEqual(
    new Set(modeNodes.map(({ node }) => node.const)),
    new Set(['reps', 'repRange', 'seconds'])
  );
  const schemaText = JSON.stringify(schema);
  for (const forbidden of [
    'slotId',
    'slotIndex',
    'pointer',
    'workoutIndex',
    'blockIndex',
    'exerciseIndex',
    '"kind"',
  ]) {
    assert.equal(schemaText.includes(forbidden), false, forbidden);
  }
});

test('zero-count entity arrays remain required and accept only empty arrays', () => {
  const skeleton = buildSkeleton([]);
  const validate = compileProviderSchema(skeleton);
  const value = createProviderOutput(skeleton);

  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  PROVIDER_ENTITY_GROUP_KEYS.forEach((key) => {
    assert.deepEqual(value.fills[key], []);
  });

  for (const key of PROVIDER_ENTITY_GROUP_KEYS) {
    const missing = structuredClone(value);
    delete missing.fills[key];
    assert.equal(validate(missing), false, key);
  }

  const nonEmpty = structuredClone(value);
  nonEmpty.fills.blockRests.push({ value: 60 });
  assert.equal(validate(nonEmpty), false);
});

test('entity objects reject provider-generated addressing fields', () => {
  const skeleton = createMixedSkeleton();
  const validate = compileProviderSchema(skeleton);
  const locations = [
    (value) => value.fills.strengthExercises[0],
    (value) => value.fills.cardioExercises[0],
    (value) => value.fills.blockRests[0],
  ];

  for (const [property, fieldValue] of [
    ['slotId', 'w9.b1.e1.id'],
    ['slotIndex', 0],
    ['kind', 'exerciseId'],
    ['pointer', '/workouts/8/blocks/0'],
    ['workoutIndex', 8],
    ['blockIndex', 0],
    ['exerciseIndex', 0],
  ]) {
    locations.forEach((locate) => {
      const value = createProviderOutput(skeleton);
      locate(value)[property] = fieldValue;
      assert.equal(validate(value), false, property);
      assert.throws(
        () => normalizeSimpleWeeklyPlanProviderFills(value, skeleton),
        (error) => error.code === 'INVALID_ENTITY_LOCAL_PROVIDER_FILL'
      );
    });
  }
});

test('entity objects require their exact entity-local value shapes', () => {
  const skeleton = createMixedSkeleton();
  const validate = compileProviderSchema(skeleton);

  for (const mutate of [
    (value) => { delete value.fills.strengthExercises[0].defaults; },
    (value) => {
      value.fills.strengthExercises[0].exerciseId = {
        value: 'ex_strength_1',
      };
    },
    (value) => {
      value.fills.cardioExercises[0].prescription = { value: null };
    },
    (value) => { value.fills.blockRests[0].value = '60'; },
  ]) {
    const value = createProviderOutput(skeleton);
    mutate(value);
    assert.equal(validate(value), false);
    assert.throws(
      () => normalizeSimpleWeeklyPlanProviderFills(value, skeleton),
      (error) => error.code === 'INVALID_ENTITY_LOCAL_PROVIDER_FILL'
    );
  }
});

test('strength sets retain reps, repRange, and seconds modes', () => {
  const skeleton = createMixedSkeleton();
  const validate = compileProviderSchema(skeleton);

  for (const mode of ['reps', 'repRange', 'seconds']) {
    const value = createProviderOutput(skeleton);
    value.fills.strengthExercises.forEach((exercise) => {
      exercise.sets = exercise.sets.map(() => target(mode));
    });
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() =>
      normalizeSimpleWeeklyPlanProviderFills(value, skeleton)
    );
  }
});

test('shared canonical grouping follows workout, block, and exercise order', () => {
  const skeleton = createMixedSkeleton();
  const entities = buildCanonicalProviderEntities(skeleton);

  assert.deepEqual(
    entities.strengthExercises.map((entity) => entity.exerciseIdSlot.id),
    ['w1.b1.e1.id', 'w1.b1.e2.id', 'w1.b3.e1.id', 'w1.b3.e2.id']
  );
  assert.deepEqual(
    entities.cardioExercises.map((entity) => entity.exerciseIdSlot.id),
    ['w1.b2.e1.id']
  );
  assert.deepEqual(
    entities.blockRests.map((entity) => entity.restSlot.id),
    ['w1.b1.rest', 'w1.b3.rest']
  );
  assert.deepEqual(
    entities.strengthExercises.map((entity) => entity.setSlots.length),
    [3, 3, 2, 2]
  );
});

test('entity-local normalization injects canonical IDs and preserves fill v1', () => {
  const skeleton = createMixedSkeleton();
  const providerOutput = createProviderOutput(skeleton);
  providerOutput.fills.strengthExercises[0].exerciseId = 'ex_first';
  providerOutput.fills.strengthExercises[0].notes = 'First lane';
  providerOutput.fills.cardioExercises[0].exerciseId = 'ex_treadmill';
  providerOutput.fills.cardioExercises[0].notes = 'Easy pace';
  const normalized = normalizeSimpleWeeklyPlanProviderFills(
    providerOutput,
    skeleton
  );

  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.geometryHash, skeleton.geometryHash);
  assert.deepEqual(
    Object.keys(normalized.fills),
    skeleton.slots.map((slot) => slot.id)
  );
  assert.equal(normalized.fills['w1.b1.e1.id'], 'ex_first');
  assert.equal(normalized.fills['w1.b1.e1.notes'], 'First lane');
  assert.equal(normalized.fills['w1.b1.rest'], 60);
  assert.equal(normalized.fills['w1.b3.rest'], 75);
  assert.equal(normalized.fills['w1.b2.e1.id'], 'ex_treadmill');
  assert.equal(normalized.fills['w1.b2.e1.notes'], 'Easy pace');
  assert.deepEqual(normalized.fills['w1.b2.e1.cardio'], {
    durationMinutes: 10,
    heartRateTargetMode: 'none',
    heartRateTargetValue: null,
    machineSettings: [],
    notes: null,
  });
});

test('outer entity count mismatches fail before fill v1 creation', () => {
  const skeleton = createMixedSkeleton();
  const validate = compileProviderSchema(skeleton);

  for (const key of PROVIDER_ENTITY_GROUP_KEYS) {
    const value = createProviderOutput(skeleton);
    value.fills[key].pop();
    assert.equal(validate(value), false, key);
    assert.throws(
      () => normalizeSimpleWeeklyPlanProviderFills(value, skeleton),
      (error) => {
        assert.equal(error.code, 'PROVIDER_FILL_COUNT_MISMATCH');
        assert.equal(error.details[0].path, `$/fills/${key}`);
        return true;
      },
      key
    );
  }
});

test('wrong provider version and geometry hash fail before normalization', () => {
  const skeleton = createMixedSkeleton();
  const wrongVersion = createProviderOutput(skeleton);
  wrongVersion.schemaVersion = 3;
  assert.throws(
    () => normalizeSimpleWeeklyPlanProviderFills(wrongVersion, skeleton),
    (error) => error.code === 'PROVIDER_FILL_VERSION_MISMATCH'
  );

  const wrongHash = createProviderOutput(skeleton);
  wrongHash.geometryHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => normalizeSimpleWeeklyPlanProviderFills(wrongHash, skeleton),
    (error) => error.code === 'PROVIDER_FILL_GEOMETRY_HASH_MISMATCH'
  );
});

test('short and long local sets fail without consuming the next exercise', () => {
  const skeleton = createRegressionSkeleton();

  for (const received of [2, 4]) {
    const value = createProviderOutput(skeleton);
    const nextExerciseBefore = structuredClone(
      value.fills.strengthExercises[2]
    );
    value.fills.strengthExercises[1].sets = Array.from(
      { length: received },
      () => target()
    );

    assert.throws(
      () => normalizeSimpleWeeklyPlanProviderFills(value, skeleton),
      (error) => {
        assert.equal(error.code, 'PROVIDER_STRENGTH_SET_COUNT_MISMATCH');
        assert.deepEqual(error.details[0], {
          path: '$/fills/strengthExercises/1/sets',
          code: 'PROVIDER_STRENGTH_SET_COUNT_MISMATCH',
          message:
            `Provider strength exercise 1 returned ${received} sets; expected 3`,
          canonicalEntityIndex: 1,
          received,
          expected: 3,
        });
        return true;
      }
    );
    assert.deepEqual(
      value.fills.strengthExercises[2],
      nextExerciseBefore
    );
  }
});

test('2x45 bench, cable fly, and defaults regression stays entity-local', () => {
  const skeleton = createRegressionSkeleton();
  const value = createProviderOutput(skeleton);
  const bench = value.fills.strengthExercises[0];
  bench.exerciseId = 'exr_incline_barbell_bench_press';
  bench.defaults = {
    tempo: '3010',
    restSeconds: 150,
    targetRir: 2,
    targetRpe: null,
  };
  bench.sets = Array.from({ length: 4 }, () => ({
    mode: 'repRange',
    minReps: 6,
    maxReps: 8,
    targetRir: 2,
    notes: null,
  }));

  const cableFly = value.fills.strengthExercises[1];
  cableFly.exerciseId = 'exr_cable_chest_fly';
  cableFly.defaults = {
    tempo: '2120',
    restSeconds: 60,
    targetRir: 2,
    targetRpe: null,
  };
  cableFly.sets = Array.from({ length: 3 }, () => ({
    mode: 'repRange',
    minReps: 10,
    maxReps: 15,
    targetRir: 2,
    notes: null,
  }));

  const inclineMachinePress = value.fills.strengthExercises[2];
  inclineMachinePress.exerciseId = 'exr_incline_machine_chest_press';
  inclineMachinePress.defaults = {
    tempo: '3010',
    restSeconds: 90,
    targetRir: 2,
    targetRpe: null,
  };

  const normalized = normalizeSimpleWeeklyPlanProviderFills(value, skeleton);
  assert.deepEqual(
    ['s1', 's2', 's3', 's4'].map(
      (suffix) => normalized.fills[`w1.b1.e1.${suffix}`]
    ),
    bench.sets
  );
  assert.deepEqual(
    ['s1', 's2', 's3'].map(
      (suffix) => normalized.fills[`w1.b2.e1.${suffix}`]
    ),
    cableFly.sets
  );
  assert.deepEqual(
    normalized.fills['w2.b1.e1.defaults'],
    inclineMachinePress.defaults
  );
  assert.notDeepEqual(
    normalized.fills['w2.b1.e1.defaults'],
    cableFly.defaults
  );

  const shortBench = structuredClone(value);
  shortBench.fills.strengthExercises[0].sets.pop();
  assert.throws(
    () => normalizeSimpleWeeklyPlanProviderFills(shortBench, skeleton),
    (error) => {
      assert.equal(error.code, 'PROVIDER_STRENGTH_SET_COUNT_MISMATCH');
      assert.equal(
        error.details[0].path,
        '$/fills/strengthExercises/0/sets'
      );
      assert.equal(error.details[0].expected, 4);
      assert.equal(error.details[0].received, 3);
      return true;
    }
  );
});

// ------------------------------------------- H-4: no per-generation schema accumulation

const {
  buildSimpleWeeklyPlanSkeleton: buildSkeletonForSchemaIdentity,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');

function skeletonWithName(name) {
  return buildSkeletonForSchemaIdentity({
    schemaVersion: 1,
    planName: 'p',
    workouts: [{
      name,
      blocks: [{ blockType: 'SINGLE', roundCount: null, setCounts: [3] }],
    }],
  });
}

// Memory retention itself is not deterministically observable in a unit test, so the
// invariant is asserted at its cause: the schema compiled for internal validation must
// not vary with the run's geometryHash. Measured separately, a hash-unique schema
// retained ~166 KB per compile on a shared Ajv instance; a hash-free one retained ~1.3 KB.
test('internal validation compiles a geometryHash-independent schema', () => {
  const first = skeletonWithName('Day A');
  const second = skeletonWithName('Day B');
  assert.notEqual(
    first.geometryHash,
    second.geometryHash,
    'the two skeletons must differ, otherwise this test proves nothing'
  );

  const firstSchema = buildSimpleWeeklyPlanFillProviderSchema(first, {
    pinGeometryHash: false,
  });
  const secondSchema = buildSimpleWeeklyPlanFillProviderSchema(second, {
    pinGeometryHash: false,
  });

  assert.equal(
    JSON.stringify(firstSchema),
    JSON.stringify(secondSchema),
    'two runs with identical geometry must reuse one compiled validator'
  );
  assert.equal(
    JSON.stringify(firstSchema).includes(first.geometryHash),
    false,
    'the run hash must not appear in the internally compiled schema'
  );
});

test('the provider-facing contract still pins the exact geometryHash', () => {
  const skeleton = skeletonWithName('Day A');
  const providerSchema = buildSimpleWeeklyPlanFillProviderSchema(skeleton);

  assert.deepEqual(providerSchema.properties.geometryHash, {
    type: 'string',
    const: skeleton.geometryHash,
  });
});

test('dropping the hash const does not weaken provider fill validation', () => {
  const skeleton = skeletonWithName('Day A');
  const valid = {
    schemaVersion: 4,
    geometryHash: skeleton.geometryHash,
    fills: {
      strengthExercises: [{
        exerciseId: 'exr_x',
        defaults: { tempo: '3010', restSeconds: 60, targetRir: 2, targetRpe: null },
        sets: [
          { mode: 'reps', targetReps: 8, targetRir: 2, notes: null },
          { mode: 'reps', targetReps: 8, targetRir: 2, notes: null },
          { mode: 'reps', targetReps: 8, targetRir: 2, notes: null },
        ],
        notes: null,
      }],
      cardioExercises: [],
      blockRests: [],
    },
  };
  assert.ok(normalizeSimpleWeeklyPlanProviderFills(
    structuredClone(valid),
    skeleton
  ));

  // A wrong hash is still rejected, by the explicit identity check.
  const wrongHash = structuredClone(valid);
  wrongHash.geometryHash = `sha256:${'b'.repeat(64)}`;
  assert.throws(
    () => normalizeSimpleWeeklyPlanProviderFills(wrongHash, skeleton),
    (error) => error.code === 'PROVIDER_FILL_GEOMETRY_HASH_MISMATCH'
  );

  // A structurally invalid payload is still rejected by AJV.
  const badTempo = structuredClone(valid);
  badTempo.fills.strengthExercises[0].defaults.tempo = 'controlled';
  assert.throws(
    () => normalizeSimpleWeeklyPlanProviderFills(badTempo, skeleton),
    (error) => error.code === 'INVALID_ENTITY_LOCAL_PROVIDER_FILL'
  );
});
