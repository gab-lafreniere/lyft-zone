#!/usr/bin/env node
'use strict';

/**
 * Layer 2 replay harness: measures Call #2 bind reliability against frozen, real
 * Call #1 outputs. Call #1 is never invoked, so this costs only the bind calls.
 *
 * THIS SPENDS REAL OPENAI BUDGET. It refuses to run without --confirm-spend.
 *
 *   node scripts/replayBoundPlanBind.js --estimate
 *   node scripts/replayBoundPlanBind.js --samples=10 --confirm-spend
 *   node scripts/replayBoundPlanBind.js --case=smoke-203907 --samples=3 --confirm-spend
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const {
  buildBoundPlanExtractionRequest,
} = require('../src/domain/simpleWeeklyPlanPipeline/aiPrompts');
const {
  verifyBoundPlan,
} = require('../src/domain/simpleWeeklyPlanPipeline/boundPlanVerification');
const {
  adaptBoundPlanToGeometry,
} = require('../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  createSimpleWeeklyPlanOpenAIProvider,
  resolveSimpleWeeklyPlanAiConfig,
} = require('../services/simpleWeeklyPlanAiProvider');
const {
  estimateOpenAiCostUsd,
} = require('../src/ai/openAiPricing');
const exerciseLibrary = require('../src/exercise-library/exercises.json');

const CORPUS_ROOT = path.join(
  __dirname,
  '../test/fixtures/simpleWeeklyPlanPipeline/bound-plan'
);
const corpus = require(path.join(CORPUS_ROOT, 'corpus.json'));

// Rough characters-per-token used only for the pre-flight estimate.
const CHARACTERS_PER_TOKEN = 4;

function parseArguments(argv) {
  const options = {
    samples: 10,
    cases: null,
    confirmSpend: false,
    estimate: false,
    maxOutputTokens: null,
  };
  argv.slice(2).forEach((argument) => {
    if (argument === '--confirm-spend') options.confirmSpend = true;
    else if (argument === '--estimate') options.estimate = true;
    else if (argument === '--real-only') {
      options.cases = corpus.cases
        .filter((entry) => entry.origin !== 'synthetic-from-smoke-203907'
          && entry.origin !== 'synthetic-from-smoke-203739')
        .map((entry) => entry.id);
    } else if (argument.startsWith('--samples=')) {
      options.samples = Number(argument.split('=')[1]);
    } else if (argument.startsWith('--case=')) {
      options.cases = [argument.split('=')[1]];
    } else if (argument.startsWith('--cases=')) {
      options.cases = argument.split('=')[1].split(',').filter(Boolean);
    } else if (argument.startsWith('--max-output-tokens=')) {
      options.maxOutputTokens = Number(argument.split('=')[1]);
    }
  });
  if (!Number.isInteger(options.samples) || options.samples < 1) {
    throw new Error('--samples must be a positive integer');
  }
  return options;
}

function selectedCases(options) {
  const cases = options.cases
    ? options.cases.map((id) => {
      const entry = corpus.cases.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`No corpus case matches ${id}`);
      return entry;
    })
    : corpus.cases;
  if (!cases.length) {
    throw new Error('No corpus case selected');
  }
  return cases;
}

// Compact structural signature used to measure stability across samples.
// SINGLE and SUPERSET both begin with S, so the type letter is explicit here:
// S = SINGLE, X = SUPERSET, C = CARDIO.
const FINGERPRINT_LETTER = Object.freeze({
  SINGLE: 'S',
  SUPERSET: 'X',
  CARDIO: 'C',
});

function structureFingerprint(boundPlan) {
  return (boundPlan.workouts || [])
    .map((workout) => (workout.blocks || [])
      .map((block) => {
        const letter = FINGERPRINT_LETTER[block.type] || '?';
        return `${letter}${(block.exercises || []).length}`;
      })
      .join(''))
    .join('|');
}

function supersetSignature(boundPlan) {
  const entries = [];
  (boundPlan.workouts || []).forEach((workout, workoutIndex) => {
    (workout.blocks || []).forEach((block, blockIndex) => {
      if (block.type !== 'SUPERSET') return;
      entries.push(`w${workoutIndex + 1}b${blockIndex + 1}:[${(block.exercises || [])
        .map((exercise) => exercise.exerciseId).join(' + ')}]`);
    });
  });
  return entries;
}

function entityCounts(boundPlan) {
  const workouts = boundPlan.workouts || [];
  let blockCount = 0;
  let exerciseCount = 0;
  let supersetCount = 0;
  let cardioCount = 0;
  const exerciseIds = [];
  workouts.forEach((workout) => {
    (workout.blocks || []).forEach((block) => {
      blockCount += 1;
      if (block.type === 'SUPERSET') supersetCount += 1;
      if (block.type === 'CARDIO') cardioCount += 1;
      (block.exercises || []).forEach((exercise) => {
        exerciseCount += 1;
        exerciseIds.push(exercise.exerciseId);
      });
    });
  });
  return {
    workoutCount: workouts.length,
    blockCount,
    exerciseCount,
    supersetCount,
    cardioCount,
    exerciseIds,
  };
}

function loadCase(entry) {
  const source = fs.readFileSync(
    path.join(CORPUS_ROOT, entry.sourcePlan),
    'utf8'
  );
  const ids = new Set(source.match(/\bexr_[A-Za-z0-9_-]+\b/g) || []);
  return {
    entry,
    source,
    // The replay measures binder reliability, so the pool is approximated from the
    // library rather than from a live user profile.
    eligibleExerciseLookup: Object.fromEntries(
      exerciseLibrary
        .filter((exercise) => ids.has(exercise.exerciseId))
        .map((exercise) => [exercise.exerciseId, exercise])
    ),
  };
}

function estimate(cases, samples, model) {
  let inputTokens = 0;
  let outputTokens = 0;

  cases.forEach((entry) => {
    const loaded = loadCase(entry);
    const request = buildBoundPlanExtractionRequest({
      generatedPlanText: loaded.source,
    });
    const perCallInput = Math.ceil(
      request.userMessage.length / CHARACTERS_PER_TOKEN
    );
    // Roughly 60 output tokens per bound exercise plus block and workout wrappers.
    const perCallOutput = Math.ceil(
      (entry.truth.exerciseCount || 12) * 60 + (entry.truth.blockCount || 9) * 12
    );
    inputTokens += perCallInput * samples;
    outputTokens += perCallOutput * samples;
  });

  return {
    calls: cases.length * samples,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateOpenAiCostUsd({
      model,
      usage: { inputTokens, cachedInputTokens: 0, outputTokens },
    }),
  };
}

function tally(values) {
  return Object.entries(values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);
}

function summarize(entry, results) {
  const total = results.length;
  const count = (predicate) => results.filter(predicate).length;
  const rate = (value) => (total ? Math.round((value / total) * 1000) / 10 : 0);
  const bound = results.filter((result) => result.counts);
  const outputTokens = results
    .map((result) => result.outputTokens)
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right);

  const truth = entry.truth || {};
  const deviations = bound
    .filter((result) => (
      result.counts.workoutCount !== truth.workoutCount ||
      result.counts.blockCount !== truth.blockCount ||
      result.counts.exerciseCount !== truth.exerciseCount
    ))
    .map((result) => ({
      sample: result.sample,
      workouts: `${result.counts.workoutCount} vs ${truth.workoutCount}`,
      blocks: `${result.counts.blockCount} vs ${truth.blockCount}`,
      exercises: `${result.counts.exerciseCount} vs ${truth.exerciseCount}`,
    }));

  return {
    samples: total,
    schemaValidRate: rate(count((result) => result.schemaValid)),
    spanVerifiedRate: rate(count((result) => result.spanVerified)),
    arityValidRate: rate(count((result) => result.arityConsistent)),
    workoutCountMatchRate: rate(count((result) => result.workoutCountMatch)),
    successRate: rate(count((result) => result.valid)),
    geometryHashes: tally(
      bound.map((result) => result.geometryHash || 'PROJECTION_FAILED')
    ),
    structureFingerprints: tally(bound.map((result) => result.fingerprint)),
    blockCounts: tally(bound.map((result) => String(result.counts.blockCount))),
    exerciseCounts: tally(bound.map((result) => String(result.counts.exerciseCount))),
    supersetSignatures: tally(bound.map((result) => result.supersets.join(' ; '))),
    entityDeviationsFromTruth: deviations,
    nonVerbatimFields: results.flatMap((result) => result.spanFailures),
    poolFailures: results.flatMap((result) => result.poolFailures),
    outputTokens: outputTokens.length ? {
      min: outputTokens[0],
      median: outputTokens[Math.floor(outputTokens.length / 2)],
      max: outputTokens[outputTokens.length - 1],
      total: outputTokens.reduce((sum, value) => sum + value, 0),
    } : null,
    inputTokensTotal: results.reduce(
      (sum, result) => sum + (result.inputTokens || 0),
      0
    ),
    costUsd: Math.round(
      results.reduce((sum, result) => sum + (result.costUsd || 0), 0) * 1e6
    ) / 1e6,
    durationMs: {
      min: Math.min(...results.map((result) => result.durationMs)),
      max: Math.max(...results.map((result) => result.durationMs)),
    },
    failureCodes: tally(results.flatMap((result) => result.codes)),
  };
}

async function replayCase(loaded, samples, provider, config) {
  const results = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const request = buildBoundPlanExtractionRequest({
      generatedPlanText: loaded.source,
    });
    const startedAt = performance.now();
    let boundPlan = null;
    let providerError = null;
    let usage = null;

    try {
      const response = await provider.generate({
        stage: 'CALL_2_BIND_PLAN',
        model: config.models.call2,
        systemMessage: request.systemMessage,
        userMessage: request.userMessage,
        schema: request.schema,
        formatName: request.formatName,
        timeoutMs: config.timeouts.call2,
        maxOutputTokens: config.maxOutputTokens.call2,
      });
      boundPlan = response.value;
      usage = response.usage || null;
    } catch (error) {
      providerError = error?.code || error?.message || 'PROVIDER_ERROR';
    }

    const usageFields = {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: usage
        ? estimateOpenAiCostUsd({ model: config.models.call2, usage })
        : null,
    };

    if (providerError) {
      results.push({
        sample: sample + 1,
        schemaValid: false,
        spanVerified: false,
        arityConsistent: false,
        workoutCountMatch: false,
        valid: false,
        codes: [providerError],
        spanFailures: [],
        poolFailures: [],
        ...usageFields,
        durationMs: Math.round(performance.now() - startedAt),
      });
      continue;
    }

    const verification = verifyBoundPlan({
      boundPlan,
      generatedPlanText: loaded.source,
      eligibleExerciseLookup: loaded.eligibleExerciseLookup,
      sessionsPerWeek: loaded.entry.sessionsPerWeek,
    });
    const codes = verification.failures.map((failure) => failure.code);
    let geometryHash = null;
    try {
      geometryHash = buildSimpleWeeklyPlanSkeleton(
        adaptBoundPlanToGeometry(boundPlan)
      ).geometryHash;
    } catch (error) {
      codes.push(error.code || 'GEOMETRY_PROJECTION_FAILED');
    }

    results.push({
      sample: sample + 1,
      schemaValid: !codes.includes('BOUND_PLAN_SCHEMA_INVALID'),
      spanVerified: !codes.includes('BOUND_PLAN_SPAN_NOT_IN_SOURCE'),
      arityConsistent: !codes.includes('BOUND_PLAN_BLOCK_ARITY_INVALID')
        && !codes.includes('BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED'),
      workoutCountMatch: !codes.includes('BOUND_PLAN_WORKOUT_COUNT_MISMATCH'),
      valid: verification.valid,
      codes,
      spanFailures: verification.failures
        .filter((failure) => failure.code === 'BOUND_PLAN_SPAN_NOT_IN_SOURCE')
        .map((failure) => ({
          sample: sample + 1,
          path: failure.path,
          received: failure.received,
        })),
      poolFailures: verification.failures
        .filter((failure) => (
          failure.code === 'BOUND_PLAN_EXERCISE_OUTSIDE_POOL' ||
          failure.code === 'BOUND_PLAN_EXERCISE_TYPE_MISMATCH'
        ))
        .map((failure) => ({
          sample: sample + 1,
          code: failure.code,
          path: failure.path,
          received: failure.received,
          inSourceVerbatim: String(loaded.source).includes(String(failure.received)),
        })),
      geometryHash,
      fingerprint: structureFingerprint(boundPlan),
      supersets: supersetSignature(boundPlan),
      counts: entityCounts(boundPlan),
      coverage: verification.coverage,
      ...usageFields,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  return results;
}

async function main() {
  const options = parseArguments(process.argv);
  const config = resolveSimpleWeeklyPlanAiConfig(
    process.env,
    options.maxOutputTokens
      ? { maxOutputTokens: { call2: options.maxOutputTokens } }
      : {}
  );
  const cases = selectedCases(options);
  console.log(`  call2 maxOutputTokens: ${config.maxOutputTokens.call2}`);
  const projection = estimate(cases, options.samples, config.models.call2);

  console.log('Bound Plan bind replay');
  console.log(`  cases    : ${cases.map((entry) => entry.id).join(', ')}`);
  console.log(`  samples  : ${options.samples} per case`);
  console.log(`  model    : ${config.models.call2}`);
  console.log('  estimate :', JSON.stringify(projection, null, 2));

  if (options.estimate) {
    console.log('\nEstimate only. No provider calls were made.');
    return;
  }
  if (!options.confirmSpend) {
    console.error(
      '\nRefusing to run: this makes real OpenAI calls. Re-run with --confirm-spend.'
    );
    process.exitCode = 2;
    return;
  }

  const provider = createSimpleWeeklyPlanOpenAIProvider({});
  const report = {};

  for (const entry of cases) {
    const loaded = loadCase(entry);
    const results = await replayCase(loaded, options.samples, provider, config);
    report[entry.id] = {
      expected: entry.expectedBoundPlanOutcome,
      truth: entry.truth,
      ...summarize(entry, results),
    };
    console.log(`\n${entry.id}`);
    console.log(JSON.stringify(report[entry.id], null, 2));
  }

  const outputPath = path.join(
    process.cwd(),
    `bound-plan-replay-${Date.now()}.json`
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written to ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { estimate, summarize };
