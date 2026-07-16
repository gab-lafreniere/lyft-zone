const OpenAI = require('openai');
const { ApiError } = require('./usersService');
const { getOpenAIClient } = require('../src/ai/openaiClient');
const { getModelForTask } = require('../src/ai/aiRouter');

const DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS = 120000;
const DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS = 24000;
const WEEKLY_PLAN_AI_RESPONSE_FORMAT_NAME = 'weekly_plan_ai_v1';

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function resolvePositiveSafeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProgramGenerationConfig(env = process.env) {
  return {
    timeoutMs: resolvePositiveSafeInteger(
      env.OPENAI_PROGRAM_GENERATION_TIMEOUT_MS,
      DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS
    ),
    maxOutputTokens: resolvePositiveSafeInteger(
      env.OPENAI_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS,
      DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS
    ),
  };
}

function createProviderError(status, code, message) {
  return new ApiError(status, code, message);
}

function assertGenerationInput(promptDescriptor, schema) {
  if (
    typeof promptDescriptor?.systemMessage !== 'string' ||
    !promptDescriptor.systemMessage.trim() ||
    typeof promptDescriptor?.userMessage !== 'string' ||
    !promptDescriptor.userMessage.trim() ||
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema)
  ) {
    throw createProviderError(
      500,
      'AI_WEEKLY_PLAN_PROVIDER_REQUEST_INVALID',
      'AI weekly plan provider request could not be processed'
    );
  }
}

function resolveOpenAIClient(env, deps = {}) {
  if (hasOwn(deps, 'openaiClient')) {
    const injectedClient = deps.openaiClient;
    if (typeof injectedClient?.responses?.create !== 'function') {
      throw createProviderError(
        503,
        'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
        'AI weekly plan provider is unavailable'
      );
    }
    return injectedClient;
  }

  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      'AI weekly plan provider is unavailable'
    );
  }

  try {
    const client = (deps.getOpenAIClient || getOpenAIClient)();
    if (typeof client?.responses?.create !== 'function') {
      throw new Error('Invalid OpenAI client');
    }
    return client;
  } catch (_error) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      'AI weekly plan provider is unavailable'
    );
  }
}

function resolveProgramGenerationModel(deps = {}) {
  let model;
  try {
    model = (deps.getModelForTask || getModelForTask)('program_generation');
  } catch (_error) {
    model = null;
  }

  if (typeof model !== 'string' || !model.trim()) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_MODEL_UNAVAILABLE',
      'AI weekly plan model is unavailable'
    );
  }

  return model.trim();
}

function buildResponsesRequest({ model, promptDescriptor, schema, maxOutputTokens }) {
  return {
    model,
    instructions: promptDescriptor.systemMessage,
    input: promptDescriptor.userMessage,
    text: {
      format: {
        type: 'json_schema',
        name: WEEKLY_PLAN_AI_RESPONSE_FORMAT_NAME,
        strict: true,
        schema,
      },
    },
    max_output_tokens: maxOutputTokens,
    store: false,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidProviderResponseError() {
  return createProviderError(
    502,
    'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    'AI weekly plan provider returned an invalid response'
  );
}

function assertGeneratedAIOutputObject(value) {
  if (!isObject(value)) {
    throw invalidProviderResponseError();
  }
  return value;
}

function parseWeeklyPlanAiResponse(response) {
  if (!isObject(response)) {
    throw invalidProviderResponseError();
  }

  if (response.status === 'failed' || response.error) {
    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_PROVIDER_ERROR',
      'AI weekly plan provider returned an error'
    );
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;

    if (reason === 'max_output_tokens') {
      throw createProviderError(
        502,
        'AI_WEEKLY_PLAN_MAX_OUTPUT_TOKENS',
        'AI weekly plan generation exceeded its output limit'
      );
    }

    if (reason === 'content_filter') {
      throw createProviderError(
        502,
        'AI_WEEKLY_PLAN_REFUSED',
        'AI weekly plan generation could not be completed'
      );
    }

    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_INCOMPLETE_RESPONSE',
      'AI weekly plan provider returned an incomplete response'
    );
  }

  if (response.status != null && response.status !== 'completed') {
    throw invalidProviderResponseError();
  }

  if (hasOwn(response, 'output') && !Array.isArray(response.output)) {
    throw invalidProviderResponseError();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const textParts = [];
  let hasUnexpectedOutput = false;

  output.forEach((item) => {
    if (!isObject(item)) {
      hasUnexpectedOutput = true;
      return;
    }

    if (item.type === 'reasoning') {
      return;
    }

    if (item.type !== 'message' || !Array.isArray(item.content)) {
      hasUnexpectedOutput = true;
      return;
    }

    item.content.forEach((content) => {
      if (!isObject(content)) {
        hasUnexpectedOutput = true;
        return;
      }

      if (content.type === 'refusal') {
        throw createProviderError(
          502,
          'AI_WEEKLY_PLAN_REFUSED',
          'AI weekly plan generation could not be completed'
        );
      }

      if (content.type !== 'output_text') {
        hasUnexpectedOutput = true;
        return;
      }

      if (typeof content.text === 'string') {
        textParts.push(content.text);
      } else {
        hasUnexpectedOutput = true;
      }
    });
  });

  if (hasUnexpectedOutput) {
    throw invalidProviderResponseError();
  }

  let outputText;
  if (hasOwn(response, 'output_text')) {
    if (typeof response.output_text !== 'string') {
      throw invalidProviderResponseError();
    }
    outputText = response.output_text;
  } else if (textParts.length > 0) {
    outputText = textParts.join('');
  } else if (hasOwn(response, 'output')) {
    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_EMPTY_RESPONSE',
      'AI weekly plan provider returned an empty response'
    );
  } else {
    throw invalidProviderResponseError();
  }

  if (!outputText.trim()) {
    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_EMPTY_RESPONSE',
      'AI weekly plan provider returned an empty response'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_error) {
    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_INVALID_JSON',
      'AI weekly plan provider returned invalid JSON'
    );
  }

  return assertGeneratedAIOutputObject(parsed);
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function buildGeneratorMetadata(response, requestedModel) {
  return {
    type: 'openai',
    model:
      typeof response?.model === 'string' && response.model.trim()
        ? response.model.trim()
        : requestedModel,
    responseId:
      typeof response?.id === 'string' && response.id.trim()
        ? response.id.trim()
        : null,
    usage: {
      inputTokens: normalizeTokenCount(response?.usage?.input_tokens),
      outputTokens: normalizeTokenCount(response?.usage?.output_tokens),
      totalTokens: normalizeTokenCount(response?.usage?.total_tokens),
      reasoningTokens: normalizeTokenCount(
        response?.usage?.output_tokens_details?.reasoning_tokens
      ),
    },
  };
}

function mapOpenAIError(error, options = {}) {
  if (error instanceof ApiError) {
    return error;
  }

  const status = Number(error?.status);

  if (
    options.didTimeout ||
    error instanceof OpenAI.APIConnectionTimeoutError ||
    status === 408
  ) {
    return createProviderError(
      504,
      'AI_WEEKLY_PLAN_GENERATION_TIMEOUT',
      'AI weekly plan generation timed out'
    );
  }

  if (error instanceof OpenAI.APIUserAbortError) {
    return createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      'AI weekly plan provider is unavailable'
    );
  }

  if (error instanceof OpenAI.RateLimitError || status === 429) {
    return createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_RATE_LIMITED',
      'AI weekly plan provider is temporarily rate limited'
    );
  }

  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    status === 401 ||
    status === 403
  ) {
    return createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_AUTH_FAILED',
      'AI weekly plan provider authentication failed'
    );
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      'AI weekly plan provider is unavailable'
    );
  }

  if (Number.isFinite(status) && status >= 500) {
    return createProviderError(
      502,
      'AI_WEEKLY_PLAN_PROVIDER_ERROR',
      'AI weekly plan provider returned an error'
    );
  }

  if (Number.isFinite(status) && status >= 400 && status < 500) {
    return createProviderError(
      500,
      'AI_WEEKLY_PLAN_PROVIDER_REQUEST_INVALID',
      'AI weekly plan provider request could not be processed'
    );
  }

  return createProviderError(
    502,
    'AI_WEEKLY_PLAN_PROVIDER_ERROR',
    'AI weekly plan provider returned an error'
  );
}

async function generateWeeklyPlanAiOutput(
  { promptDescriptor, schema } = {},
  deps = {}
) {
  assertGenerationInput(promptDescriptor, schema);

  const env = deps.env || process.env;
  const config = resolveProgramGenerationConfig(env);
  const client = resolveOpenAIClient(env, deps);
  const model = resolveProgramGenerationModel(deps);
  const AbortControllerImpl = deps.AbortController || globalThis.AbortController;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;

  if (typeof AbortControllerImpl !== 'function') {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      'AI weekly plan provider is unavailable'
    );
  }

  const controller = new AbortControllerImpl();
  let didTimeout = false;
  const timer = setTimer(() => {
    didTimeout = true;
    controller.abort();
  }, config.timeoutMs);
  let response;

  try {
    response = await client.responses.create(
      buildResponsesRequest({
        model,
        promptDescriptor,
        schema,
        maxOutputTokens: config.maxOutputTokens,
      }),
      { signal: controller.signal }
    );
  } catch (error) {
    throw mapOpenAIError(error, { didTimeout });
  } finally {
    clearTimer(timer);
  }

  return {
    generatedAIOutput: parseWeeklyPlanAiResponse(response),
    generator: buildGeneratorMetadata(response, model),
  };
}

module.exports = {
  DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS,
  DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS,
  WEEKLY_PLAN_AI_RESPONSE_FORMAT_NAME,
  buildResponsesRequest,
  generateWeeklyPlanAiOutput,
  parseWeeklyPlanAiResponse,
  resolveProgramGenerationConfig,
};
