const test = require('node:test');
const assert = require('node:assert/strict');

let createAIWeeklyPlanDraft;

require.cache[require.resolve('../../services/programGenerationService')] = {
  id: require.resolve('../../services/programGenerationService'),
  filename: require.resolve('../../services/programGenerationService'),
  loaded: true,
  exports: {
    createAIWeeklyPlanDraft: (...args) => createAIWeeklyPlanDraft(...args),
  },
};

const weeklyPlansRouter = require('../../routes/weeklyPlans');

function findRoute(path, method) {
  return weeklyPlansRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  );
}

async function invokeAIDraftsRoute(reqOverrides = {}) {
  const route = findRoute('/ai-drafts', 'post');
  assert.ok(route);

  const req = {
    body: {
      userId: 'user_123',
      options: {},
    },
    ...reqOverrides,
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await route.route.stack[0].handle(req, res);
  return res;
}

test('POST /api/weekly-plans/ai-drafts returns the service response on success', async () => {
  createAIWeeklyPlanDraft = async (payload) => ({
    weeklyPlanParentId: 'parent_123',
    weeklyPlanVersionId: 'version_123',
    status: 'DRAFT',
    source: 'ai',
    builderPayload: {
      programName: `AI Draft for ${payload.userId}`,
    },
  });

  const res = await invokeAIDraftsRoute();

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.source, 'ai');
  assert.equal(res.body.builderPayload.programName, 'AI Draft for user_123');
});

test('POST /api/weekly-plans/ai-drafts maps controlled provider errors', async (t) => {
  const cases = [
    {
      name: 'timeout',
      status: 504,
      code: 'AI_WEEKLY_PLAN_GENERATION_TIMEOUT',
      message: 'AI weekly plan generation timed out',
    },
    {
      name: 'provider unavailable',
      status: 503,
      code: 'AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE',
      message: 'AI weekly plan provider is unavailable',
    },
    {
      name: 'refusal',
      status: 502,
      code: 'AI_WEEKLY_PLAN_REFUSED',
      message: 'AI weekly plan generation could not be completed',
    },
    {
      name: 'max output tokens',
      status: 502,
      code: 'AI_WEEKLY_PLAN_MAX_OUTPUT_TOKENS',
      message: 'AI weekly plan generation exceeded its output limit',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      createAIWeeklyPlanDraft = async () => {
        const error = new Error(entry.message);
        error.status = entry.status;
        error.code = entry.code;
        throw error;
      };

      const res = await invokeAIDraftsRoute();

      assert.equal(res.statusCode, entry.status);
      assert.deepEqual(res.body, {
        error: {
          code: entry.code,
          message: entry.message,
          details: undefined,
        },
      });
      assert.doesNotMatch(JSON.stringify(res.body), /prompt|doctrine|provider raw|stack/i);
    });
  }
});

test('POST /api/weekly-plans/ai-drafts maps temporarily unsupported goals with details', async () => {
  createAIWeeklyPlanDraft = async () => {
    const error = new Error(
      'AI Weekly Plan Builder V1 currently supports HYPERTROPHY only'
    );
    error.status = 422;
    error.code = 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL';
    error.details = {
      primaryGoal: 'STRENGTH',
      supportedPrimaryGoals: ['HYPERTROPHY'],
    };
    throw error;
  };

  const res = await invokeAIDraftsRoute();

  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body, {
    error: {
      code: 'AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL',
      message: 'AI Weekly Plan Builder V1 currently supports HYPERTROPHY only',
      details: {
        primaryGoal: 'STRENGTH',
        supportedPrimaryGoals: ['HYPERTROPHY'],
      },
    },
  });
});

test('POST /api/weekly-plans/ai-drafts maps missing userId validation errors', async () => {
  createAIWeeklyPlanDraft = async (payload) => {
    assert.equal(payload.userId, undefined);
    const error = new Error('userId is required');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  };

  const res = await invokeAIDraftsRoute({
    body: {
      options: {},
    },
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'userId is required',
      details: undefined,
    },
  });
});
