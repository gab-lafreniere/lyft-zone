const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_IP_ANALYSES,
  createMovementConstraintAnalyzeRateLimit,
} = require('../../middleware/movementConstraintAnalyzeRateLimit');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createRequest({ userId = 'user_1', ip = '203.0.113.10' } = {}) {
  return {
    params: { userId },
    headers: { 'x-forwarded-for': ip },
    ip,
    socket: { remoteAddress: ip },
  };
}

function runMiddleware(middleware, req = createRequest()) {
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

test('movementConstraintAnalyzeRateLimit allows the first analyze request', () => {
  const limiter = createMovementConstraintAnalyzeRateLimit({ now: () => 1000 });
  const result = runMiddleware(limiter);

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
});

test('movementConstraintAnalyzeRateLimit blocks a second request for the same user within 30 seconds', () => {
  let now = 1000;
  const limiter = createMovementConstraintAnalyzeRateLimit({ now: () => now });

  assert.equal(runMiddleware(limiter).nextCalled, true);

  now += 29_000;
  const blocked = runMiddleware(limiter);

  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.deepEqual(blocked.res.body, {
    error: {
      code: 'AI_ANALYZE_RATE_LIMITED',
      message: 'Please wait before running another AI analysis.',
    },
  });
});

test('movementConstraintAnalyzeRateLimit allows the same user after 30 seconds', () => {
  let now = 1000;
  const limiter = createMovementConstraintAnalyzeRateLimit({ now: () => now });

  assert.equal(runMiddleware(limiter).nextCalled, true);

  now += 30_000;
  assert.equal(runMiddleware(limiter).nextCalled, true);
});

test('movementConstraintAnalyzeRateLimit blocks IP after 20 analyses in 15 minutes', () => {
  let now = 1000;
  const limiter = createMovementConstraintAnalyzeRateLimit({ now: () => now });

  for (let index = 0; index < MAX_IP_ANALYSES; index += 1) {
    const result = runMiddleware(
      limiter,
      createRequest({ userId: `user_${index}`, ip: '198.51.100.20' })
    );
    assert.equal(result.nextCalled, true);
    now += 1000;
  }

  const blocked = runMiddleware(
    limiter,
    createRequest({ userId: 'user_over_limit', ip: '198.51.100.20' })
  );

  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.body.error.code, 'AI_ANALYZE_RATE_LIMITED');
});

test('movementConstraintAnalyzeRateLimit does not call the analyze handler when rate limited', () => {
  let handlerCalled = false;
  const limiter = createMovementConstraintAnalyzeRateLimit({ now: () => 1000 });

  runMiddleware(limiter);

  const req = createRequest();
  const res = createResponse();
  limiter(req, res, () => {
    handlerCalled = true;
  });

  assert.equal(handlerCalled, false);
  assert.equal(res.statusCode, 429);
});
