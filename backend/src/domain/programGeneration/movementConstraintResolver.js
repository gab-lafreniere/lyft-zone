function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeStringArray(value) {
  return Array.from(new Set(toArray(value).map(normalizeValue).filter(Boolean)));
}

function normalizeSignalType(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeDetectedSignals(value) {
  const signals = [];
  const seen = new Set();

  toArray(value).forEach((signal) => {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeValue(signal.value);

    if (!type || !signalValue) {
      return;
    }

    const key = `${type}:${signalValue}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    signals.push({
      type,
      value: signalValue,
    });
  });

  return signals;
}

function normalizeConfirmedSignals(value) {
  const signals = [];
  const seen = new Set();

  toArray(value).forEach((signal) => {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeValue(signal.value);
    const decision = normalizeValue(signal.decision);

    if (!type || !signalValue || !decision) {
      return;
    }

    const key = `${type}:${signalValue}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    signals.push({
      type,
      value: signalValue,
      decision,
    });
  });

  return signals;
}

function normalizePainIssues(value) {
  return toArray(value)
    .filter((issue) => issue && typeof issue === 'object' && !Array.isArray(issue))
    .map((issue) => ({
      id: normalizeOptionalString(issue.id),
      description: normalizeOptionalString(issue.description),
      affectedArea: normalizeValue(issue.affectedArea),
      painSeverity: normalizeValue(issue.painSeverity),
      trainingRule: normalizeValue(issue.trainingRule),
      analysisStatus: normalizeValue(issue.analysisStatus) || 'draft',
      detectedSignals: normalizeDetectedSignals(issue.detectedSignals),
      confirmedSignals: normalizeConfirmedSignals(issue.confirmedSignals),
    }));
}

function addUnique(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function resolveMovementConstraints(normalizedProfile = {}) {
  const movementConstraints = normalizedProfile.movementConstraints || {};
  const hasModernShape =
    hasOwn(movementConstraints, 'painIssues') ||
    hasOwn(movementConstraints, 'manualBlockedExerciseIds');

  if (!hasModernShape) {
    const blockedExerciseIds = hasOwn(movementConstraints, 'blockedExerciseIds')
      ? normalizeStringArray(movementConstraints.blockedExerciseIds)
      : [];

    return {
      painIssues: [],
      cautionMovementPatterns: hasOwn(movementConstraints, 'cautionMovementPatterns')
        ? normalizeStringArray(movementConstraints.cautionMovementPatterns)
        : hasOwn(movementConstraints, 'cautionPatterns')
          ? normalizeStringArray(movementConstraints.cautionPatterns)
          : [],
      blockedMovementPatterns: hasOwn(movementConstraints, 'blockedMovementPatterns')
        ? normalizeStringArray(movementConstraints.blockedMovementPatterns)
        : [],
      cautionJointStressTags: hasOwn(movementConstraints, 'cautionJointStressTags')
        ? normalizeStringArray(movementConstraints.cautionJointStressTags)
        : [],
      blockedJointStressTags: hasOwn(movementConstraints, 'blockedJointStressTags')
        ? normalizeStringArray(movementConstraints.blockedJointStressTags)
        : [],
      manualBlockedExerciseIds: blockedExerciseIds,
      blockedExerciseIds,
      debug: {
        manualBlockedExerciseCount: blockedExerciseIds.length,
        ruleDerivedBlockedExerciseCount: null,
      },
    };
  }

  const painIssues = normalizePainIssues(movementConstraints.painIssues);
  const cautionMovementPatterns = [];
  const blockedMovementPatterns = [];
  const cautionJointStressTags = [];
  const blockedJointStressTags = [];
  const manualBlockedExerciseIds = normalizeStringArray(
    movementConstraints.manualBlockedExerciseIds
  );

  painIssues
    .filter((issue) => issue.analysisStatus === 'analyzed')
    .forEach((issue) => {
      issue.confirmedSignals.forEach((signal) => {
        if (signal.type === 'movementPattern' && signal.decision === 'caution') {
          addUnique(cautionMovementPatterns, signal.value);
        }

        if (signal.type === 'movementPattern' && signal.decision === 'blocked') {
          addUnique(blockedMovementPatterns, signal.value);
        }

        if (signal.type === 'jointStressTag' && signal.decision === 'caution') {
          addUnique(cautionJointStressTags, signal.value);
        }

        if (signal.type === 'jointStressTag' && signal.decision === 'blocked') {
          addUnique(blockedJointStressTags, signal.value);
        }
      });
    });

  return {
    painIssues,
    cautionMovementPatterns,
    blockedMovementPatterns,
    cautionJointStressTags,
    blockedJointStressTags,
    manualBlockedExerciseIds,
    blockedExerciseIds: manualBlockedExerciseIds,
    debug: {
      manualBlockedExerciseCount: manualBlockedExerciseIds.length,
      ruleDerivedBlockedExerciseCount: null,
    },
  };
}

module.exports = {
  resolveMovementConstraints,
};
