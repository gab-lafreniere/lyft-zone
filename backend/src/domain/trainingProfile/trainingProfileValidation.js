const {
  AREA_DEFINITIONS,
  getAreaDefinition,
  isDeprioritizableArea,
  isInvalidParentChildConflict,
  isInvalidSiblingCombination,
  isMicroFocus,
  normalizeAreaName,
} = require('./trainingProfileRules');
const {
  isKnownEquipmentPreset,
  resolveEnvironmentInput,
} = require('./trainingProfileEnvironment');
const exerciseEnums = require('../../exercise-library/exercise-enums.json');

const TRAINING_GOALS = new Set([
  'HYPERTROPHY',
  'STRENGTH',
  'MIXED',
]);
const EQUIPMENT_BIASES = new Set(['machines', 'free_weights', 'no_preference']);
const EXPERIENCE_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const PAIN_SEVERITIES = new Set(['none', 'low', 'moderate', 'high', 'severe']);
const TRAINING_RULES = new Set(['none', 'monitor', 'limit', 'modify', 'avoid']);
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
const ANALYSIS_STATUSES = new Set(['draft', 'needs_clarification', 'analyzed', 'needs_reanalysis']);
const SIGNAL_TYPES = new Set(['movementPattern', 'jointStressTag']);
const SIGNAL_DECISIONS = new Set(['monitor', 'caution', 'blocked']);
const CAUTION_LEVELS = new Set(['none', 'low', 'medium', 'high']);
const CAUTION_LEVEL_WEIGHTS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const SIGNAL_DECISION_WEIGHTS = {
  monitor: 1,
  caution: 2,
  blocked: 3,
};
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const SIGNAL_VALUE_SETS = {
  movementPattern: new Set(exerciseEnums.movementPattern || []),
  jointStressTag: new Set(exerciseEnums.jointStressTags || []),
};
const MAX_SHORT_TEXT = 120;
const MAX_LONG_TEXT = 1000;
const MAX_PAIN_DESCRIPTION = 500;
const MAX_PAIN_ISSUES = 5;
const MAX_DETECTED_SIGNALS = 4;
const MAX_CLARIFICATION_QUESTIONS = 3;
const MAX_CLARIFICATION_QUESTION = 160;
const MAX_CLARIFICATION_ANSWER = 500;
const MAX_AI_SUMMARY = 500;
const MAX_REASON = 180;

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

function normalizeAreaArray(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => normalizeAreaName(entry))
        .filter(Boolean)
    )
  );
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => normalizeLowerString(entry))
        .filter(Boolean)
    )
  );
}

function normalizeSignalType(value) {
  const normalized = normalizeOptionalString(value);
  return normalized || null;
}

function normalizeInteger(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

function pushIssue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function ensureBoundedString(value, issues, path, label, maxLength = MAX_SHORT_TEXT) {
  if (value == null) {
    return;
  }

  if (value.length > maxLength) {
    pushIssue(issues, path, 'STRING_TOO_LONG', `${label} must be at most ${maxLength} characters`);
  }
}

function ensureKnownAreas(values, issues, path) {
  values.forEach((value, index) => {
    if (!getAreaDefinition(value)) {
      pushIssue(issues, `${path}[${index}]`, 'UNKNOWN_AREA', 'Area is not recognized');
    }
  });
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeCautionLevel(value, decision) {
  const normalized = normalizeLowerString(value);

  if (normalized) {
    return normalized;
  }

  return decision === 'caution' ? 'medium' : 'none';
}

function validateCautionLevel(cautionLevel, decision, issues, path) {
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

function isHigherPrioritySignal(candidate, current) {
  if (!current) {
    return true;
  }

  const candidateDecisionWeight = SIGNAL_DECISION_WEIGHTS[candidate.decision] || 0;
  const currentDecisionWeight = SIGNAL_DECISION_WEIGHTS[current.decision] || 0;

  if (candidateDecisionWeight !== currentDecisionWeight) {
    return candidateDecisionWeight > currentDecisionWeight;
  }

  return (
    (CAUTION_LEVEL_WEIGHTS[candidate.cautionLevel] || 0) >
    (CAUTION_LEVEL_WEIGHTS[current.cautionLevel] || 0)
  );
}

function normalizeDetectedSignals(value, issues, path) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalizedSignals = [];
  const seen = new Set();

  if (values.length > MAX_DETECTED_SIGNALS) {
    pushIssue(
      issues,
      path,
      'MAX_ITEMS_EXCEEDED',
      `detectedSignals must contain at most ${MAX_DETECTED_SIGNALS} signals`
    );
  }

  values.slice(0, MAX_DETECTED_SIGNALS).forEach((signal, index) => {
    const signalPath = `${path}[${index}]`;

    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      pushIssue(issues, signalPath, 'INVALID_TYPE', 'Signal must be an object');
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeLowerString(signal.value);
    const recommendedDecision = normalizeLowerString(signal.recommendedDecision);
    const cautionLevel = normalizeCautionLevel(signal.cautionLevel, recommendedDecision);
    const confidence = normalizeLowerString(signal.confidence);
    const reason = normalizeOptionalString(signal.reason);

    if (!type) {
      pushIssue(issues, `${signalPath}.type`, 'REQUIRED', 'Signal type is required');
    } else if (!SIGNAL_TYPES.has(type)) {
      pushIssue(issues, `${signalPath}.type`, 'INVALID_ENUM', 'Signal type is invalid');
    }

    if (!signalValue) {
      pushIssue(issues, `${signalPath}.value`, 'REQUIRED', 'Signal value is required');
    } else if (type && SIGNAL_TYPES.has(type) && !SIGNAL_VALUE_SETS[type].has(signalValue)) {
      pushIssue(issues, `${signalPath}.value`, 'INVALID_ENUM', 'Signal value is invalid');
    }

    if (recommendedDecision && !SIGNAL_DECISIONS.has(recommendedDecision)) {
      pushIssue(
        issues,
        `${signalPath}.recommendedDecision`,
        'INVALID_ENUM',
        'recommendedDecision is invalid'
      );
    }

    if (recommendedDecision && SIGNAL_DECISIONS.has(recommendedDecision)) {
      validateCautionLevel(cautionLevel, recommendedDecision, issues, `${signalPath}.cautionLevel`);
    } else if (signal.cautionLevel != null && !CAUTION_LEVELS.has(cautionLevel)) {
      pushIssue(issues, `${signalPath}.cautionLevel`, 'INVALID_ENUM', 'cautionLevel is invalid');
    }

    if (confidence && !CONFIDENCE_LEVELS.has(confidence)) {
      pushIssue(issues, `${signalPath}.confidence`, 'INVALID_ENUM', 'confidence is invalid');
    }

    ensureBoundedString(reason, issues, `${signalPath}.reason`, 'reason', MAX_REASON);

    if (!type || !SIGNAL_TYPES.has(type) || !signalValue) {
      return;
    }

    const key = `${type}:${signalValue}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    const normalizedSignal = {
      type,
      value: signalValue,
    };

    if (recommendedDecision && SIGNAL_DECISIONS.has(recommendedDecision)) {
      normalizedSignal.recommendedDecision = recommendedDecision;
      normalizedSignal.cautionLevel = cautionLevel;
    }

    if (confidence && CONFIDENCE_LEVELS.has(confidence)) {
      normalizedSignal.confidence = confidence;
    }

    if (reason) {
      normalizedSignal.reason = reason;
    }

    normalizedSignals.push(normalizedSignal);
  });

  return normalizedSignals;
}

function normalizeConfirmedSignals(value, issues, path) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const signalsByKey = new Map();
  const order = [];
  const decisionsBySignalKey = new Map();

  values.forEach((signal, index) => {
    const signalPath = `${path}[${index}]`;

    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      pushIssue(issues, signalPath, 'INVALID_TYPE', 'Signal must be an object');
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeLowerString(signal.value);
    const decision = normalizeLowerString(signal.decision);
    const cautionLevel = normalizeCautionLevel(signal.cautionLevel, decision);

    if (!type) {
      pushIssue(issues, `${signalPath}.type`, 'REQUIRED', 'Signal type is required');
    } else if (!SIGNAL_TYPES.has(type)) {
      pushIssue(issues, `${signalPath}.type`, 'INVALID_ENUM', 'Signal type is invalid');
    }

    if (!signalValue) {
      pushIssue(issues, `${signalPath}.value`, 'REQUIRED', 'Signal value is required');
    } else if (type && SIGNAL_TYPES.has(type) && !SIGNAL_VALUE_SETS[type].has(signalValue)) {
      pushIssue(issues, `${signalPath}.value`, 'INVALID_ENUM', 'Signal value is invalid');
    }

    if (!decision) {
      pushIssue(issues, `${signalPath}.decision`, 'REQUIRED', 'Signal decision is required');
    } else if (!SIGNAL_DECISIONS.has(decision)) {
      pushIssue(issues, `${signalPath}.decision`, 'INVALID_ENUM', 'Signal decision is invalid');
    }

    const validCautionLevel =
      decision && SIGNAL_DECISIONS.has(decision)
        ? validateCautionLevel(cautionLevel, decision, issues, `${signalPath}.cautionLevel`)
        : true;

    if (
      !type ||
      !SIGNAL_TYPES.has(type) ||
      !signalValue ||
      !SIGNAL_DECISIONS.has(decision) ||
      !validCautionLevel
    ) {
      return;
    }

    const signalKey = `${type}:${signalValue}`;
    const existingDecision = decisionsBySignalKey.get(signalKey);

    if (existingDecision) {
      decisionsBySignalKey.set(signalKey, decision);
    } else {
      decisionsBySignalKey.set(signalKey, decision);
      order.push(signalKey);
    }

    const normalizedSignal = {
      type,
      value: signalValue,
      decision,
      cautionLevel,
    };

    if (isHigherPrioritySignal(normalizedSignal, signalsByKey.get(signalKey))) {
      signalsByKey.set(signalKey, normalizedSignal);
    }
  });

  return order.map((key) => signalsByKey.get(key)).filter(Boolean);
}

function normalizeClarificationQuestions(value, issues, path) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];

  if (values.length > MAX_CLARIFICATION_QUESTIONS) {
    pushIssue(
      issues,
      path,
      'MAX_ITEMS_EXCEEDED',
      `clarificationQuestions must contain at most ${MAX_CLARIFICATION_QUESTIONS} questions`
    );
  }

  return values
    .slice(0, MAX_CLARIFICATION_QUESTIONS)
    .map((question, index) => {
      const questionPath = `${path}[${index}]`;

      if (!question || typeof question !== 'object' || Array.isArray(question)) {
        pushIssue(issues, questionPath, 'INVALID_TYPE', 'Clarification question must be an object');
        return null;
      }

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
        MAX_CLARIFICATION_QUESTION
      );

      return id && questionText ? { id, question: questionText } : null;
    })
    .filter(Boolean);
}

function normalizeClarificationAnswers(value, issues, path) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];

  return values
    .map((answer, index) => {
      const answerPath = `${path}[${index}]`;

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

      ensureBoundedString(
        answerText,
        issues,
        `${answerPath}.answer`,
        'answer',
        MAX_CLARIFICATION_ANSWER
      );

      return questionId && answerText ? { questionId, answer: answerText } : null;
    })
    .filter(Boolean);
}

function normalizePainIssues(value, issues, path = 'movementConstraints.painIssues') {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalizedIssues = [];
  const seenIds = new Set();

  if (values.length > MAX_PAIN_ISSUES) {
    pushIssue(
      issues,
      path,
      'MAX_ITEMS_EXCEEDED',
      `painIssues must contain at most ${MAX_PAIN_ISSUES} issues`
    );
  }

  values.slice(0, MAX_PAIN_ISSUES).forEach((issue, index) => {
    const issuePath = `${path}[${index}]`;

    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      pushIssue(issues, issuePath, 'INVALID_TYPE', 'Pain issue must be an object');
      return;
    }

    const id = normalizeOptionalString(issue.id);
    const description = normalizeOptionalString(issue.description);
    const affectedArea = normalizeLowerString(issue.affectedArea);
    const painSeverity = normalizeLowerString(issue.painSeverity);
    const trainingRule = normalizeLowerString(issue.trainingRule);
    const analysisStatus = normalizeLowerString(issue.analysisStatus) || 'draft';
    const aiSummary = normalizeOptionalString(issue.aiSummary);

    if (!id) {
      pushIssue(issues, `${issuePath}.id`, 'REQUIRED', 'Pain issue id is required');
    } else if (seenIds.has(id)) {
      pushIssue(issues, `${issuePath}.id`, 'DUPLICATE_VALUE', 'Pain issue id must be unique');
    } else {
      seenIds.add(id);
    }

    if (!description) {
      pushIssue(
        issues,
        `${issuePath}.description`,
        'REQUIRED',
        'Pain issue description is required'
      );
    }
    ensureBoundedString(
      description,
      issues,
      `${issuePath}.description`,
      'Pain issue description',
      MAX_PAIN_DESCRIPTION
    );

    if (!affectedArea) {
      pushIssue(issues, `${issuePath}.affectedArea`, 'REQUIRED', 'affectedArea is required');
    } else if (!AFFECTED_AREAS.has(affectedArea)) {
      pushIssue(issues, `${issuePath}.affectedArea`, 'INVALID_ENUM', 'affectedArea is invalid');
    }

    if (!painSeverity) {
      pushIssue(issues, `${issuePath}.painSeverity`, 'REQUIRED', 'painSeverity is required');
    } else if (!PAIN_SEVERITIES.has(painSeverity)) {
      pushIssue(issues, `${issuePath}.painSeverity`, 'INVALID_ENUM', 'painSeverity is invalid');
    }

    if (trainingRule && !TRAINING_RULES.has(trainingRule)) {
      pushIssue(issues, `${issuePath}.trainingRule`, 'INVALID_ENUM', 'trainingRule is invalid');
    }

    ensureBoundedString(aiSummary, issues, `${issuePath}.aiSummary`, 'aiSummary', MAX_AI_SUMMARY);

    if (!ANALYSIS_STATUSES.has(analysisStatus)) {
      pushIssue(
        issues,
        `${issuePath}.analysisStatus`,
        'INVALID_ENUM',
        'analysisStatus is invalid'
      );
    }

    normalizedIssues.push({
      id,
      description,
      affectedArea,
      painSeverity,
      trainingRule,
      analysisStatus,
      clarificationQuestions: normalizeClarificationQuestions(
        issue.clarificationQuestions,
        issues,
        `${issuePath}.clarificationQuestions`
      ),
      clarificationAnswers: normalizeClarificationAnswers(
        issue.clarificationAnswers,
        issues,
        `${issuePath}.clarificationAnswers`
      ),
      aiSummary,
      detectedSignals: normalizeDetectedSignals(
        issue.detectedSignals,
        issues,
        `${issuePath}.detectedSignals`
      ),
      confirmedSignals: normalizeConfirmedSignals(
        issue.confirmedSignals,
        issues,
        `${issuePath}.confirmedSignals`
      ),
    });
  });

  return normalizedIssues;
}

function normalizeMovementConstraintsInput(movementConstraints = {}, issues = []) {
  const source =
    movementConstraints && typeof movementConstraints === 'object' && !Array.isArray(movementConstraints)
      ? movementConstraints
      : {};
  const hasModernShape =
    hasOwn(source, 'painIssues') || hasOwn(source, 'manualBlockedExerciseIds');

  return {
    painIssues: hasModernShape
      ? normalizePainIssues(source.painIssues, issues)
      : [],
    manualBlockedExerciseIds: normalizeStringArray(
      hasModernShape ? source.manualBlockedExerciseIds : source.blockedExerciseIds
    ),
  };
}

function validateTrainingProfileInput(payload) {
  const issues = [];
  const primaryGoal = normalizeOptionalString(payload?.primaryGoal)?.toUpperCase() || null;
  const musclePrioritiesInput =
    payload?.musclePriorities && typeof payload.musclePriorities === 'object'
      ? payload.musclePriorities
      : {};
  const primaryFocusValues = normalizeAreaArray(musclePrioritiesInput.primaryFocus);
  const secondaryFocuses = normalizeAreaArray(musclePrioritiesInput.secondaryFocuses);
  const deprioritizedAreas = normalizeAreaArray(musclePrioritiesInput.deprioritizedArea);
  const primaryFocus = primaryFocusValues[0] || null;
  const deprioritizedArea = deprioritizedAreas[0] || null;
  const sessionsPerWeek = normalizeInteger(payload?.availability?.sessionsPerWeek);
  const durationPerSession = normalizeInteger(payload?.availability?.durationPerSession);
  const experience = normalizeLowerString(payload?.experience);
  const environment = resolveEnvironmentInput(payload?.environment);
  const movementConstraints = normalizeMovementConstraintsInput(
    payload?.movementConstraints,
    issues
  );
  const equipmentBias = normalizeLowerString(payload?.exercisePreference?.equipmentBias);
  const cardioRole = normalizeLowerString(payload?.cardioProfile?.cardioRole);
  const preferredModalities = normalizeStringArray(payload?.cardioProfile?.preferredModalities);
  const physicalNotes = normalizeOptionalString(payload?.physicalNotes);

  if (!primaryGoal) {
    pushIssue(issues, 'primaryGoal', 'REQUIRED', 'primaryGoal is required');
  } else if (!TRAINING_GOALS.has(primaryGoal)) {
    pushIssue(issues, 'primaryGoal', 'INVALID_ENUM', 'primaryGoal is invalid');
  }

  if (primaryFocusValues.length > 1) {
    pushIssue(
      issues,
      'musclePriorities.primaryFocus',
      'MAX_ITEMS_EXCEEDED',
      'primaryFocus must contain at most one value'
    );
  }

  if (secondaryFocuses.length > 2) {
    pushIssue(
      issues,
      'musclePriorities.secondaryFocuses',
      'MAX_ITEMS_EXCEEDED',
      'secondaryFocuses must contain at most two values'
    );
  }

  if (deprioritizedAreas.length > 1) {
    pushIssue(
      issues,
      'musclePriorities.deprioritizedArea',
      'MAX_ITEMS_EXCEEDED',
      'deprioritizedArea must contain at most one value'
    );
  }

  ensureKnownAreas(primaryFocusValues, issues, 'musclePriorities.primaryFocus');
  ensureKnownAreas(secondaryFocuses, issues, 'musclePriorities.secondaryFocuses');
  ensureKnownAreas(deprioritizedAreas, issues, 'musclePriorities.deprioritizedArea');

  if (primaryFocus && secondaryFocuses.includes(primaryFocus)) {
    pushIssue(
      issues,
      'musclePriorities.secondaryFocuses',
      'DUPLICATE_PRIORITY',
      'secondaryFocuses cannot repeat the primaryFocus'
    );
  }

  if (deprioritizedArea) {
    if (primaryFocus === deprioritizedArea || secondaryFocuses.includes(deprioritizedArea)) {
      pushIssue(
        issues,
        'musclePriorities.deprioritizedArea',
        'CONFLICTING_PRIORITY',
        'deprioritizedArea cannot also be a focus area'
      );
    }

    if (!isDeprioritizableArea(deprioritizedArea)) {
      pushIssue(
        issues,
        'musclePriorities.deprioritizedArea',
        'INVALID_DEPRIORITIZED_AREA',
        'deprioritizedArea must target a region or major muscle group'
      );
    }

    if (isMicroFocus(deprioritizedArea)) {
      pushIssue(
        issues,
        'musclePriorities.deprioritizedArea',
        'INVALID_DEPRIORITIZED_AREA',
        'deprioritizedArea cannot target a micro-focus'
      );
    }

    [primaryFocus, ...secondaryFocuses].filter(Boolean).forEach((focusArea) => {
      if (isInvalidParentChildConflict(focusArea, deprioritizedArea)) {
        pushIssue(
          issues,
          'musclePriorities.deprioritizedArea',
          'PARENT_CHILD_CONFLICT',
          'Cannot deprioritize a parent area of a focused muscle'
        );
      }

      if (isInvalidSiblingCombination(focusArea, deprioritizedArea)) {
        pushIssue(
          issues,
          'musclePriorities.deprioritizedArea',
          'BIOMECHANICAL_CONFLICT',
          'This focus/deprioritize combination is blocked by the biomechanical matrix'
        );
      }
    });
  }

  if (sessionsPerWeek == null || sessionsPerWeek < 1 || sessionsPerWeek > 7) {
    pushIssue(
      issues,
      'availability.sessionsPerWeek',
      'INVALID_RANGE',
      'sessionsPerWeek must be an integer between 1 and 7'
    );
  }

  if (durationPerSession == null || durationPerSession < 15 || durationPerSession > 240) {
    pushIssue(
      issues,
      'availability.durationPerSession',
      'INVALID_RANGE',
      'durationPerSession must be an integer between 15 and 240'
    );
  }

  if (!experience) {
    pushIssue(issues, 'experience', 'REQUIRED', 'experience is required');
  }

  if (experience && !EXPERIENCE_LEVELS.has(experience)) {
    pushIssue(issues, 'experience', 'INVALID_ENUM', 'experience is invalid');
  }

  if (!isKnownEquipmentPreset(environment.equipmentPreset)) {
    pushIssue(
      issues,
      'environment.equipmentPreset',
      'INVALID_ENUM',
      'equipmentPreset is invalid'
    );
  }

  if (equipmentBias && !EQUIPMENT_BIASES.has(equipmentBias)) {
    pushIssue(
      issues,
      'exercisePreference.equipmentBias',
      'INVALID_ENUM',
      'equipmentBias is invalid'
    );
  }

  [environment.equipmentPreset, cardioRole].forEach((value, index) => {
    const paths = [
      'environment.equipmentPreset',
      'cardioProfile.cardioRole',
    ];
    const labels = [
      'equipmentPreset',
      'cardioRole',
    ];
    ensureBoundedString(value, issues, paths[index], labels[index]);
  });

  ensureBoundedString(physicalNotes, issues, 'physicalNotes', 'physicalNotes', MAX_LONG_TEXT);

  const normalizedValue = {
    primaryGoal,
    musclePriorities: {
      primaryFocus,
      secondaryFocuses,
      deprioritizedArea,
    },
    experience,
    availability: {
      sessionsPerWeek,
      durationPerSession,
    },
    environment: {
      equipmentPreset: environment.equipmentPreset,
      availableEquipment: environment.availableEquipment,
    },
    movementConstraints,
    exercisePreference: {
      equipmentBias: equipmentBias || 'no_preference',
    },
    cardioProfile: {
      cardioRole,
      preferredModalities,
    },
    physicalNotes,
  };

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? normalizedValue : null,
    issues,
    meta: {
      knownAreas: Object.keys(AREA_DEFINITIONS),
    },
  };
}

module.exports = {
  EQUIPMENT_BIASES,
  EXPERIENCE_LEVELS,
  PAIN_SEVERITIES,
  TRAINING_GOALS,
  TRAINING_RULES,
  normalizeMovementConstraintsInput,
  validateTrainingProfileInput,
};
