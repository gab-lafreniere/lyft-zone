import {
  AREA_KIND_MAP,
  BIOMECHANICAL_CONFLICTS,
  getAncestorAreas,
  getComparableArea,
} from "./settingsOptions";

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
  const trainingEnvironment = normalizeString(
    trainingProfileDraft?.environment?.trainingEnvironment
  );
  const equipmentSetup = normalizeString(
    trainingProfileDraft?.environment?.equipmentSetup
  );
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
  const painDescription = normalizeString(
    trainingProfileDraft?.movementConstraints?.painDescription
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

  if (!trainingEnvironment) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "environment.trainingEnvironment",
      "Training environment is required."
    );
  }

  if (!equipmentSetup) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "environment.equipmentSetup",
      "Equipment setup is required."
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

  if (painDescription.length > 1000) {
    pushFieldError(
      fieldErrors,
      formErrors,
      "movementConstraints.painDescription",
      "Pain description must be at most 1000 characters."
    );
  }

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
