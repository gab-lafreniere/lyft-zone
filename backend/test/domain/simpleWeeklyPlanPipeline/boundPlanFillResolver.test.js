const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseSourcePlan,
  resolveDeterministicWeeklyPlanFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/deterministicFillResolver');
const {
  resolveBoundPlanWeeklyPlanFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/boundPlanFillResolver');
const {
  upperBound,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillNormalization');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  adaptBoundPlanToGeometry,
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  normalizeSimpleWeeklyPlanProviderFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillSchema');
const {
  validateSimpleWeeklyPlanFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillValidation');
const {
  materializeSimpleWeeklyPlan,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillMaterializer');
const {
  buildWeeklyPlanFillFallbackRequest,
  mergeWeeklyPlanFillFallback,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillFallback');
const {
  computeWeeklyPlanWorkoutMetrics,
} = require('../../../src/domain/weeklyPlans/weeklyPlanMetrics');
const exerciseLibrary = require('../../../src/exercise-library/exercises.json');

const FIXTURES = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline/real-call3-fixtures'
);
const AFTER_ROUND = /after\s+(?:the\s+|each\s+)?(?:pair|round)|after\s+\d*B\b/i;
const MACHINE_KEYS = ['speed', 'incline', 'resistance', 'level', 'pace'];

function loadFixture(name) {
  const directory = path.join(FIXTURES, name);
  const source = fs.readFileSync(
    path.join(directory, '02-output-ai_generated-plan.txt'),
    'utf8'
  );
  const structure = JSON.parse(fs.readFileSync(
    path.join(directory, '04-output-ai_extracted-structure.json'),
    'utf8'
  ));
  const ids = new Set(source.match(/\b(?:exr|ex)_[A-Za-z0-9_:-]+\b/g) || []);
  return {
    source,
    structure,
    sessionsPerWeek: Object.keys(structure)
      .filter((key) => /^workout_\d+$/.test(key)).length,
    eligibleExerciseLookup: Object.fromEntries(
      exerciseLibrary
        .filter((exercise) => ids.has(exercise.exerciseId))
        .map((exercise) => [exercise.exerciseId, exercise])
    ),
  };
}

// Converts the legacy parser's own reading of a fixture into the BoundPlan a correct
// binder would return for the same text. The legacy parser is known-correct for
// fixtures A and B, so this makes the two resolvers directly comparable without
// hand-authoring a bound plan that could silently drift from the source.
function legacyParseToBoundPlan(source, structure) {
  const parsed = parseSourcePlan(source);

  return {
    schemaVersion: 1,
    planName: structure.planName,
    workouts: parsed.map((workout) => ({
      name: workout.name,
      blocks: workout.blocks.map((block) => {
        const isSuperset = block.blockType === 'SUPERSET';
        // A correct binder puts a round-scoped rest on the block and leaves that
        // lane's own rest null, which is exactly the scope the source expressed.
        const roundRest = isSuperset
          ? (block.afterRoundRest
            || block.exercises.map((entry) => entry.rest || '')
              .find((value) => AFTER_ROUND.test(value))
            || null)
          : null;

        return {
          type: block.blockType,
          restAfterRound: roundRest,
          exercises: block.exercises.map((entry) => {
            const machineSettings = MACHINE_KEYS
              .filter((key) => entry[key] != null)
              .map((key) => ({ key, value: String(entry[key]) }));
            const laneRest = entry.rest || null;

            return {
              exerciseId: entry.exerciseId,
              sets: block.blockType === 'CARDIO'
                ? null
                : upperBound(entry.sets),
              reps: entry.reps || null,
              rir: entry.rir || null,
              rpe: entry.rpe || null,
              tempo: entry.tempo || null,
              rest: laneRest && laneRest === roundRest ? null : laneRest,
              duration: entry.duration || null,
              intensity: entry.heartRate || entry.intensity || entry.tempo || null,
              machineSettings: machineSettings.length ? machineSettings : null,
              notes: entry.notes || null,
            };
          }),
        };
      }),
    })),
  };
}

function buildBoth(name) {
  const fixture = loadFixture(name);
  const legacySkeleton = buildSimpleWeeklyPlanSkeleton(
    adaptSimpleWeeklyPlanStructureToLegacyGeometry(fixture.structure, {
      sessionsPerWeek: fixture.sessionsPerWeek,
    })
  );
  const boundPlan = legacyParseToBoundPlan(fixture.source, fixture.structure);
  const boundSkeleton = buildSimpleWeeklyPlanSkeleton(
    adaptBoundPlanToGeometry(boundPlan)
  );

  return { fixture, legacySkeleton, boundPlan, boundSkeleton };
}

function completeDocument(skeleton, providerFills, eligibleExerciseLookup) {
  const normalized = normalizeSimpleWeeklyPlanProviderFills(providerFills, skeleton);
  const validation = validateSimpleWeeklyPlanFills({
    skeleton,
    fillOutput: normalized,
    eligibleExerciseLookup,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const materialization = materializeSimpleWeeklyPlan({
    skeleton,
    normalizedFills: validation.normalizedFills,
    eligibleExerciseLookup,
  });
  assert.equal(materialization.valid, true, JSON.stringify(materialization.errors));
  return materialization.document;
}

// -------------------------------------------------------------- equivalence gate

['fixture-a', 'fixture-b'].forEach((name) => {
  test(`${name} produces byte-identical geometry, fills and Output 07`, () => {
    const { fixture, legacySkeleton, boundPlan, boundSkeleton } = buildBoth(name);

    assert.equal(
      boundSkeleton.geometryHash,
      legacySkeleton.geometryHash,
      'geometryHash must not move'
    );

    const legacy = resolveDeterministicWeeklyPlanFills({
      generatedPlanText: fixture.source,
      skeleton: legacySkeleton,
      eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    });
    const bound = resolveBoundPlanWeeklyPlanFills({
      boundPlan,
      skeleton: boundSkeleton,
      eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    });

    assert.deepEqual(
      bound.providerFills,
      legacy.providerFills,
      'provider fills must be identical'
    );
    assert.equal(bound.totalFieldCount, legacy.totalFieldCount);
    assert.equal(bound.unresolvedFieldCount, legacy.unresolvedFieldCount);
    assert.deepEqual(
      bound.unresolved.map((entry) => entry.resolutionId),
      legacy.unresolved.map((entry) => entry.resolutionId)
    );
    assert.deepEqual(
      bound.unresolved.map((entry) => entry.allowedValues),
      legacy.unresolved.map((entry) => entry.allowedValues)
    );
  });
});

test('fixture-a materializes an identical Output 07 through both resolvers', () => {
  const { fixture, legacySkeleton, boundPlan, boundSkeleton } = buildBoth('fixture-a');

  const legacyDocument = completeDocument(
    legacySkeleton,
    resolveDeterministicWeeklyPlanFills({
      generatedPlanText: fixture.source,
      skeleton: legacySkeleton,
      eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    }).providerFills,
    fixture.eligibleExerciseLookup
  );
  const boundDocument = completeDocument(
    boundSkeleton,
    resolveBoundPlanWeeklyPlanFills({
      boundPlan,
      skeleton: boundSkeleton,
      eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    }).providerFills,
    fixture.eligibleExerciseLookup
  );

  assert.deepEqual(boundDocument, legacyDocument);
});

test('fixture-b still needs exactly eight ambiguous block rests and no more', () => {
  const { fixture, boundPlan, boundSkeleton } = buildBoth('fixture-b');
  const bound = resolveBoundPlanWeeklyPlanFills({
    boundPlan,
    skeleton: boundSkeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });

  assert.equal(bound.fallbackRequired, true);
  assert.equal(bound.unresolvedFieldCount, 8);
  assert.equal(bound.fallbackEligible, true);
  bound.unresolved.forEach((entry) => {
    assert.equal(entry.entityType, 'blockRest');
    assert.ok(entry.allowedValues.length > 0);
  });
});

// ------------------------------------------------------------------ isolation

test('the bound plan resolver never receives the source document', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../../../src/domain/simpleWeeklyPlanPipeline/boundPlanFillResolver.js'
    ),
    'utf8'
  );

  // Strip comments: the module documents WHY it refuses the source document, so the
  // assertion must look at executable code only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  ['generatedPlanText', 'output2', 'parseSourcePlan'].forEach((token) => {
    assert.equal(
      code.includes(token),
      false,
      `the fill stage must not reference ${token} in executable code`
    );
  });
});

test('resolution is deterministic across repeated runs', () => {
  const { fixture, boundPlan, boundSkeleton } = buildBoth('fixture-a');
  const run = () => JSON.stringify(resolveBoundPlanWeeklyPlanFills({
    boundPlan,
    skeleton: boundSkeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  }));

  assert.equal(run(), run());
});

test('each set object is an independent clone, never a shared reference', () => {
  const { fixture, boundPlan, boundSkeleton } = buildBoth('fixture-a');
  const bound = resolveBoundPlanWeeklyPlanFills({
    boundPlan,
    skeleton: boundSkeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  const exercise = bound.providerFills.fills.strengthExercises
    .find((entry) => entry.sets.length > 1);

  assert.ok(exercise);
  exercise.sets[0].targetRir = 99;
  assert.notEqual(exercise.sets[1].targetRir, 99);
});

// ------------------------------------------------------------- product decisions

function singleExerciseBoundPlan(overrides) {
  return {
    schemaVersion: 1,
    planName: 'Plan',
    workouts: [{
      name: 'Day 1',
      blocks: [{
        type: 'SINGLE',
        restAfterRound: null,
        exercises: [{
          exerciseId: 'exr_incline_dumbbell_press',
          sets: 2,
          reps: '6–8',
          rir: '2',
          rpe: null,
          tempo: '3-0-1-0',
          rest: '120 sec',
          duration: null,
          intensity: null,
          machineSettings: null,
          notes: null,
          ...overrides,
        }],
      }],
    }],
  };
}

function singleExerciseSetup(overrides) {
  const boundPlan = singleExerciseBoundPlan(overrides);
  const skeleton = buildSimpleWeeklyPlanSkeleton(adaptBoundPlanToGeometry(boundPlan));
  const eligibleExerciseLookup = Object.fromEntries(
    exerciseLibrary
      .filter((exercise) => exercise.exerciseId === 'exr_incline_dumbbell_press')
      .map((exercise) => [exercise.exerciseId, exercise])
  );
  return { boundPlan, skeleton, eligibleExerciseLookup };
}

test('D2: RIR wins over RPE and the dropped value is recorded, not fatal', () => {
  const setup = singleExerciseSetup({ rir: '1–2', rpe: '8' });
  const result = resolveBoundPlanWeeklyPlanFills(setup);
  const defaults = result.providerFills.fills.strengthExercises[0].defaults;

  assert.equal(defaults.targetRir, 2);
  assert.equal(defaults.targetRpe, null);
  assert.ok(result.normalizationDecisions.some(
    (decision) => decision.rule === 'RIR_PRECEDENCE_OVER_RPE'
  ));
  assert.equal(result.fallbackRequired, false);
});

test('a qualitative tempo resolves to null and needs no fallback', () => {
  const setup = singleExerciseSetup({ tempo: 'controlled' });
  const result = resolveBoundPlanWeeklyPlanFills(setup);

  assert.equal(result.providerFills.fills.strengthExercises[0].defaults.tempo, null);
  assert.equal(result.fallbackRequired, false, 'no AI call for an absent tempo');
  assert.equal(result.unresolvedFieldCount, 0);
  assert.ok(result.normalizationDecisions.some(
    (decision) => decision.rule === 'TEMPO_UNSPECIFIED_TO_NULL'
  ));
});

test('every qualitative tempo form resolves to null rather than inventing digits', () => {
  // NOTE: a partially numeric tempo such as "X-0-1-0" is NOT in this list. normalizeTempo
  // strips the X, leaves "010", and pads to "0100" — pre-existing behaviour shared with
  // the legacy resolver, outside the scope of this change. Reported for the audit.
  ['controlled', 'explosive', 'slow and controlled', 'tempo controlled', '2-1', '']
    .forEach((tempo) => {
      const result = resolveBoundPlanWeeklyPlanFills(singleExerciseSetup({ tempo }));
      assert.equal(
        result.providerFills.fills.strengthExercises[0].defaults.tempo,
        null,
        `tempo ${JSON.stringify(tempo)} must resolve to null`
      );
      assert.equal(result.fallbackRequired, false, tempo);
      assert.notEqual(
        result.providerFills.fills.strengthExercises[0].defaults.tempo,
        '0000'
      );
    });
});

test('an explicit numeric tempo still normalizes unchanged', () => {
  [['3-0-1-0', '3010'], ['2-1-2', '2120'], ['2010', '2010']]
    .forEach(([source, expected]) => {
      const result = resolveBoundPlanWeeklyPlanFills(
        singleExerciseSetup({ tempo: source })
      );
      assert.equal(
        result.providerFills.fills.strengthExercises[0].defaults.tempo,
        expected,
        source
      );
      assert.equal(result.fallbackRequired, false);
    });
});

test('a null tempo survives validation and materializes into Output 07', () => {
  const setup = singleExerciseSetup({ tempo: 'controlled' });
  const result = resolveBoundPlanWeeklyPlanFills(setup);
  const document = completeDocument(
    setup.skeleton,
    result.providerFills,
    setup.eligibleExerciseLookup
  );
  const exercise = document.workouts[0].blocks[0].exercises[0];

  assert.equal(exercise.defaultTempo, null, 'Output 07 carries the canonical absence');
  assert.notEqual(exercise.defaultTempo, '0000');
});

test('a time-based prescription with a null tempo still uses targetSeconds', () => {
  const setup = singleExerciseSetup({ tempo: 'controlled', reps: '30 seconds' });
  const result = resolveBoundPlanWeeklyPlanFills(setup);
  const document = completeDocument(
    setup.skeleton,
    result.providerFills,
    setup.eligibleExerciseLookup
  );
  const exercise = document.workouts[0].blocks[0].exercises[0];

  assert.equal(exercise.defaultTempo, null);
  exercise.setTemplates.forEach((setTemplate) => {
    assert.equal(setTemplate.targetSeconds, 30, 'the time target carries the work');
    assert.equal(setTemplate.targetReps, null);
  });

  // The duration engine reads targetSeconds and never consults tempo here.
  const metrics = computeWeeklyPlanWorkoutMetrics(document.workouts[0]);
  assert.ok(metrics.totalTUTSeconds >= 60, 'two 30 second sets contribute their time');
});

test('the fallback contract no longer accepts a tempo resolution target', () => {
  const geometryHash = `sha256:${'1'.repeat(64)}`;

  assert.throws(() => mergeWeeklyPlanFillFallback({
    providerFills: {
      schemaVersion: 4,
      geometryHash,
      fills: {
        strengthExercises: [
          { exerciseId: 'x', defaults: { tempo: null }, sets: [], notes: null },
        ],
        cardioExercises: [],
        blockRests: [],
      },
    },
    unresolved: [{
      resolutionId: 'strengthExercises[0].defaults.tempo',
      entityType: 'strengthExercise',
      entityIndex: 0,
      field: 'BlockExercise.defaultTempo',
      expected: { type: 'string', pattern: '^[0-9]{4}$' },
      fallbackEligible: true,
    }],
    fallbackOutput: {
      schemaVersion: 1,
      geometryHash,
      resolutions: [
        { resolutionId: 'strengthExercises[0].defaults.tempo', value: '3010' },
      ],
    },
  }), (error) => {
    // The contract refuses a tempo target: its value is not an integer drawn from a
    // source-supported allowlist, and it is no longer an allowlisted merge target.
    assert.ok([
      'INVALID_FILL_FALLBACK_VALUE',
      'INVALID_FILL_FALLBACK_ALLOWED_VALUES',
      'UNSUPPORTED_FILL_FALLBACK_MERGE_TARGET',
    ].includes(error.code), `unexpected code ${error.code}`);
    return true;
  }, 'tempo is no longer a fallback-eligible field');
});

test('unnormalizable rest and rep targets still fail closed (D7)', () => {
  assert.throws(
    () => resolveBoundPlanWeeklyPlanFills(singleExerciseSetup({ rest: 'as needed' })),
    (error) => error.code === 'DETERMINISTIC_EXERCISE_REST_UNRESOLVED'
  );
  assert.throws(
    () => resolveBoundPlanWeeklyPlanFills(singleExerciseSetup({ reps: 'AMRAP' })),
    (error) => error.code === 'DETERMINISTIC_SET_TARGET_UNRESOLVED'
  );
});

test('a superset lane that merely restates the round rest is not double counted', () => {
  const boundPlan = {
    schemaVersion: 1,
    planName: 'Plan',
    workouts: [{
      name: 'Day 1',
      blocks: [{
        type: 'SUPERSET',
        restAfterRound: '60 sec after the pair',
        exercises: [
          {
            exerciseId: 'exr_cable_chest_fly',
            sets: 3,
            reps: '10–15',
            rir: '2',
            rpe: null,
            tempo: '2-1-2-0',
            rest: '30 sec then move to B',
            duration: null,
            intensity: null,
            machineSettings: null,
            notes: null,
          },
          {
            exerciseId: 'exr_face_pull',
            sets: 3,
            reps: '12–20',
            rir: '2',
            rpe: null,
            tempo: '2-1-2-0',
            rest: '60 sec after the pair',
            duration: null,
            intensity: null,
            machineSettings: null,
            notes: null,
          },
        ],
      }],
    }],
  };
  const skeleton = buildSimpleWeeklyPlanSkeleton(adaptBoundPlanToGeometry(boundPlan));
  const eligibleExerciseLookup = Object.fromEntries(
    exerciseLibrary
      .filter((exercise) => ['exr_cable_chest_fly', 'exr_face_pull']
        .includes(exercise.exerciseId))
      .map((exercise) => [exercise.exerciseId, exercise])
  );

  const result = resolveBoundPlanWeeklyPlanFills({
    boundPlan,
    skeleton,
    eligibleExerciseLookup,
  });

  assert.equal(result.providerFills.fills.blockRests[0].value, 60);
  assert.equal(
    result.providerFills.fills.strengthExercises[0].defaults.restSeconds,
    30,
    'a genuine lane transition rest is preserved'
  );
  assert.equal(
    result.providerFills.fills.strengthExercises[1].defaults.restSeconds,
    null,
    'the lane that restates the round rest is nulled'
  );
  assert.ok(result.normalizationDecisions.some(
    (decision) => decision.rule === 'SUPERSET_LANE_REST_DUPLICATES_ROUND_REST'
  ));
});
