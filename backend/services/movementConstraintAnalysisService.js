const { getOpenAIClient } = require('../src/ai/openaiClient');
const { getModelForTask } = require('../src/ai/aiRouter');
const exerciseEnums = require('../src/exercise-library/exercise-enums.json');
const {
  buildMovementAnalysisJsonSchema,
  validateAnalysisRequest,
  validateAnalysisResponse,
} = require('../src/domain/trainingProfile/movementConstraintAnalysisValidation');

function createServiceError(status, code, message, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function isEnabled(env = process.env) {
  return String(env.ENABLE_AI_MOVEMENT_CONSTRAINTS || '').toLowerCase() === 'true';
}

function resolveTimeoutMs(env = process.env) {
  const parsed = Number(env.OPENAI_MOVEMENT_CONSTRAINTS_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12000;
}

function assertAnalysisAvailable(env = process.env) {
  if (!isEnabled(env) || !env.OPENAI_API_KEY) {
    throw createServiceError(
      503,
      'AI_MOVEMENT_CONSTRAINTS_DISABLED',
      'AI movement constraint analysis is not enabled'
    );
  }
}

function buildSystemPrompt() {
  return [
    'You are a training constraint analysis assistant for Lyft Zone.',
    'Do not diagnose or identify injuries, pathologies, or medical conditions.',
    'Do not recommend treatment, rehabilitation, or say a movement is safe.',
    'Do not write "not a diagnosis" or "not medical advice" in JSON fields; the app displays its own safety note separately.',
    'Only map the user description to suggested training constraint signals for the user to review.',
    'Use only provided enum values.',
    'Return JSON matching the schema.',
    'Ask clarification questions only when the provided description is too vague to select relevant training signals.',
    'Prefer direct analysis when the user clearly describes the triggering movement, position, range of motion, or exercise.',
    'If status is needs_clarification, return 1-3 clarificationQuestions and no detectedSignals.',
    'If status is analyzed, return clarificationQuestions as an empty array and 1-3 prioritized detectedSignals.',
    'If vague, return needs_clarification.',
    'Explain only how the training plan should handle what the user describes.',
  ].join('\n');
}

function buildUserPrompt(normalizedPayload) {
  return JSON.stringify({
    task: 'training constraint analysis',
    terminology: {
      analysis: 'training constraint analysis',
      painIssue: 'pain issue analysis',
      signals: 'suggested training signals',
    },
    decisionDefinitions: {
      monitor: 'Keep active for future check-in context. No exercise pool, scoring, or plan effect.',
      caution: 'Soft training constraint. Prefer alternatives when reasonable, but do not exclude from pool.',
      blocked: 'Hard training constraint. Exclude matching movementPattern or jointStressTag after confirmation.',
    },
    cautionLevel: {
      none: 'Required for monitor or blocked.',
      low: 'Small caution.',
      medium: 'Normal caution.',
      high: 'Strong caution, still not blocked.',
    },
    enums: {
      affectedArea: [
        'shoulder',
        'elbow',
        'wrist',
        'lower_back',
        'hip',
        'knee',
        'ankle',
        'neck_upper_back',
      ],
      painSeverity: ['none', 'low', 'moderate', 'high', 'severe'],
      movementPattern: exerciseEnums.movementPattern || [],
      jointStressTag: exerciseEnums.jointStressTags || [],
    },
    painIssue: normalizedPayload.painIssue,
    context: normalizedPayload.context,
  });
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }

  const textParts = [];
  (response?.output || []).forEach((item) => {
    (item?.content || []).forEach((content) => {
      if (typeof content?.text === 'string') {
        textParts.push(content.text);
      }
    });
  });

  return textParts.join('\n').trim();
}

function parseOpenAIResponse(response) {
  const outputText = extractOutputText(response);

  if (!outputText) {
    throw createServiceError(
      502,
      'AI_MOVEMENT_CONSTRAINTS_EMPTY_RESPONSE',
      'AI analysis returned an empty response'
    );
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw createServiceError(
      502,
      'AI_MOVEMENT_CONSTRAINTS_INVALID_JSON',
      'AI analysis returned invalid JSON'
    );
  }
}

async function callOpenAI({ client, model, input, timeoutMs }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    return await client.responses.create(
      {
        model,
        input,
        text: {
          format: {
            type: 'json_schema',
            name: 'movement_constraint_analysis',
            strict: true,
            schema: buildMovementAnalysisJsonSchema(),
          },
        },
        max_output_tokens: 1200,
        temperature: 0.2,
      },
      controller ? { signal: controller.signal } : undefined
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function analyzeMovementConstraints(payload, deps = {}) {
  const env = deps.env || process.env;

  assertAnalysisAvailable(env);

  const requestValidation = validateAnalysisRequest(payload);
  if (!requestValidation.ok) {
    throw createServiceError(
      400,
      'VALIDATION_ERROR',
      'Movement constraint analysis payload is invalid',
      requestValidation.issues
    );
  }

  const model = (deps.getModelForTask || getModelForTask)('movement_analysis');
  const response = deps.openaiResponse
    ? deps.openaiResponse
    : await callOpenAI({
        client: deps.openaiClient || getOpenAIClient(),
        model,
        timeoutMs: resolveTimeoutMs(env),
        input: [
          {
            role: 'system',
            content: buildSystemPrompt(),
          },
          {
            role: 'user',
            content: buildUserPrompt(requestValidation.value),
          },
        ],
      });
  const parsed = deps.openaiResponse ? response : parseOpenAIResponse(response);
  const responseValidation = validateAnalysisResponse(parsed);

  if (!responseValidation.ok) {
    throw createServiceError(
      502,
      'AI_MOVEMENT_CONSTRAINTS_INVALID_RESPONSE',
      'AI analysis response is invalid',
      responseValidation.issues
    );
  }

  return responseValidation.value;
}

module.exports = {
  analyzeMovementConstraints,
  buildSystemPrompt,
  buildUserPrompt,
  createServiceError,
  parseOpenAIResponse,
};
