const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeMovementConstraints,
  buildSystemPrompt,
} = require('../../services/movementConstraintAnalysisService');

function createPayload(overrides = {}) {
  return {
    painIssue: {
      id: 'issue_knee',
      description: 'Knee discomfort during deep squats',
      affectedArea: 'knee',
      painSeverity: 'moderate',
      clarificationAnswers: [],
      ...(overrides.painIssue || {}),
    },
    context: {
      existingPainIssues: [],
      manualBlockedExerciseIds: [],
      ...(overrides.context || {}),
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

test('buildSystemPrompt tells the model to prefer direct analysis for clear movement triggers', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Do not diagnose/);
  assert.match(prompt, /Do not write "not a diagnosis" or "not medical advice"/);
  assert.match(prompt, /Ask clarification questions only when/);
  assert.match(prompt, /Prefer direct analysis/);
  assert.match(prompt, /1-3 prioritized detectedSignals/);
});

test('analyzeMovementConstraints accepts clear descriptions as analyzed without clarification questions', async () => {
  const result = await analyzeMovementConstraints(
    createPayload({
      painIssue: {
        description:
          'My knee feels uncomfortable during deep squats and lunges, but leg extension feels fine.',
      },
    }),
    {
      env: enabledEnv(),
      openaiResponse: {
        status: 'analyzed',
        clarificationQuestions: [],
        aiSummary:
          'Your description points mostly to loaded deep knee bending during squats and lunges.',
        detectedSignals: [
          {
            type: 'jointStressTag',
            value: 'deep_knee_flexion',
            recommendedDecision: 'caution',
            cautionLevel: 'medium',
            confidence: 'high',
            reason: 'The discomfort is described during deep squat and lunge positions.',
          },
        ],
      },
    }
  );

  assert.equal(result.status, 'analyzed');
  assert.deepEqual(result.clarificationQuestions, []);
  assert.equal(result.detectedSignals.length, 1);
});

test('analyzeMovementConstraints accepts vague descriptions as needs_clarification', async () => {
  const result = await analyzeMovementConstraints(
    createPayload({
      painIssue: {
        description: 'My knee hurts sometimes.',
      },
    }),
    {
      env: enabledEnv(),
      openaiResponse: {
        status: 'needs_clarification',
        clarificationQuestions: [
          {
            id: 'q1',
            question: 'Which movements trigger it most: squats, lunges, stairs, or leg extension?',
          },
        ],
        aiSummary: '',
        detectedSignals: [],
      },
    }
  );

  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.clarificationQuestions.length, 1);
  assert.deepEqual(result.detectedSignals, []);
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

test('analyzeMovementConstraints rejects analyzed without detected signals', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [],
          aiSummary: 'Deep squats are the main training trigger described.',
          detectedSignals: [],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /at least one detected signal/);
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

test('analyzeMovementConstraints rejects more than three detected signals', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [],
          aiSummary: 'Several training signals were suggested.',
          detectedSignals: Array.from({ length: 4 }, (_, index) => ({
            type: 'movementPattern',
            value: [
              'squat_pattern',
              'lunge_pattern',
              'knee_extension',
              'knee_flexion',
            ][index],
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
      assert.match(JSON.stringify(error.details), /at most 3 signals/);
      return true;
    }
  );
});

test('analyzeMovementConstraints safely corrects signal type when value belongs to another enum', async () => {
  const result = await analyzeMovementConstraints(createPayload(), {
    env: enabledEnv(),
    openaiResponse: {
      status: 'analyzed',
      clarificationQuestions: [],
      aiSummary: 'Deep knee bending is the relevant training constraint.',
      detectedSignals: [
        {
          type: 'movementPattern',
          value: 'deep_knee_flexion',
          recommendedDecision: 'caution',
          cautionLevel: 'medium',
          confidence: 'high',
          reason: 'Deep squat positions are reported as the trigger.',
        },
      ],
    },
  });

  assert.deepEqual(result.detectedSignals[0], {
    type: 'jointStressTag',
    value: 'deep_knee_flexion',
    recommendedDecision: 'caution',
    cautionLevel: 'medium',
    confidence: 'high',
    reason: 'Deep squat positions are reported as the trigger.',
  });
});

test('analyzeMovementConstraints rejects unknown signal values', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [],
          aiSummary: 'Deep knee bending is the relevant training constraint.',
          detectedSignals: [
            {
              type: 'jointStressTag',
              value: 'not_real_signal',
              recommendedDecision: 'caution',
              cautionLevel: 'medium',
              confidence: 'high',
              reason: 'Deep squat positions are reported as the trigger.',
            },
          ],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /Signal value is invalid/);
      return true;
    }
  );
});

test('analyzeMovementConstraints rejects medical-style summary and reason text', async () => {
  await assert.rejects(
    () =>
      analyzeMovementConstraints(createPayload(), {
        env: enabledEnv(),
        openaiResponse: {
          status: 'analyzed',
          clarificationQuestions: [],
          aiSummary: 'This is not a diagnosis, but it may be a medical condition.',
          detectedSignals: [
            {
              type: 'jointStressTag',
              value: 'deep_knee_flexion',
              recommendedDecision: 'caution',
              cautionLevel: 'medium',
              confidence: 'high',
              reason: 'Possible injury during deep squat positions.',
            },
          ],
        },
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE');
      assert.match(JSON.stringify(error.details), /medical wording/);
      return true;
    }
  );
});
