const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORPUS_ROOT = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline/bound-plan'
);
const corpus = require(path.join(CORPUS_ROOT, 'corpus.json'));
const exerciseLibrary = require('../../../src/exercise-library/exercises.json');

const LIBRARY_IDS = new Set(
  exerciseLibrary.map((exercise) => exercise.exerciseId)
);

function readSource(entry) {
  return fs.readFileSync(path.join(CORPUS_ROOT, entry.sourcePlan), 'utf8');
}

function caseById(id) {
  const entry = corpus.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `corpus case ${id} must exist`);
  return entry;
}

test('every corpus case resolves to a non-empty real source plan', () => {
  assert.equal(corpus.cases.length, 8);
  corpus.cases.forEach((entry) => {
    const source = readSource(entry);
    assert.ok(
      source.trim().length > 500,
      `${entry.id} source plan must be substantial`
    );
    assert.ok(
      Number.isInteger(entry.sessionsPerWeek) && entry.sessionsPerWeek >= 1,
      `${entry.id} must declare sessionsPerWeek`
    );
    assert.ok(entry.truth, `${entry.id} must declare ground truth`);
  });
});

test('the corpus covers every observed Call #1 dialect and both failure owners', () => {
  const ids = corpus.cases.map((entry) => entry.id);
  ['fixture-a', 'fixture-b', 'smoke-202258', 'smoke-203739', 'smoke-203907']
    .forEach((id) => assert.ok(ids.includes(id), `${id} must be preserved`));

  const realFailures = corpus.cases.filter(
    (entry) => entry.origin === 'real-production-failure'
  );
  assert.equal(realFailures.length, 3);

  const creatorCases = corpus.cases.filter(
    (entry) => entry.expectedBoundPlanOutcome === 'CREATOR_REPAIR_ELIGIBLE'
  );
  assert.equal(creatorCases.length, 3);
});

test('smoke-202258 preserves the prose exerciseId that killed the real run', () => {
  const source = readSource(caseById('smoke-202258'));
  assert.match(source, /exr_tricep-less/);
  assert.equal(
    LIBRARY_IDS.has('exr_tricep-less'),
    false,
    'the prose id must be absent from the library, which is why a closed dictionary never proposes it'
  );
  assert.match(source, /Not included intentionally/);
});

test('smoke-203907 declares a superset that exists only as prose', () => {
  const entry = caseById('smoke-203907');
  const source = readSource(entry);
  assert.match(source, /\*\*Superset:\*\*\s*B1 with B2/);
  assert.equal(
    entry.legacyCall2WasCorrect,
    false,
    'legacy Call #2 split this superset into one block per exercise'
  );
  assert.equal(entry.truth.blockCount, 8);
  assert.equal(entry.truth.exerciseCount, 10);
});

test('smoke-203739 uses a workout heading the legacy parser cannot see', () => {
  const source = readSource(caseById('smoke-203739'));
  assert.match(source, /^## Session 1 /m);
  assert.equal(
    /^#{1,2}\s+Day\s+\d+\b/m.test(source),
    false,
    'no Day heading exists, which is why the legacy resolver parsed zero workouts'
  );
  assert.equal(/^Workout\s+\d+\b/m.test(source), false);
});

test('creator-fewer-workouts genuinely contains fewer workouts than required', () => {
  const entry = caseById('creator-fewer-workouts');
  const source = readSource(entry);
  const headings = source.split(/\n/).filter((line) => /^# Day \d/.test(line));
  assert.equal(headings.length, 1);
  assert.equal(entry.sessionsPerWeek, 2);
  assert.equal(entry.truth.workoutCount, 1);
});

test('creator-superset-unequal contains genuinely unequal lane set counts', () => {
  const source = readSource(caseById('creator-superset-unequal'));
  const laneIndex = source.indexOf('exr_seated_cable_row');
  assert.ok(laneIndex > 0);
  const laneBlock = source.slice(laneIndex, laneIndex + 260);
  assert.match(laneBlock, /\*\*sets:\*\*\s*2/);

  const partnerIndex = source.indexOf('exr_cable_chest_fly');
  const partnerBlock = source.slice(partnerIndex, partnerIndex + 260);
  assert.match(partnerBlock, /\*\*sets:\*\*\s*3/);
});

test('creator-out-of-pool references an id that is absent from the library', () => {
  const source = readSource(caseById('creator-out-of-pool'));
  assert.match(source, /exr_fabricated_press_variant/);
  assert.equal(LIBRARY_IDS.has('exr_fabricated_press_variant'), false);
});

test('every non-deliberate corpus exerciseId exists in the library', () => {
  const DELIBERATE_UNKNOWN = new Set([
    'exr_tricep-less',
    'exr_fabricated_press_variant',
  ]);

  corpus.cases.forEach((entry) => {
    const source = readSource(entry);
    const found = new Set(
      source.match(/\bexr_[A-Za-z0-9_-]+\b/g) || []
    );
    found.forEach((exerciseId) => {
      if (DELIBERATE_UNKNOWN.has(exerciseId)) {
        return;
      }
      assert.ok(
        LIBRARY_IDS.has(exerciseId),
        `${entry.id} references unknown exerciseId ${exerciseId}`
      );
    });
  });
});

// This guard exists because the fixture-b truth was originally transcribed from a
// study that audited a different, since-deleted Fixture B generation. Ground truth must
// be derivable from the file itself, never from prose about another run.
test('declared exercise counts match the ids actually present in each source', () => {
  // creator-out-of-pool deliberately swaps one executable id for a non-library one, so
  // it counts toward the executable total even though the library rejects it.
  // exr_tricep-less is prose only and must never count.
  const DELIBERATE_EXECUTABLE_UNKNOWN = new Set(['exr_fabricated_press_variant']);

  corpus.cases.forEach((entry) => {
    const source = readSource(entry);
    const occurrences = (source.match(/\bexr_[A-Za-z0-9_-]+\b/g) || [])
      .filter((exerciseId) => (
        LIBRARY_IDS.has(exerciseId) ||
        DELIBERATE_EXECUTABLE_UNKNOWN.has(exerciseId)
      ));

    assert.equal(
      occurrences.length,
      entry.truth.exerciseCount,
      `${entry.id}: declared exerciseCount must equal the executable id occurrences in its source`
    );
  });
});

test('fixture geometry truth is reproducible from the fixture itself', () => {
  const {
    adaptSimpleWeeklyPlanStructureToLegacyGeometry,
  } = require('../../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');

  [
    ['fixture-a', '../real-call3-fixtures/fixture-a/04-output-ai_extracted-structure.json'],
    ['fixture-b', '../real-call3-fixtures/fixture-b/04-output-ai_extracted-structure.json'],
  ].forEach(([id, relative]) => {
    const entry = caseById(id);
    const structure = JSON.parse(
      fs.readFileSync(path.join(CORPUS_ROOT, relative), 'utf8')
    );
    const sessionsPerWeek = Object.keys(structure)
      .filter((key) => /^workout_\d+$/.test(key)).length;
    const geometry = adaptSimpleWeeklyPlanStructureToLegacyGeometry(
      structure,
      { sessionsPerWeek }
    );

    let blockCount = 0;
    let exerciseCount = 0;
    let supersetCount = 0;
    let setTemplateCount = 0;
    geometry.workouts.forEach((workout) => {
      workout.blocks.forEach((block) => {
        blockCount += 1;
        if (block.blockType === 'SUPERSET') supersetCount += 1;
        block.setCounts.forEach((setCount) => {
          exerciseCount += 1;
          setTemplateCount += setCount;
        });
      });
    });

    assert.equal(sessionsPerWeek, entry.truth.workoutCount, `${id} workouts`);
    assert.equal(blockCount, entry.truth.blockCount, `${id} blocks`);
    assert.equal(exerciseCount, entry.truth.exerciseCount, `${id} exercises`);
    assert.equal(supersetCount, entry.truth.supersetCount, `${id} supersets`);
    assert.equal(
      setTemplateCount,
      entry.truth.setTemplateCount,
      `${id} set templates`
    );
  });
});

test('preserved legacy Output 04 artifacts remain readable for the failed runs', () => {
  ['smoke-202258', 'smoke-203739', 'smoke-203907'].forEach((id) => {
    const legacy = JSON.parse(
      fs.readFileSync(
        path.join(CORPUS_ROOT, id, 'legacy-04-structure.json'),
        'utf8'
      )
    );
    assert.ok(String(legacy.planName || '').trim());
    assert.ok(legacy.workout_1 && Array.isArray(legacy.workout_1.blocks));
  });
});

test('legacy Output 04 agrees with ground truth except for smoke-203907', () => {
  ['smoke-202258', 'smoke-203739'].forEach((id) => {
    const entry = caseById(id);
    const legacy = JSON.parse(
      fs.readFileSync(
        path.join(CORPUS_ROOT, id, 'legacy-04-structure.json'),
        'utf8'
      )
    );
    entry.truth.workouts.forEach((truthWorkout, index) => {
      const legacyBlocks = legacy[`workout_${index + 1}`].blocks
        .map((block) => block.type);
      assert.deepEqual(
        legacyBlocks,
        truthWorkout.blocks,
        `${id} workout ${index + 1} legacy block types must match ground truth`
      );
    });
  });

  const split = JSON.parse(
    fs.readFileSync(
      path.join(CORPUS_ROOT, 'smoke-203907', 'legacy-04-structure.json'),
      'utf8'
    )
  );
  assert.equal(
    split.workout_1.blocks.filter((block) => block.type === 'SUPERSET').length,
    2,
    'legacy Call #2 emitted two SUPERSET blocks where the source has one two-lane superset'
  );
  assert.equal(caseById('smoke-203907').truth.workouts[0].blocks
    .filter((type) => type === 'SUPERSET').length, 1);
});
