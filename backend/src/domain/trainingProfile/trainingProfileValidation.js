const {
  AREA_DEFINITIONS,
  getAreaDefinition,
  isDeprioritizableArea,
  isInvalidParentChildConflict,
  isInvalidSiblingCombination,
  isMicroFocus,
  normalizeAreaName,
} = require('./trainingProfileRules');

const TRAINING_GOALS = new Set([
  'HYPERTROPHY',
  'STRENGTH',
  'MIXED',
]);
const EQUIPMENT_BIASES = new Set(['machines', 'free_weights', 'no_preference']);
const EXPERIENCE_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const PAIN_SEVERITIES = new Set(['none', 'low', 'moderate', 'high', 'severe']);
const TRAINING_RULES = new Set(['none', 'monitor', 'limit', 'modify', 'avoid']);
const MAX_SHORT_TEXT = 120;
const MAX_LONG_TEXT = 1000;

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
  const trainingEnvironment = normalizeLowerString(payload?.environment?.trainingEnvironment);
  const equipmentSetup = normalizeLowerString(payload?.environment?.equipmentSetup);
  const equipmentList = normalizeStringArray(payload?.environment?.equipmentList);
  const painDescription = normalizeOptionalString(payload?.movementConstraints?.painDescription);
  const affectedArea = normalizeLowerString(payload?.movementConstraints?.affectedArea);
  const painSeverity = normalizeLowerString(payload?.movementConstraints?.painSeverity);
  const trainingRule = normalizeLowerString(payload?.movementConstraints?.trainingRule);
  const aiDetectedPatterns = normalizeStringArray(payload?.movementConstraints?.aiDetectedPatterns);
  const confirmedPatterns = normalizeStringArray(payload?.movementConstraints?.confirmedPatterns);
  const cautionMovementPatterns = normalizeStringArray(
    payload?.movementConstraints?.cautionMovementPatterns
  );
  const blockedMovementPatterns = normalizeStringArray(
    payload?.movementConstraints?.blockedMovementPatterns
  );
  const cautionJointStressTags = normalizeStringArray(
    payload?.movementConstraints?.cautionJointStressTags
  );
  const blockedJointStressTags = normalizeStringArray(
    payload?.movementConstraints?.blockedJointStressTags
  );
  const blockedExerciseIds = normalizeStringArray(
    payload?.movementConstraints?.blockedExerciseIds
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

  if (!trainingEnvironment) {
    pushIssue(
      issues,
      'environment.trainingEnvironment',
      'REQUIRED',
      'trainingEnvironment is required'
    );
  }

  if (!equipmentSetup) {
    pushIssue(
      issues,
      'environment.equipmentSetup',
      'REQUIRED',
      'equipmentSetup is required'
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

  if (painSeverity && !PAIN_SEVERITIES.has(painSeverity)) {
    pushIssue(
      issues,
      'movementConstraints.painSeverity',
      'INVALID_ENUM',
      'painSeverity is invalid'
    );
  }

  if (trainingRule && !TRAINING_RULES.has(trainingRule)) {
    pushIssue(
      issues,
      'movementConstraints.trainingRule',
      'INVALID_ENUM',
      'trainingRule is invalid'
    );
  }

  [trainingEnvironment, equipmentSetup, cardioRole, affectedArea].forEach((value, index) => {
    const paths = [
      'environment.trainingEnvironment',
      'environment.equipmentSetup',
      'cardioProfile.cardioRole',
      'movementConstraints.affectedArea',
    ];
    const labels = [
      'trainingEnvironment',
      'equipmentSetup',
      'cardioRole',
      'affectedArea',
    ];
    ensureBoundedString(value, issues, paths[index], labels[index]);
  });

  ensureBoundedString(painDescription, issues, 'movementConstraints.painDescription', 'painDescription', MAX_LONG_TEXT);
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
      trainingEnvironment,
      equipmentSetup,
      equipmentList,
    },
    movementConstraints: {
      painDescription,
      affectedArea,
      painSeverity,
      trainingRule,
      aiDetectedPatterns,
      confirmedPatterns,
      cautionMovementPatterns,
      blockedMovementPatterns,
      cautionJointStressTags,
      blockedJointStressTags,
      blockedExerciseIds,
    },
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
  validateTrainingProfileInput,
};
