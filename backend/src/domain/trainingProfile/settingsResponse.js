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

function buildSettingsResponse(user = {}) {
  const snapshot = resolveSnapshot(user.profile?.onboardingSnapshot);

  return {
    account: {
      profile: {
        name: null,
        email: user.email || null,
        username: null,
        profilePicture: null,
      },
    },
    trainingProfile: {
      profile: snapshot.profile,
      derived: snapshot.derived,
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
      schemaVersion: snapshot.schemaVersion,
    },
  };
}

module.exports = {
  buildSettingsResponse,
  createDefaultTrainingProfile,
  deriveTrainingProfile,
};
