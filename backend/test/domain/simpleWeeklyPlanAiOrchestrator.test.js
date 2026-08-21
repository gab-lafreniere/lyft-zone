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
  PROVIDER_ENTITY_GROUP_KEYS,
  SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
  buildCanonicalProviderEntities,
} = require('../../src/domain/simpleWeeklyPlanPipeline/fillSchema');
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
  const entities = buildCanonicalProviderEntities(skeleton);
  return {
    schemaVersion: SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
    geometryHash: fills.geometryHash,
    fills: {
      strengthExercises: entities.strengthExercises.map((entity) => ({
        exerciseId: fills.fills[entity.exerciseIdSlot.id],
        defaults: fills.fills[entity.defaultsSlot.id],
        sets: entity.setSlots.map((slot) => fills.fills[slot.id]),
        notes: fills.fills[entity.notesSlot.id],
      })),
      cardioExercises: entities.cardioExercises.map((entity) => ({
        exerciseId: fills.fills[entity.exerciseIdSlot.id],
        prescription: fills.fills[entity.cardioPrescriptionSlot.id],
        notes: fills.fills[entity.notesSlot.id],
      })),
      blockRests: entities.blockRests.map((entity) => ({
        value: fills.fills[entity.restSlot.id],
      })),
    },
  };
}

async function createScenario(t, options = {}) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'simple-weekly-plan-ai-test-')
  );
  t.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const generatedPlanText = options.generatedPlanText ||
    await loadFixture('02-generated-plan-three-day.txt');
  const structure = await loadJsonFixture('03-extracted-structure.json');
  if (options.presentation !== undefined) {
    structure.presentation = structuredClone(options.presentation);
  }
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
          options.invalidFills(value, skeleton);
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
    deterministicFillsEnabled:
      options.deterministicFillsEnabled ?? false,
    onProgress: options.onProgress,
    dependencies: {
      env: options.env || {},
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
    skeleton,
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
  assert.match(call2.userMessage, /Copy each value from the PROGRAM PRESENTATION section verbatim/);
  assert.match(call2.userMessage, /Do not improve, summarize, shorten, rewrite, infer, complete, or invent/);
  assert.ok(call2.userMessage.includes(scenario.generatedPlanText.trim()));
  assert.ok(
    call2.userMessage.includes(
      '- SUPERSET: number of complete rounds set performed for the two-exercise block;'
    )
  );
  assert.ok(
    call2.userMessage.includes(
      '- list every executable block in execution order, with exactly one blocks[] entry for each source-plan block;'
    )
  );
  assert.equal(
    call2.userMessage.includes('- list every block in execution order;'),
    false
  );
  assert.ok(
    call2.userMessage.includes(
      '- Consecutive blocks remain separate even when they have the same type and the same setCount. Never collapse or omit repeated-looking blocks.'
    )
  );
  const structureSelfCheck = [
    'Before returning the JSON, verify each workout once:',
    '- every source-plan block is represented exactly once;',
    '- the blocks[] count matches the number of executable source-plan blocks;',
    '- no consecutive repeated-looking blocks were collapsed or skipped.',
  ].join('\n');
  assert.ok(call2.userMessage.includes(structureSelfCheck));
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
  assert.ok(call3.userMessage.includes('PLAN SKELETON AND ENTITY REGISTRY'));
  assert.equal(call3.userMessage.includes('ALLOWED EXERCISES'), false);
  const call3Instructions = call3.userMessage.split(
    '\n\nPLAN SKELETON AND ENTITY REGISTRY\n'
  )[0];
  assert.equal(call3Instructions.includes('exerciseName'), false);
  assert.equal(JSON.stringify(call3.schema).includes('exerciseName'), false);
  assert.equal(call3.formatName, 'simple_weekly_plan_fills_v4');
  assert.equal(call3.schema.properties.schemaVersion.const, 4);
  assert.equal(JSON.stringify(call3.schema).includes('slotId'), false);
  assert.equal(JSON.stringify(call3.schema).includes('slotIndex'), false);
  assert.equal(JSON.stringify(call3.schema).includes('"kind"'), false);
  assert.ok(
    call3Instructions.includes(
      'Each strength exercise object must contain all and only that exercise\'s exerciseId, defaults, sets, and notes.'
    )
  );
  assert.ok(
    call3Instructions.includes(
      'Each sets array must contain only sets belonging to its own exercise and must match its entityRegistry setCount.'
    )
  );
  assert.ok(
    call3Instructions.includes(
      'Never carry a value from one exercise into the next.'
    )
  );
  assert.ok(
    call3Instructions.includes(
      'Do not return slotId, slotIndex, kind, pointer, or workout/block/exercise coordinates. The backend owns all addressing.'
    )
  );
  assert.ok(
    call3.userMessage.includes(
      "If entityRegistry expects more sets for an exercise than the source explicitly lists because of inconsistent SUPERSET geometry, emit the expected count using only that same exercise's stated values."
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
    'Fill the entity-local contract using the source plan.'
  );
  const call3SkeletonIndex = call3.userMessage.indexOf(
    '\nPLAN SKELETON AND ENTITY REGISTRY\n'
  );
  const call3SourceIndex = call3.userMessage.indexOf('\nSOURCE PLAN\n');
  assert.ok(call3InstructionsIndex >= 0);
  assert.ok(call3SkeletonIndex > call3InstructionsIndex);
  assert.ok(call3SourceIndex > call3SkeletonIndex);
  const call3RegistryHeader = '\nPLAN SKELETON AND ENTITY REGISTRY\n';
  const call3Registry = JSON.parse(
    call3.userMessage.slice(
      call3SkeletonIndex + call3RegistryHeader.length,
      call3SourceIndex
    ).trim()
  );
  assert.deepEqual(call3Registry.document, scenario.skeleton.document);
  const entities = buildCanonicalProviderEntities(scenario.skeleton);
  assert.deepEqual(
    call3Registry.entityRegistry,
    {
      strengthExercises: entities.strengthExercises.map((entity) => ({
        setCount: entity.setSlots.length,
      })),
      cardioExerciseCount: entities.cardioExercises.length,
      blockRestCount: entities.blockRests.length,
    }
  );
  const entityRegistryText = JSON.stringify(call3Registry.entityRegistry);
  for (const forbidden of [
    'slotId',
    'slotIndex',
    'pointer',
    'kind',
    'workoutIndex',
    'blockIndex',
    'exerciseIndex',
    'w1.b1',
  ]) {
    assert.equal(entityRegistryText.includes(forbidden), false, forbidden);
  }
  assert.equal(call3.schema.properties.fills.type, 'object');
  assert.equal(call3.schema.properties.fills.additionalProperties, false);
  assert.deepEqual(
    call3.schema.properties.fills.required,
    PROVIDER_ENTITY_GROUP_KEYS
  );
  assert.deepEqual(
    Object.keys(call3.schema.properties.fills.properties),
    PROVIDER_ENTITY_GROUP_KEYS
  );
  PROVIDER_ENTITY_GROUP_KEYS.forEach((key) => {
    const groupSchema = call3.schema.properties.fills.properties[key];
    assert.equal(groupSchema.minItems, entities[key].length);
    assert.equal(groupSchema.maxItems, entities[key].length);
  });
  assert.equal(entities.strengthExercises.length, 28);
  assert.equal(entities.cardioExercises.length, 0);
  assert.equal(entities.blockRests.length, 7);
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
  assert.ok(
    output3.includes(
      `${structureSelfCheck}\n\nSTRUCTURED OUTPUT CONFIGURATION`
    )
  );
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
  assert.deepEqual(
    scenario.result.sourceWorkoutNames,
    [
      scenario.structure.workout_1.name,
      scenario.structure.workout_2.name,
      scenario.structure.workout_3.name,
    ]
  );
  assert.deepEqual(
    scenario.result.completedDocument.workouts.map((workout) => workout.name),
    scenario.result.sourceWorkoutNames
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
  assert.deepEqual(
    scenario.output['05-output-backend_plan-skeleton.json']
      .document.workouts.map((workout) => workout.name),
    scenario.result.sourceWorkoutNames
  );
  const output6 = scenario.output['06-output-backend_deterministic-fills.json'].modelInput;
  const output6Headings = [
    'SYSTEM MESSAGE',
    'USER MESSAGE',
    'STRUCTURED OUTPUT CONFIGURATION',
    'PLAN SKELETON AND ENTITY REGISTRY',
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
  assert.ok(output6.includes('simple_weekly_plan_fills_v4'));
  for (const removedRegistryTerm of [
    'slotGroups',
    'strengthSetTargets',
    'cardioPrescriptions',
    'blockRestSeconds',
  ]) {
    assert.equal(
      output6.includes(removedRegistryTerm),
      false,
      removedRegistryTerm
    );
  }
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
    scenario.output['07-output-backend_completed-plan.json']
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
      scenario.output['07-output-backend_completed-plan.json']
    ).sort(),
    ['name', 'sessionsPerWeek', 'workouts']
  );
  const firstExercise =
    scenario.output['07-output-backend_completed-plan.json']
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
      scenario.output['07-output-backend_completed-plan.json']
    )
  );
  const measuredCallDurations = scenario.output[
    '08-output-backend_validation-result.json'
  ].aiUsage.calls.map((call) => call.durationMs);
  assert.equal(
    measuredCallDurations.every(
      (durationMs) => Number.isSafeInteger(durationMs) && durationMs >= 0
    ),
    true
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
          durationMs: measuredCallDurations[0],
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
          durationMs: measuredCallDurations[1],
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
          durationMs: measuredCallDurations[2],
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
  assert.deepEqual(
    scenario.output['08-output-backend_validation-result.json'].timing
      .generationContext,
    {
      sessionsPerWeek: 3,
      durationPerSession: null,
      generatedWorkoutCount: 3,
      generatedExerciseCount: 28,
      generatedSetCount: 104,
    }
  );
  assert.equal(
    scenario.output['08-output-backend_validation-result.json'].timing
      .persistenceOutcome,
    'PENDING'
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

test('GEOMETRY_ONLY carries presentation without making it part of geometry validity', async (t) => {
  const presentation = {
    title: 'Balanced Upper Specialization',
    summary: 'Upper-body volume leads the week while lower-body work preserves balanced development.',
    progression: 'Add load after every set reaches its target range with the prescribed effort.',
    coachingNotes: [
      'Keep pressing technique stable as weekly fatigue accumulates.',
      'Use strict pulling mechanics to support balanced shoulder function.',
    ],
  };
  const scenario = await createScenario(t, { presentation });

  assert.equal(scenario.result.valid, true, JSON.stringify(scenario.result.error));
  assert.deepEqual(scenario.result.boundPresentation, presentation);
  assert.deepEqual(
    scenario.output['04-output-ai_extracted-structure.json'].presentation,
    presentation
  );
});

test('presentation kill switch restores Phase 1A prompt, schema, and result tiers', async (t) => {
  const scenario = await createScenario(t, {
    env: { SIMPLE_WEEKLY_PLAN_PRESENTATION_CONTRACT: 'off' },
  });
  const call2 = scenario.calls.find((call) => call.stage === 'CALL_2_STRUCTURE');

  assert.equal(call2.schema.properties.presentation, undefined);
  assert.doesNotMatch(call2.userMessage, /PROGRAM PRESENTATION/);
  assert.equal(scenario.result.boundPresentation, null);
  assert.equal(scenario.result.presentationContractEnabled, false);
});

test('deterministic no-fallback path skips Call 3 and records resolver observability', async (t) => {
  const scenario = await createScenario(t, {
    deterministicFillsEnabled: true,
  });
  assert.equal(scenario.result.valid, true);
  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE']
  );
  assert.equal(scenario.calls.length, 2);
  assert.deepEqual(scenario.result.modelsUsed, [
    'gpt-5.4-mini-2026-03-17',
    'gpt-4.1-mini-2025-04-14',
  ]);
  const output6 = scenario.output['06-output-backend_deterministic-fills.json'];
  assert.match(output6.resolverVersion, /fill-resolver-v1$/);
  assert.equal(output6.fallbackRequired, false);
  assert.equal(output6.unresolvedFieldCount, 0);
  assert.equal(
    output6.deterministicallyResolvedFieldCount,
    output6.totalFieldCount
  );
  assert.equal(output6.providerFills.geometryHash, scenario.skeleton.geometryHash);
  const output8 = scenario.output['08-output-backend_validation-result.json'];
  assert.equal(output8.fillResolution.mode, 'DETERMINISTIC_WITH_FALLBACK');
  assert.equal(output8.fillResolution.fallbackRequired, false);
  assert.equal(output8.fillResolution.fallbackValidationOutcome, 'NOT_REQUIRED');
  assert.equal(output8.aiUsage.calls.length, 2);
  assert.equal(
    output8.aiUsage.calls.some((call) => call.stage.includes('CALL_3')),
    false
  );
});

test('deterministic fills ignore ineligible ID-like tokens outside executable geometry', async (t) => {
  const executablePlan = await loadFixture('02-generated-plan-three-day.txt');
  const generatedPlanText = [
    executablePlan,
    '',
    'Discarded non-executable SUPERSET B note:',
    'Do not use exr_tricep-less?',
  ].join('\n');
  const scenario = await createScenario(t, {
    deterministicFillsEnabled: true,
    generatedPlanText,
  });

  assert.equal(scenario.result.valid, true, JSON.stringify(scenario.result.error));
  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE']
  );
  const completed = scenario.output['07-output-backend_completed-plan.json'];
  const materializedIds = completed.workouts.flatMap((workout) =>
    workout.blocks.flatMap((block) =>
      block.exercises.map((exercise) => exercise.exerciseId)
    )
  );
  assert.equal(materializedIds.includes('exr_tricep'), false);
  assert.equal(JSON.stringify(completed).includes('exr_tricep-less?'), false);
  assert.equal(
    materializedIds.every((exerciseId) => scenario.eligibleLookup[exerciseId]),
    true
  );
});

test('deterministic fills still reject an executable exercise outside the eligible pool', async (t) => {
  const executablePlan = await loadFixture('02-generated-plan-three-day.txt');
  const generatedPlanText = executablePlan.replace(
    'exr_incline_barbell_bench_press',
    'exr_actually_ineligible'
  );
  const scenario = await createScenario(t, {
    deterministicFillsEnabled: true,
    generatedPlanText,
  });

  assert.equal(scenario.result.valid, false);
  assert.equal(scenario.result.error.code, 'DETERMINISTIC_EXERCISE_ID_INELIGIBLE');
  assert.equal(scenario.result.statuses.output6, 'ERROR');
  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE']
  );
});

test('legacy full Call 3 still rejects ineligible ID-like tokens anywhere in source text', async (t) => {
  const executablePlan = await loadFixture('02-generated-plan-three-day.txt');
  const generatedPlanText = `${executablePlan}\n\nDiscarded note: exr_tricep-less?`;
  const scenario = await createScenario(t, {
    deterministicFillsEnabled: false,
    generatedPlanText,
  });

  assert.equal(scenario.result.valid, false);
  assert.equal(scenario.result.error.code, 'EXERCISE_ID_OUTSIDE_ELIGIBLE_POOL');
  assert.equal(scenario.result.statuses.output6, 'ERROR');
  assert.deepEqual(
    scenario.calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE']
  );
});

test('public progress stages follow real boundaries and callback failures are harmless', async (t) => {
  const stages = [];
  const scenario = await createScenario(t, {
    runId: 'progress-stages',
    onProgress(stage) {
      stages.push(stage);
      if (stage === 'EXTRACTING_STRUCTURE') {
        throw new Error('best effort progress failure');
      }
    },
  });

  assert.equal(scenario.result.valid, true);
  assert.deepEqual(stages, [
    'PROFILE_SETUP',
    'DESIGNING_PROGRAM',
    'EXTRACTING_STRUCTURE',
    'RESOLVING_EXERCISES',
    'VALIDATING_PROGRAM',
  ]);
});

test('the complete backend lookup remains independent from prompt serialization', async (t) => {
  const scenario = await createScenario(t, {
    invalidFills(value, skeleton) {
      const exerciseIndex = buildCanonicalProviderEntities(
        skeleton
      ).strengthExercises.findIndex(
        (entity) => entity.exerciseIdSlot.id === 'w1.b1.e1.id'
      );
      value.fills.strengthExercises[exerciseIndex].exerciseId =
        'exr_unused_pool_item';
    },
    runId: 'complete-lookup',
  });
  const exercise =
    scenario.output['07-output-backend_completed-plan.json']
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
    invalidFills(value, skeleton) {
      const exerciseIndex = buildCanonicalProviderEntities(
        skeleton
      ).strengthExercises.findIndex(
        (entity) => entity.exerciseIdSlot.id === 'w1.b1.e1.id'
      );
      value.fills.strengthExercises[exerciseIndex].exerciseId =
        'exr_outside_pool';
    },
    runId: 'outside-lookup',
  });
  const output7 =
    scenario.output['07-output-backend_completed-plan.json'];

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
    scenario.output['07-output-backend_completed-plan.json'];
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
    scenario.output['07-output-backend_completed-plan.json']
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
      invalidFills(value, skeleton) {
        const exerciseIndex = buildCanonicalProviderEntities(
          skeleton
        ).strengthExercises.findIndex(
          (entity) => entity.exerciseIdSlot.id === 'w1.b1.e1.id'
        );
        value.fills.strengthExercises[exerciseIndex].sets.pop();
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

test('failed generation retains completed-call usage and estimated cost in Output 8', async (t) => {
  const scenario = await createScenario(t, {
    invalidFills(value, skeleton) {
      const exerciseIndex = buildCanonicalProviderEntities(
        skeleton
      ).strengthExercises.findIndex(
        (entity) => entity.exerciseIdSlot.id === 'w1.b1.e1.id'
      );
      value.fills.strengthExercises[exerciseIndex].sets.pop();
    },
    runId: 'failed-generation-usage',
  });
  const output8 =
    scenario.output['08-output-backend_validation-result.json'];

  assert.equal(output8.status, 'NOT_PRODUCED');
  assert.equal(output8.blockedByOutput, 7);
  assert.equal(output8.aiUsage.calls.length, 3);
  assert.deepEqual(
    output8.aiUsage.calls.map(({ call, stage }) => ({ call, stage })),
    [
      { call: 1, stage: 'CALL_1_PLAN_TEXT' },
      { call: 2, stage: 'CALL_2_STRUCTURE' },
      { call: 3, stage: 'CALL_3_FILLS' },
    ]
  );
  assert.equal(
    output8.aiUsage.calls.every(
      (call) => Number.isSafeInteger(call.durationMs) && call.durationMs >= 0
    ),
    true
  );
  assert.equal(output8.aiUsage.totals.totalTokens, 3850);
  assert.equal(output8.aiUsage.totals.estimatedCostUsd, 0.002135);
  assert.equal(output8.timing.persistenceOutcome, 'NOT_ATTEMPTED');
});

test('failed generation totals include the completed calls available before call 3', async (t) => {
  const invalidStructure =
    await loadJsonFixture('03-extracted-structure.json');
  invalidStructure.workout_1.blocks[0].setCount = 0;
  const scenario = await createScenario(t, {
    invalidStructure,
    runId: 'partial-failed-generation-usage',
  });
  const aiUsage = scenario.output[
    '08-output-backend_validation-result.json'
  ].aiUsage;

  assert.equal(aiUsage.calls.length, 2);
  assert.equal(aiUsage.totals.inputTokens, 1500);
  assert.equal(aiUsage.totals.totalTokens, 1650);
  assert.equal(aiUsage.totals.estimatedCostUsd, 0.001315);
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
