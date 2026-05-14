const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRAINING_PROFILE_SCHEMA_VERSION,
  mapTrainingProfileToUserProfileUpdate,
} = require('../../src/domain/trainingProfile/trainingProfileMapper');
const {
  deriveTrainingProfile,
} = require('../../src/domain/trainingProfile/settingsResponse');
const {
  validateTrainingProfileInput,
} = require('../../src/domain/trainingProfile/trainingProfileValidation');
const {
  ApiError,
  getUserSettings,
  upsertUserProfile,
  updateTrainingProfileSettings,
} = require('../../services/usersService');

function createCanonicalPayload() {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: 'upper_chest',
      secondaryFocuses: ['lats', 'rear_delts'],
      deprioritizedArea: 'quadriceps',
    },
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 75,
    },
    environment: {
      trainingEnvironment: 'commercial_gym',
      equipmentSetup: 'full_gym',
      equipmentList: ['dumbbells', 'selectorized_machine'],
    },
    movementConstraints: {
      painDescription: 'Shoulder irritation',
      affectedArea: 'shoulder',
      painSeverity: 'moderate',
      trainingRule: 'modify',
      aiDetectedPatterns: ['overhead_press'],
      confirmedPatterns: ['overhead_press'],
      cautionMovementPatterns: ['horizontal_press'],
      blockedMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['shoulder_rotation'],
      blockedJointStressTags: ['shoulder_compression'],
      blockedExerciseIds: ['ex_barbell_press'],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
    cardioProfile: {
      cardioRole: 'warm_up_only',
      preferredModalities: ['treadmill_walk'],
    },
    physicalNotes: 'Prefers stable pressing variations.',
  };
}

function createNormalizedCanonicalProfile(overrides = {}) {
  const validation = validateTrainingProfileInput({
    ...createCanonicalPayload(),
    ...overrides,
  });

  assert.equal(validation.ok, true);
  return validation.value;
}

test('getUserSettings returns frontend-friendly defaults when userProfile is missing', async () => {
  let query = null;
  const prisma = {
    user: {
      findUnique: async (args) => {
        query = args;
        return {
          id: 'user_123',
          email: 'athlete@example.com',
          profile: null,
        };
      },
    },
  };

  const result = await getUserSettings('user_123', { prisma });

  assert.deepEqual(query, {
    where: { id: 'user_123' },
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
  assert.equal(result.account.profile.email, 'athlete@example.com');
  assert.equal(result.account.profile.name, null);
  assert.equal(result.meta.hasTrainingProfile, false);
  assert.equal(result.meta.schemaVersion, TRAINING_PROFILE_SCHEMA_VERSION);
  assert.equal(result.aiCoaching.mode, 'off');
  assert.equal(result.interface.units.weight, 'kg');
  assert.equal(result.interface.units.height, 'cm');
  assert.equal(result.trainingProfile.profile.primaryGoal, null);
  assert.deepEqual(result.trainingProfile.profile.environment.equipmentList, []);
  assert.equal(result.trainingProfile.derived.musclePriorityProfile.weights.primary, 1);
  assert.deepEqual(result.trainingProfile.derived.movementConstraints.blockedExerciseIds, []);
});

test('getUserSettings returns the canonical snapshot and derived data when present', async () => {
  const normalizedProfile = createNormalizedCanonicalProfile();
  const mapped = mapTrainingProfileToUserProfileUpdate(normalizedProfile);
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 'user_123',
        email: 'athlete@example.com',
        profile: {
          trainingMode: 'AI_COACH',
          onboardingSnapshot: mapped.onboardingSnapshot,
        },
      }),
    },
  };

  const result = await getUserSettings('user_123', { prisma });

  assert.deepEqual(result.trainingProfile.profile, normalizedProfile);
  assert.deepEqual(result.trainingProfile.derived, mapped.onboardingSnapshot.derived);
  assert.equal(result.aiCoaching.mode, 'on');
  assert.equal(result.meta.hasTrainingProfile, true);
  assert.equal(result.meta.schemaVersion, TRAINING_PROFILE_SCHEMA_VERSION);
});

test('getUserSettings recomputes derived data when onboardingSnapshot.profile exists without derived', async () => {
  const normalizedProfile = createNormalizedCanonicalProfile();
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 'user_123',
        email: 'athlete@example.com',
        profile: {
          trainingMode: 'FIXED',
          onboardingSnapshot: {
            schemaVersion: TRAINING_PROFILE_SCHEMA_VERSION,
            profile: normalizedProfile,
          },
        },
      }),
    },
  };

  const result = await getUserSettings('user_123', { prisma });

  assert.deepEqual(result.trainingProfile.profile, normalizedProfile);
  assert.deepEqual(result.trainingProfile.derived, deriveTrainingProfile(normalizedProfile));
  assert.equal(result.meta.hasTrainingProfile, true);
});

test('updateTrainingProfileSettings validates, maps, persists, and returns the full settings shape', async () => {
  const payload = createCanonicalPayload();
  const validation = validateTrainingProfileInput(payload);
  assert.equal(validation.ok, true);
  const mapped = mapTrainingProfileToUserProfileUpdate(validation.value);
  const calls = {
    userQueries: [],
    upsert: null,
  };
  const prisma = {
    user: {
      findUnique: async (args) => {
        calls.userQueries.push(args);

        if (args.select && args.select.email) {
          return {
            id: 'user_123',
            email: 'athlete@example.com',
            profile: {
              trainingMode: 'FIXED',
              onboardingSnapshot: mapped.onboardingSnapshot,
            },
          };
        }

        return { id: 'user_123' };
      },
    },
    userProfile: {
      upsert: async (args) => {
        calls.upsert = args;
        return {
          id: 'profile_123',
          userId: 'user_123',
          ...mapped,
        };
      },
    },
  };

  const result = await updateTrainingProfileSettings('user_123', payload, { prisma });

  assert.deepEqual(calls.userQueries, [
    {
      where: { id: 'user_123' },
      select: { id: true },
    },
    {
      where: { id: 'user_123' },
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
    },
  ]);
  assert.deepEqual(calls.upsert, {
    where: { userId: 'user_123' },
    update: mapped,
    create: {
      userId: 'user_123',
      ...mapped,
    },
  });
  assert.deepEqual(result.trainingProfile.profile, validation.value);
  assert.deepEqual(result.trainingProfile.derived, mapped.onboardingSnapshot.derived);
  assert.equal(result.meta.hasTrainingProfile, true);
  assert.equal(result.account.profile.email, 'athlete@example.com');
});

test('updateTrainingProfileSettings returns validation details when the canonical payload is invalid', async () => {
  let upsertCalled = false;
  const prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    userProfile: {
      upsert: async () => {
        upsertCalled = true;
        return null;
      },
    },
  };

  await assert.rejects(
    () =>
      updateTrainingProfileSettings(
        'user_123',
        {
          primaryGoal: 'HYPERTROPHY',
          availability: {
            sessionsPerWeek: 4,
            durationPerSession: 60,
          },
        },
        { prisma }
      ),
    (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.match(JSON.stringify(error.details), /experience is required/);
      assert.equal(upsertCalled, false);
      return true;
    }
  );
});

test('upsertUserProfile keeps the canonical onboarding flow for PUT /api/users/:userId/profile', async () => {
  const payload = createCanonicalPayload();
  const validation = validateTrainingProfileInput(payload);
  assert.equal(validation.ok, true);
  const mapped = mapTrainingProfileToUserProfileUpdate(validation.value);
  let upsertArgs = null;
  const prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    userProfile: {
      upsert: async (args) => {
        upsertArgs = args;
        return {
          id: 'profile_123',
          userId: 'user_123',
          ...mapped,
        };
      },
    },
  };

  const result = await upsertUserProfile('user_123', payload, { prisma });

  assert.deepEqual(upsertArgs, {
    where: { userId: 'user_123' },
    update: mapped,
    create: {
      userId: 'user_123',
      ...mapped,
    },
  });
  assert.equal(result.userId, 'user_123');
  assert.deepEqual(result.onboardingSnapshot, mapped.onboardingSnapshot);
});

test('upsertUserProfile keeps the legacy partial update behavior for PUT /api/users/:userId/profile', async () => {
  let upsertArgs = null;
  const prisma = {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    userProfile: {
      upsert: async (args) => {
        upsertArgs = args;
        return {
          id: 'profile_legacy',
          ...args.create,
        };
      },
    },
  };
  const payload = {
    trainingMode: 'FIXED',
    experienceNotes: 'Legacy profile notes',
    availableSessionsPerWeek: 3,
    unexpectedField: 'ignored',
  };

  const result = await upsertUserProfile('user_123', payload, { prisma });

  assert.deepEqual(upsertArgs, {
    where: { userId: 'user_123' },
    update: {
      trainingMode: 'FIXED',
      experienceNotes: 'Legacy profile notes',
      availableSessionsPerWeek: 3,
    },
    create: {
      userId: 'user_123',
      trainingMode: 'FIXED',
      experienceNotes: 'Legacy profile notes',
      availableSessionsPerWeek: 3,
    },
  });
  assert.equal(result.userId, 'user_123');
  assert.equal(result.trainingMode, 'FIXED');
  assert.equal(result.experienceNotes, 'Legacy profile notes');
});
