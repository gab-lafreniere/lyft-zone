const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_MODELS } = require('../../src/ai/aiModels');
const { getModelForTask } = require('../../src/ai/aiRouter');

test('getModelForTask maps movement_analysis to SMALL_TASK', () => {
  assert.equal(getModelForTask('movement_analysis'), AI_MODELS.SMALL_TASK);
});

test('getModelForTask keeps program_generation on PROGRAM_GENERATION', () => {
  assert.equal(getModelForTask('program_generation'), AI_MODELS.PROGRAM_GENERATION);
});

test('getModelForTask routes program_review to PROGRAM_REVIEW', () => {
  assert.equal(getModelForTask('program_review'), AI_MODELS.PROGRAM_REVIEW);
});

test('getModelForTask routes program_repair to PROGRAM_REPAIR', () => {
  assert.equal(getModelForTask('program_repair'), AI_MODELS.PROGRAM_REPAIR);
});

function loadFreshRouterWithEnv(overrides = {}) {
  const keys = [
    'OPENAI_MODEL_PROGRAM_REPAIR',
    'OPENAI_MODEL_PROGRAM_REVIEW',
    'OPENAI_MODEL_PROGRAM_GENERATION',
    'OPENAI_MODEL_VALIDATION',
    'OPENAI_MODEL_SMALL_TASK',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const modelsPath = require.resolve('../../src/ai/aiModels');
  const routerPath = require.resolve('../../src/ai/aiRouter');

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  });
  delete require.cache[modelsPath];
  delete require.cache[routerPath];

  try {
    return require('../../src/ai/aiRouter').getModelForTask;
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
    delete require.cache[modelsPath];
    delete require.cache[routerPath];
  }
}

test('program_repair model routing uses its override then generation and current fallback', () => {
  const withRepairOverride = loadFreshRouterWithEnv({
    OPENAI_MODEL_PROGRAM_REPAIR: 'repair-specific-model',
    OPENAI_MODEL_PROGRAM_GENERATION: 'generation-specific-model',
  });
  assert.equal(withRepairOverride('program_repair'), 'repair-specific-model');
  assert.equal(
    withRepairOverride('program_generation'),
    'generation-specific-model'
  );

  const withGenerationFallback = loadFreshRouterWithEnv({
    OPENAI_MODEL_PROGRAM_GENERATION: 'generation-fallback-model',
  });
  assert.equal(
    withGenerationFallback('program_repair'),
    'generation-fallback-model'
  );

  const withCurrentFallback = loadFreshRouterWithEnv();
  assert.equal(withCurrentFallback('program_repair'), 'gpt-5.4-mini');
});

test('program_repair routing leaves review and unknown task behavior unchanged', () => {
  const routed = loadFreshRouterWithEnv({
    OPENAI_MODEL_PROGRAM_REPAIR: 'repair-model',
    OPENAI_MODEL_PROGRAM_REVIEW: 'review-model',
    OPENAI_MODEL_PROGRAM_GENERATION: 'generation-model',
    OPENAI_MODEL_SMALL_TASK: 'small-task-model',
  });

  assert.equal(routed('program_review'), 'review-model');
  assert.equal(routed('unknown_task'), 'small-task-model');
});
