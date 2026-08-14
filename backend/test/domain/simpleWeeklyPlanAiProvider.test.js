const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIMPLE_WEEKLY_PLAN_AI_DEFAULTS,
  buildSimpleWeeklyPlanResponsesRequest,
  collectResponseText,
  createSimpleWeeklyPlanOpenAIProvider,
  normalizeResponseUsage,
  parseStructuredResponse,
  renderSimpleWeeklyPlanModelInput,
  resolveSimpleWeeklyPlanAiConfig,
  sanitizeProviderDiagnostics,
} = require('../../services/simpleWeeklyPlanAiProvider');

test('provider configuration has isolated defaults and accepts pipeline-specific overrides', () => {
  assert.deepEqual(
    resolveSimpleWeeklyPlanAiConfig({}),
    SIMPLE_WEEKLY_PLAN_AI_DEFAULTS
  );
  assert.deepEqual(
    resolveSimpleWeeklyPlanAiConfig({
      OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_1: 'model-one',
      OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_2: 'model-two',
      OPENAI_SIMPLE_WEEKLY_PLAN_MODEL_3: 'model-three',
      OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_1_MS: '101',
      OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_2_MS: '102',
      OPENAI_SIMPLE_WEEKLY_PLAN_TIMEOUT_3_MS: '103',
      OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_1: '201',
      OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_2: '202',
      OPENAI_SIMPLE_WEEKLY_PLAN_MAX_OUTPUT_TOKENS_3: '203',
    }),
    {
      deterministicFillsEnabled: true,
      // Bound Plan migration defaults: the current production path stays selected
      // until the flags are flipped explicitly.
      extractionMode: 'GEOMETRY_ONLY',
      recoveryLevel: 'OFF',
      models: {
        call1: 'model-one',
        call2: 'model-two',
        call3: 'model-three',
      },
      timeouts: { call1: 101, call2: 102, call3: 103 },
      maxOutputTokens: { call1: 201, call2: 202, call3: 203 },
    }
  );
  assert.equal(
    resolveSimpleWeeklyPlanAiConfig({
      SIMPLE_WEEKLY_PLAN_DETERMINISTIC_FILLS_ENABLED: 'false',
    }).deterministicFillsEnabled,
    false
  );
});

test('plain and Structured Output requests use the minimal Responses API shape', () => {
  const plain = buildSimpleWeeklyPlanResponsesRequest({
    model: 'model',
    systemMessage: 'system',
    userMessage: 'user',
    maxOutputTokens: 50,
  });
  assert.deepEqual(plain, {
    model: 'model',
    instructions: 'system',
    input: 'user',
    max_output_tokens: 50,
    store: false,
  });

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  };
  const structured = buildSimpleWeeklyPlanResponsesRequest({
    model: 'model',
    systemMessage: 'system',
    userMessage: 'user',
    schema,
    formatName: 'format_name',
    maxOutputTokens: 75,
  });
  assert.deepEqual(structured.text, {
    format: {
      type: 'json_schema',
      name: 'format_name',
      strict: true,
      schema,
    },
  });
});

test('observable model input renders the exact semantic request fields', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  };
  const options = {
    model: 'model-observed',
    systemMessage: 'Exact system message',
    userMessage: 'Exact user message',
    schema,
    formatName: 'observed_shape',
    maxOutputTokens: 321,
  };
  const request = buildSimpleWeeklyPlanResponsesRequest(options);
  const artifact = renderSimpleWeeklyPlanModelInput(options);
  const structuredConfiguration = artifact
    .split('STRUCTURED OUTPUT CONFIGURATION\n')[1]
    .split('\n\nMODEL INPUT METADATA')[0];

  assert.ok(artifact.includes(`SYSTEM MESSAGE\n${request.instructions}`));
  assert.ok(artifact.includes(`USER MESSAGE\n${request.input}`));
  assert.deepEqual(
    JSON.parse(structuredConfiguration),
    request.text.format
  );
  assert.ok(artifact.includes('model: model-observed'));
  assert.ok(artifact.includes('responseFormat: json_schema'));
  assert.ok(artifact.includes('maxOutputTokens: 321'));
  assert.equal(artifact.includes('Authorization'), false);
  assert.equal(artifact.includes('requestId'), false);
});

test('model input rendering fails closed on credential-like material', () => {
  assert.throws(
    () =>
      renderSimpleWeeklyPlanModelInput({
        model: 'model',
        systemMessage:
          'Authorization: Bearer credential-value-that-is-secret',
        userMessage: 'user',
        maxOutputTokens: 50,
      }),
    (error) => error.code === 'UNSAFE_MODEL_INPUT_ARTIFACT'
  );
});

test('provider returns useful text or parsed JSON without provider envelopes', async () => {
  const requests = [];
  const responses = [
    {
      status: 'completed',
      model: 'resolved-one',
      output_text: '  useful plan text  ',
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 1 },
        total_tokens: 14,
      },
      secretProviderEnvelope: 'must-not-be-returned',
    },
    {
      status: 'completed',
      model: 'resolved-two',
      output_text: '{"value":"structured"}',
      usage: {
        input_tokens: 20,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 28,
      },
    },
  ];
  const provider = createSimpleWeeklyPlanOpenAIProvider({
    openAIClient: {
      responses: {
        async create(request, options) {
          requests.push({ request, options });
          return responses.shift();
        },
      },
    },
  });

  const textResult = await provider.generate({
    model: 'one',
    systemMessage: 'system',
    userMessage: 'user',
    timeoutMs: 1000,
    maxOutputTokens: 50,
  });
  const structuredResult = await provider.generate({
    model: 'two',
    systemMessage: 'system',
    userMessage: 'user',
    schema: { type: 'object' },
    formatName: 'shape',
    timeoutMs: 1000,
    maxOutputTokens: 50,
  });

  assert.deepEqual(textResult, {
    value: 'useful plan text',
    model: 'resolved-one',
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 4,
      reasoningTokens: 1,
      totalTokens: 14,
    },
  });
  assert.deepEqual(structuredResult, {
    value: { value: 'structured' },
    model: 'resolved-two',
    usage: {
      inputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 8,
      reasoningTokens: 0,
      totalTokens: 28,
    },
  });
  assert.deepEqual(Object.keys(textResult).sort(), ['model', 'usage', 'value']);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ options }) => options.signal));
});

test('usage normalization preserves only non-negative safe integers', () => {
  assert.deepEqual(
    normalizeResponseUsage({
      input_tokens: 0,
      input_tokens_details: { cached_tokens: -1 },
      output_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens_details: { reasoning_tokens: 1.5 },
      total_tokens: '10',
      secret: 'not retained',
    }),
    {
      inputTokens: 0,
      cachedInputTokens: null,
      outputTokens: Number.MAX_SAFE_INTEGER,
      reasoningTokens: null,
      totalTokens: null,
    }
  );
  assert.deepEqual(normalizeResponseUsage(null), {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  });
});

test('provider parsing rejects invalid JSON, refusal, empty, and incomplete output', () => {
  assert.throws(
    () => parseStructuredResponse({ status: 'completed', output_text: '{' }),
    (error) => error.code === 'INVALID_PROVIDER_JSON'
  );
  assert.throws(
    () =>
      collectResponseText({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'no' }],
          },
        ],
      }),
    (error) => error.code === 'PROVIDER_REFUSAL'
  );
  assert.throws(
    () => collectResponseText({ status: 'completed', output_text: ' ' }),
    (error) => error.code === 'EMPTY_PROVIDER_RESPONSE'
  );
  assert.throws(
    () =>
      collectResponseText({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    (error) => error.code === 'MAX_OUTPUT_TOKENS'
  );
});

test('SDK errors retain only cleaned provider diagnostics', async () => {
  const sdkError = Object.assign(
    new Error('HTTP request failed with secret transport context'),
    {
      status: 429,
      requestID: 'req_rate_limit',
      code: 'rate_limit_exceeded',
      error: {
        code: 'rate_limit_exceeded',
        message:
          'Rate limit reached Authorization: Bearer hidden-token sk-proj-hiddencredential',
      },
      headers: {
        authorization: 'Bearer hidden-header-token',
      },
    }
  );
  const provider = createSimpleWeeklyPlanOpenAIProvider({
    openAIClient: {
      responses: {
        async create() {
          throw sdkError;
        },
      },
    },
  });

  await assert.rejects(
    provider.generate({
      stage: 'CALL_3_FILLS',
      model: 'model-three',
      systemMessage: 'system',
      userMessage: 'user',
      timeoutMs: 1000,
      maxOutputTokens: 50,
    }),
    (error) => {
      assert.equal(error.code, 'PROVIDER_RATE_LIMITED');
      assert.deepEqual(error.providerDiagnostics, {
        stage: 'CALL_3_FILLS',
        model: 'model-three',
        requestId: 'req_rate_limit',
        providerCode: 'rate_limit_exceeded',
        providerMessage:
          'Rate limit reached Authorization: [REDACTED] [REDACTED_API_KEY]',
        httpStatus: 429,
        rawOutputAvailable: false,
      });
      const serialized = JSON.stringify(error.providerDiagnostics);
      assert.equal(serialized.includes('hidden-token'), false);
      assert.equal(serialized.includes('hiddencredential'), false);
      assert.equal(serialized.includes('headers'), false);
      assert.equal(serialized.includes('stack'), false);
      return true;
    }
  );
});

test('timeout before a response reports no model raw output', async () => {
  const provider = createSimpleWeeklyPlanOpenAIProvider({
    openAIClient: {
      responses: {
        async create() {
          throw Object.assign(new Error('Request timed out'), { status: 408 });
        },
      },
    },
  });

  await assert.rejects(
    provider.generate({
      stage: 'CALL_3_FILLS',
      model: 'model-three',
      systemMessage: 'system',
      userMessage: 'user',
      timeoutMs: 1000,
      maxOutputTokens: 50,
    }),
    (error) => {
      assert.equal(error.code, 'PROVIDER_TIMEOUT');
      assert.equal(error.providerDiagnostics.rawOutputAvailable, false);
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          error.providerDiagnostics,
          'rawOutput'
        ),
        false
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          error.providerDiagnostics,
          'responseStatus'
        ),
        false
      );
      return true;
    }
  );
});

test('partial provider text is cleaned and truncated only when received', async () => {
  const response = {
    status: 'completed',
    model: 'resolved-three',
    output_text:
      `{"partial":"Authorization: Bearer hidden-token ` +
      `sk-proj-hiddencredential ${'x'.repeat(9000)}`,
    _request_id: 'req_partial',
  };
  const provider = createSimpleWeeklyPlanOpenAIProvider({
    openAIClient: {
      responses: {
        async create() {
          return response;
        },
      },
    },
  });

  await assert.rejects(
    provider.generate({
      stage: 'CALL_3_FILLS',
      model: 'model-three',
      systemMessage: 'system',
      userMessage: 'user',
      schema: { type: 'object' },
      formatName: 'fills',
      timeoutMs: 1000,
      maxOutputTokens: 50,
    }),
    (error) => {
      const diagnostics = error.providerDiagnostics;
      assert.equal(error.code, 'INVALID_PROVIDER_JSON');
      assert.equal(diagnostics.stage, 'CALL_3_FILLS');
      assert.equal(diagnostics.model, 'resolved-three');
      assert.equal(diagnostics.requestId, 'req_partial');
      assert.equal(diagnostics.responseStatus, 'completed');
      assert.equal(diagnostics.rawOutputAvailable, true);
      assert.match(diagnostics.rawOutput, /\[REDACTED\]/);
      assert.match(diagnostics.rawOutput, /\[REDACTED_API_KEY\]/);
      assert.match(diagnostics.rawOutput, /…\[truncated\]$/);
      assert.equal(diagnostics.rawOutput.includes('hidden-token'), false);
      assert.equal(diagnostics.rawOutput.includes('hiddencredential'), false);
      assert.equal(diagnostics.rawOutput.length < 8100, true);
      return true;
    }
  );
});

test('diagnostic sanitization uses the authorized field allowlist', () => {
  assert.deepEqual(
    sanitizeProviderDiagnostics({
      stage: 'CALL_3_FILLS',
      model: 'model',
      rawOutputAvailable: false,
      headers: { authorization: 'Bearer secret' },
      stack: 'secret stack',
      cause: 'secret cause',
      request: 'full prompt',
      pool: 'full pool',
    }),
    {
      stage: 'CALL_3_FILLS',
      model: 'model',
      rawOutputAvailable: false,
    }
  );
});
