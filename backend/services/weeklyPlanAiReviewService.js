const OpenAI = require('openai');
const { ApiError } = require('./usersService');
const { getOpenAIClient } = require('../src/ai/openaiClient');
const { getModelForTask } = require('../src/ai/aiRouter');
const {
  PROGRAM_REVIEW_RESPONSE_FORMAT_NAME,
} = require('../src/domain/programGeneration/programReviewSchema');

const DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS = 60000;
const DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS = 4000;

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolvePositiveSafeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAIWeeklyPlanReviewEnabled(env = process.env) {
  return String(env.ENABLE_AI_WEEKLY_PLAN_REVIEW || '').toLowerCase() === 'true';
}

function resolveProgramReviewConfig(env = process.env) {
  return {
    timeoutMs: resolvePositiveSafeInteger(
      env.OPENAI_PROGRAM_REVIEW_TIMEOUT_MS,
      DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS
    ),
    maxOutputTokens: resolvePositiveSafeInteger(
      env.OPENAI_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS,
      DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS
    ),
  };
}

function createProviderError(status, code, message) {
  return new ApiError(status, code, message);
}

function assertAIWeeklyPlanReviewEnabled(env) {
  if (!isAIWeeklyPlanReviewEnabled(env)) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_DISABLED',
      'AI weekly plan review is not enabled'
    );
  }
}

function assertReviewRequest(promptDescriptor, schema) {
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
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_REQUEST_INVALID',
      'AI weekly plan review provider request could not be processed'
    );
  }
}

function resolveOpenAIClient(env, deps = {}) {
  if (hasOwn(deps, 'openaiClient')) {
    const injectedClient = deps.openaiClient;
    if (typeof injectedClient?.responses?.create !== 'function') {
      throw createProviderError(
        503,
        'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
        'AI weekly plan review provider is unavailable'
      );
    }
    return injectedClient;
  }

  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
      'AI weekly plan review provider is unavailable'
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
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
      'AI weekly plan review provider is unavailable'
    );
  }
}

function resolveProgramReviewModel(deps = {}) {
  let model;
  try {
    model = (deps.getModelForTask || getModelForTask)('program_review');
  } catch (_error) {
    model = null;
  }

  if (typeof model !== 'string' || !model.trim()) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_MODEL_UNAVAILABLE',
      'AI weekly plan review model is unavailable'
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
        name: PROGRAM_REVIEW_RESPONSE_FORMAT_NAME,
        strict: true,
        schema,
      },
    },
    max_output_tokens: maxOutputTokens,
    store: false,
  };
}

function invalidProviderResponseError() {
  return createProviderError(
    502,
    'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    'AI weekly plan review provider returned an invalid response'
  );
}

function assertProgramReviewObject(value) {
  if (!isObject(value)) {
    throw invalidProviderResponseError();
  }
  return value;
}

function parseWeeklyPlanAiReviewResponse(response) {
  if (!isObject(response)) {
    throw invalidProviderResponseError();
  }

  if (response.status === 'failed' || response.error) {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
      'AI weekly plan review provider returned an error'
    );
  }

  if (response.status === 'incomplete') {
    if (response.incomplete_details?.reason === 'content_filter') {
      throw createProviderError(
        502,
        'AI_WEEKLY_PLAN_REVIEW_REFUSED',
        'AI weekly plan review could not be completed'
      );
    }

    throw createProviderError(
      502,
      'AI_WEEKLY_PLAN_REVIEW_INCOMPLETE',
      'AI weekly plan review provider returned an incomplete response'
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
          'AI_WEEKLY_PLAN_REVIEW_REFUSED',
          'AI weekly plan review could not be completed'
        );
      }

      if (content.type !== 'output_text' || typeof content.text !== 'string') {
        hasUnexpectedOutput = true;
        return;
      }

      textParts.push(content.text);
    });
  });

  if (hasUnexpectedOutput) {
    throw invalidProviderResponseError();
  }

  let outputText = null;
  if (hasOwn(response, 'output_text')) {
    if (typeof response.output_text !== 'string') {
      throw invalidProviderResponseError();
    }
    outputText = response.output_text;
  }

  if (!outputText?.trim() && textParts.length > 0) {
    outputText = textParts.join('');
  }

  if (!outputText?.trim()) {
    throw invalidProviderResponseError();
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_error) {
    throw invalidProviderResponseError();
  }

  return assertProgramReviewObject(parsed);
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function buildReviewerMetadata(response, requestedModel) {
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
      'AI_WEEKLY_PLAN_REVIEW_TIMEOUT',
      'AI weekly plan review timed out'
    );
  }

  if (
    error instanceof OpenAI.APIUserAbortError ||
    error instanceof OpenAI.RateLimitError ||
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof OpenAI.APIConnectionError ||
    status === 401 ||
    status === 403 ||
    status === 429 ||
    (Number.isFinite(status) && status >= 500)
  ) {
    return createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
      'AI weekly plan review provider is unavailable'
    );
  }

  if (Number.isFinite(status) && status >= 400 && status < 500) {
    return createProviderError(
      500,
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_REQUEST_INVALID',
      'AI weekly plan review provider request could not be processed'
    );
  }

  return createProviderError(
    503,
    'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    'AI weekly plan review provider is unavailable'
  );
}

async function reviewWeeklyPlanAi({ promptDescriptor, schema } = {}, deps = {}) {
  const env = deps.env || process.env;
  assertAIWeeklyPlanReviewEnabled(env);
  assertReviewRequest(promptDescriptor, schema);

  const config = resolveProgramReviewConfig(env);
  const client = resolveOpenAIClient(env, deps);
  const model = resolveProgramReviewModel(deps);
  const AbortControllerImpl = deps.AbortController || globalThis.AbortController;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;

  if (typeof AbortControllerImpl !== 'function') {
    throw createProviderError(
      503,
      'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
      'AI weekly plan review provider is unavailable'
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
      {
        signal: controller.signal,
        maxRetries: 0,
      }
    );
  } catch (error) {
    throw mapOpenAIError(error, { didTimeout });
  } finally {
    clearTimer(timer);
  }

  return {
    programReview: parseWeeklyPlanAiReviewResponse(response),
    reviewer: buildReviewerMetadata(response, model),
  };
}

module.exports = {
  DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS,
  buildResponsesRequest,
  buildReviewerMetadata,
  isAIWeeklyPlanReviewEnabled,
  parseWeeklyPlanAiReviewResponse,
  resolveProgramReviewConfig,
  reviewWeeklyPlanAi,
};
