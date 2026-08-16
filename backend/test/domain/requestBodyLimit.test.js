// Regression coverage for the request-body limit and its 413 contract.
//
// Manual Builder saves send the whole plan document so the backend can diff it. A
// six-week six-day cycle serializes to ~380 KB, which exceeded body-parser's 100 KB
// default and was rejected before routing — the save never reached a handler, and the
// default Express error page (HTML) made the failure unreadable to the client.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../../server');

const KB = 1024;

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(server, { method = 'PATCH', path = '/', body = '' }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          raw,
        }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function bodyOfSize(targetBytes) {
  // A realistically shaped payload rather than one giant string, so the parser walks a
  // structure comparable to a real draft.
  const weeks = [];
  let current = () => Buffer.byteLength(JSON.stringify({ userId: 'u', weeks }));
  let weekNumber = 1;
  while (current() < targetBytes) {
    weeks.push({
      id: `week_${weekNumber}`,
      weekNumber,
      orderIndex: weekNumber,
      label: `Week ${weekNumber}`,
      notes: null,
      workouts: Array.from({ length: 6 }, (_, workoutIndex) => ({
        id: `w_${weekNumber}_${workoutIndex}`,
        name: `Day ${workoutIndex + 1}`,
        orderIndex: workoutIndex + 1,
        blocks: Array.from({ length: 9 }, (_, blockIndex) => ({
          id: `b_${weekNumber}_${workoutIndex}_${blockIndex}`,
          orderIndex: blockIndex + 1,
          blockType: 'SINGLE',
          restSeconds: 90,
          exercises: [{
            id: `e_${weekNumber}_${workoutIndex}_${blockIndex}`,
            exerciseId: 'exr_movement_example',
            exerciseName: 'Movement Example',
            orderIndex: 1,
            defaultTempo: '3010',
            setTemplates: Array.from({ length: 3 }, (_, setIndex) => ({
              id: `s_${weekNumber}_${workoutIndex}_${blockIndex}_${setIndex}`,
              setIndex: setIndex + 1,
              setType: 'WORKING',
              targetReps: 10,
              minReps: 8,
              maxReps: 12,
              targetRir: 2,
              tempo: '3010',
              restSeconds: 90,
              notes: null,
            })),
          }],
        })),
      })),
    });
    weekNumber += 1;
  }
  return JSON.stringify({ userId: 'u', weeks });
}

test('the configured request body limit is explicit and above real draft payloads', () => {
  // Asserted as a resolved byte count, not a literal, so it cannot silently revert to
  // body-parser's 100 KB default.
  const limit = require('../../server').REQUEST_BODY_LIMIT;
  assert.ok(limit, 'a limit must be configured explicitly');

  const match = String(limit).match(/^(\d+(?:\.\d+)?)(kb|mb)$/i);
  assert.ok(match, `limit must be a parseable size, got ${limit}`);
  const bytes = Number(match[1]) * (match[2].toLowerCase() === 'mb' ? 1024 * KB : KB);

  assert.ok(
    bytes >= 1024 * KB,
    `limit ${limit} must comfortably exceed the ~380 KB real cycle payload`
  );
  assert.ok(bytes <= 8 * 1024 * KB, `limit ${limit} must stay bounded`);
});

test('a ~400 KB cycle draft body reaches the route instead of a body-parser rejection', async () => {
  const server = await listen();
  try {
    const body = bodyOfSize(400 * KB);
    assert.ok(
      Buffer.byteLength(body) > 380 * KB,
      'fixture must exceed the real 380 KB payload'
    );

    const response = await request(server, {
      method: 'PATCH',
      path: '/api/cycles/cycle_missing/drafts/plan_missing',
      body,
    });

    // The route is reached and answers on its own terms. What matters is that this is
    // no longer a pre-routing 413.
    assert.notEqual(
      response.status,
      413,
      'a 400 KB draft must not be rejected as too large'
    );
    assert.ok(
      response.contentType.includes('application/json'),
      `expected a JSON response from the route, got ${response.contentType}`
    );
    const parsed = JSON.parse(response.raw);
    assert.notEqual(parsed?.error?.code, 'PAYLOAD_TOO_LARGE');
  } finally {
    await close(server);
  }
});

test('an oversized body returns JSON 413 with PAYLOAD_TOO_LARGE, not HTML', async () => {
  const server = await listen();
  try {
    const body = bodyOfSize(3 * 1024 * KB);
    assert.ok(
      Buffer.byteLength(body) > 2 * 1024 * KB,
      'fixture must exceed the configured limit'
    );

    const response = await request(server, {
      method: 'PATCH',
      path: '/api/cycles/cycle_missing/drafts/plan_missing',
      body,
    });

    assert.equal(response.status, 413);
    assert.ok(
      response.contentType.includes('application/json'),
      `413 must be JSON so clients can classify it, got ${response.contentType}`
    );
    assert.equal(
      response.raw.trimStart().startsWith('<'),
      false,
      '413 must not be an HTML error page'
    );
    assert.deepEqual(JSON.parse(response.raw), {
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
      },
    });
  } finally {
    await close(server);
  }
});

test('malformed JSON within the limit is not reported as too large', async () => {
  const server = await listen();
  try {
    const response = await request(server, {
      method: 'PATCH',
      path: '/api/cycles/cycle_missing/drafts/plan_missing',
      body: '{"userId": "u", "weeks": [',
    });

    assert.notEqual(response.status, 413);
    assert.notEqual(
      (() => {
        try {
          return JSON.parse(response.raw)?.error?.code;
        } catch {
          return null;
        }
      })(),
      'PAYLOAD_TOO_LARGE',
      'a syntax error must not be misreported as an oversized payload'
    );
  } finally {
    await close(server);
  }
});
