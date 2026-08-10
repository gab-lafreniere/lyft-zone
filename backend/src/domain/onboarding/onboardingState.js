const {
  validateTrainingProfileInput,
} = require('../trainingProfile/trainingProfileValidation');

const ONBOARDING_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
});
const ONBOARDING_STATUS_VALUES = new Set(Object.values(ONBOARDING_STATUS));
const MIN_ONBOARDING_STEP = 0;
const MAX_ONBOARDING_STEP = 5;

function hasValidCanonicalTrainingProfile(profile) {
  const canonicalProfile = profile?.onboardingSnapshot?.profile;
  if (!canonicalProfile || typeof canonicalProfile !== 'object' || Array.isArray(canonicalProfile)) {
    return false;
  }

  return validateTrainingProfileInput(canonicalProfile).ok;
}

function normalizeLastCompletedStep(value, status) {
  if (status === ONBOARDING_STATUS.COMPLETED) {
    return MAX_ONBOARDING_STEP;
  }

  if (!Number.isInteger(value)) {
    return 0;
  }

  return Math.min(MAX_ONBOARDING_STEP, Math.max(MIN_ONBOARDING_STEP, value));
}

function deriveOnboardingState(profile = null) {
  const hasValidTrainingProfile = hasValidCanonicalTrainingProfile(profile);
  const storedStatus = ONBOARDING_STATUS_VALUES.has(profile?.onboardingStatus)
    ? profile.onboardingStatus
    : null;

  if (!storedStatus) {
    const isComplete = hasValidTrainingProfile;
    return {
      status: isComplete
        ? ONBOARDING_STATUS.COMPLETED
        : ONBOARDING_STATUS.NOT_STARTED,
      lastCompletedStep: isComplete ? MAX_ONBOARDING_STEP : 0,
      isComplete,
      isLegacyInferred: true,
      hasValidTrainingProfile,
    };
  }

  return {
    status: storedStatus,
    lastCompletedStep: normalizeLastCompletedStep(
      profile?.onboardingLastCompletedStep,
      storedStatus
    ),
    isComplete: storedStatus === ONBOARDING_STATUS.COMPLETED,
    isLegacyInferred: false,
    hasValidTrainingProfile,
  };
}

module.exports = {
  MAX_ONBOARDING_STEP,
  MIN_ONBOARDING_STEP,
  ONBOARDING_STATUS,
  deriveOnboardingState,
  hasValidCanonicalTrainingProfile,
  normalizeLastCompletedStep,
};

