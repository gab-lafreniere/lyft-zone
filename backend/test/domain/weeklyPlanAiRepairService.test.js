const test = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai');

const {
  DEFAULT_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS,
  DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS,
  WEEKLY_PLAN_AI_REPAIR_RESPONSE_FORMAT_NAME,
  buildProgramRepairResponsesRequest,
  parseWeeklyPlanAiRepairResponse,
  repairWeeklyPlanAi,
  resolveProgramRepairConfig,
} = require('../../services/weeklyPlanAiRepairService');

function createPromptDescriptor() {
  return {
    promptVersion: 'ai-weekly-plan-repair-prompt-v1.0.0',
    systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
    userMessage: 'USER_MESSAGE_SENTINEL',
  };
}

function createSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'workouts'],
    properties: {
      schemaVersion: { type: 'integer', enum: [1] },
      workouts: { type: 'array' },
    },
  };
}

function createRepairedOutput() {
  return {
    schemaVersion: 1,
    strategySummary: 'Repaired complete weekly plan.',
    workouts: [],
  };
}

function createResponse(overrides = {}) {
  return {
    id: 'resp_weekly_plan_repair_123',
    model: 'returned-repair-model',
    status: 'completed',
    output_text: JSON.stringify(createRepairedOutput()),
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
    setTimeout: (callback, delay) => {
      capture.timerCallback = callback;
      capture.timeoutDelay = delay;
      return 'repair-timer-token';
    },
    clearTimeout: (timer) => {
      capture.clearCount = (capture.clearCount || 0) + 1;
      capture.clearedTimer = timer;
    },
  };
}

test('repair configuration exports exact defaults and accepts positive safe integers', () => {
  assert.equal(DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS, 120000);
  assert.equal(DEFAULT_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS, 24000);
  assert.equal(
    WEEKLY_PLAN_AI_REPAIR_RESPONSE_FORMAT_NAME,
    'weekly_plan_ai_repair_v1'
  );
  assert.deepEqual(resolveProgramRepairConfig({}), {
    timeoutMs: 120000,
    maxOutputTokens: 24000,
  });
  assert.deepEqual(
    resolveProgramRepairConfig({
      OPENAI_PROGRAM_REPAIR_TIMEOUT_MS: '45000',
      OPENAI_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS: '32000',
    }),
    {
      timeoutMs: 45000,
      maxOutputTokens: 32000,
    }
  );
});

test('repair configuration falls back at call time for absent and invalid values', async (t) => {
  const invalidValues = [
    undefined,
    '',
    'abc',
    '0',
    '-1',
    '1.5',
    'Infinity',
    '9007199254740992',
  ];

  for (const value of invalidValues) {
    await t.test(`invalid value ${String(value)}`, () => {
      assert.deepEqual(
        resolveProgramRepairConfig({
          OPENAI_PROGRAM_REPAIR_TIMEOUT_MS: value,
          OPENAI_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS: value,
        }),
        {
          timeoutMs: DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS,
          maxOutputTokens: DEFAULT_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS,
        }
      );
    });
  }

  const env = {};
  assert.equal(
    resolveProgramRepairConfig(env).timeoutMs,
    DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS
  );
  env.OPENAI_PROGRAM_REPAIR_TIMEOUT_MS = '32100';
  assert.equal(resolveProgramRepairConfig(env).timeoutMs, 32100);
});

test('buildProgramRepairResponsesRequest creates the exact model-agnostic request', () => {
  const promptDescriptor = createPromptDescriptor();
  const schema = createSchema();
  const request = buildProgramRepairResponsesRequest({
    model: 'repair-model',
    promptDescriptor,
    schema,
    maxOutputTokens: 24000,
  });

  assert.deepEqual(request, {
    model: 'repair-model',
    instructions: promptDescriptor.systemMessage,
    input: promptDescriptor.userMessage,
    text: {
      format: {
        type: 'json_schema',
        name: 'weekly_plan_ai_repair_v1',
        strict: true,
        schema,
      },
    },
    max_output_tokens: 24000,
    store: false,
  });
  assert.strictEqual(request.text.format.schema, schema);
  assert.deepEqual(Object.keys(request), [
    'model',
    'instructions',
    'input',
    'text',
    'max_output_tokens',
    'store',
  ]);
});

test('repairWeeklyPlanAi routes program_repair and makes exactly one strict provider call', async () => {
  const capture = {};
  const promptDescriptor = createPromptDescriptor();
  const schema = createSchema();
  let routedTask = null;
  let productionClientCalled = false;

  const result = await repairWeeklyPlanAi(
    { promptDescriptor, schema },
    {
      env: {},
      openaiClient: createClient(createResponse(), capture),
      getOpenAIClient: () => {
        productionClientCalled = true;
        throw new Error('must not be called');
      },
      getModelForTask: (task) => {
        routedTask = task;
        return 'requested-repair-model';
      },
      ...createTimerDeps(capture),
    }
  );

  assert.equal(productionClientCalled, false);
  assert.equal(routedTask, 'program_repair');
  assert.equal(capture.callCount, 1);
  assert.deepEqual(capture.request, {
    model: 'requested-repair-model',
    instructions: promptDescriptor.systemMessage,
    input: promptDescriptor.userMessage,
    text: {
      format: {
        type: 'json_schema',
        name: 'weekly_plan_ai_repair_v1',
        strict: true,
        schema,
      },
    },
    max_output_tokens: DEFAULT_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS,
    store: false,
  });
  assert.strictEqual(capture.request.text.format.schema, schema);
  assert.deepEqual(Object.keys(capture.options), ['signal', 'maxRetries']);
  assert.ok(capture.options.signal instanceof AbortSignal);
  assert.equal(capture.options.maxRetries, 0);
  assert.equal(capture.timeoutDelay, DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS);
  assert.equal(capture.clearedTimer, 'repair-timer-token');
  assert.equal(capture.clearCount, 1);
  assert.deepEqual(result.repairedAIOutput, createRepairedOutput());
  assert.equal(Object.hasOwn(result, 'response'), false);
  assert.equal(Object.hasOwn(result, 'outputText'), false);
});

test('repairWeeklyPlanAi resolves timeout and output token overrides per invocation', async () => {
  const firstCapture = {};
  const secondCapture = {};
  const env = {
    OPENAI_PROGRAM_REPAIR_TIMEOUT_MS: '41000',
    OPENAI_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS: '31000',
  };

  await repairWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env,
      openaiClient: createClient(createResponse(), firstCapture),
      getModelForTask: () => 'repair-model',
      ...createTimerDeps(firstCapture),
    }
  );

  env.OPENAI_PROGRAM_REPAIR_TIMEOUT_MS = '42000';
  env.OPENAI_PROGRAM_REPAIR_MAX_OUTPUT_TOKENS = '32000';
  await repairWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env,
      openaiClient: createClient(createResponse(), secondCapture),
      getModelForTask: () => 'repair-model',
      ...createTimerDeps(secondCapture),
    }
  );

  assert.equal(firstCapture.timeoutDelay, 41000);
  assert.equal(firstCapture.request.max_output_tokens, 31000);
  assert.equal(secondCapture.timeoutDelay, 42000);
  assert.equal(secondCapture.request.max_output_tokens, 32000);
});

test('repairWeeklyPlanAi rejects invalid requests, missing models, and unavailable clients before a provider call', async (t) => {
  const requestCases = [
    { promptDescriptor: null, schema: createSchema() },
    { promptDescriptor: createPromptDescriptor(), schema: null },
    {
      promptDescriptor: { ...createPromptDescriptor(), userMessage: '   ' },
      schema: createSchema(),
    },
  ];

  for (const input of requestCases) {
    await t.test('invalid provider request', async () => {
      await assert.rejects(
        () => repairWeeklyPlanAi(input, {}),
        (error) => {
          assert.equal(error.status, 500);
          assert.equal(
            error.code,
            'AI_WEEKLY_PLAN_REPAIR_PROVIDER_REQUEST_INVALID'
          );
          return true;
        }
      );
    });
  }

  await t.test('missing API key', async () => {
    let getClientCalled = false;
    await assert.rejects(
      () =>
        repairWeeklyPlanAi(
          { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
          {
            env: {},
            getOpenAIClient: () => {
              getClientCalled = true;
            },
            getModelForTask: () => 'repair-model',
          }
        ),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(
          error.code,
          'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE'
        );
        return true;
      }
    );
    assert.equal(getClientCalled, false);
  });

  await t.test('invalid injected client', async () => {
    await assert.rejects(
      () =>
        repairWeeklyPlanAi(
          { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
          {
            env: {},
            openaiClient: null,
            getModelForTask: () => 'repair-model',
          }
        ),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(
          error.code,
          'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE'
        );
        return true;
      }
    );
  });

  await t.test('invalid production client', async () => {
    await assert.rejects(
      () =>
        repairWeeklyPlanAi(
          { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
          {
            env: { OPENAI_API_KEY: 'PRIVATE_API_KEY_SENTINEL' },
            getOpenAIClient: () => ({ responses: {} }),
            getModelForTask: () => 'repair-model',
          }
        ),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(
          error.code,
          'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE'
        );
        assert.doesNotMatch(error.message, /PRIVATE_API_KEY_SENTINEL/);
        return true;
      }
    );
  });

  await t.test('missing model', async () => {
    const capture = {};
    await assert.rejects(
      () =>
        repairWeeklyPlanAi(
          { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
          {
            env: {},
            openaiClient: createClient(createResponse(), capture),
            getModelForTask: (task) => {
              assert.equal(task, 'program_repair');
              return '   ';
            },
          }
        ),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_MODEL_UNAVAILABLE');
        return true;
      }
    );
    assert.equal(capture.callCount || 0, 0);
  });
});

test('parseWeeklyPlanAiRepairResponse accepts output_text and fragmented messages after reasoning', () => {
  assert.deepEqual(
    parseWeeklyPlanAiRepairResponse(createResponse()),
    createRepairedOutput()
  );

  const response = createResponse({
    output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private' }] },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"schemaVersion":1,' }],
      },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '"workouts":[]}' }],
      },
    ],
  });
  delete response.output_text;

  assert.deepEqual(parseWeeklyPlanAiRepairResponse(response), {
    schemaVersion: 1,
    workouts: [],
  });
});

test('parseWeeklyPlanAiRepairResponse maps every controlled invalid response condition', async (t) => {
  const cases = [
    {
      name: 'null response',
      response: null,
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'array response',
      response: [],
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'failed response',
      response: createResponse({ status: 'failed' }),
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_ERROR',
    },
    {
      name: 'response error',
      response: createResponse({ error: { message: 'PRIVATE_RAW_ERROR' } }),
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_ERROR',
    },
    {
      name: 'incomplete max output tokens',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_MAX_OUTPUT_TOKENS',
    },
    {
      name: 'incomplete content filter',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_REFUSED',
    },
    {
      name: 'incomplete generic',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'other' },
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INCOMPLETE_RESPONSE',
    },
    {
      name: 'unknown status',
      response: createResponse({ status: 'queued' }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'non-array output',
      response: createResponse({ output: {} }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'explicit refusal before parsing',
      response: createResponse({
        output: [
          {
            type: 'message',
            content: [
              { type: 'refusal', refusal: 'PRIVATE_REFUSAL_SENTINEL' },
            ],
          },
        ],
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_REFUSED',
    },
    {
      name: 'unexpected output item',
      response: createResponse({
        output: [{ type: 'function_call', name: 'not-allowed' }],
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'unknown content part',
      response: createResponse({
        output: [
          { type: 'message', content: [{ type: 'parsed', parsed: {} }] },
        ],
      }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'output parsed legacy branch rejected',
      response: { status: 'completed', output_parsed: createRepairedOutput() },
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'completed response without output fields',
      response: { status: 'completed' },
      code: 'AI_WEEKLY_PLAN_REPAIR_EMPTY_RESPONSE',
    },
    {
      name: 'statusless response without output fields',
      response: {},
      code: 'AI_WEEKLY_PLAN_REPAIR_EMPTY_RESPONSE',
    },
    {
      name: 'empty output',
      response: { status: 'completed', output: [] },
      code: 'AI_WEEKLY_PLAN_REPAIR_EMPTY_RESPONSE',
    },
    {
      name: 'empty text',
      response: createResponse({ output_text: '   ', output: [] }),
      code: 'AI_WEEKLY_PLAN_REPAIR_EMPTY_RESPONSE',
    },
    {
      name: 'invalid output text type',
      response: createResponse({ output_text: {}, output: [] }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'invalid JSON',
      response: createResponse({ output_text: '{bad', output: [] }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_JSON',
    },
    {
      name: 'JSON array',
      response: createResponse({ output_text: '[]', output: [] }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
    {
      name: 'JSON null',
      response: createResponse({ output_text: 'null', output: [] }),
      code: 'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.throws(
        () => parseWeeklyPlanAiRepairResponse(entry.response),
        (error) => {
          assert.equal(error.status, 502);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(
            error.message,
            /PRIVATE_RAW_ERROR|PRIVATE_REFUSAL_SENTINEL/
          );
          assert.equal(error.details, undefined);
          return true;
        }
      );
    });
  }
});

test('repairWeeklyPlanAi returns only normalized provider metadata', async () => {
  const complete = await repairWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env: {},
      openaiClient: createClient(
        createResponse({
          id: 'resp_repair_usage_123',
          model: 'actual-repair-model',
          usage: {
            input_tokens: 1200,
            output_tokens: 800,
            total_tokens: 2000,
            output_tokens_details: { reasoning_tokens: 250 },
          },
          rawResponse: 'PRIVATE_RAW_RESPONSE',
        })
      ),
      getModelForTask: () => 'requested-repair-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(complete.repairer, {
    type: 'openai',
    model: 'actual-repair-model',
    responseId: 'resp_repair_usage_123',
    usage: {
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      reasoningTokens: 250,
    },
  });
  assert.doesNotMatch(JSON.stringify(complete), /PRIVATE_RAW_RESPONSE/);

  const partial = await repairWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
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
      getModelForTask: () => 'requested-repair-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(partial.repairer, {
    type: 'openai',
    model: 'requested-repair-model',
    responseId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
});

test('repairWeeklyPlanAi does not run local schema or semantic validation', async () => {
  const schemaInvalidButObject = {
    definitelyNotWeeklyPlanV1: true,
    workouts: 'not-an-array',
  };
  const response = createResponse({
    output_text: JSON.stringify(schemaInvalidButObject),
  });

  const result = await repairWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env: {},
      openaiClient: createClient(response),
      getModelForTask: () => 'repair-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(result.repairedAIOutput, schemaInvalidButObject);
});

test('repairWeeklyPlanAi maps SDK and HTTP errors with dedicated repair codes and always clears its timer', async (t) => {
  const headers = new Headers({ 'x-request-id': 'PRIVATE_REQUEST_ID' });
  const cases = [
    {
      name: 'connection timeout',
      error: new OpenAI.APIConnectionTimeoutError({
        message: 'PROVIDER_SECRET_SENTINEL',
      }),
      status: 504,
      code: 'AI_WEEKLY_PLAN_REPAIR_TIMEOUT',
    },
    {
      name: 'rate limit',
      error: new OpenAI.RateLimitError(
        429,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_RATE_LIMITED',
    },
    {
      name: 'authentication',
      error: new OpenAI.AuthenticationError(
        401,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_AUTH_FAILED',
    },
    {
      name: 'permission',
      error: new OpenAI.PermissionDeniedError(
        403,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_AUTH_FAILED',
    },
    {
      name: 'connection unavailable',
      error: new OpenAI.APIConnectionError({
        message: 'PROVIDER_SECRET_SENTINEL',
        cause: new Error('PRIVATE_NETWORK_CAUSE'),
      }),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE',
    },
    {
      name: '4xx request',
      error: new OpenAI.BadRequestError(
        400,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 500,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_REQUEST_INVALID',
    },
    {
      name: '5xx provider',
      error: new OpenAI.InternalServerError(
        500,
        { message: 'PROVIDER_SECRET_SENTINEL' },
        headers
      ),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_ERROR',
    },
    {
      name: 'unknown provider error',
      error: new Error('PROVIDER_SECRET_SENTINEL'),
      status: 502,
      code: 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_ERROR',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const capture = {};
      await assert.rejects(
        () =>
          repairWeeklyPlanAi(
            { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
            {
              env: {},
              openaiClient: createRejectingClient(entry.error, capture),
              getModelForTask: () => 'repair-model',
              ...createTimerDeps(capture),
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(
            error.message,
            /PROVIDER_SECRET_SENTINEL|PRIVATE_REQUEST_ID|PRIVATE_NETWORK_CAUSE/
          );
          assert.equal(error.details, undefined);
          return true;
        }
      );
      assert.equal(capture.callCount, 1);
      assert.equal(capture.clearCount, 1);
      assert.equal(capture.clearedTimer, 'repair-timer-token');
    });
  }
});

test('repairWeeklyPlanAi distinguishes its application timeout from an external abort', async () => {
  const timeoutCapture = {};
  const timeoutClient = {
    responses: {
      create: async (_request, options) => {
        timeoutCapture.callCount = (timeoutCapture.callCount || 0) + 1;
        assert.equal(options.maxRetries, 0);
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
      repairWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: {},
          openaiClient: timeoutClient,
          getModelForTask: () => 'repair-model',
          setTimeout: (callback, delay) => {
            timeoutCapture.timeoutDelay = delay;
            queueMicrotask(callback);
            return 'timeout-token';
          },
          clearTimeout: (timer) => {
            timeoutCapture.clearCount = (timeoutCapture.clearCount || 0) + 1;
            timeoutCapture.clearedTimer = timer;
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 504);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_TIMEOUT');
      return true;
    }
  );
  assert.equal(timeoutCapture.callCount, 1);
  assert.equal(timeoutCapture.timeoutDelay, DEFAULT_PROGRAM_REPAIR_TIMEOUT_MS);
  assert.equal(timeoutCapture.clearCount, 1);
  assert.equal(timeoutCapture.clearedTimer, 'timeout-token');

  const abortCapture = {};
  await assert.rejects(
    () =>
      repairWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: {},
          openaiClient: createRejectingClient(
            new OpenAI.APIUserAbortError(),
            abortCapture
          ),
          getModelForTask: () => 'repair-model',
          ...createTimerDeps(abortCapture),
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REPAIR_PROVIDER_UNAVAILABLE');
      return true;
    }
  );
  assert.equal(abortCapture.callCount, 1);
  assert.equal(abortCapture.clearCount, 1);
});
