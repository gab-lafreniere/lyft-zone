const test = require('node:test');
const assert = require('node:assert/strict');

const {
  estimateOpenAiCostUsd,
} = require('../../src/ai/openAiPricing');

test('known configured models and their snapshots use the verified standard rates', () => {
  const gpt54Usage = {
    inputTokens: 2000,
    cachedInputTokens: 500,
    outputTokens: 250,
    reasoningTokens: 200,
    totalTokens: 2250,
  };
  const gpt41Usage = {
    inputTokens: 1000,
    cachedInputTokens: 200,
    outputTokens: 100,
    reasoningTokens: 90,
    totalTokens: 1100,
  };

  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-5.4-mini',
      usage: gpt54Usage,
    }),
    0.0022875
  );
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-5.4-mini-2026-03-17',
      usage: gpt54Usage,
    }),
    0.0022875
  );
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini',
      usage: gpt41Usage,
    }),
    0.0005
  );
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini-2025-04-14',
      usage: gpt41Usage,
    }),
    0.0005
  );
});

test('reasoning tokens are not billed separately from output tokens', () => {
  const baseUsage = {
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 100,
    totalTokens: 1100,
  };

  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini',
      usage: { ...baseUsage, reasoningTokens: 0 },
    }),
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini',
      usage: { ...baseUsage, reasoningTokens: 100 },
    })
  );
});

test('unknown models and incomplete or inconsistent usage return null', () => {
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'unknown-model',
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 10,
      },
    }),
    null
  );
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini',
      usage: {
        inputTokens: 100,
        cachedInputTokens: null,
        outputTokens: 10,
      },
    }),
    null
  );
  assert.equal(
    estimateOpenAiCostUsd({
      model: 'gpt-4.1-mini',
      usage: {
        inputTokens: 100,
        cachedInputTokens: 101,
        outputTokens: 10,
      },
    }),
    null
  );
});
