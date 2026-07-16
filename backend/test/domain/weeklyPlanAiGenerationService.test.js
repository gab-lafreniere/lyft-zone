const test = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai');

const {
  DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS,
  DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS,
  generateWeeklyPlanAiOutput,
  parseWeeklyPlanAiResponse,
  resolveProgramGenerationConfig,
} = require('../../services/weeklyPlanAiGenerationService');

function createPromptDescriptor() {
  return {
    promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.0',
    systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
    userMessage: 'USER_MESSAGE_SENTINEL',
  };
}

function createSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['planName'],
    properties: {
      planName: { type: 'string' },
    },
  };
}

function createResponse(overrides = {}) {
  return {
    id: 'resp_weekly_plan_123',
    model: 'returned-program-model',
    status: 'completed',
    output_text: JSON.stringify({ planName: 'AI Draft' }),
    output: [],
    ...overrides,
  };
}

function createClient(response, capture = {}) {
  return {
    responses: {
      create: async (request, options) => {
        capture.callCount = (capture.callCount || 0) + 1;
        capture.request = request;
        capture.options = options;
        return response;
      },
    },
  };
}

function createRejectingClient(error, capture = {}) {
  return {
    responses: {
      create: async () => {
        capture.callCount = (capture.callCount || 0) + 1;
        throw error;
      },
    },
  };
}

function createTimerDeps(capture = {}) {
  return {
    setTimeout: (_callback, delay) => {
      capture.timeoutDelay = delay;
      return 'timer-token';
    },
    clearTimeout: (timer) => {
      capture.clearedTimer = timer;
    },
  };
}

test('generateWeeklyPlanAiOutput builds the model-agnostic Responses API request', async () => {
  const capture = {};
  let routedTask = null;
  let getClientCalled = false;
  const schema = createSchema();
  const promptDescriptor = createPromptDescriptor();

  const result = await generateWeeklyPlanAiOutput(
    { promptDescriptor, schema },
    {
      env: {},
      openaiClient: createClient(createResponse(), capture),
      getOpenAIClient: () => {
        getClientCalled = true;
        throw new Error('must not be called');
      },
      getModelForTask: (task) => {
        routedTask = task;
        return 'requested-program-model';
      },
      ...createTimerDeps(capture),
    }
  );

  assert.equal(getClientCalled, false);
  assert.equal(routedTask, 'program_generation');
  assert.deepEqual(capture.request, {
    model: 'requested-program-model',
    instructions: promptDescriptor.systemMessage,
    input: promptDescriptor.userMessage,
    text: {
      format: {
        type: 'json_schema',
        name: 'weekly_plan_ai_v1',
        strict: true,
        schema,
      },
    },
    max_output_tokens: DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS,
    store: false,
  });
  assert.deepEqual(Object.keys(capture.options), ['signal']);
  assert.ok(capture.options.signal);
  assert.equal(capture.timeoutDelay, DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS);
  assert.equal(capture.clearedTimer, 'timer-token');
  assert.deepEqual(result.generatedAIOutput, { planName: 'AI Draft' });
  assert.equal(result.generator.type, 'openai');
  assert.equal(result.generator.model, 'returned-program-model');
  assert.equal(result.generator.responseId, 'resp_weekly_plan_123');
  assert.deepEqual(result.generator.usage, {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
  });
});

test('generateWeeklyPlanAiOutput applies valid timeout and output token overrides', async () => {
  const capture = {};

  await generateWeeklyPlanAiOutput(
    {
      promptDescriptor: createPromptDescriptor(),
      schema: createSchema(),
    },
    {
      env: {
        OPENAI_PROGRAM_GENERATION_TIMEOUT_MS: '45000',
        OPENAI_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS: '32000',
      },
      openaiClient: createClient(createResponse(), capture),
      getModelForTask: () => 'program-model',
      ...createTimerDeps(capture),
    }
  );

  assert.equal(capture.timeoutDelay, 45000);
  assert.equal(capture.request.max_output_tokens, 32000);
});

test('resolveProgramGenerationConfig falls back for absent or invalid values', async (t) => {
  const invalidValues = [undefined, '', 'abc', '0', '-1', '1.5', 'Infinity', '9007199254740992'];

  for (const value of invalidValues) {
    await t.test(`invalid value ${String(value)}`, () => {
      const config = resolveProgramGenerationConfig({
        OPENAI_PROGRAM_GENERATION_TIMEOUT_MS: value,
        OPENAI_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS: value,
      });

      assert.deepEqual(config, {
        timeoutMs: DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS,
        maxOutputTokens: DEFAULT_PROGRAM_GENERATION_MAX_OUTPUT_TOKENS,
      });
    });
  }
});

test('generateWeeklyPlanAiOutput rejects missing production API key before client resolution', async () => {
  let getClientCalled = false;

  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: {},
          getOpenAIClient: () => {
            getClientCalled = true;
          },
          getModelForTask: () => 'program-model',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE');
      assert.equal(error.details, undefined);
      return true;
    }
  );

  assert.equal(getClientCalled, false);
});

test('generateWeeklyPlanAiOutput maps production client initialization failures', async () => {
  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: { OPENAI_API_KEY: 'test-key-sentinel' },
          getOpenAIClient: () => {
            throw new Error('PRIVATE_CLIENT_INITIALIZATION_SENTINEL');
          },
          getModelForTask: () => 'program-model',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE');
      assert.doesNotMatch(error.message, /PRIVATE_CLIENT_INITIALIZATION_SENTINEL/);
      return true;
    }
  );
});

test('generateWeeklyPlanAiOutput rejects an empty routed model without calling the provider', async () => {
  const capture = {};

  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: {},
          openaiClient: createClient(createResponse(), capture),
          getModelForTask: (task) => {
            assert.equal(task, 'program_generation');
            return '   ';
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_MODEL_UNAVAILABLE');
      return true;
    }
  );

  assert.equal(capture.callCount || 0, 0);
});

test('parseWeeklyPlanAiResponse parses response.output_text JSON exactly once', () => {
  const aiOutput = {
    planName: 'Raw provider output',
    workouts: [],
  };

  const parsed = parseWeeklyPlanAiResponse(
    createResponse({
      output_text: JSON.stringify(aiOutput),
      output: [],
    })
  );

  assert.deepEqual(parsed, aiOutput);
});

test('parseWeeklyPlanAiResponse concatenates output_text parts across messages', () => {
  const response = createResponse({
    output: [
      {
        type: 'reasoning',
        summary: [],
      },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"planName":' }],
      },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '"Split output"}' }],
      },
    ],
  });
  delete response.output_text;

  const parsed = parseWeeklyPlanAiResponse(response);

  assert.deepEqual(parsed, { planName: 'Split output' });
});

test('parseWeeklyPlanAiResponse maps invalid response conditions', async (t) => {
  const cases = [
    {
      name: 'null response',
      response: null,
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'failed response',
      response: createResponse({ status: 'failed' }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_PROVIDER_ERROR',
    },
    {
      name: 'max output tokens',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_MAX_OUTPUT_TOKENS',
    },
    {
      name: 'content filter',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REFUSED',
    },
    {
      name: 'other incomplete reason',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'other' },
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INCOMPLETE_RESPONSE',
    },
    {
      name: 'explicit refusal',
      response: createResponse({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'refusal',
                refusal: 'PRIVATE_REFUSAL_TEXT_SENTINEL',
              },
            ],
          },
        ],
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REFUSED',
    },
    {
      name: 'empty output array',
      response: createResponse({ output_text: '', output: [] }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_EMPTY_RESPONSE',
    },
    {
      name: 'whitespace output text',
      response: createResponse({ output_text: '   ', output: [] }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_EMPTY_RESPONSE',
    },
    {
      name: 'invalid JSON',
      response: createResponse({ output_text: '{bad', output: [] }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_JSON',
    },
    {
      name: 'JSON array',
      response: createResponse({ output_text: '[]', output: [] }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'JSON null',
      response: createResponse({ output_text: 'null', output: [] }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'unexpected output item',
      response: createResponse({
        output: [{ type: 'function_call', name: 'unexpected' }],
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'reasoning only',
      response: createResponse({
        output_text: '',
        output: [{ type: 'reasoning', summary: [] }],
      }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_EMPTY_RESPONSE',
    },
    {
      name: 'non-terminal status',
      response: createResponse({ status: 'in_progress' }),
      status: 502,
      code: 'AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.throws(
        () => parseWeeklyPlanAiResponse(entry.response),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(error.message, /PRIVATE_REFUSAL_TEXT_SENTINEL/);
          assert.equal(error.details, undefined);
          return true;
        }
      );
    });
  }
});

test('generateWeeklyPlanAiOutput extracts compact provider metadata and usage', async () => {
  const result = await generateWeeklyPlanAiOutput(
    {
      promptDescriptor: createPromptDescriptor(),
      schema: createSchema(),
    },
    {
      env: {},
      openaiClient: createClient(
        createResponse({
          id: 'resp_usage_123',
          model: 'actual-provider-model',
          usage: {
            input_tokens: 1200,
            output_tokens: 800,
            total_tokens: 2000,
            output_tokens_details: {
              reasoning_tokens: 250,
            },
          },
        })
      ),
      getModelForTask: () => 'requested-provider-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(result.generator, {
    type: 'openai',
    model: 'actual-provider-model',
    responseId: 'resp_usage_123',
    usage: {
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      reasoningTokens: 250,
    },
  });
});

test('generateWeeklyPlanAiOutput normalizes missing provider metadata to safe fallbacks', async () => {
  const result = await generateWeeklyPlanAiOutput(
    {
      promptDescriptor: createPromptDescriptor(),
      schema: createSchema(),
    },
    {
      env: {},
      openaiClient: createClient(
        createResponse({
          id: null,
          model: ' ',
          usage: {
            input_tokens: -1,
            output_tokens: 1.5,
            total_tokens: '2000',
            output_tokens_details: {},
          },
        })
      ),
      getModelForTask: () => 'requested-provider-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(result.generator, {
    type: 'openai',
    model: 'requested-provider-model',
    responseId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
});

test('generateWeeklyPlanAiOutput maps installed SDK error classes without application retries', async (t) => {
  const headers = new Headers({ 'x-request-id': 'req_private_123' });
  const cases = [
    {
      name: 'connection timeout',
      error: new OpenAI.APIConnectionTimeoutError({ message: 'PROVIDER_SECRET_SENTINEL' }),
      status: 504,
      code: 'AI_WEEKLY_PLAN_GENERATION_TIMEOUT',
    },
    {
      name: 'rate limit',
      error: new OpenAI.RateLimitError(
        429,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_PROVIDER_RATE_LIMITED',
    },
    {
      name: 'authentication',
      error: new OpenAI.AuthenticationError(
        401,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_PROVIDER_AUTH_FAILED',
    },
    {
      name: 'permission',
      error: new OpenAI.PermissionDeniedError(
        403,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_PROVIDER_AUTH_FAILED',
    },
    {
      name: 'network',
      error: new OpenAI.APIConnectionError({
        message: 'PROVIDER_SECRET_SENTINEL',
        cause: new Error('PRIVATE_NETWORK_CAUSE'),
      }),
      status: 503,
      code: 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
    },
    {
      name: 'provider 5xx',
      error: new OpenAI.InternalServerError(
        500,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_PROVIDER_ERROR',
    },
    {
      name: 'bad request',
      error: new OpenAI.BadRequestError(
        400,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 500,
      code: 'AI_WEEKLY_PLAN_PROVIDER_REQUEST_INVALID',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const capture = {};

      await assert.rejects(
        () =>
          generateWeeklyPlanAiOutput(
            {
              promptDescriptor: createPromptDescriptor(),
              schema: createSchema(),
            },
            {
              env: {},
              openaiClient: createRejectingClient(entry.error, capture),
              getModelForTask: () => 'program-model',
              ...createTimerDeps(capture),
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(error.message, /PROVIDER_SECRET_SENTINEL/);
          assert.equal(error.details, undefined);
          return true;
        }
      );

      assert.equal(capture.callCount, 1);
      assert.equal(capture.clearedTimer, 'timer-token');
    });
  }
});

test('generateWeeklyPlanAiOutput distinguishes the application timeout from another abort', async () => {
  const timeoutCapture = {};
  const timeoutClient = {
    responses: {
      create: async (_request, options) => {
        timeoutCapture.callCount = (timeoutCapture.callCount || 0) + 1;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new OpenAI.APIUserAbortError());
          });
        });
      },
    },
  };

  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: {},
          openaiClient: timeoutClient,
          getModelForTask: () => 'program-model',
          setTimeout: (callback, delay) => {
            timeoutCapture.timeoutDelay = delay;
            queueMicrotask(callback);
            return 'timeout-token';
          },
          clearTimeout: (timer) => {
            timeoutCapture.clearedTimer = timer;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 504);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_GENERATION_TIMEOUT');
      return true;
    }
  );

  assert.equal(timeoutCapture.callCount, 1);
  assert.equal(timeoutCapture.timeoutDelay, DEFAULT_PROGRAM_GENERATION_TIMEOUT_MS);
  assert.equal(timeoutCapture.clearedTimer, 'timeout-token');

  const abortCapture = {};
  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: {},
          openaiClient: createRejectingClient(new OpenAI.APIUserAbortError(), abortCapture),
          getModelForTask: () => 'program-model',
          ...createTimerDeps(abortCapture),
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE');
      return true;
    }
  );

  assert.equal(abortCapture.callCount, 1);
  assert.equal(abortCapture.clearedTimer, 'timer-token');
});

test('generateWeeklyPlanAiOutput rejects an explicitly injected unusable client', async () => {
  await assert.rejects(
    () =>
      generateWeeklyPlanAiOutput(
        {
          promptDescriptor: createPromptDescriptor(),
          schema: createSchema(),
        },
        {
          env: {},
          openaiClient: null,
          getModelForTask: () => 'program-model',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE');
      return true;
    }
  );
});
