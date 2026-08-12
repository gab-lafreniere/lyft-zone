const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  runDeterministicWeeklyPlanPipeline,
} = require('../../../services/simpleWeeklyPlanPipelineService');
const {
  summarizeWeeklyPlan,
  validateFinalWeeklyPlan,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/finalValidation');
const {
  CANONICAL_OUTPUT_FILES,
  rewriteWeeklyPlanPipelineOutput8,
  writeWeeklyPlanPipelineArtifacts,
} = require('../../../services/weeklyPlanPipelineArtifactWriter');
const {
  buildSimulatedFills,
} = require('../../fixtures/simpleWeeklyPlanPipeline/fills-simulated');

const fixturesDirectory = path.join(
  __dirname,
  '../../fixtures/simpleWeeklyPlanPipeline'
);

async function loadFixture(filename) {
  return fs.readFile(path.join(fixturesDirectory, filename), 'utf8');
}

async function loadJsonFixture(filename) {
  return JSON.parse(await loadFixture(filename));
}

test('realistic three-day fixture runs deterministically from structure to Output #8', async () => {
  const calls = [];
  const result = await runDeterministicWeeklyPlanPipeline({
    promptInputText: await loadFixture('01-prompt-input.txt'),
    generatedPlanText: await loadFixture('02-generated-plan-three-day.txt'),
    extractedStructure: await loadJsonFixture('03-extracted-structure.json'),
    sessionsPerWeek: 3,
    fills: buildSimulatedFills(),
    eligibleExerciseLookup:
      await loadJsonFixture('eligible-exercise-lookup.json'),
    runtimeUserId: 'runtime_user',
    finalPreflight: async (payload) => {
      calls.push(payload);
      return {
        document: payload,
        businessRulesValidation: { ok: true, issueCount: 0 },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'runtime_user');
  assert.equal(calls[0].source, 'AI');
  assert.equal(result.outputs.output8.valid, true);
  assert.deepEqual(result.outputs.output8.summary, {
    workoutCount: 3,
    blockCount: 21,
    exerciseCount: 28,
    setTemplateCount: 104,
  });
  assert.deepEqual(summarizeWeeklyPlan(result.outputs.output7), {
    workoutCount: 3,
    blockCount: 21,
    exerciseCount: 28,
    setTemplateCount: 104,
  });
  for (const pipelineOnlyField of [
    'schemaVersion',
    'geometryHash',
    'slots',
    'slotTypes',
    'fills',
    'userId',
    'source',
    'generationContext',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        result.outputs.output7,
        pipelineOnlyField
      ),
      false
    );
  }
});

test('final validation captures errors without correction or a second call', async () => {
  const completedDocument = {
    name: 'Invalid plan',
    sessionsPerWeek: 1,
    workouts: [],
  };
  let callCount = 0;
  const result = await validateFinalWeeklyPlan({
    completedDocument,
    runtimeUserId: 'runtime_user',
    preflight: async () => {
      callCount += 1;
      const error = new Error('setType is invalid');
      error.code = 'VALIDATION_ERROR';
      throw error;
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].path, null);
  assert.equal(result.errors[0].code, 'VALIDATION_ERROR');
  assert.equal(result.warnings[0].code, 'LIMITED_VALIDATOR_ERROR_GRANULARITY');
  assert.equal(
    Object.prototype.hasOwnProperty.call(result, 'metrics'),
    false
  );
  assert.deepEqual(completedDocument, {
    name: 'Invalid plan',
    sessionsPerWeek: 1,
    workouts: [],
  });
});

test('successful final validation reports canonical SINGLE, SUPERSET, CARDIO, and muscle metrics without changing Output #7', async () => {
  const strengthSet = (setIndex) => ({
    setIndex,
    setType: 'WORKING',
    targetReps: 10,
    minReps: null,
    maxReps: null,
    targetRir: 2,
    tempo: '2010',
    restSeconds: 60,
  });
  const completedDocument = {
    name: 'Metrics plan',
    sessionsPerWeek: 3,
    workouts: [
      {
        name: 'Single',
        orderIndex: 1,
        blocks: [
          {
            blockType: 'SINGLE',
            orderIndex: 1,
            restSeconds: 60,
            exercises: [
              {
                exerciseId: 'ex_single',
                exerciseName: 'Single exercise',
                bodyParts: ['chest', 'triceps'],
                defaultTempo: '2010',
                setTemplates: [strengthSet(1), strengthSet(2)],
              },
            ],
          },
        ],
      },
      {
        name: 'Superset',
        orderIndex: 2,
        blocks: [
          {
            blockType: 'SUPERSET',
            orderIndex: 1,
            roundCount: 2,
            restSeconds: 90,
            exercises: [
              {
                exerciseId: 'ex_back',
                exerciseName: 'Back exercise',
                bodyParts: ['back'],
                defaultTempo: '2010',
                setTemplates: [strengthSet(1), strengthSet(2)],
              },
              {
                exerciseId: 'ex_biceps',
                exerciseName: 'Biceps exercise',
                bodyParts: ['biceps'],
                defaultTempo: '2010',
                setTemplates: [strengthSet(1), strengthSet(2)],
              },
            ],
          },
        ],
      },
      {
        name: 'Cardio',
        orderIndex: 3,
        blocks: [
          {
            blockType: 'CARDIO',
            orderIndex: 1,
            exercises: [
              {
                exerciseId: 'ex_cardio',
                exerciseName: 'Cardio exercise',
                bodyParts: ['quadriceps'],
                setTemplates: [],
                cardioPrescription: {
                  durationMinutes: 20,
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const before = structuredClone(completedDocument);
  const result = await validateFinalWeeklyPlan({
    completedDocument,
    runtimeUserId: 'runtime_user',
    preflight: async () => ({ ok: true }),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(completedDocument, before);
  assert.deepEqual(
    result.metrics.workouts.map((workout) => ({
      workoutIndex: workout.workoutIndex,
      name: workout.name,
      exerciseCount: workout.exerciseCount,
      setCount: workout.setCount,
      estimatedDurationMinutes: workout.estimatedDurationMinutes,
      totalTUTMinutes: workout.totalTUTMinutes,
      totalTUTSeconds: workout.totalTUTSeconds,
    })),
    [
      {
        workoutIndex: 1,
        name: 'Single',
        exerciseCount: 1,
        setCount: 2,
        estimatedDurationMinutes: 14,
        totalTUTMinutes: 1,
        totalTUTSeconds: 60,
      },
      {
        workoutIndex: 2,
        name: 'Superset',
        exerciseCount: 2,
        setCount: 4,
        estimatedDurationMinutes: 16,
        totalTUTMinutes: 2,
        totalTUTSeconds: 120,
      },
      {
        workoutIndex: 3,
        name: 'Cardio',
        exerciseCount: 1,
        setCount: 0,
        estimatedDurationMinutes: 30,
        totalTUTMinutes: 0,
        totalTUTSeconds: 0,
      },
    ]
  );
  assert.deepEqual(
    {
      totalExerciseCount: result.metrics.weekly.totalExerciseCount,
      totalSetCount: result.metrics.weekly.totalSetCount,
      averageDurationMinutes:
        result.metrics.weekly.averageDurationMinutes,
      averageTUTMinutes: result.metrics.weekly.averageTUTMinutes,
      totalTUTSeconds: result.metrics.weekly.totalTUTSeconds,
    },
    {
      totalExerciseCount: 4,
      totalSetCount: 6,
      averageDurationMinutes: 20,
      averageTUTMinutes: 2,
      totalTUTSeconds: 180,
    }
  );

  const singleDistribution = Object.fromEntries(
    result.metrics.workouts[0].muscleDistribution.map((entry) => [
      entry.key,
      entry,
    ])
  );
  assert.deepEqual(singleDistribution.chest, {
    key: 'chest',
    label: 'Chest',
    rawSets: 2,
    normalizedShare: 1,
    percentageOfWorkout: 50,
  });
  assert.deepEqual(singleDistribution.triceps, {
    key: 'triceps',
    label: 'Triceps',
    rawSets: 2,
    normalizedShare: 1,
    percentageOfWorkout: 50,
  });
  assert.equal(
    result.metrics.workouts[2].muscleDistribution.every(
      (entry) => entry.rawSets === 0 && entry.normalizedShare === 0
    ),
    true
  );
});

test('artifact writer creates exactly eight canonical autonomous files with mode 0600', async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'simple-weekly-plan-artifacts-')
  );
  t.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const outputs = {
    output1: 'prompt',
    output2: 'plan',
    output3: 'prompt 2',
    output4: { schemaVersion: 1 },
    output5: { schemaVersion: 1, geometryHash: 'sha256:test' },
    output6: 'prompt 3',
    output7: { name: 'Plan', sessionsPerWeek: 1, workouts: [] },
    output8: { valid: true },
  };
  const written = await writeWeeklyPlanPipelineArtifacts({
    outputs,
    runId: 'test-run',
    baseDirectory: temporaryRoot,
  });
  const names = (await fs.readdir(written.runDirectory)).sort();

  assert.deepEqual(
    names,
    CANONICAL_OUTPUT_FILES.map(([, filename]) => filename).sort()
  );
  assert.equal(names.length, 8);
  assert.deepEqual(names, [
    '01-input-ai_master-prompt.txt',
    '02-output-ai_generated-plan.txt',
    '03-input-ai_prompt-2.txt',
    '04-output-ai_extracted-structure.json',
    '05-output-backend_plan-skeleton.json',
    '06-input-ai_prompt-3.txt',
    '07-output-ai_completed-plan.json',
    '08-output-backend_validation-result.json',
  ]);
  for (const filename of names) {
    const filePath = path.join(written.runDirectory, filename);
    const stat = await fs.stat(filePath);
    assert.equal(stat.mode & 0o777, 0o600);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /\n$/);
    if (filename.endsWith('.json')) {
      assert.doesNotThrow(() => JSON.parse(content));
    }
  }
  await rewriteWeeklyPlanPipelineOutput8({
    runDirectory: written.runDirectory,
    output8: { valid: true, timing: { persistenceOutcome: 'SUCCEEDED' } },
  });
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(
          written.runDirectory,
          '08-output-backend_validation-result.json'
        ),
        'utf8'
      )
    ),
    { valid: true, timing: { persistenceOutcome: 'SUCCEEDED' } }
  );
  assert.equal((await fs.readdir(written.runDirectory)).length, 8);
  assert.equal(
    (await fs.stat(
      path.join(
        written.runDirectory,
        '08-output-backend_validation-result.json'
      )
    )).mode & 0o777,
    0o600
  );
  await assert.rejects(
    writeWeeklyPlanPipelineArtifacts({
      outputs,
      runId: 'test-run',
      baseDirectory: temporaryRoot,
    }),
    /EEXIST/
  );
  await assert.rejects(
    writeWeeklyPlanPipelineArtifacts({
      outputs: { ...outputs, output9: {} },
      runId: 'too-many-outputs',
      baseDirectory: temporaryRoot,
    }),
    /Exactly outputs output1 through output8/
  );
  const missingOutput = { ...outputs };
  delete missingOutput.output6;
  await assert.rejects(
    writeWeeklyPlanPipelineArtifacts({
      outputs: missingOutput,
      runId: 'missing-output',
      baseDirectory: temporaryRoot,
    }),
    /Exactly outputs output1 through output8/
  );
});
