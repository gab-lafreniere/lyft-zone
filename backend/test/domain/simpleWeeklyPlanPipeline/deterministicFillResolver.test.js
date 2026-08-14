const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  deriveRestCandidates,
  parseRestSeconds,
  resolveDeterministicWeeklyPlanFills,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/deterministicFillResolver');
const {
  buildWeeklyPlanFillFallbackRequest,
  mergeWeeklyPlanFillFallback,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillFallback');
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
  buildSimpleWeeklyPlanSkeleton,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  resolveWeeklyPlanFillFallback,
} = require('../../../services/simpleWeeklyPlanFillFallbackService');

const FIXTURE_ROOT = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline/real-call3-fixtures'
);
const FIXTURE_A = path.join(FIXTURE_ROOT, 'fixture-a');
const FIXTURE_B = path.join(FIXTURE_ROOT, 'fixture-b');
const exerciseLibrary = require('../../../src/exercise-library/exercises.json');

function loadFixture(directory) {
  const source = fs.readFileSync(path.join(directory, '02-output-ai_generated-plan.txt'), 'utf8');
  const structure = JSON.parse(fs.readFileSync(
    path.join(directory, '04-output-ai_extracted-structure.json')
  ));
  const exactIds = new Set(source.match(/\b(?:exr|ex)_[A-Za-z0-9_:-]+\b/g) || []);
  const eligibleExerciseLookup = Object.fromEntries(
    exerciseLibrary
      .filter((exercise) => exactIds.has(exercise.exerciseId))
      .map((exercise) => [exercise.exerciseId, exercise])
  );
  return {
    source,
    skeleton: buildSimpleWeeklyPlanSkeleton(
      adaptSimpleWeeklyPlanStructureToLegacyGeometry(structure, {
        sessionsPerWeek: Object.keys(structure).filter((key) => /^workout_\d+$/.test(key)).length,
      })
    ),
    eligibleExerciseLookup,
  };
}

function completePipeline(fixture, providerFills) {
  const normalized = normalizeSimpleWeeklyPlanProviderFills(
    providerFills,
    fixture.skeleton
  );
  const validation = validateSimpleWeeklyPlanFills({
    skeleton: fixture.skeleton,
    fillOutput: normalized,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const materialization = materializeSimpleWeeklyPlan({
    skeleton: fixture.skeleton,
    normalizedFills: validation.normalizedFills,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  assert.equal(materialization.valid, true, JSON.stringify(materialization.errors));
  return materialization.document;
}

function plausibleFixtureBResolutions(result) {
  const values = [60, 60, 60, 60, 60, 75, 60, 60];
  return {
    schemaVersion: 1,
    geometryHash: result.geometryHash,
    resolutions: result.unresolved.map((entry, index) => ({
      resolutionId: entry.resolutionId,
      value: values[index],
    })),
  };
}

test('rest normalization keeps exact seconds and uses range upper bounds without 15-second rounding', () => {
  assert.equal(parseRestSeconds('68 sec'), 68);
  assert.equal(parseRestSeconds('60–75 sec'), 75);
  assert.equal(parseRestSeconds('2.5–3 min'), 180);
});

test('ambiguous SUPERSET candidates are derived only from normalized lane-local rests', () => {
  assert.deepEqual(deriveRestCandidates(['45–60 sec', '45–60 sec']), [60]);
  assert.deepEqual(deriveRestCandidates(['60–75 sec', '60–75 sec']), [75]);
  assert.deepEqual(deriveRestCandidates(['45–60 sec', '60–75 sec']), [60, 75]);
  assert.deepEqual(deriveRestCandidates(['as needed', 'full recovery']), []);
});

test('real Fixture A is fully deterministic and preserves studied fidelity', () => {
  const fixture = loadFixture(FIXTURE_A);
  const first = resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  const second = resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  assert.deepEqual(second, first);
  assert.equal(first.totalFieldCount, 282);
  assert.equal(first.deterministicallyResolvedFieldCount, 282);
  assert.equal(first.unresolvedFieldCount, 0);
  assert.equal(first.fallbackRequired, false);
  assert.equal(first.geometryHash, 'sha256:411ca29c8c33e75203d3ba67d5b2d6e6b26efd055556a1e6bbaa70d6e01c31ab');

  const document = completePipeline(fixture, first.providerFills);
  assert.equal(document.workouts.length, 2);
  assert.equal(document.workouts.flatMap((workout) => workout.blocks).length, 14);
  assert.equal(document.workouts[0].blocks[4].restSeconds, 60);
  assert.equal(document.workouts[0].blocks[4].exercises[1].defaultRestSeconds, null);
  assert.equal(document.workouts[0].blocks[5].exercises[0].defaultRestSeconds, 75);
  assert.equal(document.workouts[1].blocks[5].restSeconds, 75);
  assert.equal(document.workouts[1].blocks[5].exercises[1].defaultRestSeconds, null);
  assert.equal(document.workouts[0].blocks[0].exercises[0].cardioPrescription.heartRateTargetMode, 'none');
  assert.equal(document.workouts[0].blocks[0].exercises[0].cardioPrescription.heartRateTargetValue, null);
});

test('real Fixture B uses one compact fallback call for exactly eight ambiguous block rests', async () => {
  const fixture = loadFixture(FIXTURE_B);
  const deterministic = resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  assert.equal(deterministic.totalFieldCount, 893);
  assert.equal(deterministic.deterministicallyResolvedFieldCount, 885);
  assert.equal(deterministic.unresolvedFieldCount, 8);
  assert.equal(deterministic.fallbackRequired, true);
  assert.equal(deterministic.fallbackEligible, true);
  assert.equal(deterministic.geometryHash, 'sha256:e1c3d0cb9093b13e723f77617ce3c1165957a7c5a110eb54ff8ae9417a196ce9');
  assert.deepEqual(
    deterministic.unresolved.map((entry) => entry.resolutionId),
    Array.from({ length: 8 }, (_, index) => `blockRests[${index}].value`)
  );
  assert.deepEqual(
    deterministic.unresolved.map((entry) => entry.allowedValues),
    [[60], [60], [60], [60], [60], [75], [60], [60]]
  );
  assert.equal(deterministic.unresolved.every((entry) =>
    entry.entityType === 'blockRest' &&
    entry.field === 'WorkoutBlock.restSeconds' &&
    entry.fallbackEligible === true
  ), true);

  const controlled = plausibleFixtureBResolutions(deterministic);
  const calls = [];
  const fallback = await resolveWeeklyPlanFillFallback({
    provider: {
      async generate(request) {
        calls.push(request);
        return { value: controlled, model: 'gpt-4.1-mini', usage: {} };
      },
    },
    geometryHash: deterministic.geometryHash,
    unresolved: deterministic.unresolved,
    model: 'gpt-4.1-mini',
    timeoutMs: 1000,
    maxOutputTokens: 1000,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, 'CALL_3_FILL_FALLBACK');
  assert.equal(JSON.stringify(calls[0].userMessage).includes('2.5–3 min'), false);
  assert.equal(fallback.request.payload.unresolved.length, 8);

  const before = structuredClone(deterministic.providerFills);
  const merged = mergeWeeklyPlanFillFallback({
    providerFills: deterministic.providerFills,
    unresolved: deterministic.unresolved,
    fallbackOutput: fallback.result.value,
  });
  assert.deepEqual(deterministic.providerFills, before);
  assert.deepEqual(merged.fills.strengthExercises, before.fills.strengthExercises);
  assert.deepEqual(merged.fills.cardioExercises, before.fills.cardioExercises);
  assert.deepEqual(merged.fills.blockRests.map((entry) => entry.value), [60, 60, 60, 60, 60, 75, 60, 60]);

  const document = completePipeline(fixture, merged);
  assert.equal(document.workouts.length, 6);
  assert.equal(document.workouts.flatMap((workout) => workout.blocks).length, 38);
  assert.equal(document.workouts.flatMap((workout) => workout.blocks.flatMap((block) => block.exercises)).length, 46);
  assert.equal(document.workouts.flatMap((workout) => workout.blocks.flatMap((block) => block.exercises.flatMap((exercise) => exercise.setTemplates))).length, 119);
  assert.equal(fixture.skeleton.geometryHash, deterministic.geometryHash);
  assert.equal(document.workouts[0].blocks[1].exercises[0].defaultRestSeconds, 180);
  assert.equal(document.workouts[0].blocks[4].exercises[0].defaultRestSeconds, 90);
  assert.equal(document.workouts[2].blocks[2].exercises[0].setTemplates[0].notes, 'each leg');
  assert.equal(document.workouts[5].blocks[3].exercises[1].setTemplates[0].notes, 'each arm');
  assert.equal(document.workouts[0].blocks[0].exercises[0].cardioPrescription.notes, 'very light warm-up pace');
  assert.equal(document.workouts[0].blocks[6].exercises[0].cardioPrescription.notes, 'easy conversational pace');
});

test('fallback schema binds every requested resolutionId to its field constraints', () => {
  const fixture = loadFixture(FIXTURE_B);
  const result = resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  const request = buildWeeklyPlanFillFallbackRequest(result);
  assert.equal(request.schema.properties.resolutions.minItems, 8);
  assert.equal(request.schema.properties.resolutions.maxItems, 8);
  assert.deepEqual(
    request.schema.properties.resolutions.items.anyOf.map(
      (variant) => variant.properties.resolutionId.const
    ),
    result.unresolved.map((entry) => entry.resolutionId)
  );
  assert.deepEqual(
    request.schema.properties.resolutions.items.anyOf.map(
      (variant) => variant.properties.value
    ),
    result.unresolved.map((entry) => ({
      type: 'integer',
      const: entry.allowedValues[0],
    }))
  );
  assert.deepEqual(
    request.payload.unresolved.map((entry) => entry.allowedValues),
    result.unresolved.map((entry) => entry.allowedValues)
  );
  assert.equal(request.userMessage.includes('Recoverable 6-Day Hypertrophy Plan'), false);
});

test('mixed local candidates use an enum and backend validation enforces it', () => {
  const geometryHash = `sha256:${'1'.repeat(64)}`;
  const unresolved = [{
    resolutionId: 'blockRests[0].value',
    entityType: 'blockRest',
    entityIndex: 0,
    field: 'WorkoutBlock.restSeconds',
    expected: { type: 'integer', minimum: 0, maximum: 600 },
    allowedValues: deriveRestCandidates(['45–60 sec', '60–75 sec']),
    blockType: 'SUPERSET',
    restStrategy: 'AFTER_ROUND',
    fallbackEligible: true,
    localSource: { exercises: [] },
  }];
  const request = buildWeeklyPlanFillFallbackRequest({ geometryHash, unresolved });
  assert.deepEqual(
    request.schema.properties.resolutions.items.anyOf[0].properties.value,
    { type: 'integer', enum: [60, 75] }
  );
  const providerFills = {
    schemaVersion: 4,
    geometryHash,
    fills: {
      strengthExercises: [],
      cardioExercises: [],
      blockRests: [{ value: null }],
    },
  };
  for (const value of [60, 75]) {
    const merged = mergeWeeklyPlanFillFallback({
      providerFills,
      unresolved,
      fallbackOutput: {
        schemaVersion: 1,
        geometryHash,
        resolutions: [{ resolutionId: 'blockRests[0].value', value }],
      },
    });
    assert.equal(merged.fills.blockRests[0].value, value);
  }
  assert.throws(() => mergeWeeklyPlanFillFallback({
    providerFills,
    unresolved,
    fallbackOutput: {
      schemaVersion: 1,
      geometryHash,
      resolutions: [{ resolutionId: 'blockRests[0].value', value: 90 }],
    },
  }), /source-supported candidate allowlist|constraints/i);
});

test('fallback validation rejects duplicate, missing, extra, wrong-hash, wrong-type, out-of-range, and resolved-field mutations', () => {
  const fixture = loadFixture(FIXTURE_B);
  const result = resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  });
  const valid = plausibleFixtureBResolutions(result);
  function rejected(mutator, pattern) {
    const output = structuredClone(valid);
    mutator(output);
    assert.throws(() => mergeWeeklyPlanFillFallback({
      providerFills: result.providerFills,
      unresolved: result.unresolved,
      fallbackOutput: output,
    }), pattern);
  }
  rejected((output) => {
    output.resolutions[1].resolutionId = output.resolutions[0].resolutionId;
  }, /duplicate resolutionId/i);
  rejected((output) => { output.resolutions.pop(); }, /count is invalid/i);
  rejected((output) => { output.resolutions[0].resolutionId = 'strengthExercises[0].exerciseId'; }, /unrequested resolutionId/i);
  rejected((output) => { output.geometryHash = 'sha256:' + '0'.repeat(64); }, /geometryHash does not match/i);
  rejected((output) => { output.resolutions[0].value = '60'; }, /constraints/i);
  rejected((output) => { output.resolutions[0].value = 601; }, /constraints/i);
  rejected((output) => { output.resolutions[0].value = 180; }, /constraints/i);
  rejected((output) => { output.resolutions[0].value = 240; }, /constraints/i);
  rejected((output) => { output.resolutions[0].exerciseId = 'exr_substitution'; }, /missing or extra fields/i);

  const missingCandidates = structuredClone(result.unresolved);
  missingCandidates[0].allowedValues = [];
  assert.throws(() => buildWeeklyPlanFillFallbackRequest({
    geometryHash: result.geometryHash,
    unresolved: missingCandidates,
  }), /source-supported candidate allowlist/i);

  const withUnexpectedNull = structuredClone(result.providerFills);
  withUnexpectedNull.fills.blockRests.push({ value: null });
  assert.throws(() => mergeWeeklyPlanFillFallback({
    providerFills: withUnexpectedNull,
    unresolved: result.unresolved,
    fallbackOutput: valid,
  }), /unresolved values remain/i);
});

test('fatal geometry and eligibility errors fail before any fallback can be invoked', () => {
  const fixture = loadFixture(FIXTURE_A);
  const wrongSkeleton = structuredClone(fixture.skeleton);
  wrongSkeleton.document.workouts.pop();
  assert.throws(() => resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: wrongSkeleton,
    eligibleExerciseLookup: fixture.eligibleExerciseLookup,
  }), (error) => error.code === 'DETERMINISTIC_WORKOUT_GEOMETRY_MISMATCH');

  const lookup = structuredClone(fixture.eligibleExerciseLookup);
  delete lookup.exr_treadmill_walk;
  assert.throws(() => resolveDeterministicWeeklyPlanFills({
    generatedPlanText: fixture.source,
    skeleton: fixture.skeleton,
    eligibleExerciseLookup: lookup,
  }), (error) => error.code === 'DETERMINISTIC_EXERCISE_ID_INELIGIBLE');
});
