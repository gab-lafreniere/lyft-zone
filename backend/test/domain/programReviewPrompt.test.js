const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REVIEW_PROMPT_VERSION,
  ProgramReviewPromptError,
  buildProgramReviewPrompt,
} = require('../../src/domain/programGeneration/prompts/programReviewPrompt');

function createReviewInput() {
  return {
    schemaVersion: 4,
    evaluationPolicy: { id: 'policy', version: 1 },
    plan: {
      workouts: [{ orderIndex: 1, estimatedDurationMinutes: 14 }],
    },
    analytics: {
      schemaVersion: 3,
      workouts: [
        {
          workoutOrderIndex: 1,
          calculatedDurationMinutes: 14,
          durationCalculation: {
            methodId: 'historical_weekly_plan_metrics_v1',
          },
        },
      ],
    },
  };
}

test('Review prompt V1.3 uses backend-only input and no doctrine', () => {
  const prompt = buildProgramReviewPrompt({
    reviewInput: createReviewInput(),
  });

  assert.equal(
    PROGRAM_REVIEW_PROMPT_VERSION,
    'ai-program-review-prompt-v1.3.0'
  );
  assert.match(prompt.userMessage, /PROGRAM REVIEW INPUT V4/);
  assert.match(prompt.userMessage, /durationCalculation/);
  assert.doesNotMatch(prompt.userMessage, /APPENDIX A/);
  assert.doesNotMatch(prompt.userMessage, /durationDebugComparison/);
});

test('Review prompt assigns qualitative responsibilities after duration gate', () => {
  const prompt = buildProgramReviewPrompt({
    reviewInput: createReviewInput(),
  });
  const combined = `${prompt.systemMessage}\n${prompt.userMessage}`;

  assert.match(combined, /after deterministic backend duration validation has passed/);
  assert.match(combined, /split quality/);
  assert.match(combined, /cautions/);
  assert.match(combined, /cardio/);
  assert.match(combined, /Do not infer or compare any AI-declared duration/);
});

test('Review prompt is deterministic and does not require doctrine', () => {
  const reviewInput = createReviewInput();
  assert.deepEqual(
    buildProgramReviewPrompt({ reviewInput }),
    buildProgramReviewPrompt({ reviewInput })
  );
  assert.doesNotThrow(() =>
    buildProgramReviewPrompt({ reviewInput, doctrine: null })
  );
});

test('Review prompt rejects an invalid Review Input version', () => {
  assert.throws(
    () =>
      buildProgramReviewPrompt({
        reviewInput: { schemaVersion: 3 },
      }),
    ProgramReviewPromptError
  );
});
