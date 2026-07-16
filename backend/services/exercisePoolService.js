const { getPrisma } = require('../lib/prisma');
const {
  EXERCISE_POOL_SCHEMA_VERSION,
  buildExercisePool,
} = require('../src/domain/exercises/exercisePoolBuilder');
const { resolveEquipmentContext } = require('../src/domain/programGeneration/equipmentResolver');
const {
  resolveMovementConstraints,
} = require('../src/domain/programGeneration/movementConstraintResolver');
const {
  resolveMusclePriorityProfile,
} = require('../src/domain/programGeneration/musclePriorityResolver');
const {
  TRAINING_PROFILE_SCHEMA_VERSION,
} = require('../src/domain/trainingProfile/trainingProfileMapper');

const EXERCISE_POOL_SELECT = Object.freeze({
  exerciseId: true,
  name: true,
  aliases: true,
  equipmentCategory: true,
  equipmentNeeded: true,
  movementPattern: true,
  jointStressTags: true,
  bodyParts: true,
  muscleFocus: true,
  targetMuscles: true,
  secondaryMuscles: true,
  mechanicType: true,
  unilateralType: true,
  difficulty: true,
  trainingType: true,
  isSupersetFriendly: true,
  fatigueScore: true,
  cardioModality: true,
  cardioImpactLevel: true,
  cardioFatigueScore: true,
  lowerBodyFatigueBias: true,
  status: true,
  overview: true,
});

const EXERCISE_POOL_ORDER_BY = Object.freeze({
  exerciseId: 'asc',
});

class ExercisePoolServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExercisePoolServiceError';
    this.code = code;
  }
}

function getNowIso(deps = {}) {
  if (typeof deps.now === 'function') {
    return deps.now().toISOString();
  }

  if (deps.now instanceof Date) {
    return deps.now.toISOString();
  }

  return new Date().toISOString();
}

function resolvePoolContext(userId, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new ExercisePoolServiceError(
      'PROFILE_NOT_READY',
      'Training profile onboardingSnapshot is required before building an exercise pool'
    );
  }

  if (snapshot.schemaVersion !== TRAINING_PROFILE_SCHEMA_VERSION) {
    throw new ExercisePoolServiceError(
      'UNSUPPORTED_PROFILE_SCHEMA_VERSION',
      'Unsupported training profile schema version'
    );
  }

  const profile = snapshot.profile;

  if (!profile || typeof profile !== 'object') {
    throw new ExercisePoolServiceError(
      'PROFILE_NOT_READY',
      'Training profile onboardingSnapshot.profile is missing'
    );
  }

  const derived = snapshot.derived && typeof snapshot.derived === 'object'
    ? snapshot.derived
    : {};

  return {
    userId,
    profileSchemaVersion: snapshot.schemaVersion,
    primaryGoal: profile.primaryGoal || null,
    experience: profile.experience || null,
    musclePriorityProfile:
      derived.musclePriorityProfile || resolveMusclePriorityProfile(profile),
    equipmentContext: resolveEquipmentContext(profile),
    movementConstraints:
      derived.movementConstraints || resolveMovementConstraints(profile),
    cardioProfile: profile.cardioProfile || {
      cardioRole: null,
      preferredModalities: [],
    },
  };
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeArray(value) {
  return Array.from(new Set(toArray(value).map(normalizeValue).filter(Boolean)));
}

function parseCsvParam(value) {
  return normalizeArray(String(value || '').split(','));
}

function parseLimit(value) {
  const parsed = parseInt(value || '25', 10);
  if (!Number.isFinite(parsed)) {
    return 25;
  }

  return Math.min(Math.max(parsed, 1), 150);
}

function parseCursor(value) {
  const parsed = parseInt(value || '0', 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(parsed, 0);
}

function includesAny(values, expectedValues) {
  if (!expectedValues.length) {
    return true;
  }

  const normalizedValues = normalizeArray(values);
  return expectedValues.some((expectedValue) => normalizedValues.includes(expectedValue));
}

function matchesEquipmentCategory(value, expectedValues) {
  if (!expectedValues.length) {
    return true;
  }

  const normalizedValue = normalizeValue(value);

  return expectedValues.some((expectedValue) => {
    switch (expectedValue) {
      case 'machine':
        return (
          normalizedValue === 'selectorized_machine' ||
          normalizedValue === 'plate_loaded_machine'
        );
      case 'assisted':
        return normalizedValue === 'assisted_machine';
      case 'smith machine':
        return normalizedValue === 'smith_machine';
      default:
        return normalizedValue === expectedValue;
    }
  });
}

function buildPoolSearchText(item = {}) {
  const attributes = item.attributes || {};

  return [
    item.exerciseId,
    item.name,
    ...toArray(item.aliases),
    attributes.movementPattern,
    ...toArray(attributes.bodyParts),
    ...toArray(attributes.muscleFocus),
    ...toArray(attributes.targetMuscles),
    ...toArray(attributes.secondaryMuscles),
    attributes.mechanicType,
    attributes.unilateralType,
    attributes.cardioModality,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

function filterPoolItems(items = [], query = {}) {
  const q = normalizeValue(query.q);
  const bodyParts = parseCsvParam(query.bodyParts);
  const muscleFocus = parseCsvParam(query.muscleFocus);
  const equipmentCategory = parseCsvParam(query.equipmentCategory);
  const trainingType = parseCsvParam(query.trainingType);
  const difficulty = parseCsvParam(query.difficulty);

  return items.filter((item) => {
    const attributes = item.attributes || {};

    if (q && !buildPoolSearchText(item).includes(q)) {
      return false;
    }

    if (!includesAny(attributes.bodyParts, bodyParts)) {
      return false;
    }

    if (!includesAny(attributes.muscleFocus, muscleFocus)) {
      return false;
    }

    if (!matchesEquipmentCategory(attributes.equipmentCategory, equipmentCategory)) {
      return false;
    }

    if (trainingType.length && !trainingType.includes(normalizeValue(item.trainingType))) {
      return false;
    }

    if (difficulty.length && !difficulty.includes(normalizeValue(attributes.difficulty))) {
      return false;
    }

    return true;
  });
}

function buildExercisePoolSearchResponse(poolResult, query = {}) {
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);
  const filteredItems = filterPoolItems(poolResult.pool?.items || [], query);
  const pageItems = filteredItems.slice(cursor, cursor + limit);
  const nextCursor =
    cursor + pageItems.length < filteredItems.length ? String(cursor + pageItems.length) : null;
  const response = {
    items: pageItems,
    nextCursor,
    total: filteredItems.length,
    poolSummary: {
      totalExercises: poolResult.pool?.stats?.fetchedCount || 0,
      availableExercises: poolResult.pool?.stats?.eligibleCount || 0,
      excludedExercises: poolResult.pool?.stats?.excludedCount || 0,
    },
    meta: poolResult.meta || {},
    hardConstraints: poolResult.hardConstraints || {},
  };

  if (normalizeValue(query.includeExcluded) === 'true') {
    response.excluded = poolResult.pool?.excluded || [];
    response.excludedByReason = poolResult.pool?.stats?.excludedByReason || {};
  }

  return response;
}

async function buildExercisePoolFromSnapshot(userId, snapshot, options = {}, deps = {}) {
  if (!userId) {
    throw new ExercisePoolServiceError('VALIDATION_ERROR', 'userId is required');
  }

  const prisma = deps.prisma || getPrisma();
  const poolContext = resolvePoolContext(userId, snapshot);
  const exercises = await prisma.exercise.findMany({
    select: EXERCISE_POOL_SELECT,
    orderBy: EXERCISE_POOL_ORDER_BY,
  });

  return buildExercisePool(exercises, poolContext, {
    allowDraftFallback: options.allowDraftFallback === true,
    generatedAt: options.generatedAt || getNowIso(deps),
    schemaVersion: EXERCISE_POOL_SCHEMA_VERSION,
  });
}

async function buildExercisePoolForUser(userId, options = {}, deps = {}) {
  if (!userId) {
    throw new ExercisePoolServiceError('VALIDATION_ERROR', 'userId is required');
  }

  const prisma = deps.prisma || getPrisma();
  const profileRecord = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      onboardingSnapshot: true,
    },
  });

  return buildExercisePoolFromSnapshot(
    userId,
    profileRecord?.onboardingSnapshot,
    options,
    deps
  );
}

async function getExercisePoolForUser(userId, query = {}, deps = {}) {
  const poolResult = await buildExercisePoolForUser(userId, {}, deps);
  return buildExercisePoolSearchResponse(poolResult, query);
}

module.exports = {
  EXERCISE_POOL_ORDER_BY,
  EXERCISE_POOL_SCHEMA_VERSION,
  EXERCISE_POOL_SELECT,
  ExercisePoolServiceError,
  buildExercisePoolFromSnapshot,
  buildExercisePoolSearchResponse,
  buildExercisePoolForUser,
  filterPoolItems,
  getExercisePoolForUser,
  resolvePoolContext,
};
