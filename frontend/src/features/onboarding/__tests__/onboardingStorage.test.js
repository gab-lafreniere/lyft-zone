import {
  createOnboardingDraft,
  mergeOnboardingStepIntoCanonical,
  restoreOnboardingSession,
} from "../onboardingDraft";
import {
  ONBOARDING_GENERATION_RECOVERY_TTL_MS,
  clearOnboardingRecovery,
  getOnboardingDraftStorageKey,
  loadOnboardingRecovery,
  saveOnboardingRecovery,
} from "../onboardingStorage";

function createSettings({ lastCompletedStep = 0, profile = {} } = {}) {
  return {
    account: {
      profile: {
        displayName: "",
        age: null,
        sex: null,
        demographicsStatus: "NOT_COLLECTED",
      },
    },
    trainingProfile: {
      profile: {
        primaryGoal: null,
        experience: null,
        availability: { sessionsPerWeek: null, durationPerSession: null },
        environment: { equipmentPreset: null, availableEquipment: ["bodyweight"] },
        musclePriorities: {
          primaryFocus: null,
          secondaryFocuses: [],
          deprioritizedArea: null,
        },
        movementConstraints: { painIssues: [], manualBlockedExerciseIds: [] },
        exercisePreference: { equipmentBias: "no_preference" },
        cardioProfile: { cardioRole: null, preferredModalities: [] },
        physicalNotes: "",
        ...profile,
      },
    },
    meta: {
      onboarding: {
        status: "IN_PROGRESS",
        lastCompletedStep,
        isComplete: false,
      },
    },
  };
}

beforeEach(() => window.localStorage.clear());

test("stores recovery under a versioned user-scoped key", () => {
  const recovery = {
    draft: createOnboardingDraft(createSettings()),
    profile: { displayName: "Alex", age: 30, sex: "MALE" },
    step: 2,
  };

  saveOnboardingRecovery("user_1", recovery);

  expect(loadOnboardingRecovery("user_1")).toMatchObject({
    version: 1,
    userId: "user_1",
    step: 2,
    profile: recovery.profile,
  });
  expect(loadOnboardingRecovery("user_2")).toBeNull();
  expect(window.localStorage.getItem(getOnboardingDraftStorageKey("user_1"))).not.toBeNull();

  clearOnboardingRecovery("user_1");
  expect(loadOnboardingRecovery("user_1")).toBeNull();
});

test("rejects malformed or incompatible recovery", () => {
  window.localStorage.setItem(
    getOnboardingDraftStorageKey("user_1"),
    JSON.stringify({ version: 2, userId: "user_1", draft: {} })
  );
  expect(loadOnboardingRecovery("user_1")).toBeNull();

  window.localStorage.setItem(getOnboardingDraftStorageKey("user_1"), "not-json");
  expect(loadOnboardingRecovery("user_1")).toBeNull();
  expect(window.localStorage.getItem(getOnboardingDraftStorageKey("user_1"))).toBeNull();
});

test("rehydrates a valid generation attempt with its frozen training days", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  saveOnboardingRecovery("user_1", {
    draft: createOnboardingDraft(createSettings()),
    profile: { displayName: "Alex", age: 30, sex: "MALE" },
    step: 5,
    generation: {
      generationId: "generation_recovery_1",
      startedAt: new Date(now).toISOString(),
      trainingDays: ["TUESDAY", "THURSDAY"],
      phase: "generating",
      window: { startDate: "2026-08-24", durationWeeks: 6 },
      conflicts: [],
    },
  });

  expect(loadOnboardingRecovery("user_1", window.localStorage, now).generation).toEqual({
    generationId: "generation_recovery_1",
    startedAt: new Date(now).toISOString(),
    trainingDays: ["TUESDAY", "THURSDAY"],
    phase: "generating",
    window: { startDate: "2026-08-24", durationWeeks: 6 },
    conflicts: [],
  });
});

test("clears corrupt and stale generation recovery without bricking draft loading", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  const base = {
    version: 1,
    userId: "user_1",
    draft: createOnboardingDraft(createSettings()),
    profile: {},
    step: 5,
  };
  window.localStorage.setItem(
    getOnboardingDraftStorageKey("user_1"),
    JSON.stringify({
      ...base,
      generation: {
        generationId: "contains spaces",
        startedAt: new Date(now).toISOString(),
        trainingDays: ["MONDAY"],
        phase: "generating",
      },
    })
  );
  expect(loadOnboardingRecovery("user_1", window.localStorage, now)).toBeNull();
  expect(window.localStorage.getItem(getOnboardingDraftStorageKey("user_1"))).toBeNull();

  window.localStorage.setItem(
    getOnboardingDraftStorageKey("user_1"),
    JSON.stringify({
      ...base,
      generation: {
        generationId: "stale_generation",
        startedAt: new Date(now - ONBOARDING_GENERATION_RECOVERY_TTL_MS - 1).toISOString(),
        trainingDays: ["MONDAY"],
        phase: "generating",
      },
    })
  );
  expect(loadOnboardingRecovery("user_1", window.localStorage, now)).toBeNull();
  expect(window.localStorage.getItem(getOnboardingDraftStorageKey("user_1"))).toBeNull();
});

test("restores local draft before Step 2 and ignores it once the server is authoritative", () => {
  const recovery = {
    draft: {
      ...createOnboardingDraft(createSettings()),
      experience: "advanced",
      availability: { sessionsPerWeek: 7, durationPerSession: 120 },
    },
    profile: { displayName: "Local", age: 28, sex: "FEMALE" },
    step: 2,
  };

  const localSession = restoreOnboardingSession(createSettings(), recovery);
  expect(localSession.draft.experience).toBe("advanced");
  expect(localSession.step).toBe(2);
  expect(localSession.draft.primaryGoal).toBe("HYPERTROPHY");

  const serverSession = restoreOnboardingSession(
    createSettings({
      lastCompletedStep: 2,
      profile: {
        experience: "beginner",
        availability: { sessionsPerWeek: 3, durationPerSession: 45 },
      },
    }),
    recovery
  );
  expect(serverSession.serverAuthoritative).toBe(true);
  expect(serverSession.draft.experience).toBe("beginner");
  expect(serverSession.draft.availability).toEqual({
    sessionsPerWeek: 3,
    durationPerSession: 45,
  });
  expect(serverSession.step).toBe(3);
});

test("merges only the active onboarding step into a newer canonical profile", () => {
  const canonical = createOnboardingDraft(
    createSettings({
      lastCompletedStep: 3,
      profile: {
        experience: "beginner",
        availability: { sessionsPerWeek: 3, durationPerSession: 45 },
        musclePriorities: {
          primaryFocus: "back",
          secondaryFocuses: [],
          deprioritizedArea: null,
        },
        environment: {
          equipmentPreset: "commercial_gym",
          availableEquipment: ["bodyweight", "cable_machine"],
        },
      },
    })
  );
  const local = {
    ...canonical,
    experience: "advanced",
    musclePriorities: {
      primaryFocus: "chest",
      secondaryFocuses: ["biceps"],
      deprioritizedArea: null,
    },
  };

  const merged = mergeOnboardingStepIntoCanonical(canonical, local, 3);

  expect(merged.musclePriorities).toEqual(local.musclePriorities);
  expect(merged.experience).toBe("beginner");
  expect(merged.environment).toEqual(canonical.environment);
});
