const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeMovementConstraints,
} = require('../../services/movementConstraintAnalysisService');

function createPayload() {
  return {
    painIssue: {
      id: 'issue_knee',
      description: 'Knee discomfort during deep squats',
      affectedArea: 'knee',
      painSeverity: 'moderate',
      clarificationAnswers: [],
    },
    context: {
      existingPainIssues: [],
      manualBlockedExerciseIds: [],
    },
  };
}

function enabledEnv() {
  return {
    ENABLE_AI_MOVEMENT_CONSTRAINTS: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MOVEMENT_CONSTRAINTS_TIMEOUT_MS: '1000',
  };
}

test('analyzeMovementConstraints returns 503 and does not call OpenAI when disabled', async () => {
  let called = false;

  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: {
          ENABLE_AI_MOVEMENT_CONSTRAINTS: 'false',
          OPENAI_API_KEY: 'test-key',
        },
        openaiClient: {
          responses: {
            create: async () => {
              called = true;
            },
          },
        },
      }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_DISABLED');
      return true;
    }
  );

  assert.equal(called, false);
});

test('analyzeMovementConstraints returns 503 and does not call OpenAI when api key is missing', async () => {
  let called = false;

  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: {
          ENABLE_AI_MOVEMENT_CONSTRAINTS: 'true',
        },
        openaiClient: {
          responses: {
            create: async () => {
              called = true;
            },
          },
        },
      }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_DISABLED');
      return true;
    }
  );

  assert.equal(called, false);
});

test('analyzeMovementConstraints uses task router model and accepts analyzed output', async () => {
  let requestedModel = null;

  const result = await analyzeMovementConstraints(createPayload(), {
    env: enabledEnv(),
    getModelForTask: (task) => {
      assert.equal(task, 'movement_analysis');
      return 'small-task-model';
    },
    openaiClient: {
      responses: {
        create: async (request) => {
          requestedModel = request.model;
          return {
            output_text: JSON.stringify({
              status: 'analyzed',
              clarificationQuestions: [],
              aiSummary: 'Deep squats are the main training trigger described.',
              detectedSignals: [
                {
                  type: 'jointStressTag',
                  value: 'deep_knee_flexion',
                  recommendedDecision: 'caution',
                  cautionLevel: 'medium',
                  confidence: 'medium',
                  reason: 'Deep squats are reported as the main trigger.',
                },
              ],
            }),
          };
        },
      },
    },
  });

  assert.equal(requestedModel, 'small-task-model');
  assert.equal(result.status, 'analyzed');
  assert.deepEqual(result.clarificationQuestions, []);
  assert.equal(result.detectedSignals.length, 1);
});

test('analyzeMovementConstraints rejects needs_clarification without questions', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'needs_clarification',
          clarificationQuestions: [],
          aiSummary: null,
          detectedSignals: [],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /at least one question/);
      return true;
    }
  );
});

test('analyzeMovementConstraints rejects analyzed with clarification questions', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [{ id: 'q1', question: 'Does this happen during deep squats?' }],
          aiSummary: 'Deep squats are the main training trigger described.',
          detectedSignals: [],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /must not include clarification questions/);
      return true;
    }
  );
});

test('analyzeMovementConstraints rejects needs_clarification with detected signals', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'needs_clarification',
          clarificationQuestions: [{ id: 'q1', question: 'Does this happen during deep squats?' }],
          aiSummary: null,
          detectedSignals: [
            {
              type: 'movementPattern',
              value: 'squat_pattern',
              recommendedDecision: 'monitor',
              cautionLevel: 'none',
              confidence: 'low',
              reason: 'More detail is still needed.',
            },
          ],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /must not include detected signals/);
      return true;
    }
  );
});

test('analyzeMovementConstraints rejects more than four detected signals', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [],
          aiSummary: 'Several training signals were suggested.',
          detectedSignals: Array.from({ length: 5 }, (_, index) => ({
            type: 'movementPattern',
            value: index % 2 === 0 ? 'squat_pattern' : 'lunge_pattern',
            recommendedDecision: 'monitor',
            cautionLevel: 'none',
            confidence: 'low',
            reason: 'The description is broad.',
          })),
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /at most 4 signals/);
      return true;
    }
  );
});
