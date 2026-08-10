import {
  createTrainingProfileDraft,
  deepClone,
  modernizeTrainingProfileDraft,
} from "../settings/settingsMappers";

export const ONBOARDING_PRIMARY_GOAL = "HYPERTROPHY";
export const FIRST_CANONICAL_SAVE_STEP = 2;

function clampStep(value) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue)) {
    return 1;
  }
  return Math.min(5, Math.max(1, numericValue));
}

export function createOnboardingDraft(settingsData) {
  const source = createTrainingProfileDraft(settingsData);
  return modernizeTrainingProfileDraft({
    ...source,
    primaryGoal: ONBOARDING_PRIMARY_GOAL,
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
      ...(source?.musclePriorities || {}),
    },
    availability: {
      sessionsPerWeek: null,
      durationPerSession: null,
      ...(source?.availability || {}),
    },
    environment: {
      equipmentPreset: null,
      availableEquipment: ["bodyweight"],
      ...(source?.environment || {}),
    },
    movementConstraints: {
      painIssues: [],
      manualBlockedExerciseIds: [],
      ...(source?.movementConstraints || {}),
    },
    exercisePreference: {
      equipmentBias: "no_preference",
      ...(source?.exercisePreference || {}),
    },
    cardioProfile: {
      cardioRole: null,
      preferredModalities: [],
      ...(source?.cardioProfile || {}),
    },
    physicalNotes: source?.physicalNotes ?? "",
  });
}

export function isCanonicalServerAuthoritative(settingsData) {
  return (
    Number(settingsData?.meta?.onboarding?.lastCompletedStep || 0) >=
    FIRST_CANONICAL_SAVE_STEP
  );
}

export function restoreOnboardingSession(settingsData, recovery = null) {
  const accountProfile = settingsData?.account?.profile || {};
  const onboarding = settingsData?.meta?.onboarding || {};
  const lastCompletedStep = Number(onboarding.lastCompletedStep || 0);
  const serverAuthoritative = isCanonicalServerAuthoritative(settingsData);
  const serverDraft = createOnboardingDraft(settingsData);
  const recoveredDraft = recovery?.draft
    ? createOnboardingDraft({
        trainingProfile: { profile: deepClone(recovery.draft) },
      })
    : null;
  const draft = serverAuthoritative || !recoveredDraft
    ? serverDraft
    : recoveredDraft;
  const demographicsLocked = accountProfile.demographicsStatus === "LOCKED";
  const profile = {
    displayName:
      accountProfile.displayName ||
      accountProfile.name ||
      (!serverAuthoritative ? recovery?.profile?.displayName : "") ||
      "",
    age: demographicsLocked
      ? accountProfile.currentAge ?? accountProfile.age ?? ""
      : !serverAuthoritative
        ? recovery?.profile?.age ?? accountProfile.age ?? ""
        : accountProfile.age ?? "",
    sex: demographicsLocked
      ? accountProfile.sex || ""
      : !serverAuthoritative
        ? recovery?.profile?.sex || accountProfile.sex || ""
        : accountProfile.sex || "",
    demographicsStatus: accountProfile.demographicsStatus || "NOT_COLLECTED",
  };
  const resumeStep = serverAuthoritative
    ? lastCompletedStep + 1
    : Math.max(lastCompletedStep + 1, Number(recovery?.step || 1));

  return {
    draft: {
      ...draft,
      primaryGoal: ONBOARDING_PRIMARY_GOAL,
    },
    profile,
    step: clampStep(resumeStep),
    lastCompletedStep,
    serverAuthoritative,
  };
}

export function createOnboardingRecovery({ draft, profile, step }) {
  return {
    draft: deepClone({
      ...draft,
      primaryGoal: ONBOARDING_PRIMARY_GOAL,
    }),
    profile: deepClone(profile),
    step: clampStep(step),
  };
}

export function mergeOnboardingStepIntoCanonical(
  canonicalDraft,
  onboardingDraft,
  step
) {
  const merged = createOnboardingDraft({
    trainingProfile: { profile: deepClone(canonicalDraft) },
  });

  if (step === 2) {
    merged.primaryGoal = ONBOARDING_PRIMARY_GOAL;
    merged.experience = onboardingDraft.experience;
    merged.availability = deepClone(onboardingDraft.availability);
  } else if (step === 3) {
    merged.musclePriorities = deepClone(onboardingDraft.musclePriorities);
  } else if (step === 4) {
    merged.environment = deepClone(onboardingDraft.environment);
    merged.exercisePreference = deepClone(onboardingDraft.exercisePreference);
  } else if (step === 5) {
    merged.movementConstraints = deepClone(onboardingDraft.movementConstraints);
    merged.cardioProfile = deepClone(onboardingDraft.cardioProfile);
    merged.physicalNotes = onboardingDraft.physicalNotes;
  }

  return {
    ...merged,
    primaryGoal: ONBOARDING_PRIMARY_GOAL,
  };
}
