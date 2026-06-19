const { Prisma } = require('@prisma/client');
const { getPrisma } = require('../lib/prisma');
const {
  validateTrainingProfileInput,
} = require('../src/domain/trainingProfile/trainingProfileValidation');
const {
  mapTrainingProfileToUserProfileUpdate,
} = require('../src/domain/trainingProfile/trainingProfileMapper');
const {
  buildSettingsResponse,
} = require('../src/domain/trainingProfile/settingsResponse');
const {
  analyzeMovementConstraints,
} = require('./movementConstraintAnalysisService');

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isOnboardingTrainingProfilePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const musclePriorities =
    payload.musclePriorities && typeof payload.musclePriorities === 'object'
      ? payload.musclePriorities
      : null;

  return (
    hasOwn(payload, 'availability') ||
    hasOwn(payload, 'environment') ||
    hasOwn(payload, 'movementConstraints') ||
    hasOwn(payload, 'exercisePreference') ||
    hasOwn(payload, 'cardioProfile') ||
    hasOwn(payload, 'physicalNotes') ||
    Boolean(
      musclePriorities &&
        (hasOwn(musclePriorities, 'primaryFocus') ||
          hasOwn(musclePriorities, 'secondaryFocuses') ||
          hasOwn(musclePriorities, 'deprioritizedArea'))
    )
  );
}

async function createUser(payload) {
  const prisma = getPrisma();
  const email = normalizeEmail(payload.email);

  if (!email) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'email is required');
  }

  try {
    const user = await prisma.user.create({
      data: { email },
    });

    return user;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiError(409, 'CONFLICT', 'A user with this email already exists');
    }

    throw error;
  }
}

async function assertUserExists(userId, prisma) {
  if (!userId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  return user;
}

async function fetchUserSettingsRecord(userId, prisma) {
  if (!userId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          trainingMode: true,
          onboardingSnapshot: true,
        },
      },
    },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  return user;
}

function buildCanonicalTrainingProfileUpdate(payload) {
  const validation = validateTrainingProfileInput(payload);

  if (!validation.ok) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Training profile payload is invalid',
      validation.issues
    );
  }

  return mapTrainingProfileToUserProfileUpdate(validation.value);
}

async function upsertUserProfileRecord(userId, data, prisma) {
  return prisma.userProfile.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
  });
}

async function upsertCanonicalTrainingProfile(userId, payload, prisma) {
  await assertUserExists(userId, prisma);
  const data = buildCanonicalTrainingProfileUpdate(payload);
  return upsertUserProfileRecord(userId, data, prisma);
}

async function getUserSettings(userId, deps = {}) {
  const prisma = deps.prisma || getPrisma();
  const user = await fetchUserSettingsRecord(userId, prisma);
  return buildSettingsResponse(user);
}

async function updateTrainingProfileSettings(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  await upsertCanonicalTrainingProfile(userId, payload, prisma);
  const user = await fetchUserSettingsRecord(userId, prisma);

  return buildSettingsResponse(user);
}

async function analyzeMovementConstraintSettings(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  await assertUserExists(userId, prisma);
  return analyzeMovementConstraints(payload, deps);
}

async function upsertUserProfile(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  await assertUserExists(userId, prisma);

  let data;

  if (isOnboardingTrainingProfilePayload(payload)) {
    data = buildCanonicalTrainingProfileUpdate(payload);
  } else {
    const allowedFields = [
      'primaryGoal',
      'trainingMode',
      'experienceNotes',
      'availableSessionsPerWeek',
      'sessionDurationMinutes',
      'trainingPreferences',
      'equipmentContext',
      'constraints',
      'musclePriorities',
      'onboardingSnapshot',
    ];

    data = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        data[field] = payload[field];
      }
    }
  }

  return upsertUserProfileRecord(userId, data, prisma);
}

module.exports = {
  ApiError,
  analyzeMovementConstraintSettings,
  createUser,
  getUserSettings,
  upsertUserProfile,
  updateTrainingProfileSettings,
};
