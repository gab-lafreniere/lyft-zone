const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ONBOARDING_STATUS,
  deriveOnboardingState,
  hasValidCanonicalTrainingProfile,
} = require('../../src/domain/onboarding/onboardingState');
const {
  MAX_DISPLAY_NAME_LENGTH,
  validateDisplayName,
} = require('../../src/domain/userProfile/userProfileDisplayName');
const {
  updateUserOnboarding,
} = require('../../services/usersService');

function createCanonicalProfile() {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    experience: 'beginner',
    availability: {
      sessionsPerWeek: 3,
      durationPerSession: 60,
    },
    environment: {
      equipmentPreset: 'minimal',
      availableEquipment: ['bodyweight'],
    },
    movementConstraints: {
      painIssues: [],
      manualBlockedExerciseIds: [],
    },
    exercisePreference: {
      equipmentBias: 'no_preference',
    },
    cardioProfile: {
      cardioRole: null,
      preferredModalities: [],
    },
    physicalNotes: null,
  };
}

function createProfile(overrides = {}) {
  return {
    userId: 'user_123',
    displayName: 'Jordan',
    age: 30,
    ageInputDate: new Date('2026-08-07T00:00:00.000Z'),
    sex: 'FEMALE',
    onboardingStatus: null,
    onboardingLastCompletedStep: null,
    onboardingSnapshot: {
      schemaVersion: 2,
      profile: createCanonicalProfile(),
    },
    ...overrides,
  };
}

function createPrisma(initialProfile = null) {
  let profile = initialProfile;
  let upsertCount = 0;

  const tx = {
    userProfile: {
      findUnique: async () => profile,
      upsert: async ({ update, create }) => {
        upsertCount += 1;
        profile = profile
          ? { ...profile, ...update }
          : { id: 'profile_123', ...create };
        return profile;
      },
    },
  };

  return {
    user: {
      findUnique: async () => ({ id: 'user_123' }),
    },
    userProfile: tx.userProfile,
    $transaction: async (operation) => operation(tx),
    getProfile: () => profile,
    getUpsertCount: () => upsertCount,
  };
}

test('legacy inference bypasses onboarding only for a canonically valid Training Profile', () => {
  const validProfile = createProfile();
  const invalidProfile = createProfile({
    onboardingSnapshot: {
      schemaVersion: 2,
      profile: { primaryGoal: 'HYPERTROPHY' },
    },
  });

  assert.equal(hasValidCanonicalTrainingProfile(validProfile), true);
  assert.deepEqual(deriveOnboardingState(validProfile), {
    status: 'COMPLETED',
    lastCompletedStep: 5,
    isComplete: true,
    isLegacyInferred: true,
    hasValidTrainingProfile: true,
  });
  assert.deepEqual(deriveOnboardingState(invalidProfile), {
    status: 'NOT_STARTED',
    lastCompletedStep: 0,
    isComplete: false,
    isLegacyInferred: true,
    hasValidTrainingProfile: false,
  });
});

test('explicit lifecycle states preserve NOT_STARTED, IN_PROGRESS, and COMPLETED', () => {
  assert.equal(
    deriveOnboardingState(createProfile({ onboardingStatus: 'NOT_STARTED' })).status,
    ONBOARDING_STATUS.NOT_STARTED
  );
  assert.deepEqual(
    deriveOnboardingState(createProfile({
      onboardingStatus: 'IN_PROGRESS',
      onboardingLastCompletedStep: 3,
    })),
    {
      status: 'IN_PROGRESS',
      lastCompletedStep: 3,
      isComplete: false,
      isLegacyInferred: false,
      hasValidTrainingProfile: true,
    }
  );
  assert.deepEqual(
    deriveOnboardingState(createProfile({
      onboardingStatus: 'COMPLETED',
      onboardingLastCompletedStep: 2,
    })).lastCompletedStep,
    5
  );
});

test('displayName validation trims, bounds, and rejects missing values', () => {
  assert.deepEqual(validateDisplayName('  Jordan   Lee  '), {
    ok: true,
    value: 'Jordan Lee',
  });
  assert.equal(validateDisplayName('   ').ok, false);
  assert.equal(validateDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)).ok, false);
  assert.deepEqual(validateDisplayName(null, { required: false }), {
    ok: true,
    value: null,
  });
});

test('lifecycle begin and advance are monotonic and idempotent', async () => {
  const prisma = createPrisma(createProfile({
    onboardingStatus: 'NOT_STARTED',
    onboardingLastCompletedStep: null,
  }));

  const begun = await updateUserOnboarding('user_123', { action: 'BEGIN' }, { prisma });
  assert.equal(begun.status, 'IN_PROGRESS');
  assert.equal(begun.lastCompletedStep, 0);

  await updateUserOnboarding(
    'user_123',
    { action: 'ADVANCE', lastCompletedStep: 3 },
    { prisma }
  );
  const repeated = await updateUserOnboarding(
    'user_123',
    { action: 'ADVANCE', lastCompletedStep: 2 },
    { prisma }
  );

  assert.equal(repeated.lastCompletedStep, 3);
  assert.equal(prisma.getProfile().onboardingLastCompletedStep, 3);
});

test('completion rejects an invalid canonical Training Profile', async () => {
  const prisma = createPrisma(createProfile({
    onboardingStatus: 'IN_PROGRESS',
    onboardingLastCompletedStep: 1,
    onboardingSnapshot: null,
  }));

  await assert.rejects(
    updateUserOnboarding('user_123', { action: 'COMPLETE' }, { prisma }),
    (error) => error.code === 'PROFILE_NOT_READY' && error.status === 409
  );
});

test('completion requires new-user identity and demographics, then becomes idempotent', async () => {
  const prisma = createPrisma(createProfile({
    onboardingStatus: 'IN_PROGRESS',
    onboardingLastCompletedStep: 4,
  }));

  const completed = await updateUserOnboarding(
    'user_123',
    { action: 'COMPLETE' },
    { prisma, now: new Date('2026-08-07T12:00:00.000Z') }
  );
  const writesAfterCompletion = prisma.getUpsertCount();
  const repeated = await updateUserOnboarding(
    'user_123',
    { action: 'COMPLETE' },
    { prisma, now: new Date('2026-08-07T12:00:00.000Z') }
  );

  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.lastCompletedStep, 5);
  assert.equal(repeated.status, 'COMPLETED');
  assert.equal(prisma.getUpsertCount(), writesAfterCompletion);
});

test('legacy completion inference remains compatible without displayName or demographics', async () => {
  const prisma = createPrisma(createProfile({
    displayName: null,
    age: null,
    ageInputDate: null,
    sex: null,
  }));

  const result = await updateUserOnboarding('user_123', { action: 'BEGIN' }, { prisma });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.isLegacyInferred, true);
  assert.equal(prisma.getUpsertCount(), 0);
});

