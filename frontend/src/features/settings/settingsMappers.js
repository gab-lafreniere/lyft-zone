const EQUIPMENT_ALIASES = {
  selectorized_shoulder_press: "shoulder_press_machine",
};

const EQUIPMENT_PRESET_ALIASES = {
  limited_gym: "commercial_gym",
};

const VALID_ANALYSIS_STATUSES = new Set([
  "draft",
  "needs_clarification",
  "analyzed",
  "needs_reanalysis",
]);
const VALID_SIGNAL_TYPES = new Set(["movementPattern", "jointStressTag"]);
const VALID_SIGNAL_DECISIONS = new Set(["monitor", "caution", "blocked"]);
const VALID_CAUTION_LEVELS = new Set(["none", "low", "medium", "high"]);
const VALID_CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEquipmentPreset(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  return EQUIPMENT_PRESET_ALIASES[normalized] || normalized;
}

function normalizeEquipmentValue(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  return EQUIPMENT_ALIASES[normalized] || normalized;
}

function normalizeEquipmentList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(values.map(normalizeEquipmentValue).filter(Boolean))
  );
}

function ensureAvailableEquipment(value) {
  const equipment = normalizeEquipmentList(value);
  return equipment.length ? equipment : ["bodyweight"];
}

function normalizeOptionalText(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeSignalType(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeDetectedSignals(value) {
  const seen = new Set();
  const signals = [];

  toArray(value).forEach((signal) => {
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeString(signal.value);
    const recommendedDecision = normalizeString(signal.recommendedDecision);
    const cautionLevel = normalizeString(signal.cautionLevel);
    const confidence = normalizeString(signal.confidence);
    const reason = normalizeOptionalText(signal.reason);

    if (!VALID_SIGNAL_TYPES.has(type) || !signalValue) {
      return;
    }

    const key = `${type}:${signalValue}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    const normalizedSignal = { type, value: signalValue };

    if (VALID_SIGNAL_DECISIONS.has(recommendedDecision)) {
      normalizedSignal.recommendedDecision = recommendedDecision;
      normalizedSignal.cautionLevel =
        VALID_CAUTION_LEVELS.has(cautionLevel) ? cautionLevel : recommendedDecision === "caution" ? "medium" : "none";
    }

    if (VALID_CONFIDENCE_LEVELS.has(confidence)) {
      normalizedSignal.confidence = confidence;
    }

    if (reason) {
      normalizedSignal.reason = reason;
    }

    signals.push(normalizedSignal);
  });

  return signals;
}

function normalizeConfirmedSignals(value) {
  const decisionsByKey = new Map();
  const signals = [];

  toArray(value).forEach((signal) => {
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeString(signal.value);
    const decision = normalizeString(signal.decision);
    const cautionLevel = normalizeString(signal.cautionLevel);

    if (!VALID_SIGNAL_TYPES.has(type) || !signalValue || !VALID_SIGNAL_DECISIONS.has(decision)) {
      return;
    }

    const key = `${type}:${signalValue}`;
    if (decisionsByKey.has(key)) {
      return;
    }

    decisionsByKey.set(key, decision);
    signals.push({
      type,
      value: signalValue,
      decision,
      cautionLevel:
        VALID_CAUTION_LEVELS.has(cautionLevel) ? cautionLevel : decision === "caution" ? "medium" : "none",
    });
  });

  return signals;
}

export function isCompletePainIssue(issue) {
  return Boolean(
    normalizeOptionalText(issue?.id) &&
      normalizeOptionalText(issue?.description) &&
      normalizeString(issue?.affectedArea) &&
      normalizeString(issue?.painSeverity)
  );
}

function normalizeClarificationQuestions(value) {
  return toArray(value)
    .filter((question) => question && typeof question === "object" && !Array.isArray(question))
    .map((question) => ({
      id: normalizeOptionalText(question.id),
      question: normalizeOptionalText(question.question),
    }))
    .filter((question) => question.id && question.question);
}

function normalizeClarificationAnswers(value) {
  return toArray(value)
    .filter((answer) => answer && typeof answer === "object" && !Array.isArray(answer))
    .map((answer) => ({
      questionId: normalizeOptionalText(answer.questionId),
      answer: normalizeOptionalText(answer.answer),
    }))
    .filter((answer) => answer.questionId && answer.answer);
}

function normalizePainIssue(issue, { requireComplete = false } = {}) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    return null;
  }

  const id = normalizeOptionalText(issue.id);
  const description = normalizeOptionalText(issue.description);
  const affectedArea = normalizeString(issue.affectedArea);
  const painSeverity = normalizeString(issue.painSeverity);
  const trainingRule = normalizeString(issue.trainingRule);
  const analysisStatus = normalizeString(issue.analysisStatus);
  const normalizedIssue = {
    id,
    description,
    affectedArea,
    painSeverity,
    trainingRule,
    analysisStatus: VALID_ANALYSIS_STATUSES.has(analysisStatus)
      ? analysisStatus
      : "draft",
    clarificationQuestions: normalizeClarificationQuestions(issue.clarificationQuestions),
    clarificationAnswers: normalizeClarificationAnswers(issue.clarificationAnswers),
    aiSummary: normalizeOptionalText(issue.aiSummary),
    detectedSignals: normalizeDetectedSignals(issue.detectedSignals),
    confirmedSignals: normalizeConfirmedSignals(issue.confirmedSignals),
  };

  if (requireComplete && !isCompletePainIssue(normalizedIssue)) {
    return null;
  }

  return normalizedIssue;
}

function legacyPainIssueFromMovementConstraints(movementConstraints) {
  const description = normalizeOptionalText(movementConstraints?.painDescription);
  const affectedArea = normalizeString(movementConstraints?.affectedArea);
  const painSeverity = normalizeString(movementConstraints?.painSeverity);
  const trainingRule = normalizeString(movementConstraints?.trainingRule);

  if (!description && !affectedArea && !painSeverity && !trainingRule) {
    return null;
  }

  return {
    id: "legacy_issue",
    description,
    affectedArea,
    painSeverity,
    trainingRule,
    analysisStatus: "draft",
    detectedSignals: [],
    confirmedSignals: [],
  };
}

function normalizeMovementConstraintsDraft(movementConstraints = {}) {
  const source =
    movementConstraints && typeof movementConstraints === "object" && !Array.isArray(movementConstraints)
      ? movementConstraints
      : {};
  const painIssues = Array.isArray(source.painIssues)
    ? source.painIssues.map((issue) => normalizePainIssue(issue)).filter(Boolean)
    : [];
  const legacyIssue = painIssues.length ? null : legacyPainIssueFromMovementConstraints(source);

  return {
    painIssues: legacyIssue ? [legacyIssue] : painIssues,
    manualBlockedExerciseIds: Array.from(
      new Set(
        toArray(source.manualBlockedExerciseIds ?? source.blockedExerciseIds)
          .map(normalizeString)
          .filter(Boolean)
      )
    ),
  };
}

function normalizeMovementConstraintsPayload(movementConstraints = {}) {
  const normalizedDraft = normalizeMovementConstraintsDraft(movementConstraints);

  return {
    painIssues: normalizedDraft.painIssues
      .map((issue) => normalizePainIssue(issue, { requireComplete: true }))
      .filter(Boolean),
    manualBlockedExerciseIds: normalizedDraft.manualBlockedExerciseIds,
  };
}

export function modernizeTrainingProfileDraft(trainingProfileDraft) {
  const nextDraft = deepClone(trainingProfileDraft || {});
  const environment = nextDraft.environment || {};
  const equipmentPreset = normalizeEquipmentPreset(
    environment.equipmentPreset ?? environment.equipmentSetup
  );

  nextDraft.environment = {
    equipmentPreset,
    availableEquipment: ensureAvailableEquipment(
      environment.availableEquipment ?? environment.equipmentList
    ),
  };
  nextDraft.movementConstraints = normalizeMovementConstraintsDraft(
    nextDraft.movementConstraints
  );

  return nextDraft;
}

export function createTrainingProfileDraft(settingsData) {
  return modernizeTrainingProfileDraft(settingsData?.trainingProfile?.profile || {});
}

export function toTrainingProfilePayload(trainingProfileDraft) {
  const payload = modernizeTrainingProfileDraft(trainingProfileDraft);
  payload.movementConstraints = normalizeMovementConstraintsPayload(
    trainingProfileDraft?.movementConstraints
  );

  return payload;
}

export function toPersistableTrainingProfileDraft(trainingProfileDraft) {
  return toTrainingProfilePayload(trainingProfileDraft);
}

export function serializePersistableTrainingProfileDraft(trainingProfileDraft) {
  return JSON.stringify(toPersistableTrainingProfileDraft(trainingProfileDraft) || null);
}

export function mergeLocalIncompletePainIssues(baseDraft, localDraft) {
  const nextDraft = deepClone(baseDraft || {});
  const baseIssues = toArray(nextDraft?.movementConstraints?.painIssues);
  const localIssues = toArray(localDraft?.movementConstraints?.painIssues);
  const baseIssueIds = new Set(baseIssues.map((issue) => issue?.id).filter(Boolean));
  const incompleteLocalIssues = localIssues.filter(
    (issue) => issue?.id && !isCompletePainIssue(issue) && !baseIssueIds.has(issue.id)
  );

  if (!incompleteLocalIssues.length) {
    return nextDraft;
  }

  nextDraft.movementConstraints = {
    ...(nextDraft.movementConstraints || {}),
    painIssues: [...baseIssues, ...deepClone(incompleteLocalIssues)],
  };

  return nextDraft;
}

export function areTrainingProfilesEqual(left, right) {
  return (
    serializePersistableTrainingProfileDraft(left) ===
    serializePersistableTrainingProfileDraft(right)
  );
}

export function mapApiErrorDetails(details) {
  const fieldErrors = {};
  const formErrors = [];

  if (!Array.isArray(details)) {
    return { fieldErrors, formErrors };
  }

  details.forEach((detail) => {
    const path = String(detail?.path || "").trim();
    const message = String(detail?.message || "Invalid value").trim();

    if (!message) {
      return;
    }

    if (path) {
      if (!fieldErrors[path]) {
        fieldErrors[path] = message;
      }
      return;
    }

    formErrors.push(message);
  });

  return { fieldErrors, formErrors };
}

export function findFieldError(fieldErrors, paths = []) {
  for (const path of paths) {
    if (!path) {
      continue;
    }

    if (fieldErrors[path]) {
      return fieldErrors[path];
    }
  }

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const matchingPath = Object.keys(fieldErrors).find(
      (candidate) =>
        candidate === path ||
        candidate.startsWith(`${path}.`) ||
        candidate.startsWith(`${path}[`)
    );

    if (matchingPath) {
      return fieldErrors[matchingPath];
    }
  }

  return "";
}

export function formatReadonlyValue(value, fallback = "Not available yet") {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }

  return String(value);
}

export function toTextList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  return value.join("\n");
}

export function fromTextList(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}
