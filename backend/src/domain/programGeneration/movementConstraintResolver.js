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

function resolveMovementConstraints(normalizedProfile = {}) {
  const movementConstraints = normalizedProfile.movementConstraints || {};
  const painSeverity = normalizeValue(movementConstraints.painSeverity) || 'none';
  const trainingRule = normalizeValue(movementConstraints.trainingRule) || 'none';
  const aiDetectedPatterns = normalizeStringArray(movementConstraints.aiDetectedPatterns);
  const confirmedPatterns = normalizeStringArray(movementConstraints.confirmedPatterns);
  const cautionMovementPatterns = hasOwn(movementConstraints, 'cautionMovementPatterns')
    ? normalizeStringArray(movementConstraints.cautionMovementPatterns)
    : hasOwn(movementConstraints, 'cautionPatterns')
      ? normalizeStringArray(movementConstraints.cautionPatterns)
      : confirmedPatterns.length
        ? confirmedPatterns
        : aiDetectedPatterns;

  return {
    painDescription: normalizeOptionalString(movementConstraints.painDescription),
    affectedArea: normalizeValue(movementConstraints.affectedArea),
    painSeverity,
    trainingRule,
    aiDetectedPatterns,
    confirmedPatterns,
    cautionMovementPatterns,
    blockedMovementPatterns: hasOwn(movementConstraints, 'blockedMovementPatterns')
      ? normalizeStringArray(movementConstraints.blockedMovementPatterns)
      : [],
    cautionJointStressTags: hasOwn(movementConstraints, 'cautionJointStressTags')
      ? normalizeStringArray(movementConstraints.cautionJointStressTags)
      : [],
    blockedJointStressTags: hasOwn(movementConstraints, 'blockedJointStressTags')
      ? normalizeStringArray(movementConstraints.blockedJointStressTags)
      : [],
    blockedExerciseIds: hasOwn(movementConstraints, 'blockedExerciseIds')
      ? normalizeStringArray(movementConstraints.blockedExerciseIds)
      : [],
  };
}

module.exports = {
  resolveMovementConstraints,
};
