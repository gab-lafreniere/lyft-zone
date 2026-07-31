const OpenAI = require('openai');
const { getOpenAIClient } = require('../src/ai/openaiClient');

const SIMPLE_WEEKLY_PLAN_AI_DEFAULTS = Object.freeze({
  models: {
    call1: 'gpt-5.4-mini',
    call2: 'gpt-4.1-mini',
    call3: 'gpt-4.1-mini',
  },
  timeouts: {
    call1: 120000,
    call2: 60000,
    call3: 120000,
  },
  maxOutputTokens: {
    call1: 16000,
    call2: 3000,
    call3: 24000,
  },
});

const PROVIDER_DIAGNOSTIC_STRING_FIELDS = Object.freeze([
  'stage',
  'model',
  'requestId',
  'providerCode',
  'providerMessage',
  'responseStatus',
]);
const PROVIDER_MESSAGE_LIMIT = 2000;
const PROVIDER_RAW_OUTPUT_LIMIT = 8000;

class SimpleWeeklyPlanProviderError extends Error {
  constructor(code, message, providerDiagnostics = null) {
    super(message);
    this.name = 'SimpleWeeklyPlanProviderError';
    this.code = code;
    if (providerDiagnostics) {
      this.providerDiagnostics = providerDiagnostics;
    }
  }
}

function sanitizeProviderDiagnosticText(value, limit) {
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = value
    .replace(
      /authorization\s*:\s*bearer\s+\S+/gi,
      'Authorization: [REDACTED]'
    )
    .replace(/\bbearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g,
      '[REDACTED_API_KEY]'
    )
    .trim();
  if (!sanitized) {
    return null;
  }
  return sanitized.length > limit
    ? `${sanitized.slice(0, limit)}…[truncated]`
    : sanitized;
}

function sanitizeProviderDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const sanitized = {};

  PROVIDER_DIAGNOSTIC_STRING_FIELDS.forEach((field) => {
    const text = sanitizeProviderDiagnosticText(
      value[field],
      PROVIDER_MESSAGE_LIMIT
    );
    if (text) {
      sanitized[field] = text;
    }
  });
  if (Number.isInteger(value.httpStatus)) {
    sanitized.httpStatus = value.httpStatus;
  }
  const rawOutput = sanitizeProviderDiagnosticText(
    value.rawOutput,
    PROVIDER_RAW_OUTPUT_LIMIT
  );
  if (rawOutput) {
    sanitized.rawOutputAvailable = true;
    sanitized.rawOutput = rawOutput;
  } else if (value.rawOutputAvailable === false) {
    sanitized.rawOutputAvailable = false;
  }

  return Object.keys(sanitized).length ? sanitized : null;
}

function collectAvailableResponseText(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return null;
  }
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const parts = [];
  (Array.isArray(response.output) ? response.output : []).forEach((item) => {
    if (item?.type !== 'message' || !Array.isArray(item.content)) {
      return;
    }
    item.content.forEach((content) => {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    });
  });
  return parts.join('').trim() || null;
}

function buildProviderDiagnostics({
  stage,
  model,
  error = null,
  response = null,
}) {
  const providerError =
    response?.error && typeof response.error === 'object'
      ? response.error
      : error?.error && typeof error.error === 'object'
        ? error.error
        : null;
  const rawOutput = collectAvailableResponseText(response);
  const status = Number(error?.status);

  return sanitizeProviderDiagnostics({
    stage,
    model:
      typeof response?.model === 'string' && response.model.trim()
        ? response.model
        : model,
    requestId: error?.requestID || response?._request_id,
    ...(Number.isInteger(status) && status > 0
      ? { httpStatus: status }
      : {}),
    providerCode:
      providerError?.code ||
      (!(error instanceof SimpleWeeklyPlanProviderError)
        ? error?.code
        : null),
    providerMessage:
      providerError?.message ||
      (!(error instanceof SimpleWeeklyPlanProviderError)
        ? error?.message
        : null),
    responseStatus: response?.status,
    rawOutputAvailable: Boolean(rawOutput),
    rawOutput,
  });
}

function resolvePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveString(value, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;
}

function normalizeUsageToken(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeResponseUsage(usage) {
  return {
    inputTokens: normalizeUsageToken(usage?.input_tokens),
    cachedInputTokens: normalizeUsageToken(
      usage?.input_tokens_details?.cached_tokens
    ),
    outputTokens: normalizeUsageToken(usage?.output_tokens),
    reasoningTokens: normalizeUsageToken(
      usage?.output_tokens_details?.reasoning_tokens
    ),
    totalTokens: normalizeUsageToken(usage?.total_tokens),
  };
}

function resolveSimpleWeeklyPlanAiConfig(env = process.env, overrides = {}) {
  return {
    models: {
      call1: resolveString(
        overrides.models?.call1 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_1 ||
          env.OPENAI_MODEL_PROGRAM_GENERATION,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.models.call1
      ),
      call2: resolveString(
        overrides.models?.call2 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_2 ||
          env.OPENAI_MODEL_SMALL_TASK,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.models.call2
      ),
      call3: resolveString(
        overrides.models?.call3 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_3 ||
          env.OPENAI_MODEL_SMALL_TASK,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.models.call3
      ),
    },
    timeouts: {
      call1: resolvePositiveInteger(
        overrides.timeouts?.call1 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_1_MS,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.timeouts.call1
      ),
      call2: resolvePositiveInteger(
        overrides.timeouts?.call2 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_2_MS,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.timeouts.call2
      ),
      call3: resolvePositiveInteger(
        overrides.timeouts?.call3 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_3_MS,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.timeouts.call3
      ),
    },
    maxOutputTokens: {
      call1: resolvePositiveInteger(
        overrides.maxOutputTokens?.call1 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_1,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.maxOutputTokens.call1
      ),
      call2: resolvePositiveInteger(
        overrides.maxOutputTokens?.call2 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_2,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.maxOutputTokens.call2
      ),
      call3: resolvePositiveInteger(
        overrides.maxOutputTokens?.call3 ||
          env.OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_3,
        SIMPLE_WEEKLY_PLAN_AI_DEFAULTS.maxOutputTokens.call3
      ),
    },
  };
}

function collectResponseText(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new SimpleWeeklyPlanProviderError(
      'INVALID_PROVIDER_RESPONSE',
      'Provider returned an invalid response'
    );
  }
  if (response.status === 'failed' || response.error) {
    throw new SimpleWeeklyPlanProviderError(
      'PROVIDER_ERROR',
      'Provider returned an error'
    );
  }
  if (response.status === 'incomplete') {
    const code =
      response.incomplete_details?.reason === 'max_output_tokens'
        ? 'MAX_OUTPUT_TOKENS'
        : response.incomplete_details?.reason === 'content_filter'
          ? 'PROVIDER_REFUSAL'
          : 'INCOMPLETE_PROVIDER_RESPONSE';
    throw new SimpleWeeklyPlanProviderError(
      code,
      'Provider returned an incomplete response'
    );
  }
  if (response.status != null && response.status !== 'completed') {
    throw new SimpleWeeklyPlanProviderError(
      'INVALID_PROVIDER_RESPONSE',
      'Provider returned an invalid response status'
    );
  }

  if (typeof response.output_text === 'string') {
    if (!response.output_text.trim()) {
      throw new SimpleWeeklyPlanProviderError(
        'EMPTY_PROVIDER_RESPONSE',
        'Provider returned empty text'
      );
    }
    return response.output_text.trim();
  }

  const parts = [];
  (Array.isArray(response.output) ? response.output : []).forEach((item) => {
    if (item?.type === 'reasoning') {
      return;
    }
    if (item?.type !== 'message' || !Array.isArray(item.content)) {
      throw new SimpleWeeklyPlanProviderError(
        'INVALID_PROVIDER_RESPONSE',
        'Provider returned unexpected output'
      );
    }
    item.content.forEach((content) => {
      if (content?.type === 'refusal') {
        throw new SimpleWeeklyPlanProviderError(
          'PROVIDER_REFUSAL',
          'Provider refused the request'
        );
      }
      if (content?.type !== 'output_text' || typeof content.text !== 'string') {
        throw new SimpleWeeklyPlanProviderError(
          'INVALID_PROVIDER_RESPONSE',
          'Provider returned unexpected message content'
        );
      }
      parts.push(content.text);
    });
  });

  const text = parts.join('').trim();
  if (!text) {
    throw new SimpleWeeklyPlanProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'Provider returned empty text'
    );
  }
  return text;
}

function parseStructuredResponse(response) {
  const text = collectResponseText(response);
  let value;
  try {
    value = JSON.parse(text);
  } catch (_error) {
    throw new SimpleWeeklyPlanProviderError(
      'INVALID_PROVIDER_JSON',
      'Provider returned invalid JSON'
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SimpleWeeklyPlanProviderError(
      'INVALID_PROVIDER_JSON',
      'Provider JSON must be an object'
    );
  }
  return value;
}

function buildSimpleWeeklyPlanResponsesRequest({
  model,
  systemMessage,
  userMessage,
  schema,
  formatName,
  maxOutputTokens,
}) {
  const request = {
    model,
    instructions: systemMessage,
    input: userMessage,
    max_output_tokens: maxOutputTokens,
    store: false,
  };
  if (schema) {
    request.text = {
      format: {
        type: 'json_schema',
        name: formatName,
        strict: true,
        schema,
      },
    };
  }
  return request;
}

function assertSafeModelInputArtifact(text) {
  const unsafePatterns = [
    /authorization\s*:\s*bearer\s+\S+/i,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(text))) {
    throw new SimpleWeeklyPlanProviderError(
      'UNSAFE_MODEL_INPUT_ARTIFACT',
      'Model input artifact contains credential-like material'
    );
  }
}

function renderSimpleWeeklyPlanModelInput(options) {
  const request = buildSimpleWeeklyPlanResponsesRequest(options);
  const sections = [
    'SYSTEM MESSAGE',
    request.instructions,
    '',
    'USER MESSAGE',
    request.input,
  ];

  if (request.text?.format) {
    sections.push(
      '',
      'STRUCTURED OUTPUT CONFIGURATION',
      JSON.stringify(request.text.format, null, 2)
    );
  }

  sections.push(
    '',
    'MODEL INPUT METADATA',
    `model: ${request.model}`,
    `responseFormat: ${
      request.text?.format?.type === 'json_schema'
        ? 'json_schema'
        : 'text'
    }`,
    `maxOutputTokens: ${request.max_output_tokens}`
  );

  const artifact = sections.join('\n');
  assertSafeModelInputArtifact(artifact);
  return artifact;
}

function mapProviderError(error, didTimeout, context = {}) {
  const providerDiagnostics = buildProviderDiagnostics({
    ...context,
    error,
  });
  if (error instanceof SimpleWeeklyPlanProviderError) {
    return new SimpleWeeklyPlanProviderError(
      error.code,
      error.message,
      providerDiagnostics
    );
  }
  const status = Number(error?.status);
  if (
    didTimeout ||
    error instanceof OpenAI.APIConnectionTimeoutError ||
    status === 408
  ) {
    return new SimpleWeeklyPlanProviderError(
      'PROVIDER_TIMEOUT',
      'Provider request timed out',
      providerDiagnostics
    );
  }
  if (error instanceof OpenAI.RateLimitError || status === 429) {
    return new SimpleWeeklyPlanProviderError(
      'PROVIDER_RATE_LIMITED',
      'Provider is temporarily rate limited',
      providerDiagnostics
    );
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    status === 401 ||
    status === 403
  ) {
    return new SimpleWeeklyPlanProviderError(
      'PROVIDER_AUTH_FAILED',
      'Provider authentication failed',
      providerDiagnostics
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new SimpleWeeklyPlanProviderError(
      'PROVIDER_UNAVAILABLE',
      'Provider is unavailable',
      providerDiagnostics
    );
  }
  return new SimpleWeeklyPlanProviderError(
    'PROVIDER_ERROR',
    'Provider request failed',
    providerDiagnostics
  );
}

function createSimpleWeeklyPlanOpenAIProvider({
  openAIClient,
  getClient = getOpenAIClient,
} = {}) {
  return {
    async generate({
      stage,
      model,
      systemMessage,
      userMessage,
      schema = null,
      formatName = null,
      timeoutMs,
      maxOutputTokens,
    }) {
      const client = openAIClient || getClient();
      if (typeof client?.responses?.create !== 'function') {
        throw new SimpleWeeklyPlanProviderError(
          'PROVIDER_UNAVAILABLE',
          'Provider is unavailable',
          buildProviderDiagnostics({ stage, model })
        );
      }
      const controller = new AbortController();
      let didTimeout = false;
      const timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, timeoutMs);
      let response;

      try {
        response = await client.responses.create(
          buildSimpleWeeklyPlanResponsesRequest({
            model,
            systemMessage,
            userMessage,
            schema,
            formatName,
            maxOutputTokens,
          }),
          { signal: controller.signal }
        );
      } catch (error) {
        throw mapProviderError(error, didTimeout, { stage, model });
      } finally {
        clearTimeout(timer);
      }

      try {
        return {
          value: schema
            ? parseStructuredResponse(response)
            : collectResponseText(response),
          model:
            typeof response?.model === 'string' && response.model.trim()
              ? response.model.trim()
              : model,
          usage: normalizeResponseUsage(response?.usage),
        };
      } catch (error) {
        throw mapProviderError(error, false, {
          stage,
          model,
          response,
        });
      }
    },
  };
}

module.exports = {
  SIMPLE_WEEKLY_PLAN_AI_DEFAULTS,
  SimpleWeeklyPlanProviderError,
  assertSafeModelInputArtifact,
  buildSimpleWeeklyPlanResponsesRequest,
  buildProviderDiagnostics,
  collectResponseText,
  createSimpleWeeklyPlanOpenAIProvider,
  normalizeResponseUsage,
  parseStructuredResponse,
  renderSimpleWeeklyPlanModelInput,
  resolveSimpleWeeklyPlanAiConfig,
  sanitizeProviderDiagnostics,
};
