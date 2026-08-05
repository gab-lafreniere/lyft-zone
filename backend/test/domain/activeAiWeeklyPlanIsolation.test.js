const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BACKEND_ROOT = path.resolve(__dirname, '../..');

const ACTIVE_RUNTIME_ROOTS = [
  'routes/weeklyPlans.js',
  'controllers/weeklyPlansController.js',
  'services/simpleWeeklyPlanAiOrchestrator.js',
  'services/simpleWeeklyPlanAiProvider.js',
  'services/programGenerationTextPromptService.js',
  'services/weeklyPlanPipelineArtifactWriter.js',
].map((relativePath) => path.join(BACKEND_ROOT, relativePath));

const LEGACY_RUNTIME_MODULES = [
  'services/programGenerationService.js',
  'services/weeklyPlanAiGenerationService.js',
  'services/weeklyPlanAiReviewService.js',
  'services/weeklyPlanAiRepairService.js',
  'services/weeklyPlanInitialGenerationDebugService.js',
  'src/ai/doctrines/bodybuildingDoctrineLoader.js',
  'src/domain/programGeneration/aiProgramRepair.js',
  'src/domain/programGeneration/aiProgramReview.js',
  'src/domain/programGeneration/completeSentenceValidation.js',
  'src/domain/programGeneration/programGenerationDoctrinePromptProjection.js',
  'src/domain/programGeneration/programRepairContextBuilder.js',
  'src/domain/programGeneration/programReviewSchema.js',
  'src/domain/programGeneration/programReviewValidation.js',
  'src/domain/programGeneration/prompts/programRepairPrompt.js',
  'src/domain/programGeneration/prompts/programReviewPrompt.js',
  'src/domain/programGeneration/weeklyPlanAiNormalizer.js',
  'src/domain/programGeneration/weeklyPlanAiPresentation.js',
  'src/domain/programGeneration/weeklyPlanAiSchema.js',
  'src/domain/programGeneration/weeklyPlanAiValidation.js',
  'src/domain/programGeneration/weeklyPlanAnalytics.js',
  'src/domain/programGeneration/weeklyPlanBackendDuration.js',
  'src/domain/programGeneration/weeklyPlanGenerationAudit.js',
].map((relativePath) => path.join(BACKEND_ROOT, relativePath));

test('active AI Weekly Plan runtime roots do not import the V4 cluster', () => {
  const loadedModules = new Set(
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          [
            `const roots = ${JSON.stringify(ACTIVE_RUNTIME_ROOTS)};`,
            'roots.forEach((root) => require(root));',
            'process.stdout.write(JSON.stringify(Object.keys(require.cache)));',
          ].join(''),
        ],
        { encoding: 'utf8' }
      )
    )
  );

  LEGACY_RUNTIME_MODULES.forEach((modulePath) => {
    assert.equal(
      loadedModules.has(modulePath),
      false,
      path.relative(BACKEND_ROOT, modulePath)
    );
  });
});
