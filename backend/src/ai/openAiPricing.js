// OpenAI Standard pricing per 1M text tokens, verified 2026-07-30:
// https://developers.openai.com/api/docs/pricing
const STANDARD_USD_PER_MILLION_TOKEN_RATES = Object.freeze({
  gpt54Mini: Object.freeze({
    input: 0.75,
    cachedInput: 0.075,
    output: 4.5,
  }),
  gpt41Mini: Object.freeze({
    input: 0.4,
    cachedInput: 0.1,
    output: 1.6,
  }),
});

const MODEL_RATE_KEY = Object.freeze({
  'gpt-5.4-mini': 'gpt54Mini',
  'gpt-5.4-mini-2026-03-17': 'gpt54Mini',
  'gpt-4.1-mini': 'gpt41Mini',
  'gpt-4.1-mini-2025-04-14': 'gpt41Mini',
});

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function roundEstimatedUsd(value) {
  return Math.round(value * 100000000) / 100000000;
}

function estimateOpenAiCostUsd({ model, usage } = {}) {
  const rateKey =
    typeof model === 'string' ? MODEL_RATE_KEY[model.trim()] : null;
  const rates = rateKey
    ? STANDARD_USD_PER_MILLION_TOKEN_RATES[rateKey]
    : null;

  if (
    !rates ||
    !isNonNegativeSafeInteger(usage?.inputTokens) ||
    !isNonNegativeSafeInteger(usage?.cachedInputTokens) ||
    !isNonNegativeSafeInteger(usage?.outputTokens) ||
    usage.cachedInputTokens > usage.inputTokens
  ) {
    return null;
  }

  const uncachedInputTokens =
    usage.inputTokens - usage.cachedInputTokens;
  const estimatedCostUsd =
    (
      uncachedInputTokens * rates.input +
      usage.cachedInputTokens * rates.cachedInput +
      usage.outputTokens * rates.output
    ) /
    1000000;

  return roundEstimatedUsd(estimatedCostUsd);
}

module.exports = {
  MODEL_RATE_KEY,
  STANDARD_USD_PER_MILLION_TOKEN_RATES,
  estimateOpenAiCostUsd,
};
