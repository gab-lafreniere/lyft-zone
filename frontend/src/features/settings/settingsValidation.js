import {
  AREA_KIND_MAP,
  AFFECTED_AREA_OPTIONS,
  BIOMECHANICAL_CONFLICTS,
  EQUIPMENT_PRESETS,
  PAIN_SEVERITY_V2_OPTIONS,
  TRAINING_RULE_V2_OPTIONS,
  getAncestorAreas,
  getComparableArea,
} from "./settingsOptions";
import { isCompletePainIssue } from "./settingsMappers";

const MAX_PAIN_DESCRIPTION = 500;
const MAX_PAIN_ISSUES = 5;
const VALID_AFFECTED_AREAS = new Set(AFFECTED_AREA_OPTIONS.map((option) => option.value));
const VALID_PAIN_SEVERITIES = new Set(PAIN_SEVERITY_V2_OPTIONS.map((option) => option.value));
const VALID_TRAINING_RULES = new Set(TRAINING_RULE_V2_OPTIONS.map((option) => option.value));
const VALID_ANALYSIS_STATUSES = new Set(["draft", "analyzed", "needs_reanalysis"]);
const VALID_SIGNAL_TYPES = new Set(["movementPattern", "jointStressTag"]);
const VALID_SIGNAL_DECISIONS = new Set(["caution", "blocked"]);

function pushFieldError(fieldErrors, formErrors, path, message) {
  if (path) {
    if (!fieldErrors[path]) {
      fieldErrors[path] = message;
    }
    return;
  }

  formErrors.push(message);
}

function normalizeInteger(value) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeString(value) {
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

function validateSignals({ signals, fieldErrors, formErrors, path, requireDecision }) {
  const decisionsByKey = new Map();

  toArray(signals).forEach((signal, index) => {
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
      pushFieldError(fieldErrors, formErrors, `${path}[${index}]`, "Signal must be an object.");
      return;
    }

    const type = normalizeSignalType(signal.type);
    const value = normalizeString(signal.value).toLowerCase();
    const decision = normalizeString(signal.decision).toLowerCase();

    if (type && !VALID_SIGNAL_TYPES.has(type)) {
      pushFieldError(fieldErrors, formErrors, `${path}[${index}].type`, "Signal type is invalid.");
    }

    if (requireDecision) {
      if (decision && !VALID_SIGNAL_DECISIONS.has(decision)) {
        pushFieldError(
          fieldErrors,
          formErrors,
          `${path}[${index}].decision`,
          "Signal decision is invalid."
        );
      }

      if (type && value && VALID_SIGNAL_TYPES.has(type) && VALID_SIGNAL_DECISIONS.has(decision)) {
        const key = `${type}:${value}`;
        const existingDecision = decisionsByKey.get(key);

        if (existingDecision && existingDecision !== decision) {
          pushFieldError(
            fieldErrors,
            formErrors,
            `${path}[${index}].decision`,
            "Signal cannot be both caution and blocked."
          );
        } else {
          decisionsByKey.set(key, decision);
        }
      }
    }
  });
}

function validateMovementConstraints(trainingProfileDraft, fieldErrors, formErrors) {
  const painIssues = Array.isArray(trainingProfileDraft?.movementConstraints?.painIssues)
    ? trainingProfileDraft.movementConstraints.painIssues
    : [];
  const persistableIssues = painIssues.filter(isCompletePainIssue);

  if (persistableIssues.length > MAX_PAIN_ISSUES) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "movementConstraints.painIssues",
      `You can add up to ${MAX_PAIN_ISSUES} pain issues.`
    );
  }

  painIssues.forEach((issue, index) => {
    const issuePath = `movementConstraints.painIssues[${index}]`;
    const description = normalizeString(issue?.description);
    const affectedArea = normalizeString(issue?.affectedArea).toLowerCase();
    const painSeverity = normalizeString(issue?.painSeverity).toLowerCase();
    const trainingRule = normalizeString(issue?.trainingRule).toLowerCase();
    const analysisStatus = normalizeString(issue?.analysisStatus).toLowerCase();

    if (description.length > MAX_PAIN_DESCRIPTION) {
      pushFieldError(
        fieldErrors,
        formErrors,
        `${issuePath}.description`,
        `Pain issue description must be at most ${MAX_PAIN_DESCRIPTION} characters.`
      );
    }

    if (affectedArea && !VALID_AFFECTED_AREAS.has(affectedArea)) {
      pushFieldError(
        fieldErrors,
        formErrors,
        `${issuePath}.affectedArea`,
        "Affected area is invalid."
      );
    }

    if (painSeverity && !VALID_PAIN_SEVERITIES.has(painSeverity)) {
      pushFieldError(
        fieldErrors,
        formErrors,
        `${issuePath}.painSeverity`,
        "Pain severity is invalid."
      );
    }

    if (trainingRule && !VALID_TRAINING_RULES.has(trainingRule)) {
      pushFieldError(
        fieldErrors,
        formErrors,
        `${issuePath}.trainingRule`,
        "Training rule is invalid."
      );
    }

    if (analysisStatus && !VALID_ANALYSIS_STATUSES.has(analysisStatus)) {
      pushFieldError(
        fieldErrors,
        formErrors,
        `${issuePath}.analysisStatus`,
        "Analysis status is invalid."
      );
    }

    validateSignals({
      signals: issue?.detectedSignals,
      fieldErrors,
      formErrors,
      path: `${issuePath}.detectedSignals`,
      requireDecision: false,
    });
    validateSignals({
      signals: issue?.confirmedSignals,
      fieldErrors,
      formErrors,
      path: `${issuePath}.confirmedSignals`,
      requireDecision: true,
    });
  });
}

function hasBiomechanicalConflict(left, right) {
  const comparableLeft = getComparableArea(left);
  const comparableRight = getComparableArea(right);

  if (!comparableLeft || !comparableRight) {
    return false;
  }

  return (BIOMECHANICAL_CONFLICTS[comparableLeft] || []).includes(comparableRight);
}

export function validateTrainingProfileDraft(trainingProfileDraft) {
  const fieldErrors = {};
  const formErrors = [];
  const primaryGoal = normalizeString(trainingProfileDraft?.primaryGoal);
  const experience = normalizeString(trainingProfileDraft?.experience);
  const sessionsPerWeek = normalizeInteger(
    trainingProfileDraft?.availability?.sessionsPerWeek
  );
  const durationPerSession = normalizeInteger(
    trainingProfileDraft?.availability?.durationPerSession
  );
  const equipmentPreset = normalizeString(
    trainingProfileDraft?.environment?.equipmentPreset
  );
  const availableEquipment = Array.isArray(
    trainingProfileDraft?.environment?.availableEquipment
  )
    ? trainingProfileDraft.environment.availableEquipment.filter(Boolean)
    : [];
  const primaryFocus = normalizeString(
    trainingProfileDraft?.musclePriorities?.primaryFocus
  );
  const secondaryFocuses = Array.isArray(
    trainingProfileDraft?.musclePriorities?.secondaryFocuses
  )
    ? trainingProfileDraft.musclePriorities.secondaryFocuses.filter(Boolean)
    : [];
  const deprioritizedArea = normalizeString(
    trainingProfileDraft?.musclePriorities?.deprioritizedArea
  );
  const physicalNotes = normalizeString(trainingProfileDraft?.physicalNotes);

  if (!primaryGoal) {
    pushFieldError(fieldErrors, formErrors, "primaryGoal", "Primary goal is required.");
  }

  if (!experience) {
    pushFieldError(fieldErrors, formErrors, "experience", "Experience is required.");
  }

  if (sessionsPerWeek == null || sessionsPerWeek < 1 || sessionsPerWeek > 7) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "availability.sessionsPerWeek",
      "Sessions per week must be an integer between 1 and 7."
    );
  }

  if (durationPerSession == null || durationPerSession < 15 || durationPerSession > 240) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "availability.durationPerSession",
      "Duration per session must be an integer between 15 and 240 minutes."
    );
  }

  if (equipmentPreset && !Object.prototype.hasOwnProperty.call(EQUIPMENT_PRESETS, equipmentPreset)) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "environment.equipmentPreset",
      "Equipment preset is invalid."
    );
  }

  if (availableEquipment.length < 1) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "environment.availableEquipment",
      "Available equipment must contain at least one item."
    );
  }

  if (secondaryFocuses.length > 2) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "musclePriorities.secondaryFocuses",
      "Secondary focuses must contain at most two values."
    );
  }

  if (
    primaryFocus &&
    secondaryFocuses.some((secondaryFocus) => secondaryFocus === primaryFocus)
  ) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "musclePriorities.secondaryFocuses",
      "Secondary focuses cannot repeat the primary focus."
    );
  }

  if (deprioritizedArea) {
    if (AREA_KIND_MAP[deprioritizedArea] === "micro") {
      pushFieldError(
        fieldErrors,
        formErrors,
        "musclePriorities.deprioritizedArea",
        "Deprioritized area cannot target a micro-focus."
      );
    }

    if (
      deprioritizedArea === primaryFocus ||
      secondaryFocuses.includes(deprioritizedArea)
    ) {
      pushFieldError(
        fieldErrors,
        formErrors,
        "musclePriorities.deprioritizedArea",
        "Deprioritized area cannot also be a focus area."
      );
    }

    [primaryFocus, ...secondaryFocuses].filter(Boolean).forEach((focusArea) => {
      if (getAncestorAreas(focusArea).includes(deprioritizedArea)) {
        pushFieldError(
          fieldErrors,
          formErrors,
          "musclePriorities.deprioritizedArea",
          "You cannot deprioritize a parent area of a selected focus."
        );
      }

      if (hasBiomechanicalConflict(focusArea, deprioritizedArea)) {
        pushFieldError(
          fieldErrors,
          formErrors,
          "musclePriorities.deprioritizedArea",
          "This focus and deprioritized combination is blocked by the current rules."
        );
      }
    });
  }

  validateMovementConstraints(trainingProfileDraft, fieldErrors, formErrors);

  if (physicalNotes.length > 1000) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "physicalNotes",
      "Physical notes must be at most 1000 characters."
    );
  }

  return {
    ok: Object.keys(fieldErrors).length === 0 && formErrors.length === 0,
    fieldErrors,
    formErrors,
  };
}
