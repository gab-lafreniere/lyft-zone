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
    musclePriorityProfile:
      derived.musclePriorityProfile || resolveMusclePriorityProfile(profile),
    equipmentContext: derived.equipmentContext || resolveEquipmentContext(profile),
    movementConstraints:
      derived.movementConstraints || resolveMovementConstraints(profile),
    cardioProfile: profile.cardioProfile || {
      cardioRole: null,
      preferredModalities: [],
    },
  };
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
  const poolContext = resolvePoolContext(userId, profileRecord?.onboardingSnapshot);
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

module.exports = {
  EXERCISE_POOL_ORDER_BY,
  EXERCISE_POOL_SCHEMA_VERSION,
  EXERCISE_POOL_SELECT,
  ExercisePoolServiceError,
  buildExercisePoolForUser,
  resolvePoolContext,
};
