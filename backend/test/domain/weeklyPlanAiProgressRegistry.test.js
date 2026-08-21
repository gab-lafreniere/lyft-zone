const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRESS_TTL_MS,
  advanceGenerationProgress,
  beginGenerationProgress,
  claimGenerationProgress,
  clearGenerationProgressForTests,
  failGenerationProgress,
  finishGenerationProgress,
  readGenerationProgress,
} = require('../../services/weeklyPlanAiProgressRegistry');

test.beforeEach(() => clearGenerationProgressForTests());

test('progress is owner-scoped, monotonic, and terminal', () => {
  const startedAt = Date.parse('2026-08-11T12:00:00.000Z');
  beginGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    startedAt
  );
  advanceGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    'BUILDING_PROGRAM',
    startedAt + 1000
  );
  advanceGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    'DESIGNING_PROGRAM',
    startedAt + 2000
  );

  assert.equal(
    readGenerationProgress(
      { generationId: 'generation_1', userId: 'user_1' },
      startedAt + 2000
    ).stage,
    'BUILDING_PROGRAM'
  );
  assert.equal(
    readGenerationProgress(
      { generationId: 'generation_1', userId: 'user_2' },
      startedAt + 2000
    ),
    null
  );

  finishGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    { weeklyPlanParentId: 'parent_1' },
    startedAt + 3000
  );
  failGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    startedAt + 4000
  );
  beginGenerationProgress(
    { generationId: 'generation_1', userId: 'user_1' },
    startedAt + 5000
  );
  assert.deepEqual(
    readGenerationProgress(
      { generationId: 'generation_1', userId: 'user_1' },
      startedAt + 5000
    ),
    {
      generationId: 'generation_1',
      status: 'SUCCEEDED',
      stage: 'SAVING_PROGRAM',
      updatedAt: '2026-08-11T12:00:03.000Z',
    }
  );
});

test('expired progress disappears without affecting newer records', () => {
  const startedAt = Date.parse('2026-08-11T12:00:00.000Z');
  beginGenerationProgress(
    { generationId: 'expired', userId: 'user_1' },
    startedAt
  );
  assert.equal(
    readGenerationProgress(
      { generationId: 'expired', userId: 'user_1' },
      startedAt + PROGRESS_TTL_MS + 1
    ),
    null
  );
});

test('the same generation id is independently owner-scoped', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  beginGenerationProgress({ generationId: 'shared', userId: 'owner' }, now);
  beginGenerationProgress(
    { generationId: 'shared', userId: 'other' },
    now + 1
  );
  assert.equal(
    readGenerationProgress(
      { generationId: 'shared', userId: 'owner' },
      now + 1
    ).status,
    'RUNNING'
  );
  assert.equal(
    readGenerationProgress(
      { generationId: 'shared', userId: 'other' },
      now + 1
    ).status,
    'RUNNING'
  );
});

test('claim is atomic, replays success, retries failure, and expires the result memo', () => {
  const startedAt = Date.parse('2026-08-11T12:00:00.000Z');
  const identity = { generationId: 'claimed', userId: 'user_1' };
  const result = {
    weeklyPlanParentId: 'parent_1',
    weeklyPlanVersionId: 'version_1',
  };

  assert.equal(claimGenerationProgress(identity, startedAt).outcome, 'CLAIMED');
  assert.equal(claimGenerationProgress(identity, startedAt + 1).outcome, 'RUNNING');

  failGenerationProgress(identity, startedAt + 2);
  assert.equal(claimGenerationProgress(identity, startedAt + 3).outcome, 'CLAIMED');
  finishGenerationProgress(identity, result, startedAt + 4);

  const replay = claimGenerationProgress(identity, startedAt + 5);
  assert.equal(replay.outcome, 'SUCCEEDED');
  assert.deepEqual(replay.result, result);
  assert.equal(
    claimGenerationProgress(identity, startedAt + 4 + PROGRESS_TTL_MS + 1).outcome,
    'CLAIMED'
  );
});
