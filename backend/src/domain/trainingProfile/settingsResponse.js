const {
  resolveEquipmentContext,
} = require('../programGeneration/equipmentResolver');
const {
  resolveMovementConstraints,
} = require('../programGeneration/movementConstraintResolver');
const {
  resolveMusclePriorityProfile,
} = require('../programGeneration/musclePriorityResolver');
const {
  TRAINING_PROFILE_SCHEMA_VERSION,
} = require('./trainingProfileMapper');
const {
  resolveEnvironmentInput,
} = require('./trainingProfileEnvironment');
const {
  normalizeMovementConstraintsInput,
} = require('./trainingProfileValidation');
const {
  DEMOGRAPHICS_STATUS,
  calculateCurrentAge,
  deriveDemographicsStatus,
} = require('../userProfile/userProfileDemographics');
const {
  getTrainingProfileAvailabilityOptions,
} = require('./trainingProfileAvailability');
const {
  deriveOnboardingState,
} = require('../onboarding/onboardingState');

function createDefaultTrainingProfile() {
  return {
    primaryGoal: null,
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    experience: null,
    availability: {
      sessionsPerWeek: null,
      durationPerSession: null,
    },
    environment: {
      equipmentPreset: null,
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

function modernizeTrainingProfile(profile) {
  const sourceProfile = profile && typeof profile === 'object'
    ? profile
    : createDefaultTrainingProfile();

  return {
    ...sourceProfile,
    environment: resolveEnvironmentInput(sourceProfile.environment),
    movementConstraints: normalizeMovementConstraintsInput(sourceProfile.movementConstraints, []),
  };
}

function deriveTrainingProfile(profile) {
  return {
    musclePriorityProfile: resolveMusclePriorityProfile(profile),
    equipmentContext: resolveEquipmentContext(profile),
    movementConstraints: resolveMovementConstraints(profile),
  };
}

function resolveSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    const defaultProfile = createDefaultTrainingProfile();

    return {
      profile: defaultProfile,
      derived: deriveTrainingProfile(defaultProfile),
      hasTrainingProfile: false,
      schemaVersion: TRAINING_PROFILE_SCHEMA_VERSION,
    };
  }

  const hasTrainingProfile = Boolean(
    snapshot.profile && typeof snapshot.profile === 'object'
  );
  const profile = hasTrainingProfile
    ? modernizeTrainingProfile(snapshot.profile)
    : createDefaultTrainingProfile();
  const derived = deriveTrainingProfile(profile);

  return {
    profile,
    derived,
    hasTrainingProfile,
    schemaVersion:
      Number.isInteger(snapshot.schemaVersion)
        ? snapshot.schemaVersion
        : TRAINING_PROFILE_SCHEMA_VERSION,
  };
}

function buildSettingsResponse(user = {}, options = {}) {
  const snapshot = resolveSnapshot(user.profile?.onboardingSnapshot);
  const onboarding = deriveOnboardingState(user.profile);
  const demographicsStatus = deriveDemographicsStatus(
    user.profile,
    options.referenceDate
  );
  const currentAge = demographicsStatus === DEMOGRAPHICS_STATUS.LOCKED
    ? calculateCurrentAge({
      storedAge: user.profile.age,
      ageInputDate: user.profile.ageInputDate,
      referenceDate: options.referenceDate,
    })
    : null;

  return {
    account: {
      profile: {
        displayName: user.profile?.displayName ?? null,
        name: user.profile?.displayName ?? null,
        email: user.email || null,
        username: null,
        profilePicture: null,
        age: user.profile?.age ?? null,
        sex: user.profile?.sex ?? null,
        currentAge,
        demographicsStatus,
      },
    },
    trainingProfile: {
      profile: snapshot.profile,
      derived: snapshot.derived,
      options: {
        availability: getTrainingProfileAvailabilityOptions(),
      },
    },
    aiCoaching: {
      mode: user.profile?.trainingMode === 'AI_COACH' ? 'on' : 'off',
      autonomyLevel: 'manual',
    },
    workoutExperience: {
      defaultRestTimer: null,
      soundVibrationAlerts: false,
    },
    interface: {
      units: {
        weight: 'kg',
        height: 'cm',
      },
    },
    meta: {
      hasTrainingProfile: snapshot.hasTrainingProfile,
      hasValidTrainingProfile: onboarding.hasValidTrainingProfile,
      schemaVersion: snapshot.schemaVersion,
      onboarding,
    },
  };
}

module.exports = {
  buildSettingsResponse,
  createDefaultTrainingProfile,
  deriveTrainingProfile,
};
