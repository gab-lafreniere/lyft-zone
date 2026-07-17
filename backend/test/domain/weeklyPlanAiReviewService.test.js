const test = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai');

const {
  DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS,
  isAIWeeklyPlanReviewEnabled,
  parseWeeklyPlanAiReviewResponse,
  resolveProgramReviewConfig,
  reviewWeeklyPlanAi,
} = require('../../services/weeklyPlanAiReviewService');

function createPromptDescriptor() {
  return {
    promptVersion: 'ai-program-review-prompt-v1.0.0',
    systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
    userMessage: 'USER_MESSAGE_SENTINEL',
  };
}

function createSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: { type: 'string' },
    },
  };
}

function createReview() {
  return {
    schemaVersion: 1,
    decision: 'PASS',
    requiresRepair: false,
    reviewSummary: 'The plan is coherent with the supplied inputs.',
    issues: [],
  };
}

function createResponse(overrides = {}) {
  return {
    id: 'resp_program_review_123',
    model: 'returned-review-model',
    status: 'completed',
    output_text: JSON.stringify(createReview()),
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

function enabledEnv(overrides = {}) {
  return {
    ENABLE_AI_WEEKLY_PLAN_REVIEW: 'true',
    ...overrides,
  };
}

test('reviewWeeklyPlanAi builds a strict Responses API request without SDK retries', async () => {
  const capture = {};
  let routedTask = null;
  const schema = createSchema();
  const promptDescriptor = createPromptDescriptor();

  const result = await reviewWeeklyPlanAi(
    { promptDescriptor, schema },
    {
      env: enabledEnv(),
      openaiClient: createClient(createResponse(), capture),
      getModelForTask: (task) => {
        routedTask = task;
        return 'requested-review-model';
      },
      ...createTimerDeps(capture),
    }
  );

  assert.equal(routedTask, 'program_review');
  assert.deepEqual(capture.request, {
    model: 'requested-review-model',
    instructions: promptDescriptor.systemMessage,
    input: promptDescriptor.userMessage,
    text: {
      format: {
        type: 'json_schema',
        name: 'ai_program_review_v1',
        strict: true,
        schema,
      },
    },
    max_output_tokens: DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS,
    store: false,
  });
  assert.deepEqual(Object.keys(capture.options), ['signal', 'maxRetries']);
  assert.ok(capture.options.signal);
  assert.equal(capture.options.maxRetries, 0);
  assert.equal(capture.timeoutDelay, DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS);
  assert.equal(capture.clearedTimer, 'timer-token');
  assert.deepEqual(result.programReview, createReview());
  assert.deepEqual(result.reviewer, {
    type: 'openai',
    model: 'returned-review-model',
    responseId: 'resp_program_review_123',
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
  assert.equal(Object.hasOwn(result, 'response'), false);
  assert.equal(Object.hasOwn(result, 'outputText'), false);
});

test('reviewWeeklyPlanAi applies valid review timeout and output overrides', async () => {
  const capture = {};

  await reviewWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env: enabledEnv({
        OPENAI_PROGRAM_REVIEW_TIMEOUT_MS: '45000',
        OPENAI_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS: '3500',
      }),
      openaiClient: createClient(createResponse(), capture),
      getModelForTask: () => 'review-model',
      ...createTimerDeps(capture),
    }
  );

  assert.equal(capture.timeoutDelay, 45000);
  assert.equal(capture.request.max_output_tokens, 3500);
});

test('resolveProgramReviewConfig falls back for absent or invalid values', async (t) => {
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
        resolveProgramReviewConfig({
          OPENAI_PROGRAM_REVIEW_TIMEOUT_MS: value,
          OPENAI_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS: value,
        }),
        {
          timeoutMs: DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS,
          maxOutputTokens: DEFAULT_PROGRAM_REVIEW_MAX_OUTPUT_TOKENS,
        }
      );
    });
  }
});

test('review feature flag defaults to disabled and blocks direct service calls', async () => {
  assert.equal(isAIWeeklyPlanReviewEnabled({}), false);
  assert.equal(
    isAIWeeklyPlanReviewEnabled({ ENABLE_AI_WEEKLY_PLAN_REVIEW: 'FALSE' }),
    false
  );
  assert.equal(
    isAIWeeklyPlanReviewEnabled({ ENABLE_AI_WEEKLY_PLAN_REVIEW: 'TrUe' }),
    true
  );

  const capture = {};
  await assert.rejects(
    () =>
      reviewWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: {},
          openaiClient: createClient(createResponse(), capture),
          getModelForTask: () => 'review-model',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_DISABLED');
      assert.equal(error.details, undefined);
      return true;
    }
  );
  assert.equal(capture.callCount || 0, 0);
});

test('reviewWeeklyPlanAi requires an injected or configured provider and routed model', async () => {
  let getClientCalled = false;

  await assert.rejects(
    () =>
      reviewWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: enabledEnv(),
          getOpenAIClient: () => {
            getClientCalled = true;
          },
          getModelForTask: () => 'review-model',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE');
      return true;
    }
  );
  assert.equal(getClientCalled, false);

  const capture = {};
  await assert.rejects(
    () =>
      reviewWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: enabledEnv(),
          openaiClient: createClient(createResponse(), capture),
          getModelForTask: () => '   ',
        }
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_MODEL_UNAVAILABLE');
      return true;
    }
  );
  assert.equal(capture.callCount || 0, 0);
});

test('parseWeeklyPlanAiReviewResponse parses output text and fragmented output text', () => {
  assert.deepEqual(parseWeeklyPlanAiReviewResponse(createResponse()), createReview());

  const response = createResponse({
    output: [
      { type: 'reasoning', summary: [] },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"decision":"PASS",' }],
      },
      {
        type: 'message',
        content: [{ type: 'output_text', text: '"issues":[]}' }],
      },
    ],
  });
  delete response.output_text;

  assert.deepEqual(parseWeeklyPlanAiReviewResponse(response), {
    decision: 'PASS',
    issues: [],
  });
});

test('parseWeeklyPlanAiReviewResponse maps refusals, incomplete results, and invalid responses', async (t) => {
  const cases = [
    {
      name: 'null response',
      response: null,
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
    {
      name: 'failed response',
      response: createResponse({ status: 'failed' }),
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
    {
      name: 'max output incomplete response',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
      code: 'AI_WEEKLY_PLAN_REVIEW_INCOMPLETE',
    },
    {
      name: 'content-filtered response',
      response: createResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
      code: 'AI_WEEKLY_PLAN_REVIEW_REFUSED',
    },
    {
      name: 'explicit refusal',
      response: createResponse({
        output: [
          {
            type: 'message',
            content: [
              { type: 'refusal', refusal: 'PRIVATE_REFUSAL_TEXT_SENTINEL' },
            ],
          },
        ],
      }),
      code: 'AI_WEEKLY_PLAN_REVIEW_REFUSED',
    },
    {
      name: 'empty response text',
      response: createResponse({ output_text: '', output: [] }),
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
    {
      name: 'invalid JSON',
      response: createResponse({ output_text: '{bad', output: [] }),
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
    {
      name: 'JSON array',
      response: createResponse({ output_text: '[]', output: [] }),
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
    {
      name: 'unexpected output item',
      response: createResponse({
        output: [{ type: 'function_call', name: 'unexpected' }],
      }),
      code: 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.throws(
        () => parseWeeklyPlanAiReviewResponse(entry.response),
        (error) => {
          assert.equal(error.status, entry.code === 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE' ? 503 : 502);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(error.message, /PRIVATE_REFUSAL_TEXT_SENTINEL/);
          assert.equal(error.details, undefined);
          return true;
        }
      );
    });
  }
});

test('reviewWeeklyPlanAi returns compact provider metadata', async () => {
  const result = await reviewWeeklyPlanAi(
    { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
    {
      env: enabledEnv(),
      openaiClient: createClient(
        createResponse({
          id: 'resp_usage_123',
          model: 'actual-provider-model',
          usage: {
            input_tokens: 1200,
            output_tokens: 800,
            total_tokens: 2000,
            output_tokens_details: { reasoning_tokens: 250 },
          },
        })
      ),
      getModelForTask: () => 'requested-provider-model',
      ...createTimerDeps(),
    }
  );

  assert.deepEqual(result.reviewer, {
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

test('reviewWeeklyPlanAi maps timeout and provider SDK errors without application retries', async (t) => {
  const headers = new Headers({ 'x-request-id': 'req_private_123' });
  const cases = [
    {
      name: 'connection timeout',
      error: new OpenAI.APIConnectionTimeoutError({ message: 'PROVIDER_SECRET_SENTINEL' }),
      status: 504,
      code: 'AI_WEEKLY_PLAN_REVIEW_TIMEOUT',
    },
    {
      name: 'rate limit',
      error: new OpenAI.RateLimitError(429, { message: 'PROVIDER_SECRET_SENTINEL' }, headers),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
    {
      name: 'authentication',
      error: new OpenAI.AuthenticationError(401, { message: 'PROVIDER_SECRET_SENTINEL' }, headers),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
    {
      name: 'network',
      error: new OpenAI.APIConnectionError({ message: 'PROVIDER_SECRET_SENTINEL' }),
      status: 503,
      code: 'AI_WEEKLY_PLAN_REVIEW_PROVIDER_UNAVAILABLE',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const capture = {};
      await assert.rejects(
        () =>
          reviewWeeklyPlanAi(
            { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
            {
              env: enabledEnv(),
              openaiClient: createRejectingClient(entry.error, capture),
              getModelForTask: () => 'review-model',
              ...createTimerDeps(capture),
            }
          ),
        (error) => {
          assert.equal(error.status, entry.status);
          assert.equal(error.code, entry.code);
          assert.doesNotMatch(error.message, /PROVIDER_SECRET_SENTINEL/);
          return true;
        }
      );
      assert.equal(capture.callCount, 1);
      assert.equal(capture.clearedTimer, 'timer-token');
    });
  }
});

test('reviewWeeklyPlanAi distinguishes its timeout abort from another abort', async () => {
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
      reviewWeeklyPlanAi(
        { promptDescriptor: createPromptDescriptor(), schema: createSchema() },
        {
          env: enabledEnv(),
          openaiClient: timeoutClient,
          getModelForTask: () => 'review-model',
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
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_TIMEOUT');
      return true;
    }
  );
  assert.equal(timeoutCapture.callCount, 1);
  assert.equal(timeoutCapture.timeoutDelay, DEFAULT_PROGRAM_REVIEW_TIMEOUT_MS);
  assert.equal(timeoutCapture.clearedTimer, 'timeout-token');
});
