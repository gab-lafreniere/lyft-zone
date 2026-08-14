const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BOUND_PLAN_SCHEMA_VERSION,
  buildSimpleWeeklyPlanBoundPlanSchema,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/boundPlanSchema');
const {
  buildCoverageDiagnostic,
  normalizeForSpanMatch,
  verifyBoundPlan,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/boundPlanVerification');
const exerciseLibrary = require('../../../src/exercise-library/exercises.json');

const CORPUS_ROOT = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline/bound-plan'
);

function loadCase(id) {
  const source = fs.readFileSync(
    path.join(CORPUS_ROOT, id, '02-output-ai_generated-plan.txt'),
    'utf8'
  );
  const ids = new Set(source.match(/\bexr_[A-Za-z0-9_-]+\b/g) || []);
  return {
    source,
    eligibleExerciseLookup: Object.fromEntries(
      exerciseLibrary
        .filter((exercise) => ids.has(exercise.exerciseId))
        .map((exercise) => [exercise.exerciseId, exercise])
    ),
  };
}

function loadGroundTruth(id) {
  return JSON.parse(
    fs.readFileSync(path.join(CORPUS_ROOT, id, 'bound-plan.json'), 'utf8')
  );
}

function clone(value) {
  return structuredClone(value);
}

function verify(boundPlan, fixture, sessionsPerWeek = 2) {
  return verifyBoundPlan({
    boundPlan,
    generatedPlanText: fixture.source,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    sessionsPerWeek,
  });
}

function codesOf(result) {
  return result.failures.map((failure) => failure.code);
}

// ---------------------------------------------------------------- schema (V1)

test('the bound plan schema is strict-mode shaped: every property is required', () => {
  const schema = buildSimpleWeeklyPlanBoundPlanSchema();

  function assertClosed(node, pointer) {
    if (node.type === 'object') {
      assert.equal(
        node.additionalProperties,
        false,
        `${pointer} must forbid additional properties`
      );
      assert.deepEqual(
        [...node.required].sort(),
        Object.keys(node.properties).sort(),
        `${pointer} must require every declared property`
      );
      Object.entries(node.properties).forEach(([key, child]) =>
        assertClosed(child, `${pointer}/${key}`)
      );
      return;
    }
    if (node.type === 'array') {
      assertClosed(node.items, `${pointer}/items`);
      return;
    }
    if (Array.isArray(node.anyOf)) {
      node.anyOf.forEach((child, index) =>
        assertClosed(child, `${pointer}/anyOf/${index}`)
      );
    }
  }

  assertClosed(schema, '$');
});

test('the schema does not force a workout count (product decision D1)', () => {
  const schema = buildSimpleWeeklyPlanBoundPlanSchema();
  assert.equal(schema.properties.workouts.minItems, 1);
  assert.equal(schema.properties.workouts.maxItems, 7);
  assert.equal(
    JSON.stringify(schema).includes('sessionsPerWeek'),
    false,
    'the binder contract must never mention the requested session count'
  );
});

test('the schema does not constrain block arity by type (anti-fabrication)', () => {
  const block = buildSimpleWeeklyPlanBoundPlanSchema()
    .properties.workouts.items.properties.blocks.items;
  assert.equal(block.properties.exercises.minItems, 1);
  assert.equal(
    Array.isArray(block.anyOf),
    false,
    'a discriminated union could compel the model to invent a second superset lane'
  );
});

test('schema rejects unknown properties, wrong version and missing fields', () => {
  const fixture = loadCase('smoke-203907');
  const truth = loadGroundTruth('smoke-203907');

  const extra = clone(truth);
  extra.workouts[0].blocks[0].exercises[0].unexpected = 'x';
  assert.deepEqual(codesOf(verify(extra, fixture)), ['BOUND_PLAN_SCHEMA_INVALID']);

  const wrongVersion = clone(truth);
  wrongVersion.schemaVersion = BOUND_PLAN_SCHEMA_VERSION + 1;
  assert.deepEqual(
    codesOf(verify(wrongVersion, fixture)),
    ['BOUND_PLAN_SCHEMA_INVALID']
  );

  const missing = clone(truth);
  delete missing.workouts[0].blocks[0].exercises[0].tempo;
  assert.deepEqual(codesOf(verify(missing, fixture)), ['BOUND_PLAN_SCHEMA_INVALID']);
});

// ------------------------------------------------------- ground truth is valid

test('the smoke-203907 ground truth binds cleanly against its real source', () => {
  const fixture = loadCase('smoke-203907');
  const result = verify(loadGroundTruth('smoke-203907'), fixture);

  assert.equal(result.valid, true, JSON.stringify(result.failures));
  assert.equal(result.warnings.length, 0);
  assert.ok(result.spansChecked >= 40);
  assert.deepEqual(result.coverage, {
    poolIdOccurrencesInSource: 10,
    boundOccurrences: 10,
    missingOccurrences: 0,
    surplusOccurrences: 0,
    mismatches: [],
    integrityViolation: false,
  });
});

test('the prose-declared superset binds as one block with two lanes', () => {
  const truth = loadGroundTruth('smoke-203907');
  truth.workouts.forEach((workout) => {
    assert.equal(workout.blocks.length, 4);
    const supersets = workout.blocks.filter((block) => block.type === 'SUPERSET');
    assert.equal(supersets.length, 1);
    assert.equal(supersets[0].exercises.length, 2);
    assert.ok(supersets[0].restAfterRound);
    supersets[0].exercises.forEach((exercise) => {
      assert.equal(
        exercise.rest,
        null,
        'round-scoped rest belongs to the block, not the lane'
      );
    });
  });
});

// ------------------------------------------------------------------ spans (V2)

test('span normalization folds dashes, non-breaking spaces, case and newlines', () => {
  assert.equal(normalizeForSpanMatch('6–8'), '6-8');
  assert.equal(normalizeForSpanMatch('2—3 min'), '2-3 min');
  assert.equal(normalizeForSpanMatch('60 sec'), '60 sec');
  assert.equal(normalizeForSpanMatch('  A \n  B  '), 'a b');
  assert.equal(normalizeForSpanMatch('Rest'), normalizeForSpanMatch('rest'));
});

test('markdown emphasis is presentation, not content, and is folded on both sides', () => {
  // The real replay case: the source bolds the number, the binder copies the words.
  assert.equal(
    normalizeForSpanMatch('- Rest: **0 sec** between paired exercises')
      .includes(normalizeForSpanMatch('0 sec between paired exercises')),
    true
  );

  [
    ['**8-12**', '8-12'],
    ['*90 sec*', '90 sec'],
    ['_2 min_', '2 min'],
    ['`3-0-1-0`', '3-0-1-0'],
    ['__12 reps__', '12 reps'],
    ['**60 sec** after the pair', '60 sec after the pair'],
  ].forEach(([source, returned]) => {
    assert.equal(
      normalizeForSpanMatch(source).includes(normalizeForSpanMatch(returned)),
      true,
      `${source} must accept ${returned}`
    );
  });
});

test('folding emphasis does not let a genuinely different value through', () => {
  [
    ['**0 sec** between paired exercises', '90 sec between paired exercises'],
    ['**8-12**', '8-14'],
    ['`3-0-1-0`', '3-0-2-0'],
    ['Rest: **60 sec**', 'rest: 75 sec'],
    ['**12 reps** each side', '12 reps each leg'],
  ].forEach(([source, returned]) => {
    assert.equal(
      normalizeForSpanMatch(source).includes(normalizeForSpanMatch(returned)),
      false,
      `${source} must still reject ${returned}`
    );
  });
});

test('a markdown-stripped value verifies end to end against the real 202258 source', () => {
  const fixture = loadCase('smoke-202258');
  const source = fixture.source;
  assert.match(source, /- Rest: \*\*0 sec\*\* between paired exercises/);

  const boundPlan = {
    schemaVersion: 1,
    planName: 'Weekly Split',
    workouts: [{
      name: 'Workout 1 — Chest Emphasis + Biceps',
      blocks: [{
        type: 'SUPERSET',
        restAfterRound: '90 sec after each round',
        exercises: [
          {
            exerciseId: 'exr_cable_preacher_curl',
            sets: 3,
            reps: '8–12',
            rir: '1–2',
            rpe: null,
            tempo: '2-0-2-0',
            // Emphasis stripped by the binder, exactly as observed in the replay.
            rest: '0 sec between paired exercises',
            duration: null,
            intensity: null,
            machineSettings: null,
            notes: null,
          },
          {
            exerciseId: 'exr_incline_hammer_curl',
            sets: 3,
            reps: '10–12',
            rir: '1–2',
            rpe: null,
            tempo: '2-0-2-0',
            rest: null,
            duration: null,
            intensity: null,
            machineSettings: null,
            notes: null,
          },
        ],
      }],
    }],
  };

  const result = verifyBoundPlan({
    boundPlan,
    generatedPlanText: source,
    // Scoped to the two bound ids: this test is about span fidelity, not occurrence
    // integrity, which has its own dedicated tests.
    eligibleExerciseLookup: Object.fromEntries(
      ['exr_cable_preacher_curl', 'exr_incline_hammer_curl']
        .map((id) => [id, fixture.eligibleExerciseLookup[id]])
    ),
    sessionsPerWeek: 1,
  });
  assert.deepEqual(codesOf(result), []);
  assert.equal(result.valid, true);
});

test('verification never mutates the bound value it checks', () => {
  const fixture = loadCase('smoke-203907');
  const boundPlan = clone(loadGroundTruth('smoke-203907'));
  boundPlan.workouts[0].blocks[1].exercises[0].rest = '**2–3 min**';
  const before = JSON.stringify(boundPlan);

  const result = verify(boundPlan, fixture);

  assert.equal(result.valid, true, 'the emphasised value still verifies');
  assert.equal(
    JSON.stringify(boundPlan),
    before,
    'the bound value must reach the resolver exactly as the binder returned it'
  );
  assert.equal(
    boundPlan.workouts[0].blocks[1].exercises[0].rest,
    '**2–3 min**',
    'normalization is verification-only'
  );
});

test('a value absent from the source is rejected as a hallucination', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[1].exercises[0].tempo = '4-4-4-4';

  const result = verify(defective, fixture);
  assert.equal(result.valid, false);
  assert.deepEqual(codesOf(result), ['BOUND_PLAN_SPAN_NOT_IN_SOURCE']);
  assert.equal(result.failures[0].received, '4-4-4-4');
  assert.match(result.failures[0].path, /blocks\/1\/exercises\/0\/tempo$/);
});

test('span verification accepts dash and whitespace variants of a real value', () => {
  const fixture = loadCase('smoke-203907');
  const variant = clone(loadGroundTruth('smoke-203907'));
  variant.workouts[0].blocks[1].exercises[0].reps = '6-8';
  variant.workouts[0].blocks[1].exercises[0].rest = '2-3  min';

  assert.equal(verify(variant, fixture).valid, true);
});

// ------------------------------------------------------------ eligibility (V3)

test('an exerciseId outside the eligible pool is rejected', () => {
  const fixture = loadCase('creator-out-of-pool');
  const truth = clone(loadGroundTruth('smoke-203907'));
  truth.workouts[0].blocks[1].exercises[0].exerciseId =
    'exr_fabricated_press_variant';

  const result = verifyBoundPlan({
    boundPlan: truth,
    generatedPlanText: fixture.source,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
    sessionsPerWeek: 2,
  });
  assert.ok(codesOf(result).includes('BOUND_PLAN_EXERCISE_OUTSIDE_POOL'));
});

// Replay #3 sample 5: the binder copied the whole label into exerciseId. The span check
// passes because that text really is in the source, so exact pool membership is the only
// thing standing between the slip and a corrupted plan.
test('an exerciseId carrying the display name is rejected even though it is verbatim', () => {
  const fixture = loadCase('smoke-203907');
  assert.match(
    fixture.source,
    /- \*\*exerciseId:\*\* exr_treadmill_walk — Treadmill Walk/,
    'the source writes the id followed by an em dash and the display name'
  );

  const accepted = clone(loadGroundTruth('smoke-203907'));
  assert.equal(
    accepted.workouts[0].blocks[0].exercises[0].exerciseId,
    'exr_treadmill_walk',
    'the identifier token alone is what must be bound'
  );
  assert.equal(verify(accepted, fixture).valid, true);

  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[0].exercises[0].exerciseId =
    'exr_treadmill_walk — Treadmill Walk';

  const result = verify(defective, fixture);
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).includes('BOUND_PLAN_EXERCISE_OUTSIDE_POOL'));
  const poolFailure = result.failures.find(
    (failure) => failure.code === 'BOUND_PLAN_EXERCISE_OUTSIDE_POOL'
  );
  assert.equal(poolFailure.received, 'exr_treadmill_walk — Treadmill Walk');

  // The span verifier alone would have let this through: the label IS in the source.
  assert.equal(
    normalizeForSpanMatch(fixture.source)
      .includes(normalizeForSpanMatch('exr_treadmill_walk — Treadmill Walk')),
    true,
    'exact pool membership, not span verification, is what catches this'
  );
});

test('the bind instructions state the exerciseId token rule without digits', () => {
  const {
    BOUND_PLAN_BIND_INSTRUCTIONS,
  } = require('../../../src/domain/simpleWeeklyPlanPipeline/aiPrompts');

  // The instruction block is hard-wrapped, so match across the line breaks.
  const flat = BOUND_PLAN_BIND_INSTRUCTIONS.replace(/\s+/g, ' ');
  assert.match(flat, /identifier token only/);
  assert.match(flat, /starts with exr_ and contains no spaces/);
  assert.match(
    flat,
    /Never include the display name, a dash, punctuation, label text, or surrounding markdown/
  );
  assert.equal(/\d/.test(BOUND_PLAN_BIND_INSTRUCTIONS), false);
});

test('a strength exercise inside a CARDIO block is rejected', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[0].exercises[0].exerciseId =
    'exr_incline_dumbbell_press';

  assert.ok(
    codesOf(verify(defective, fixture)).includes(
      'BOUND_PLAN_EXERCISE_TYPE_MISMATCH'
    )
  );
});

// ------------------------------------------------------------------ arity (V4)

test('the real legacy 203907 defect — a split superset — is caught as a binder fault', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  const superset = defective.workouts[0].blocks[2];
  // Reproduce exactly what legacy Call #2 did: one SUPERSET block per lane.
  defective.workouts[0].blocks.splice(
    2,
    1,
    { type: 'SUPERSET', restAfterRound: superset.restAfterRound, exercises: [superset.exercises[0]] },
    { type: 'SUPERSET', restAfterRound: superset.restAfterRound, exercises: [superset.exercises[1]] }
  );

  const result = verify(defective, fixture);
  assert.equal(result.valid, false);
  const codes = codesOf(result);
  assert.equal(
    codes.filter((code) => code === 'BOUND_PLAN_BLOCK_ARITY_INVALID').length,
    2,
    'both single-lane SUPERSET blocks must be reported'
  );
});

test('SINGLE and CARDIO blocks must hold exactly one exercise', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[1].exercises.push(
    clone(defective.workouts[0].blocks[3].exercises[0])
  );

  assert.ok(
    codesOf(verify(defective, fixture)).includes('BOUND_PLAN_BLOCK_ARITY_INVALID')
  );
});

test('supersets wider than two lanes are rejected until the editor supports them (D5)', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  const superset = defective.workouts[0].blocks[2];
  superset.exercises.push(clone(superset.exercises[0]));
  superset.exercises[2].exerciseId = 'exr_face_pull';
  superset.exercises[2].sets = 3;

  assert.ok(
    codesOf(verify(defective, fixture)).includes(
      'BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED'
    )
  );
});

// ---------------------------------------------------- set cardinality (V5, V8)

test('cardio must not carry a set count and strength must', () => {
  const fixture = loadCase('smoke-203907');

  const cardioSets = clone(loadGroundTruth('smoke-203907'));
  cardioSets.workouts[0].blocks[0].exercises[0].sets = 1;
  assert.ok(codesOf(verify(cardioSets, fixture)).includes('BOUND_PLAN_SETS_INVALID'));

  const noSets = clone(loadGroundTruth('smoke-203907'));
  noSets.workouts[0].blocks[1].exercises[0].sets = null;
  assert.ok(codesOf(verify(noSets, fixture)).includes('BOUND_PLAN_SETS_INVALID'));
});

test('unequal SUPERSET lane set counts fail closed and are never padded (D4)', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[2].exercises[1].sets = 2;

  const result = verify(defective, fixture);
  assert.equal(result.valid, false);
  const failure = result.failures.find(
    (entry) => entry.code === 'BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL'
  );
  assert.ok(failure);
  assert.deepEqual(failure.received, [3, 2]);
});

// ------------------------------------------------------ workout count (V6)

test('a workout count mismatch is reported with both sides', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts.pop();

  const result = verify(defective, fixture);
  const failure = result.failures.find(
    (entry) => entry.code === 'BOUND_PLAN_WORKOUT_COUNT_MISMATCH'
  );
  assert.ok(failure);
  assert.equal(failure.received, 1);
  assert.equal(failure.expected, 2);
});

// --------------------------------------------------------- rest scope (V7)

test('round-scoped rest is only legal on a SUPERSET block', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts[0].blocks[3].restAfterRound = '60 sec';

  assert.ok(
    codesOf(verify(defective, fixture)).includes('BOUND_PLAN_REST_SCOPE_INVALID')
  );
});

// ------------------------------------------------------- coverage (warning only)

test('coverage never proposes an id the coach invented in prose (smoke-202258)', () => {
  const fixture = loadCase('smoke-202258');
  assert.match(fixture.source, /exr_tricep-less/);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      fixture.eligibleExerciseLookup,
      'exr_tricep-less'
    ),
    false
  );

  const coverage = buildCoverageDiagnostic({
    boundPlan: { schemaVersion: 1, planName: 'x', workouts: [] },
    generatedPlanText: fixture.source,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });

  assert.equal(
    JSON.stringify(coverage).includes('exr_tricep-less'),
    false,
    'the closed dictionary can never surface an id that is not in the pool'
  );
  assert.ok(coverage.poolIdOccurrencesInSource > 0);
});

test('an omitted block is now a verification failure, not a warning', () => {
  const fixture = loadCase('smoke-203907');
  const truth = clone(loadGroundTruth('smoke-203907'));
  // Drop the final block of workout 2 so its exercise is bound nowhere.
  truth.workouts[1].blocks.pop();

  const result = verify(truth, fixture);

  assert.equal(result.valid, false, 'losing executable content must fail verification');
  assert.ok(codesOf(result).includes('BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING'));
  assert.equal(result.warnings.length, 0, 'integrity is a failure, never a warning');
  assert.deepEqual(result.coverage.mismatches, [
    { exerciseId: 'exr_cable_rope_curl', sourceCount: 1, boundCount: 0 },
  ]);
});

// Helpers shared by the coverage-counter tests.
function coverageLookup(exerciseIds) {
  return Object.fromEntries(
    exerciseLibrary
      .filter((exercise) => exerciseIds.includes(exercise.exerciseId))
      .map((exercise) => [exercise.exerciseId, exercise])
  );
}

function coverageExercise(exerciseId) {
  return {
    exerciseId,
    sets: 1,
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

function coveragePlan(workouts) {
  return {
    schemaVersion: 1,
    planName: 'p',
    workouts: workouts.map(([name, ids]) => ({
      name,
      blocks: ids.map((id) => ({
        type: 'SINGLE',
        restAfterRound: null,
        exercises: [coverageExercise(id)],
      })),
    })),
  };
}

test('a prefix collision is counted independently and never inflates coverage', () => {
  // The real 6x120 run: exr_leg_press is a literal prefix of exr_leg_press_calf_raise,
  // so substring matching reported a phantom unbound occurrence.
  const source = [
    '# Day 1',
    '- exr_leg_press — Leg Press',
    '- exr_leg_press_calf_raise — Leg Press Calf Raise',
  ].join('\n');
  const lookup = coverageLookup(['exr_leg_press', 'exr_leg_press_calf_raise']);

  const coverage = buildCoverageDiagnostic({
    boundPlan: coveragePlan([
      ['Day 1', ['exr_leg_press', 'exr_leg_press_calf_raise']],
    ]),
    generatedPlanText: source,
    eligibleExerciseLookup: lookup,
  });

  assert.equal(coverage.poolIdOccurrencesInSource, 2, 'two ids, two occurrences');
  assert.equal(coverage.boundOccurrences, 2);
  assert.equal(coverage.missingOccurrences, 0, 'the shorter id must not match inside the longer one');
  assert.equal(coverage.surplusOccurrences, 0);
  assert.equal(coverage.integrityViolation, false);
});

test('a prefix-only appearance is not counted as an occurrence of the shorter id', () => {
  // The longer id appears; the shorter one never does on its own.
  const source = '# Day 1\n- exr_leg_press_calf_raise — Leg Press Calf Raise';
  const coverage = buildCoverageDiagnostic({
    boundPlan: coveragePlan([['Day 1', ['exr_leg_press_calf_raise']]]),
    generatedPlanText: source,
    eligibleExerciseLookup: coverageLookup([
      'exr_leg_press',
      'exr_leg_press_calf_raise',
    ]),
  });

  assert.equal(coverage.poolIdOccurrencesInSource, 1);
  assert.equal(coverage.integrityViolation, false);
});

test('punctuation and markdown around an exerciseId do not hide an occurrence', () => {
  const lookup = coverageLookup(['exr_face_pull']);
  [
    '- **exr_face_pull** — Face Pull',
    '- `exr_face_pull`, 3 sets',
    '1. (exr_face_pull)',
    '- exr_face_pull.',
    '- *exr_face_pull*;',
    '- **exerciseId:** exr_face_pull — Face Pull',
  ].forEach((line) => {
    const coverage = buildCoverageDiagnostic({
      boundPlan: coveragePlan([['Day 1', ['exr_face_pull']]]),
      generatedPlanText: `# Day 1\n${line}`,
      eligibleExerciseLookup: lookup,
    });
    assert.equal(
      coverage.poolIdOccurrencesInSource,
      1,
      `should find the id in: ${line}`
    );
    assert.equal(coverage.integrityViolation, false, line);
  });
});

test('an id embedded inside a longer identifier is not an occurrence', () => {
  const coverage = buildCoverageDiagnostic({
    boundPlan: coveragePlan([['Day 1', []]]),
    generatedPlanText: '# Day 1\n- exr_face_pull_machine_variant is not a pool id',
    eligibleExerciseLookup: coverageLookup(['exr_face_pull']),
  });

  assert.equal(coverage.poolIdOccurrencesInSource, 0);
});

test('a genuinely missing exact token still produces an integrity violation', () => {
  // Day 2's closing block is dropped: its id is bound nowhere and sits after every
  // bound id of that workout.
  const source = [
    '# Day 1',
    '- exr_treadmill_walk warm up',
    '- exr_leg_press work',
    '# Day 2',
    '- exr_treadmill_walk warm up',
    '- exr_face_pull work',
    '- exr_leg_press_calf_raise closing block',
  ].join('\n');

  const coverage = buildCoverageDiagnostic({
    boundPlan: coveragePlan([
      ['Day 1', ['exr_treadmill_walk', 'exr_leg_press']],
      ['Day 2', ['exr_treadmill_walk', 'exr_face_pull']],
    ]),
    generatedPlanText: source,
    eligibleExerciseLookup: coverageLookup([
      'exr_treadmill_walk',
      'exr_leg_press',
      'exr_leg_press_calf_raise',
      'exr_face_pull',
    ]),
  });

  assert.equal(coverage.poolIdOccurrencesInSource, 5);
  assert.equal(coverage.boundOccurrences, 4);
  assert.equal(coverage.missingOccurrences, 1);
  assert.equal(coverage.integrityViolation, true, 'the dropped block is still detected');
  assert.deepEqual(coverage.mismatches, [
    { exerciseId: 'exr_leg_press_calf_raise', sourceCount: 1, boundCount: 0 },
  ]);
});

test('coverage counts occurrences and never deduplicates a repeated exercise id', () => {
  // The real 6x120 run bound exr_incline_treadmill_walk five times while the source
  // used it six times. Deduplicating by id would have hidden the dropped block.
  const source = [
    '# Day 1',
    '- exr_treadmill_walk warm up',
    '- exr_incline_dumbbell_press work',
    '- exr_treadmill_walk cool down',
    '# Day 2',
    '- exr_treadmill_walk warm up',
    '- exr_face_pull work',
    '- exr_treadmill_walk cool down',
  ].join('\n');
  const lookup = Object.fromEntries(
    exerciseLibrary
      .filter((exercise) => [
        'exr_treadmill_walk',
        'exr_incline_dumbbell_press',
        'exr_face_pull',
      ].includes(exercise.exerciseId))
      .map((exercise) => [exercise.exerciseId, exercise])
  );
  const boundExercise = (exerciseId) => ({
    exerciseId,
    sets: 1,
    reps: null,
    rir: null,
    rpe: null,
    tempo: null,
    rest: null,
    duration: null,
    intensity: null,
    machineSettings: null,
    notes: null,
  });
  const workout = (name, ids) => ({
    name,
    blocks: ids.map((id) => ({
      type: 'SINGLE',
      restAfterRound: null,
      exercises: [boundExercise(id)],
    })),
  });

  // Every occurrence bound: four treadmill occurrences, four bindings.
  const complete = buildCoverageDiagnostic({
    boundPlan: {
      schemaVersion: 1,
      planName: 'p',
      workouts: [
        workout('Day 1', ['exr_treadmill_walk', 'exr_incline_dumbbell_press', 'exr_treadmill_walk']),
        workout('Day 2', ['exr_treadmill_walk', 'exr_face_pull', 'exr_treadmill_walk']),
      ],
    },
    generatedPlanText: source,
    eligibleExerciseLookup: lookup,
  });
  assert.equal(complete.poolIdOccurrencesInSource, 6);
  assert.equal(complete.boundOccurrences, 6);
  assert.equal(complete.integrityViolation, false);

  // Day 2's closing treadmill block dropped: the id is still bound three times, so a
  // deduplicating check would see nothing wrong.
  const dropped = buildCoverageDiagnostic({
    boundPlan: {
      schemaVersion: 1,
      planName: 'p',
      workouts: [
        workout('Day 1', ['exr_treadmill_walk', 'exr_incline_dumbbell_press', 'exr_treadmill_walk']),
        workout('Day 2', ['exr_treadmill_walk', 'exr_face_pull']),
      ],
    },
    generatedPlanText: source,
    eligibleExerciseLookup: lookup,
  });
  assert.equal(dropped.boundOccurrences, 5);
  assert.equal(dropped.missingOccurrences, 1, 'counted by occurrence, not by id');
  assert.equal(dropped.integrityViolation, true);
  assert.deepEqual(
    dropped.mismatches,
    [{ exerciseId: 'exr_treadmill_walk', sourceCount: 4, boundCount: 3 }],
    'the id is bound elsewhere, so only occurrence counting catches this'
  );
});

test('verification reports facts only and never assigns an owner', () => {
  const fixture = loadCase('smoke-203907');
  const defective = clone(loadGroundTruth('smoke-203907'));
  defective.workouts.pop();

  const serialized = JSON.stringify(verify(defective, fixture));
  ['CREATOR', 'BINDER', 'retry', 'repair'].forEach((word) => {
    assert.equal(
      serialized.includes(word),
      false,
      `verification must not classify ownership (${word}); the recovery policy owns that`
    );
  });
});
