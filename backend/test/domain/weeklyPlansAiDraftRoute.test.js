const test = require('node:test');
const assert = require('node:assert/strict');

const programGenerationServicePath = require.resolve(
  '../../services/programGenerationService'
);
delete require.cache[programGenerationServicePath];

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

test('POST /api/weekly-plans/ai-drafts returns the controlled disabled response', async () => {
  const res = await invokeAIDraftsRoute();

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    error: {
      code: 'AI_WEEKLY_PLAN_BUILDER_DISABLED',
      message: 'AI weekly plan builder is not enabled',
    },
  });
});

test('disabled endpoint does not load the generation runtime or inspect its body', async () => {
  const body = new Proxy(
    {},
    {
      get() {
        throw new Error('request body must not be inspected');
      },
    }
  );

  const res = await invokeAIDraftsRoute({ body });

  assert.equal(res.statusCode, 503);
  assert.equal(require.cache[programGenerationServicePath], undefined);
});
