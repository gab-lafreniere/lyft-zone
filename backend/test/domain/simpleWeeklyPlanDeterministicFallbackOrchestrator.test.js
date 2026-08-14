const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  runSimpleWeeklyPlanAiPipeline,
} = require('../../services/simpleWeeklyPlanAiOrchestrator');
const {
  buildSimpleWeeklyPlanSkeleton,
} = require('../../src/domain/simpleWeeklyPlanPipeline/skeletonBuilder');
const {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
} = require('../../src/domain/simpleWeeklyPlanPipeline/structureGeometryAdapter');
const exerciseLibrary = require('../../src/exercise-library/exercises.json');

const FIXTURE_DIRECTORY = path.join(
  __dirname,
  '../fixtures/simpleWeeklyPlanPipeline/real-call3-fixtures/fixture-b'
);

test('Fixture B orchestration makes one fallback call for all eight fields and writes sidecars', async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'simple-weekly-plan-fixture-b-')
  );
  t.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const [source, structureText] = await Promise.all([
    fs.readFile(path.join(FIXTURE_DIRECTORY, '02-output-ai_generated-plan.txt'), 'utf8'),
    fs.readFile(path.join(FIXTURE_DIRECTORY, '04-output-ai_extracted-structure.json'), 'utf8'),
  ]);
  const structure = JSON.parse(structureText);
  const skeleton = buildSimpleWeeklyPlanSkeleton(
    adaptSimpleWeeklyPlanStructureToLegacyGeometry(structure, {
      sessionsPerWeek: 6,
    })
  );
  const exactIds = new Set(source.match(/\b(?:exr|ex)_[A-Za-z0-9_:-]+\b/g) || []);
  const eligible = exerciseLibrary.filter((exercise) => exactIds.has(exercise.exerciseId));
  const calls = [];
  const provider = {
    async generate(request) {
      calls.push(request);
      if (request.stage === 'CALL_1_PLAN_TEXT') {
        return {
          value: source,
          model: 'fixture-call-1',
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
        };
      }
      if (request.stage === 'CALL_2_STRUCTURE') {
        return {
          value: structure,
          model: 'fixture-call-2',
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
        };
      }
      if (request.stage === 'CALL_3_FILL_FALLBACK') {
        const payload = JSON.parse(request.userMessage);
        const values = [60, 60, 60, 60, 60, 75, 60, 60];
        return {
          value: {
            schemaVersion: 1,
            geometryHash: payload.geometryHash,
            resolutions: payload.unresolved.map((entry, index) => ({
              resolutionId: entry.resolutionId,
              value: values[index],
            })),
          },
          model: 'fixture-fallback',
          usage: { inputTokens: 80, cachedInputTokens: 0, outputTokens: 40, reasoningTokens: 0, totalTokens: 120 },
        };
      }
      throw new Error(`Unexpected stage ${request.stage}`);
    },
  };

  const result = await runSimpleWeeklyPlanAiPipeline({
    userId: 'fixture-user',
    outputDirectory: temporaryRoot,
    runId: 'fixture-b',
    provider,
    deterministicFillsEnabled: true,
    dependencies: {
      env: {},
      async buildPromptForUser() {
        return {
          sessionsPerWeek: 6,
          durationPerSession: 120,
          systemMessage: 'fixture system',
          userMessage: 'fixture user',
        };
      },
      async buildExercisePoolForUser() {
        return {
          pool: {
            items: eligible.map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              trainingType: exercise.trainingType,
              attributes: {
                bodyParts: exercise.bodyParts,
                muscleFocus: exercise.muscleFocus,
                cardioModality: exercise.cardioModality,
              },
            })),
          },
        };
      },
      buildSkeleton() {
        return structuredClone(skeleton);
      },
      async finalPreflight(document) {
        return {
          document,
          businessRulesValidation: { ok: true, issueCount: 0 },
        };
      },
    },
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(
    calls.map((call) => call.stage),
    ['CALL_1_PLAN_TEXT', 'CALL_2_STRUCTURE', 'CALL_3_FILL_FALLBACK']
  );
  assert.equal(calls.filter((call) => call.stage === 'CALL_3_FILL_FALLBACK').length, 1);
  assert.equal(calls.some((call) => call.stage === 'CALL_3_FILLS'), false);
  const names = (await fs.readdir(result.runDirectory)).sort();
  assert.equal(names.length, 10);
  assert.ok(names.includes('06b-input-ai_fill-fallback.json'));
  assert.ok(names.includes('06c-output-ai_fill-fallback.json'));
  assert.ok(names.includes('07-output-backend_completed-plan.json'));

  const output6 = JSON.parse(await fs.readFile(
    path.join(result.runDirectory, '06-output-backend_deterministic-fills.json'),
    'utf8'
  ));
  assert.equal(output6.totalFieldCount, 893);
  assert.equal(output6.deterministicallyResolvedFieldCount, 885);
  assert.equal(output6.unresolvedFieldCount, 8);
  assert.equal(output6.fallbackRequired, true);
  const fallbackInput = JSON.parse(await fs.readFile(
    path.join(result.runDirectory, '06b-input-ai_fill-fallback.json'),
    'utf8'
  ));
  assert.equal(fallbackInput.input.unresolved.length, 8);
  assert.equal(JSON.stringify(fallbackInput).includes('strictWorkoutSeconds'), false);

  assert.equal(result.output8.fillResolution.deterministicFieldCount, 885);
  assert.equal(result.output8.fillResolution.unresolvedFieldCount, 8);
  assert.equal(result.output8.fillResolution.fallbackRequired, true);
  assert.equal(result.output8.fillResolution.fallbackFieldCount, 8);
  assert.equal(result.output8.fillResolution.fallbackInputTokens, 80);
  assert.equal(result.output8.fillResolution.fallbackOutputTokens, 40);
  assert.equal(result.output8.fillResolution.fallbackValidationOutcome, 'PASSED');
  assert.equal(result.output8.aiUsage.calls.length, 3);
  assert.equal(result.output8.aiUsage.calls[2].stage, 'CALL_3_FILL_FALLBACK');
  assert.equal(result.output8.timing.stageDurations.fillGenerationMs >= 0, true);
  assert.equal(result.completedDocument.workouts.length, 6);
  assert.equal(result.completedDocument.workouts[0].blocks[3].restSeconds, 60);
  assert.equal(result.completedDocument.workouts[5].blocks[4].restSeconds, 60);
});
