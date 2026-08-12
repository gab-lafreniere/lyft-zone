const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRESS_TTL_MS,
  advanceGenerationProgress,
  beginGenerationProgress,
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
    'generation_1',
    'BUILDING_PROGRAM',
    startedAt + 1000
  );
  advanceGenerationProgress(
    'generation_1',
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

  finishGenerationProgress('generation_1', startedAt + 3000);
  failGenerationProgress('generation_1', startedAt + 4000);
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

test('another user cannot overwrite an existing generation id', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  beginGenerationProgress({ generationId: 'shared', userId: 'owner' }, now);
  assert.equal(
    beginGenerationProgress(
      { generationId: 'shared', userId: 'other' },
      now + 1
    ),
    null
  );
  assert.equal(
    readGenerationProgress(
      { generationId: 'shared', userId: 'owner' },
      now + 1
    ).status,
    'RUNNING'
  );
});
