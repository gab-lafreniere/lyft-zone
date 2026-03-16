const { Prisma } = require('@prisma/client');
const { getPrisma } = require('../lib/prisma');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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

async function upsertUserProfile(userId, payload) {
  const prisma = getPrisma();

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

  const data = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      data[field] = payload[field];
    }
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
  });

  return profile;
}

module.exports = {
  ApiError,
  createUser,
  upsertUserProfile,
};
