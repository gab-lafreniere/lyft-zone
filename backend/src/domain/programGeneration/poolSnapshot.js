const { createHash } = require('node:crypto');

const POOL_SNAPSHOT_SCHEMA_VERSION = 1;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeJointStressTags(value) {
  return Array.from(
    new Set(
      toArray(value)
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
}

function copyMuscleActivation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value ?? null;
  }

  return { ...value };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function createChecksum(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function createPoolSummary(poolResult = {}) {
  const stats = poolResult.pool?.stats || {};

  return {
    totalExercises: stats.fetchedCount || 0,
    availableExercises: stats.eligibleCount || 0,
    excludedExercises: stats.excludedCount || 0,
    excludedByReason: stats.excludedByReason || {},
  };
}

function createPoolSnapshot(poolResult = {}) {
  const allowedExerciseIds = Array.from(
    new Set(
      toArray(poolResult.pool?.items)
        .map((item) => String(item?.exerciseId || '').trim())
        .filter(Boolean)
    )
  ).sort();
  const poolSummary = createPoolSummary(poolResult);
  const snapshotWithoutChecksum = {
    schemaVersion: POOL_SNAPSHOT_SCHEMA_VERSION,
    source: 'user_exercise_pool',
    profileSchemaVersion: poolResult.meta?.profileSchemaVersion || null,
    generatedAt: poolResult.meta?.generatedAt || null,
    userId: poolResult.meta?.userId || null,
    allowedExerciseIds,
    availableExerciseCount: allowedExerciseIds.length,
    excludedExerciseCount: poolSummary.excludedExercises,
    hardConstraints: poolResult.hardConstraints || {},
    poolSummary,
  };

  return {
    ...snapshotWithoutChecksum,
    checksum: createChecksum(snapshotWithoutChecksum),
  };
}

function createExercisePoolItems(poolResult = {}) {
  return toArray(poolResult.pool?.items).map((item) => {
    const attributes = item.attributes || {};

    return {
      exerciseId: item.exerciseId,
      name: item.name,
      trainingType: item.trainingType || null,
      movementPattern: attributes.movementPattern || null,
      jointStressTags: normalizeJointStressTags(attributes.jointStressTags),
      bodyParts: toArray(attributes.bodyParts),
      muscleFocus: toArray(attributes.muscleFocus),
      targetMuscles: toArray(attributes.targetMuscles),
      secondaryMuscles: toArray(attributes.secondaryMuscles),
      // Coaching-only source metadata. Analytics V2 remains authoritative and unchanged.
      muscleActivation: copyMuscleActivation(attributes.muscleActivation),
      equipmentCategory: attributes.equipmentCategory || null,
      equipmentNeeded: toArray(attributes.equipmentNeeded),
      difficulty: attributes.difficulty || null,
      mechanicType: attributes.mechanicType || null,
      unilateralType: attributes.unilateralType || null,
      isSupersetFriendly: Boolean(attributes.isSupersetFriendly),
      cardioModality: attributes.cardioModality || null,
      cardioImpactLevel: attributes.cardioImpactLevel || null,
      fatigueScore: attributes.fatigueScore ?? null,
      softSignals: item.softSignals || {},
    };
  });
}

module.exports = {
  POOL_SNAPSHOT_SCHEMA_VERSION,
  createChecksum,
  createExercisePoolItems,
  createPoolSnapshot,
  createPoolSummary,
  stableStringify,
};
