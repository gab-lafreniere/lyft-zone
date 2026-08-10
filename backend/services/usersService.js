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
  DURATION_PER_SESSION_VALUES,
  SESSIONS_PER_WEEK_VALUES,
  normalizeDurationPerSession,
  normalizeSessionsPerWeek,
} = require('../src/domain/trainingProfile/trainingProfileAvailability');
const {
  analyzeMovementConstraints,
} = require('./movementConstraintAnalysisService');
const {
  DEMOGRAPHICS_STATUS,
  calculateCurrentAge,
  dateOnlyToUtcDate,
  deriveDemographicsStatus,
  serializeDateOnly,
  validateInitialDemographicsPayload,
} = require('../src/domain/userProfile/userProfileDemographics');
const {
  validateDisplayName,
} = require('../src/domain/userProfile/userProfileDisplayName');
const {
  MAX_ONBOARDING_STEP,
  ONBOARDING_STATUS,
  deriveOnboardingState,
} = require('../src/domain/onboarding/onboardingState');

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
          displayName: true,
          age: true,
          ageInputDate: true,
          sex: true,
          onboardingStatus: true,
          onboardingLastCompletedStep: true,
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

const COMPLETE_TRAINING_PROFILE_ROOT_FIELDS = new Set([
  'primaryGoal',
  'musclePriorities',
  'experience',
  'environment',
  'movementConstraints',
  'exercisePreference',
  'cardioProfile',
  'physicalNotes',
]);

function isAvailabilityOnlyPatchCandidate(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !hasOwn(payload, 'availability')
  ) {
    return false;
  }

  return !Object.keys(payload).some((key) =>
    COMPLETE_TRAINING_PROFILE_ROOT_FIELDS.has(key)
  );
}

function validateAvailabilityOnlyPatch(payload) {
  const issues = [];
  const rootKeys = Object.keys(payload || {});
  rootKeys.forEach((key) => {
    if (key !== 'availability') {
      issues.push({
        path: key,
        code: 'UNKNOWN_FIELD',
        message: 'Field is not allowed in an availability-only update',
      });
    }
  });

  const availability = payload?.availability;
  if (
    !availability ||
    typeof availability !== 'object' ||
    Array.isArray(availability)
  ) {
    issues.push({
      path: 'availability',
      code: 'INVALID_TYPE',
      message: 'availability must be an object',
    });
  }

  const availabilityKeys =
    availability && typeof availability === 'object' && !Array.isArray(availability)
      ? Object.keys(availability)
      : [];
  availabilityKeys.forEach((key) => {
    if (key !== 'sessionsPerWeek' && key !== 'durationPerSession') {
      issues.push({
        path: `availability.${key}`,
        code: 'UNKNOWN_FIELD',
        message: 'Field is not allowed in an availability-only update',
      });
    }
  });

  const sessionsPerWeek = normalizeSessionsPerWeek(
    availability?.sessionsPerWeek
  );
  const durationPerSession = normalizeDurationPerSession(
    availability?.durationPerSession
  );

  if (sessionsPerWeek == null) {
    issues.push({
      path: 'availability.sessionsPerWeek',
      code: 'INVALID_ENUM',
      message: `sessionsPerWeek must be one of: ${SESSIONS_PER_WEEK_VALUES.join(', ')}`,
    });
  }

  if (durationPerSession == null) {
    issues.push({
      path: 'availability.durationPerSession',
      code: 'INVALID_ENUM',
      message: `durationPerSession must be one of: ${DURATION_PER_SESSION_VALUES.join(', ')}`,
    });
  }

  if (issues.length > 0) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Training profile availability payload is invalid',
      issues
    );
  }

  return { sessionsPerWeek, durationPerSession };
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
  return buildSettingsResponse(user, { referenceDate: deps.now });
}

async function updateTrainingProfileSettings(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  if (isAvailabilityOnlyPatchCandidate(payload)) {
    const availability = validateAvailabilityOnlyPatch(payload);

    await runSerializableTransaction(prisma, async (tx) => {
      const currentUser = await fetchUserSettingsRecord(userId, tx);
      const currentSettings = buildSettingsResponse(currentUser, {
        referenceDate: deps.now,
      });

      if (!currentSettings.meta.hasTrainingProfile) {
        throw new ApiError(
          409,
          'PROFILE_NOT_READY',
          'Training Profile must be completed before updating availability'
        );
      }

      const mergedProfile = {
        ...currentSettings.trainingProfile.profile,
        availability,
      };
      const data = buildCanonicalTrainingProfileUpdate(mergedProfile);
      await upsertUserProfileRecord(userId, data, tx);
    });
  } else {
    await upsertCanonicalTrainingProfile(userId, payload, prisma);
  }

  const user = await fetchUserSettingsRecord(userId, prisma);

  return buildSettingsResponse(user, { referenceDate: deps.now });
}

async function analyzeMovementConstraintSettings(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  await assertUserExists(userId, prisma);
  return analyzeMovementConstraints(payload, deps);
}

function buildUserProfileUpdateData(payload) {
  if (isOnboardingTrainingProfilePayload(payload)) {
    return buildCanonicalTrainingProfileUpdate(payload);
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
    if (hasOwn(payload, field)) {
      data[field] = payload[field];
    }
  }

  if (hasOwn(payload, 'displayName')) {
    const validation = validateDisplayName(payload.displayName);
    if (!validation.ok) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Profile payload is invalid',
        [validation.issue]
      );
    }
    data.displayName = validation.value;
  }

  return data;
}

const ONBOARDING_ACTIONS = new Set(['BEGIN', 'ADVANCE', 'COMPLETE']);

function validateOnboardingAction(payload) {
  const action = String(payload?.action || '').trim().toUpperCase();
  if (!ONBOARDING_ACTIONS.has(action)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Onboarding action must be BEGIN, ADVANCE, or COMPLETE'
    );
  }

  if (action !== 'ADVANCE') {
    return { action, lastCompletedStep: null };
  }

  const lastCompletedStep = Number(payload?.lastCompletedStep);
  if (
    !Number.isInteger(lastCompletedStep) ||
    lastCompletedStep < 0 ||
    lastCompletedStep > MAX_ONBOARDING_STEP
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `lastCompletedStep must be an integer from 0 through ${MAX_ONBOARDING_STEP}`
    );
  }

  return { action, lastCompletedStep };
}

async function updateUserOnboarding(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();
  const input = validateOnboardingAction(payload);

  await assertUserExists(userId, prisma);

  return runSerializableTransaction(prisma, async (tx) => {
    const currentProfile = await tx.userProfile.findUnique({ where: { userId } });
    const currentState = deriveOnboardingState(currentProfile);

    if (currentState.isComplete) {
      return currentState;
    }

    let nextData;
    if (input.action === 'BEGIN') {
      nextData = {
        onboardingStatus: ONBOARDING_STATUS.IN_PROGRESS,
        onboardingLastCompletedStep: currentState.lastCompletedStep,
      };
    } else if (input.action === 'ADVANCE') {
      if (input.lastCompletedStep >= 2 && !currentState.hasValidTrainingProfile) {
        throw new ApiError(
          409,
          'PROFILE_NOT_READY',
          'A valid canonical Training Profile is required for this onboarding step'
        );
      }

      nextData = {
        onboardingStatus: ONBOARDING_STATUS.IN_PROGRESS,
        onboardingLastCompletedStep: Math.max(
          currentState.lastCompletedStep,
          input.lastCompletedStep
        ),
      };
    } else {
      if (!currentState.hasValidTrainingProfile) {
        throw new ApiError(
          409,
          'PROFILE_NOT_READY',
          'A valid canonical Training Profile is required to complete onboarding'
        );
      }

      const displayNameValidation = validateDisplayName(currentProfile?.displayName);
      if (!displayNameValidation.ok) {
        throw new ApiError(
          409,
          'ONBOARDING_PROFILE_INCOMPLETE',
          'Display name is required to complete onboarding',
          [displayNameValidation.issue]
        );
      }

      if (deriveDemographicsStatus(currentProfile, resolveNowValue(deps.now)) !== DEMOGRAPHICS_STATUS.LOCKED) {
        throw new ApiError(
          409,
          'ONBOARDING_PROFILE_INCOMPLETE',
          'Age and sex are required to complete onboarding'
        );
      }

      nextData = {
        onboardingStatus: ONBOARDING_STATUS.COMPLETED,
        onboardingLastCompletedStep: MAX_ONBOARDING_STEP,
      };
    }

    const savedProfile = await tx.userProfile.upsert({
      where: { userId },
      update: nextData,
      create: {
        userId,
        ...nextData,
      },
    });

    return deriveOnboardingState(savedProfile);
  });
}

function serializeUserProfileRecord(profile, referenceDate) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }

  if (!hasOwn(profile, 'ageInputDate')) {
    return profile;
  }

  const demographicsStatus = deriveDemographicsStatus(profile, referenceDate);
  return {
    ...profile,
    ageInputDate: serializeDateOnly(profile.ageInputDate),
    currentAge: demographicsStatus === DEMOGRAPHICS_STATUS.LOCKED
      ? calculateCurrentAge({
        storedAge: profile.age,
        ageInputDate: profile.ageInputDate,
        referenceDate,
      })
      : null,
    demographicsStatus,
  };
}

function resolveNowValue(now) {
  return typeof now === 'function' ? now() : now || new Date();
}

async function runSerializableTransaction(prisma, operation) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error?.code !== 'P2034' || attempt === 3) {
        throw error;
      }
    }
  }

  throw new ApiError(409, 'CONFLICT', 'Profile update conflicted with another request');
}

async function upsertUserProfileDemographics(userId, payload, data, prisma, deps) {
  const validation = validateInitialDemographicsPayload(payload);
  if (!validation.ok) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Profile demographics payload is invalid',
      validation.issues
    );
  }

  const collectionDate = dateOnlyToUtcDate(resolveNowValue(deps.now));
  if (!collectionDate) {
    throw new ApiError(
      500,
      'PROFILE_DEMOGRAPHICS_DATE_INVALID',
      'Profile demographics could not be saved'
    );
  }

  const profile = await runSerializableTransaction(prisma, async (tx) => {
    const current = await tx.userProfile.findUnique({ where: { userId } });
    const status = deriveDemographicsStatus(current, collectionDate);

    if (status === DEMOGRAPHICS_STATUS.INCONSISTENT) {
      throw new ApiError(
        409,
        'PROFILE_DEMOGRAPHICS_INCONSISTENT',
        'Profile demographics are incomplete and cannot currently be changed'
      );
    }

    if (status === DEMOGRAPHICS_STATUS.LOCKED) {
      if (
        current.age !== validation.value.age ||
        current.sex !== validation.value.sex
      ) {
        throw new ApiError(
          409,
          'PROFILE_DEMOGRAPHICS_LOCKED',
          'Age and sex cannot currently be changed'
        );
      }

      if (Object.keys(data).length === 0) {
        return current;
      }

      return tx.userProfile.update({
        where: { userId },
        data,
      });
    }

    const demographics = {
      age: validation.value.age,
      ageInputDate: collectionDate,
      sex: validation.value.sex,
    };

    return tx.userProfile.upsert({
      where: { userId },
      update: {
        ...data,
        ...demographics,
      },
      create: {
        userId,
        ...data,
        ...demographics,
      },
    });
  });

  return serializeUserProfileRecord(profile, deps.now);
}

async function upsertUserProfile(userId, payload, deps = {}) {
  const prisma = deps.prisma || getPrisma();

  await assertUserExists(userId, prisma);

  const data = buildUserProfileUpdateData(payload);
  const hasDemographicInput =
    hasOwn(payload, 'age') ||
    hasOwn(payload, 'sex') ||
    hasOwn(payload, 'ageInputDate');

  if (hasDemographicInput) {
    return upsertUserProfileDemographics(userId, payload, data, prisma, deps);
  }

  return serializeUserProfileRecord(
    await upsertUserProfileRecord(userId, data, prisma),
    deps.now
  );
}

module.exports = {
  ApiError,
  analyzeMovementConstraintSettings,
  createUser,
  getUserSettings,
  updateUserOnboarding,
  upsertUserProfile,
  updateTrainingProfileSettings,
};
