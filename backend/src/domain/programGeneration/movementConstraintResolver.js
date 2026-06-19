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
  const signalsByKey = new Map();
  const order = [];

  toArray(value).forEach((signal) => {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      return;
    }

    const type = normalizeSignalType(signal.type);
    const signalValue = normalizeValue(signal.value);
    const decision = normalizeValue(signal.decision);
    const cautionLevel = normalizeValue(signal.cautionLevel) || (decision === 'caution' ? 'medium' : 'none');

    if (!type || !signalValue || !decision) {
      return;
    }

    const key = `${type}:${signalValue}`;

    if (!signalsByKey.has(key)) {
      order.push(key);
    }

    const nextSignal = {
      type,
      value: signalValue,
      decision,
      cautionLevel,
    };
    const currentSignal = signalsByKey.get(key);

    if (!currentSignal || isHigherPrioritySignal(nextSignal, currentSignal)) {
      signalsByKey.set(key, nextSignal);
    }
  });

  order.forEach((key) => {
    const signal = signalsByKey.get(key);
    if (signal) {
      signals.push(signal);
    }
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

const DECISION_WEIGHTS = {
  monitor: 1,
  caution: 2,
  blocked: 3,
};

const CAUTION_LEVEL_WEIGHTS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function isHigherPrioritySignal(candidate, current) {
  const candidateDecisionWeight = DECISION_WEIGHTS[candidate.decision] || 0;
  const currentDecisionWeight = DECISION_WEIGHTS[current.decision] || 0;

  if (candidateDecisionWeight !== currentDecisionWeight) {
    return candidateDecisionWeight > currentDecisionWeight;
  }

  return (
    (CAUTION_LEVEL_WEIGHTS[candidate.cautionLevel] || 0) >
    (CAUTION_LEVEL_WEIGHTS[current.cautionLevel] || 0)
  );
}

function addSignalByPriority(target, signal) {
  if (!signal?.type || !signal?.value || !signal?.decision) {
    return;
  }

  const key = `${signal.type}:${signal.value}`;
  const current = target.get(key);

  if (!current || isHigherPrioritySignal(signal, current)) {
    target.set(key, signal);
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
      monitoredSignals: [],
      cautionSignals: [],
      blockedSignals: [],
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
  const resolvedSignalsByKey = new Map();
  const manualBlockedExerciseIds = normalizeStringArray(
    movementConstraints.manualBlockedExerciseIds
  );

  painIssues
    .filter((issue) => issue.analysisStatus === 'analyzed')
    .forEach((issue) => {
      issue.confirmedSignals.forEach((signal) => {
        addSignalByPriority(resolvedSignalsByKey, signal);
      });
    });

  const monitoredSignals = [];
  const cautionSignals = [];
  const blockedSignals = [];

  resolvedSignalsByKey.forEach((signal) => {
    if (signal.decision === 'monitor') {
      monitoredSignals.push({
        type: signal.type,
        value: signal.value,
      });
      return;
    }

    if (signal.decision === 'caution') {
      const cautionSignal = {
        type: signal.type,
        value: signal.value,
        cautionLevel: signal.cautionLevel || 'medium',
      };
      cautionSignals.push(cautionSignal);

      if (signal.type === 'movementPattern') {
        addUnique(cautionMovementPatterns, signal.value);
      }

      if (signal.type === 'jointStressTag') {
        addUnique(cautionJointStressTags, signal.value);
      }
      return;
    }

    if (signal.decision === 'blocked') {
      blockedSignals.push({
        type: signal.type,
        value: signal.value,
      });

      if (signal.type === 'movementPattern') {
        addUnique(blockedMovementPatterns, signal.value);
      }

      if (signal.type === 'jointStressTag') {
        addUnique(blockedJointStressTags, signal.value);
      }
    }
  });

  return {
    painIssues,
    cautionMovementPatterns,
    blockedMovementPatterns,
    cautionJointStressTags,
    blockedJointStressTags,
    monitoredSignals,
    cautionSignals,
    blockedSignals,
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
