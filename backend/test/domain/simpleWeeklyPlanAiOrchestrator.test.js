const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  runSimpleWeeklyPlanAiPipeline,
} = require('../../services/simpleWeeklyPlanAiOrchestrator');
const {
  CANONICAL_OUTPUT_FILES,
} = require('../../services/weeklyPlanPipelineArtifactWriter');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('../../src/domain/simpleWeeklyPlanPipeline/structureSchema');
const {
  buildWeeklyPlanMetrics,
} = require('../../src/domain/simpleWeeklyPlanPipeline/finalValidation');
const {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const {
  renderSimpleWeeklyPlanModelInput,
} = require('../../services/simpleWeeklyPlanAiProvider');
const {
  buildSimulatedFills,
} = require('../fixtures/simpleWeeklyPlanPipeline/fills-simulated');

const fixturesDirectory = path.join(
  __dirname,
  '../fixtures/simpleWeeklyPlanPipeline'
);

async function loadFixture(filename) {
  return fs.readFile(path.join(fixturesDirectory, filename), 'utf8');
}

async function loadJsonFixture(filename) {
  return JSON.parse(await loadFixture(filename));
}

function poolFromLookup(lookup, addUnused = false) {
  const items = Object.values(lookup).map((item) => ({
    exerciseId: item.exerciseId,
    name: item.name,
    trainingType: item.trainingType,
    attributes: {
      bodyParts: item.bodyParts,
      muscleFocus: item.muscleFocus,
      cardioModality: item.cardioModality,
    },
  }));
  if (addUnused) {
    items.push({
      exerciseId: 'exr_unused_pool_item',
      name: 'Unused Pool Item',
      trainingType: 'strength',
      attributes: {
        bodyParts: ['other'],
        muscleFocus: [],
        cardioModality: null,
      },
    });
  }
  return { pool: { items } };
}

function providerFillOutputFromPhaseOne(fills, skeleton) {
  return {
    schemaVersion: fills.schemaVersion,
    geometryHash: fills.geometryHash,
    fills: skeleton.slots.map((slot) => {
      const value = fills.fills[slot.id];
      if (
        slot.kind === 'exerciseId' ||
        slot.kind === 'blockRestSeconds' ||
        slot.kind === 'exerciseNotes'
      ) {
        return { slotId: slot.id, kind: slot.kind, value };
      }
      return { slotId: slot.id, kind: slot.kind, ...value };
    }),
  };
}

async function createScenario(t, options = {}) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'simple-weekly-plan-ai-test-')
  );
  t.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const generatedPlanText =
    await loadFixture('02-generated-plan-three-day.txt');
  const structure = await loadJsonFixture('03-extracted-structure.json');
  const eligibleLookup =
    await loadJsonFixture('eligible-exercise-lookup.json');
  const skeleton = buildSimpleWeeklyPlanSkeleton(
    adaptSimpleWeeklyPlanStructureToLegacyGeometry(
      structure,
      { sessionsPerWeek: 3 }
    )
  );
  const fills = buildSimulatedFills();
  fills.geometryHash = skeleton.geometryHash;
  const calls = [];
  const promptCalls = [];
  const poolCalls = [];
  const preflightCalls = [];
  const prisma = { marker: 'read-only dependency' };
  const failureStage = options.failureStage || null;
  const resolvedModels = {
    CALL_1_PLAN_TEXT: 'gpt-5.4-mini-2026-03-17',
    CALL_2_STRUCTURE: 'gpt-4.1-mini-2025-04-14',
    CALL_3_FILLS: 'gpt-4.1-mini-2025-04-14',
    ...options.resolvedModels,
  };
  const usageByStage = {
    CALL_1_PLAN_TEXT: {
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 60,
      totalTokens: 1100,
      providerRawResponse: 'must-not-be-serialized',
    },
    CALL_2_STRUCTURE: {
      inputTokens: 500,
      cachedInputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 0,
      totalTokens: 550,
    },
    CALL_3_FILLS: {
      inputTokens: 2000,
      cachedInputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 100,
      totalTokens: 2200,
    },
    ...options.usageByStage,
  };

  const provider = {
    async generate(request) {
      calls.push(request);
      if (request.stage === failureStage) {
        if (options.failureError) {
          throw options.failureError;
        }
        const error = new Error(`${failureStage} failed`);
        error.code =
          request.stage === 'CALL_2_STRUCTURE'
            ? 'INVALID_PROVIDER_JSON'
            : 'PROVIDER_ERROR';
        throw error;
      }
      if (request.stage === 'CALL_1_PLAN_TEXT') {
        return {
          value: generatedPlanText,
          model: resolvedModels[request.stage],
          usage: usageByStage[request.stage],
        };
      }
      if (request.stage === 'CALL_2_STRUCTURE') {
        const value = structuredClone(
          options.invalidStructure || structure
        );
        return {
          value,
          model: resolvedModels[request.stage],
          usage: usageByStage[request.stage],
        };
      }
      if (request.stage === 'CALL_3_FILLS') {
        const value = providerFillOutputFromPhaseOne(
          structuredClone(fills),
          skeleton
        );
        if (options.invalidFills) {
          options.invalidFills(value);
        }
        return {
          value,
          model: resolvedModels[request.stage],
          usage: usageByStage[request.stage],
        };
      }
      throw new Error(`Unexpected stage ${request.stage}`);
    },
  };

  const result = await runSimpleWeeklyPlanAiPipeline({
    userId: 'runtime_user',
    outputDirectory: temporaryRoot,
    runId: options.runId || 'mock-run',
    provider,
    dependencies: {
      env: {},
      prisma,
      async buildPromptForUser(...args) {
        promptCalls.push(args);
        return {
          sessionsPerWeek: 3,
          systemMessage: 'SYSTEM PROFILE CONTENT',
          userMessage: 'USER PROFILE CONTENT',
          inputText:
            'SYSTEM MESSAGE\nSYSTEM PROFILE CONTENT\n\nUSER MESSAGE\nUSER PROFILE CONTENT',
        };
      },
      async buildExercisePoolForUser(...args) {
        poolCalls.push(args);
        return poolFromLookup(eligibleLookup, true);
      },
      ...(options.skeletonError
        ? {
          buildSkeleton() {
            throw options.skeletonError;
          },
        }
        : {}),
      async finalPreflight(payload) {
        preflightCalls.push(payload);
        if (options.preflightError) {
          throw options.preflightError;
        }
        return {
          document: payload,
          businessRulesValidation: { ok: true, issueCount: 0 },
        };
      },
    },
  });

  const names = (await fs.readdir(result.runDirectory)).sort();
  const output = {};
  for (const [, filename, format] of CANONICAL_OUTPUT_FILES) {
    const content = await fs.readFile(
      path.join(result.runDirectory, filename),
      'utf8'
    );
    output[filename] =
      format === 'json' ? JSON.parse(content) : content.trimEnd();
  }

  return {
    calls,
    eligibleLookup,
    fills,
    generatedPlanText,
    names,
    output,
    poolCalls,
    preflightCalls,
    prisma,
    promptCalls,
    result,
    structure,
  };
}

function countSectionHeading(text, heading) {
  return (text.match(new RegExp(`^${heading}$`, 'gm')) || []).length;
}

test('mocked end-to-end pipeline performs exactly three minimal AI calls and writes eight observable artifacts', async (t) => {
  const scenario = await createScenario(t);
  const expectedNames = CANONICAL_OUTPUT_FILES
    .map(([, filename]) => filename)
    .sort();

  assert.deepEqual(scenario.names, expectedNames);
  assert.equal(scenario.names.length, 8);
  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE', 'CALL_3_FILLS']
  );
  assert.deepEqual(scenario.result.modelsUsed, [
    'gpt-5.4-mini-2026-03-17',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-mini-2025-04-14',
  ]);
  assert.equal(scenario.calls.length, 3);

  const [call1, call2, call3] = scenario.calls;
  assert.equal(call1.systemMessage, 'SYSTEM PROFILE CONTENT');
  assert.equal(call1.userMessage, 'USER PROFILE CONTENT');
  assert.deepEqual(call2.schema, buildSimpleWeeklyPlanStructureSchema(3));
  assert.ok(call2.userMessage.includes(scenario.generatedPlanText.trim()));
  assert.ok(
    call2.userMessage.includes(
      '- SUPERSET: number of complete rounds set performed for the two-exercise block;'
    )
  );
  assert.equal(call2.userMessage.includes('roundCount'), false);
  assert.equal(call2.userMessage.includes('setCounts'), false);
  assert.equal(call2.userMessage.includes('exerciseId'), false);
  assert.equal(call2.userMessage.includes('exerciseName'), false);
  assert.equal(call2.userMessage.includes('SYSTEM PROFILE CONTENT'), false);
  assert.equal(call2.userMessage.includes('USER PROFILE CONTENT'), false);
  assert.equal(call2.userMessage.includes('ALLOWED EXERCISES'), false);
  assert.ok(call3.userMessage.includes(scenario.generatedPlanText.trim()));
  assert.equal(call3.userMessage.includes('SYSTEM PROFILE CONTENT'), false);
  assert.equal(call3.userMessage.includes('USER PROFILE CONTENT'), false);
  assert.ok(call3.userMessage.includes('PLAN SKELETON AND SLOT REGISTRY'));
  assert.equal(call3.userMessage.includes('ALLOWED EXERCISES'), false);
  const call3Instructions = call3.userMessage.split(
    '\n\nPLAN SKELETON AND SLOT REGISTRY\n'
  )[0];
  assert.equal(call3Instructions.includes('exerciseName'), false);
  assert.equal(JSON.stringify(call3.schema).includes('exerciseName'), false);
  assert.ok(
    call3.userMessage.includes(
      "If the skeleton contains more set slots for an exercise than the source plan explicitly lists because of an inconsistent SUPERSET set count, fill the missing set slots using that same exercise's stated repetition range, RIR, tempo, rest, and notes."
    )
  );
  assert.ok(
    call3.userMessage.includes(
      'Do not change the exercise, block geometry, or number of sets.'
    )
  );
  assert.ok(
    call3.userMessage.includes(
      'Do not redesign, improve, correct, merge, split, add, remove or reorder anything.'
    )
  );
  const call3InstructionsIndex = call3.userMessage.indexOf(
    'Fill the provided slot registry using the source plan.'
  );
  const call3SkeletonIndex = call3.userMessage.indexOf(
    '\nPLAN SKELETON AND SLOT REGISTRY\n'
  );
  const call3SourceIndex = call3.userMessage.indexOf('\nSOURCE PLAN\n');
  assert.ok(call3InstructionsIndex >= 0);
  assert.ok(call3SkeletonIndex > call3InstructionsIndex);
  assert.ok(call3SourceIndex > call3SkeletonIndex);
  assert.equal(call3.schema.properties.fills.type, 'array');
  assert.equal(call3.schema.properties.fills.minItems, 195);
  assert.equal(call3.schema.properties.fills.maxItems, 195);
  assert.equal(
    JSON.stringify(call3.schema).includes('exr_incline_barbell_bench_press'),
    false
  );

  assert.equal(
    scenario.output['01-input-ai_master-prompt.txt'],
    renderSimpleWeeklyPlanModelInput(call1)
  );
  assert.equal(
    scenario.output['01-input-ai_master-prompt.txt'].includes(
      'STRUCTURED OUTPUT CONFIGURATION'
    ),
    false
  );
  assert.equal(
    scenario.output['02-output-ai_generated-plan.txt'],
    scenario.generatedPlanText.trim()
  );
  assert.equal(
    scenario.output['02-output-ai_generated-plan.txt'].includes(
      '"output_text"'
    ),
    false
  );
  assert.ok(
    scenario.output['02-output-ai_generated-plan.txt'].includes(
      'exr_incline_barbell_bench_press'
    )
  );
  const output3 = scenario.output['03-input-ai_prompt-2.txt'];
  const output3Headings = [
    'SYSTEM MESSAGE',
    'USER MESSAGE',
    'STRUCTURED OUTPUT CONFIGURATION',
    'SOURCE PLAN',
    'MODEL INPUT METADATA',
  ];
  output3Headings.reduce((previousIndex, heading) => {
    const currentIndex = output3.indexOf(heading);
    assert.ok(currentIndex > previousIndex, heading);
    return currentIndex;
  }, -1);
  ['"SINGLE"', '"SUPERSET"', '"CARDIO"'].forEach((blockType) => {
    assert.ok(
      scenario.output['03-input-ai_prompt-2.txt'].includes(blockType)
    );
  });
  assert.deepEqual(
    scenario.output['04-output-ai_extracted-structure.json'],
    scenario.structure
  );
  const output4Text = JSON.stringify(
    scenario.output['04-output-ai_extracted-structure.json']
  );
  for (const forbidden of [
    'schemaVersion',
    'workouts',
    'blockType',
    'roundCount',
    'setCounts',
    'exerciseId',
    'exerciseName',
  ]) {
    assert.equal(output4Text.includes(`"${forbidden}"`), false, forbidden);
  }
  assert.equal(
    scenario.output['05-output-backend_plan-skeleton.json'].geometryHash,
    call3.schema.properties.geometryHash.const
  );
  const output6 = scenario.output['06-input-ai_prompt-3.txt'];
  const output6Headings = [
    'SYSTEM MESSAGE',
    'USER MESSAGE',
    'STRUCTURED OUTPUT CONFIGURATION',
    'PLAN SKELETON AND SLOT REGISTRY',
    'SOURCE PLAN',
    'MODEL INPUT METADATA',
  ];
  output6Headings.reduce((previousIndex, heading) => {
    const currentIndex = output6.indexOf(`\n${heading}\n`);
    const normalizedIndex =
      heading === 'SYSTEM MESSAGE' ? output6.indexOf(`${heading}\n`) : currentIndex;
    assert.ok(normalizedIndex > previousIndex, heading);
    assert.equal(countSectionHeading(output6, heading), 1, heading);
    return normalizedIndex;
  }, -1);
  assert.equal(output6.includes('ALLOWED EXERCISES'), false);
  assert.equal(output6.includes('exr_unused_pool_item'), false);
  assert.ok(
    output6.includes(
      call3.schema.properties.geometryHash.const
    )
  );
  assert.ok(output6.includes(scenario.generatedPlanText.trim()));
  assert.deepEqual(scenario.result.counts, {
    workoutCount: 3,
    blockCount: 21,
    exerciseCount: 28,
    setTemplateCount: 104,
  });
  assert.equal(scenario.result.slotCount, 195);
  assert.equal(scenario.result.fillCount, 195);
  assert.equal(scenario.result.valid, true);
  assert.deepEqual(
    scenario.result.completedDocument,
    scenario.output['07-output-ai_completed-plan.json']
  );
  assert.deepEqual(
    scenario.result.metrics,
    scenario.output['08-output-backend_validation-result.json'].metrics
  );
  assert.equal(
    scenario.result.generatedPlanText,
    scenario.output['02-output-ai_generated-plan.txt']
  );
  assert.deepEqual(scenario.result.output8.summary, scenario.result.counts);
  assert.deepEqual(
    Object.keys(
      scenario.output['07-output-ai_completed-plan.json']
    ).sort(),
    ['name', 'sessionsPerWeek', 'workouts']
  );
  const firstExercise =
    scenario.output['07-output-ai_completed-plan.json']
      .workouts[0].blocks[0].exercises[0];
  assert.equal(firstExercise.exerciseName, 'Incline Barbell Bench Press');
  assert.deepEqual(firstExercise.bodyParts, ['chest']);
  assert.deepEqual(firstExercise.muscleFocus, ['upper_chest']);
  assert.equal(
    scenario.output['08-output-backend_validation-result.json'].valid,
    true
  );
  assert.deepEqual(
    scenario.output['08-output-backend_validation-result.json'].metrics,
    buildWeeklyPlanMetrics(
      scenario.output['07-output-ai_completed-plan.json']
    )
  );
  assert.deepEqual(
    scenario.output['08-output-backend_validation-result.json'].aiUsage,
    {
      calls: [
        {
          call: 1,
          stage: 'CALL_1_PLAN_TEXT',
          model: 'gpt-5.4-mini-2026-03-17',
          inputTokens: 1000,
          cachedInputTokens: 200,
          outputTokens: 100,
          reasoningTokens: 60,
          totalTokens: 1100,
          estimatedCostUsd: 0.001065,
        },
        {
          call: 2,
          stage: 'CALL_2_STRUCTURE',
          model: 'gpt-4.1-mini-2025-04-14',
          inputTokens: 500,
          cachedInputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 0,
          totalTokens: 550,
          estimatedCostUsd: 0.00025,
        },
        {
          call: 3,
          stage: 'CALL_3_FILLS',
          model: 'gpt-4.1-mini-2025-04-14',
          inputTokens: 2000,
          cachedInputTokens: 1000,
          outputTokens: 200,
          reasoningTokens: 100,
          totalTokens: 2200,
          estimatedCostUsd: 0.00082,
        },
      ],
      totals: {
        inputTokens: 3500,
        cachedInputTokens: 1300,
        outputTokens: 350,
        reasoningTokens: 160,
        totalTokens: 3850,
        estimatedCostUsd: 0.002135,
      },
    }
  );
  assert.equal(
    JSON.stringify(
      scenario.output['08-output-backend_validation-result.json']
    ).includes('must-not-be-serialized'),
    false
  );
  [
    '01-prompt-input.txt',
    '02-generated-plan.txt',
    '03-extracted-structure.json',
    '04-plan-skeleton.json',
    '05-completed-plan.json',
    '06-validation-result.json',
  ].forEach((oldName) => {
    assert.equal(scenario.names.includes(oldName), false);
  });

  assert.equal(scenario.promptCalls.length, 1);
  assert.equal(scenario.poolCalls.length, 1);
  assert.equal(scenario.preflightCalls.length, 1);
  assert.strictEqual(scenario.promptCalls[0][2].prisma, scenario.prisma);
  assert.strictEqual(scenario.poolCalls[0][2].prisma, scenario.prisma);
  assert.equal(scenario.preflightCalls[0].userId, 'runtime_user');
  assert.equal(scenario.preflightCalls[0].source, 'AI');
  assert.equal(
    scenario.calls.some((call) => /review|repair/i.test(call.stage)),
    false
  );
});

test('the complete backend lookup remains independent from prompt serialization', async (t) => {
  const scenario = await createScenario(t, {
    invalidFills(value) {
      const exerciseIdFill = value.fills.find(
        (entry) => entry.slotId === 'w1.b1.e1.id'
      );
      exerciseIdFill.value = 'exr_unused_pool_item';
    },
    runId: 'complete-lookup',
  });
  const exercise =
    scenario.output['07-output-ai_completed-plan.json']
      .workouts[0].blocks[0].exercises[0];

  assert.equal(scenario.result.statuses.output7, 'PRODUCED');
  assert.equal(
    scenario.calls[2].userMessage.includes('exr_unused_pool_item'),
    false
  );
  assert.equal(exercise.exerciseId, 'exr_unused_pool_item');
  assert.equal(exercise.exerciseName, 'Unused Pool Item');
  assert.deepEqual(exercise.bodyParts, ['other']);
  assert.deepEqual(exercise.muscleFocus, []);
});

test('an exercise ID outside the complete backend lookup is rejected', async (t) => {
  const scenario = await createScenario(t, {
    invalidFills(value) {
      const exerciseIdFill = value.fills.find(
        (entry) => entry.slotId === 'w1.b1.e1.id'
      );
      exerciseIdFill.value = 'exr_outside_pool';
    },
    runId: 'outside-lookup',
  });
  const output7 =
    scenario.output['07-output-ai_completed-plan.json'];

  assert.equal(scenario.result.statuses.output7, 'ERROR');
  assert.equal(
    output7.details.some(
      (error) => error.code === 'EXERCISE_ID_OUTSIDE_ELIGIBLE_LOOKUP'
    ),
    true
  );
});

test('Output 7 exposes only cleaned diagnostics for a call 3 provider error', async (t) => {
  const error = new Error('Provider request failed');
  error.code = 'PROVIDER_ERROR';
  error.providerDiagnostics = {
    stage: 'CALL_3_FILLS',
    model: 'model-three',
    requestId: 'req_output_7',
    httpStatus: 500,
    providerCode: 'server_error',
    providerMessage:
      'Provider failed Authorization: Bearer hidden-token sk-proj-hiddencredential',
    responseStatus: 'failed',
    rawOutputAvailable: true,
    rawOutput:
      '{"partial":"Bearer hidden-raw-token sk-proj-hiddenrawcredential"}',
    headers: { authorization: 'Bearer hidden-header-token' },
    stack: 'hidden stack',
    cause: 'hidden cause',
    request: 'hidden prompt',
    pool: 'hidden pool',
  };
  const scenario = await createScenario(t, {
    failureStage: 'CALL_3_FILLS',
    failureError: error,
    runId: 'provider-diagnostics',
  });
  const output7 =
    scenario.output['07-output-ai_completed-plan.json'];
  const serialized = JSON.stringify(output7);

  assert.equal(output7.status, 'ERROR');
  assert.equal(output7.output, 7);
  assert.deepEqual(output7.providerDiagnostics, {
    stage: 'CALL_3_FILLS',
    model: 'model-three',
    requestId: 'req_output_7',
    providerCode: 'server_error',
    providerMessage:
      'Provider failed Authorization: [REDACTED] [REDACTED_API_KEY]',
    responseStatus: 'failed',
    httpStatus: 500,
    rawOutputAvailable: true,
    rawOutput:
      '{"partial":"Bearer [REDACTED] [REDACTED_API_KEY]"}',
  });
  [
    'hidden-token',
    'hiddencredential',
    'hidden-raw-token',
    'hiddenrawcredential',
    'hidden-header-token',
    'hidden stack',
    'hidden cause',
    'hidden prompt',
    'hidden pool',
    '"headers"',
    '"stack"',
    '"cause"',
    '"request"',
    '"pool"',
  ].forEach((secret) => assert.equal(serialized.includes(secret), false));
  assert.equal(scenario.result.statuses.output8, 'NOT_PRODUCED');
  assert.equal(scenario.names.length, 8);
});

test('Output 7 marks raw output unavailable when call 3 received no response', async (t) => {
  const error = new Error('Provider request timed out');
  error.code = 'PROVIDER_TIMEOUT';
  error.providerDiagnostics = {
    stage: 'CALL_3_FILLS',
    model: 'model-three',
    rawOutputAvailable: false,
  };
  const scenario = await createScenario(t, {
    failureStage: 'CALL_3_FILLS',
    failureError: error,
    runId: 'provider-timeout-diagnostics',
  });
  const diagnostics =
    scenario.output['07-output-ai_completed-plan.json']
      .providerDiagnostics;

  assert.deepEqual(diagnostics, {
    stage: 'CALL_3_FILLS',
    model: 'model-three',
    rawOutputAvailable: false,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(diagnostics, 'rawOutput'),
    false
  );
});

test('invalid structure geometry stops before call 3', async (t) => {
  const invalidStructure =
    await loadJsonFixture('03-extracted-structure.json');
  invalidStructure.workout_1.blocks[3].setCount = 0;
  const scenario = await createScenario(t, {
    invalidStructure,
    runId: 'invalid-geometry',
  });

  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE']
  );
  assert.equal(scenario.result.statuses.output3, 'PRODUCED');
  assert.equal(scenario.result.statuses.output4, 'ERROR');
  assert.equal(scenario.result.statuses.output5, 'NOT_PRODUCED');
  assert.equal(
    scenario.output['04-output-ai_extracted-structure.json'].error.code,
    'OUTPUT_4_STRUCTURE_INVALID'
  );
  assert.deepEqual(
    scenario.output['04-output-ai_extracted-structure.json'].received,
    invalidStructure
  );
});

for (const scenarioDefinition of [
  {
    name: 'call 1',
    options: { failureStage: 'CALL_1_PLAN_TEXT', runId: 'fail-call-1' },
    failedOutput: 2,
    expectedCalls: 1,
  },
  {
    name: 'call 2 invalid provider JSON',
    options: { failureStage: 'CALL_2_STRUCTURE', runId: 'fail-call-2' },
    failedOutput: 4,
    expectedCalls: 2,
  },
  {
    name: 'structure validation',
    options: {
      invalidStructure: {
        planName: 'Invalid',
        workout_1: {
          name: 'Only one workout',
          blocks: [{ type: 'SINGLE', setCount: 3 }],
        },
      },
      runId: 'fail-structure',
    },
    failedOutput: 4,
    expectedCalls: 2,
  },
  {
    name: 'skeleton builder',
    options: {
      skeletonError: Object.assign(
        new Error('skeleton construction failed'),
        { code: 'SKELETON_BUILD_FAILED' }
      ),
      runId: 'fail-skeleton',
    },
    failedOutput: 5,
    expectedCalls: 2,
  },
  {
    name: 'call 3',
    options: { failureStage: 'CALL_3_FILLS', runId: 'fail-call-3' },
    failedOutput: 7,
    expectedCalls: 3,
  },
  {
    name: 'fill validation',
    options: {
      invalidFills(value) {
        value.fills = value.fills.filter(
          (entry) => entry.slotId !== 'w1.b1.e1.s1'
        );
      },
      runId: 'fail-fills',
    },
    failedOutput: 7,
    expectedCalls: 3,
  },
]) {
  test(`failure artifacts remain exactly eight for ${scenarioDefinition.name}`, async (t) => {
    const scenario = await createScenario(t, scenarioDefinition.options);
    assert.equal(scenario.names.length, 8);
    assert.equal(scenario.calls.length, scenarioDefinition.expectedCalls);
    assert.equal(
      scenario.result.statuses[`output${scenarioDefinition.failedOutput}`],
      'ERROR'
    );
    for (
      let number = scenarioDefinition.failedOutput + 1;
      number <= 8;
      number += 1
    ) {
      assert.equal(
        scenario.result.statuses[`output${number}`],
        'NOT_PRODUCED'
      );
      const filename = CANONICAL_OUTPUT_FILES[number - 1][1];
      const artifact = scenario.output[filename];
      if (typeof artifact === 'string') {
        assert.match(artifact, /^STATUS: NOT_PRODUCED/);
        assert.match(artifact, /BLOCKED_BY_OUTPUT:/);
        assert.match(artifact, /ERROR_CODE:/);
        assert.match(artifact, /MESSAGE:/);
      } else {
        assert.equal(artifact.status, 'NOT_PRODUCED');
        assert.equal(
          artifact.blockedByOutput,
          scenarioDefinition.failedOutput
        );
        assert.equal(typeof artifact.error.code, 'string');
        assert.equal(typeof artifact.error.message, 'string');
      }
    }
  });
}

test('final preflight failure produces invalid Output 8 once without correction', async (t) => {
  const error = new Error('final validation rejected the plan');
  error.code = 'VALIDATION_ERROR';
  const scenario = await createScenario(t, {
    preflightError: error,
    runId: 'fail-preflight',
  });

  assert.equal(scenario.names.length, 8);
  assert.equal(scenario.calls.length, 3);
  assert.equal(scenario.preflightCalls.length, 1);
  assert.equal(scenario.result.statuses.output8, 'PRODUCED_INVALID');
  assert.equal(scenario.result.valid, false);
  assert.equal(scenario.result.completedDocument, null);
  assert.equal(scenario.result.metrics, null);
  assert.equal(scenario.result.generatedPlanText, null);
  assert.equal(
    scenario.output[
      '08-output-backend_validation-result.json'
    ].errors[0].code,
    'VALIDATION_ERROR'
  );
  assert.equal(
    scenario.output[
      '08-output-backend_validation-result.json'
    ].errors[0].message,
    'final validation rejected the plan'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      scenario.output['08-output-backend_validation-result.json'],
      'metrics'
    ),
    false
  );
  assert.equal(
    scenario.output['08-output-backend_validation-result.json']
      .aiUsage.calls.length,
    3
  );
});

test('unknown model or incomplete usage makes costs and affected totals unavailable', async (t) => {
  const scenario = await createScenario(t, {
    resolvedModels: {
      CALL_2_STRUCTURE: 'unknown-model',
    },
    usageByStage: {
      CALL_3_FILLS: {
        inputTokens: 2000,
        cachedInputTokens: null,
        outputTokens: 200,
        reasoningTokens: 100,
        totalTokens: 2200,
      },
    },
    runId: 'unknown-usage',
  });
  const aiUsage =
    scenario.output['08-output-backend_validation-result.json'].aiUsage;

  assert.equal(aiUsage.calls[1].estimatedCostUsd, null);
  assert.equal(aiUsage.calls[2].cachedInputTokens, null);
  assert.equal(aiUsage.calls[2].estimatedCostUsd, null);
  assert.equal(aiUsage.totals.inputTokens, 3500);
  assert.equal(aiUsage.totals.cachedInputTokens, null);
  assert.equal(aiUsage.totals.outputTokens, 350);
  assert.equal(aiUsage.totals.estimatedCostUsd, null);
});

test('the final preflight function body contains no Prisma write operation', async () => {
  const servicePath = require.resolve('../../services/weeklyPlansService');
  const source = await fs.readFile(servicePath, 'utf8');
  const start = source.indexOf(
    'async function prepareAIWeeklyPlanDraftForCreate'
  );
  const end = source.indexOf(
    '\nfunction hasGenerationContext',
    start
  );
  assert.ok(start >= 0 && end > start);
  const functionBody = source.slice(start, end);

  assert.doesNotMatch(
    functionBody,
    /\$transaction|\.create\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/
  );
});
