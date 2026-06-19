const exerciseEnums = require('../../exercise-library/exercise-enums.json');

const ANALYSIS_RESPONSE_STATUSES = new Set(['needs_clarification', 'analyzed']);
const AFFECTED_AREAS = new Set([
  'shoulder',
  'elbow',
  'wrist',
  'lower_back',
  'hip',
  'knee',
  'ankle',
  'neck_upper_back',
]);
const PAIN_SEVERITIES = new Set(['none', 'low', 'moderate', 'high', 'severe']);
const SIGNAL_TYPES = new Set(['movementPattern', 'jointStressTag']);
const SIGNAL_DECISIONS = new Set(['monitor', 'caution', 'blocked']);
const CAUTION_LEVELS = new Set(['none', 'low', 'medium', 'high']);
const CAUTION_LEVEL_WEIGHTS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const SIGNAL_VALUE_SETS = {
  movementPattern: new Set(exerciseEnums.movementPattern || []),
  jointStressTag: new Set(exerciseEnums.jointStressTags || []),
};

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_QUESTIONS = 3;
const MAX_QUESTION_LENGTH = 160;
const MAX_ANSWER_LENGTH = 500;
const MAX_AI_SUMMARY_LENGTH = 500;
const MAX_DETECTED_SIGNALS = 4;
const MAX_REASON_LENGTH = 180;

const FORBIDDEN_TEXT_PATTERNS = [
  /\bdiagnos(?:e|is|tic)\b/i,
  /\binjury diagnosis\b/i,
  /\bmedical assessment\b/i,
  /\bpatholog(?:y|ies|ical)\b/i,
  /\btreatment\b/i,
  /\brehabilitation\b/i,
  /\brehab\b/i,
  /\bsafe to continue\b/i,
];

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeLowerString(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function pushIssue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function ensureNoUnknownFields(object, allowedFields, issues, path, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return;
  }

  Object.keys(object).forEach((key) => {
    if (!allowedFields.has(key)) {
      pushIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `${label} contains an unknown field`);
    }
  });
}

function ensureBoundedString(value, issues, path, label, maxLength) {
  if (value == null) {
    return;
  }

  if (value.length > maxLength) {
    pushIssue(issues, path, 'STRING_TOO_LONG', `${label} must be at most ${maxLength} characters`);
  }
}

function containsForbiddenText(value) {
  const text = normalizeOptionalString(value);
  return Boolean(text && FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(text)));
}

function validateCautionLevel({ decision, cautionLevel, issues, path }) {
  if (!cautionLevel) {
    pushIssue(issues, path, 'REQUIRED', 'cautionLevel is required');
    return false;
  }

  if (!CAUTION_LEVELS.has(cautionLevel)) {
    pushIssue(issues, path, 'INVALID_ENUM', 'cautionLevel is invalid');
    return false;
  }

  if (decision === 'caution' && cautionLevel === 'none') {
    pushIssue(issues, path, 'INVALID_CAUTION_LEVEL', 'cautionLevel is required for caution');
    return false;
  }

  if (decision !== 'caution' && cautionLevel !== 'none') {
    pushIssue(
      issues,
      path,
      'INVALID_CAUTION_LEVEL',
      'cautionLevel must be none for monitor or blocked'
    );
    return false;
  }

  return true;
}

function validateSignalValue({ type, value, issues, path }) {
  if (!type) {
    pushIssue(issues, `${path}.type`, 'REQUIRED', 'Signal type is required');
  } else if (!SIGNAL_TYPES.has(type)) {
    pushIssue(issues, `${path}.type`, 'INVALID_ENUM', 'Signal type is invalid');
  }

  if (!value) {
    pushIssue(issues, `${path}.value`, 'REQUIRED', 'Signal value is required');
  } else if (type && SIGNAL_TYPES.has(type) && !SIGNAL_VALUE_SETS[type].has(value)) {
    pushIssue(issues, `${path}.value`, 'INVALID_ENUM', 'Signal value is invalid');
  }

  return Boolean(type && SIGNAL_TYPES.has(type) && value && SIGNAL_VALUE_SETS[type].has(value));
}

function validateAnalysisRequest(payload = {}) {
  const issues = [];
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const painIssue =
    source.painIssue && typeof source.painIssue === 'object' && !Array.isArray(source.painIssue)
      ? source.painIssue
      : {};
  const id = normalizeOptionalString(painIssue.id);
  const description = normalizeOptionalString(painIssue.description);
  const affectedArea = normalizeLowerString(painIssue.affectedArea);
  const painSeverity = normalizeLowerString(painIssue.painSeverity);
  const clarificationAnswers = toArray(painIssue.clarificationAnswers)
    .map((answer, index) => {
      const answerPath = `painIssue.clarificationAnswers[${index}]`;

      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
        pushIssue(issues, answerPath, 'INVALID_TYPE', 'Clarification answer must be an object');
        return null;
      }

      const questionId = normalizeOptionalString(answer.questionId);
      const answerText = normalizeOptionalString(answer.answer);

      if (!questionId) {
        pushIssue(issues, `${answerPath}.questionId`, 'REQUIRED', 'questionId is required');
      }

      if (!answerText) {
        pushIssue(issues, `${answerPath}.answer`, 'REQUIRED', 'answer is required');
      }

      ensureBoundedString(answerText, issues, `${answerPath}.answer`, 'answer', MAX_ANSWER_LENGTH);

      return questionId && answerText
        ? {
            questionId,
            answer: answerText,
          }
        : null;
    })
    .filter(Boolean);

  if (!id) {
    pushIssue(issues, 'painIssue.id', 'REQUIRED', 'Pain issue id is required');
  }

  if (!description) {
    pushIssue(issues, 'painIssue.description', 'REQUIRED', 'Pain issue description is required');
  }

  ensureBoundedString(
    description,
    issues,
    'painIssue.description',
    'Pain issue description',
    MAX_DESCRIPTION_LENGTH
  );

  if (!affectedArea) {
    pushIssue(issues, 'painIssue.affectedArea', 'REQUIRED', 'affectedArea is required');
  } else if (!AFFECTED_AREAS.has(affectedArea)) {
    pushIssue(issues, 'painIssue.affectedArea', 'INVALID_ENUM', 'affectedArea is invalid');
  }

  if (!painSeverity) {
    pushIssue(issues, 'painIssue.painSeverity', 'REQUIRED', 'painSeverity is required');
  } else if (!PAIN_SEVERITIES.has(painSeverity)) {
    pushIssue(issues, 'painIssue.painSeverity', 'INVALID_ENUM', 'painSeverity is invalid');
  }

  return {
    ok: issues.length === 0,
    value:
      issues.length === 0
        ? {
            painIssue: {
              id,
              description,
              affectedArea,
              painSeverity,
              clarificationAnswers,
            },
            context: {
              existingPainIssues: Array.isArray(source.context?.existingPainIssues)
                ? source.context.existingPainIssues
                : [],
              manualBlockedExerciseIds: Array.isArray(source.context?.manualBlockedExerciseIds)
                ? source.context.manualBlockedExerciseIds
                : [],
            },
          }
        : null,
    issues,
  };
}

function normalizeDetectedSignal(signal, issues, path) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
    pushIssue(issues, path, 'INVALID_TYPE', 'Detected signal must be an object');
    return null;
  }

  ensureNoUnknownFields(
    signal,
    new Set(['type', 'value', 'recommendedDecision', 'cautionLevel', 'confidence', 'reason']),
    issues,
    path,
    'Detected signal'
  );

  const type = normalizeOptionalString(signal.type);
  const value = normalizeLowerString(signal.value);
  const recommendedDecision = normalizeLowerString(signal.recommendedDecision);
  const cautionLevel = normalizeLowerString(signal.cautionLevel);
  const confidence = normalizeLowerString(signal.confidence);
  const reason = normalizeOptionalString(signal.reason);

  const validSignalValue = validateSignalValue({ type, value, issues, path });

  if (!recommendedDecision) {
    pushIssue(issues, `${path}.recommendedDecision`, 'REQUIRED', 'recommendedDecision is required');
  } else if (!SIGNAL_DECISIONS.has(recommendedDecision)) {
    pushIssue(issues, `${path}.recommendedDecision`, 'INVALID_ENUM', 'recommendedDecision is invalid');
  }

  const validCautionLevel = validateCautionLevel({
    decision: recommendedDecision,
    cautionLevel,
    issues,
    path: `${path}.cautionLevel`,
  });

  if (!confidence) {
    pushIssue(issues, `${path}.confidence`, 'REQUIRED', 'confidence is required');
  } else if (!CONFIDENCE_LEVELS.has(confidence)) {
    pushIssue(issues, `${path}.confidence`, 'INVALID_ENUM', 'confidence is invalid');
  }

  if (!reason) {
    pushIssue(issues, `${path}.reason`, 'REQUIRED', 'reason is required');
  }

  ensureBoundedString(reason, issues, `${path}.reason`, 'reason', MAX_REASON_LENGTH);

  if (reason && containsForbiddenText(reason)) {
    pushIssue(issues, `${path}.reason`, 'OUT_OF_SCOPE_TEXT', 'reason contains medical wording');
  }

  if (
    !validSignalValue ||
    !SIGNAL_DECISIONS.has(recommendedDecision) ||
    !validCautionLevel ||
    !CONFIDENCE_LEVELS.has(confidence) ||
    !reason
  ) {
    return null;
  }

  return {
    type,
    value,
    recommendedDecision,
    cautionLevel,
    confidence,
    reason,
  };
}

function validateAnalysisResponse(payload = {}) {
  const issues = [];
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

  ensureNoUnknownFields(
    source,
    new Set(['status', 'clarificationQuestions', 'aiSummary', 'detectedSignals']),
    issues,
    'response',
    'Analysis response'
  );

  const status = normalizeLowerString(source.status);
  const aiSummary = normalizeOptionalString(source.aiSummary);

  if (!status) {
    pushIssue(issues, 'status', 'REQUIRED', 'status is required');
  } else if (!ANALYSIS_RESPONSE_STATUSES.has(status)) {
    pushIssue(issues, 'status', 'INVALID_ENUM', 'status is invalid');
  }

  if (aiSummary) {
    ensureBoundedString(aiSummary, issues, 'aiSummary', 'aiSummary', MAX_AI_SUMMARY_LENGTH);
    if (containsForbiddenText(aiSummary)) {
      pushIssue(issues, 'aiSummary', 'OUT_OF_SCOPE_TEXT', 'aiSummary contains medical wording');
    }
  }

  const clarificationQuestions = toArray(source.clarificationQuestions).map((question, index) => {
    const questionPath = `clarificationQuestions[${index}]`;

    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      pushIssue(issues, questionPath, 'INVALID_TYPE', 'Clarification question must be an object');
      return null;
    }

    ensureNoUnknownFields(
      question,
      new Set(['id', 'question']),
      issues,
      questionPath,
      'Clarification question'
    );

    const id = normalizeOptionalString(question.id);
    const questionText = normalizeOptionalString(question.question);

    if (!id) {
      pushIssue(issues, `${questionPath}.id`, 'REQUIRED', 'Question id is required');
    }

    if (!questionText) {
      pushIssue(issues, `${questionPath}.question`, 'REQUIRED', 'Question is required');
    }

    ensureBoundedString(
      questionText,
      issues,
      `${questionPath}.question`,
      'Question',
      MAX_QUESTION_LENGTH
    );

    if (questionText && containsForbiddenText(questionText)) {
      pushIssue(
        issues,
        `${questionPath}.question`,
        'OUT_OF_SCOPE_TEXT',
        'Question contains medical wording'
      );
    }

    return id && questionText ? { id, question: questionText } : null;
  }).filter(Boolean);

  if (clarificationQuestions.length > MAX_QUESTIONS) {
    pushIssue(
      issues,
      'clarificationQuestions',
      'MAX_ITEMS_EXCEEDED',
      `clarificationQuestions must contain at most ${MAX_QUESTIONS} questions`
    );
  }

  if (status === 'needs_clarification' && clarificationQuestions.length < 1) {
    pushIssue(
      issues,
      'clarificationQuestions',
      'MIN_ITEMS_REQUIRED',
      'needs_clarification requires at least one question'
    );
  }

  if (status === 'analyzed' && clarificationQuestions.length > 0) {
    pushIssue(
      issues,
      'clarificationQuestions',
      'INVALID_STATE',
      'analyzed responses must not include clarification questions'
    );
  }

  const detectedSignals = toArray(source.detectedSignals)
    .slice(0, MAX_DETECTED_SIGNALS + 1)
    .map((signal, index) => normalizeDetectedSignal(signal, issues, `detectedSignals[${index}]`))
    .filter(Boolean);

  if (toArray(source.detectedSignals).length > MAX_DETECTED_SIGNALS) {
    pushIssue(
      issues,
      'detectedSignals',
      'MAX_ITEMS_EXCEEDED',
      `detectedSignals must contain at most ${MAX_DETECTED_SIGNALS} signals`
    );
  }

  if (status === 'needs_clarification' && toArray(source.detectedSignals).length > 0) {
    pushIssue(
      issues,
      'detectedSignals',
      'INVALID_STATE',
      'needs_clarification responses must not include detected signals'
    );
  }

  const dedupedSignals = [];
  const seenSignals = new Set();
  detectedSignals.forEach((signal) => {
    const key = `${signal.type}:${signal.value}`;
    if (seenSignals.has(key)) {
      return;
    }

    seenSignals.add(key);
    dedupedSignals.push(signal);
  });

  return {
    ok: issues.length === 0,
    value:
      issues.length === 0
        ? {
            status,
            clarificationQuestions:
              status === 'needs_clarification'
                ? clarificationQuestions.slice(0, MAX_QUESTIONS)
                : [],
            aiSummary: aiSummary || null,
            detectedSignals: status === 'analyzed' ? dedupedSignals : [],
          }
        : null,
    issues,
  };
}

function buildMovementAnalysisJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'clarificationQuestions', 'aiSummary', 'detectedSignals'],
    properties: {
      status: {
        type: 'string',
        enum: ['needs_clarification', 'analyzed'],
      },
      clarificationQuestions: {
        type: 'array',
        maxItems: MAX_QUESTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'question'],
          properties: {
            id: { type: 'string', maxLength: 40 },
            question: { type: 'string', maxLength: MAX_QUESTION_LENGTH },
          },
        },
      },
      aiSummary: {
        type: ['string', 'null'],
        maxLength: MAX_AI_SUMMARY_LENGTH,
      },
      detectedSignals: {
        type: 'array',
        maxItems: MAX_DETECTED_SIGNALS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'value',
            'recommendedDecision',
            'cautionLevel',
            'confidence',
            'reason',
          ],
          properties: {
            type: { type: 'string', enum: ['movementPattern', 'jointStressTag'] },
            value: {
              type: 'string',
              enum: [
                ...(exerciseEnums.movementPattern || []),
                ...(exerciseEnums.jointStressTags || []),
              ],
            },
            recommendedDecision: {
              type: 'string',
              enum: ['monitor', 'caution', 'blocked'],
            },
            cautionLevel: {
              type: 'string',
              enum: ['none', 'low', 'medium', 'high'],
            },
            confidence: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
            reason: {
              type: 'string',
              maxLength: MAX_REASON_LENGTH,
            },
          },
        },
      },
    },
  };
}

module.exports = {
  AFFECTED_AREAS,
  CAUTION_LEVEL_WEIGHTS,
  MAX_DETECTED_SIGNALS,
  buildMovementAnalysisJsonSchema,
  validateAnalysisRequest,
  validateAnalysisResponse,
};
