import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  analyzeMovementConstraintsPainIssue,
  createAIWeeklyPlanDraft,
  createCycleFromWeeklyPlan,
  ensureCurrentUserId,
  fetchExercises,
  getAIWeeklyPlanGenerationProgress,
  getOnboardingCycleConflicts,
  getUserSettings,
  updateTrainingProfileSettings,
  updateUserOnboarding,
  updateUserProfile,
} from "../../../services/api";
import OnboardingPage from "../OnboardingPage";
import {
  getOnboardingDraftStorageKey,
  saveOnboardingRecovery,
} from "../onboardingStorage";

jest.mock("../../../services/api", () => ({
  analyzeMovementConstraintsPainIssue: jest.fn(),
  createAIWeeklyPlanDraft: jest.fn(),
  createCycleFromWeeklyPlan: jest.fn(),
  ensureCurrentUserId: jest.fn(),
  fetchExercises: jest.fn(),
  getAIWeeklyPlanGenerationProgress: jest.fn(),
  getOnboardingCycleConflicts: jest.fn(),
  getUserSettings: jest.fn(),
  updateTrainingProfileSettings: jest.fn(),
  updateUserOnboarding: jest.fn(),
  updateUserProfile: jest.fn(),
}));

const ONBOARDING_FLAG = "REACT_APP_ENABLE_ONBOARDING_FRONTEND";
const originalOnboardingFlag = process.env[ONBOARDING_FLAG];

const availabilityOptions = {
  sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
  durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
};

function createCanonicalProfile(overrides = {}) {
  return {
    primaryGoal: "HYPERTROPHY",
    experience: "intermediate",
    availability: { sessionsPerWeek: 4, durationPerSession: 60 },
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    environment: { equipmentPreset: "minimal", availableEquipment: ["bodyweight"] },
    movementConstraints: { painIssues: [], manualBlockedExerciseIds: [] },
    exercisePreference: { equipmentBias: "no_preference" },
    cardioProfile: { cardioRole: null, preferredModalities: [] },
    physicalNotes: "",
    ...overrides,
  };
}

function createSettings({
  status = "IN_PROGRESS",
  lastCompletedStep = 0,
  isComplete = false,
  trainingProfile = createCanonicalProfile(),
  accountProfile = {},
} = {}) {
  return {
    account: {
      profile: {
        displayName: "Alex",
        name: "Alex",
        age: 30,
        currentAge: 30,
        sex: "FEMALE",
        demographicsStatus: "LOCKED",
        ...accountProfile,
      },
    },
    trainingProfile: {
      profile: trainingProfile,
      options: { availability: availabilityOptions },
    },
    meta: {
      hasTrainingProfile: Boolean(trainingProfile?.experience),
      onboarding: {
        status,
        lastCompletedStep,
        isComplete,
      },
    },
  };
}

function createNewSettings() {
  return createSettings({
    status: "NOT_STARTED",
    lastCompletedStep: 0,
    trainingProfile: createCanonicalProfile({
      primaryGoal: null,
      experience: null,
      availability: { sessionsPerWeek: null, durationPerSession: null },
      environment: { equipmentPreset: null, availableEquipment: ["bodyweight"] },
    }),
    accountProfile: {
      displayName: null,
      name: null,
      age: null,
      currentAge: null,
      sex: null,
      demographicsStatus: "NOT_COLLECTED",
    },
  });
}

function renderPage(initialEntry = "/onboarding") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/" element={<p>Home destination</p>} />
        <Route path="/program" element={<p>Program destination</p>} />
        <Route path="/program/ai-builder" element={<p>AI Builder destination</p>} />
        <Route path="/program/cycles/:cycleId" element={<p>Cycle details destination</p>} />
        <Route path="/program/cycles/:cycleId/builder" element={<p>Cycle builder destination</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function findGeneratedProgramHeading() {
  return screen.findByRole(
    "heading",
    { name: "Generated Program" },
    { timeout: 6000 }
  );
}

function mockLifecycle() {
  updateUserOnboarding.mockImplementation(async (payload) => {
    if (payload.action === "COMPLETE") {
      return {
        onboarding: { status: "COMPLETED", lastCompletedStep: 5, isComplete: true },
      };
    }
    return {
      onboarding: {
        status: "IN_PROGRESS",
        lastCompletedStep: payload.lastCompletedStep || 0,
        isComplete: false,
      },
    };
  });
}

beforeEach(() => {
  process.env[ONBOARDING_FLAG] = "true";
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  ensureCurrentUserId.mockResolvedValue("user_123");
  fetchExercises.mockResolvedValue([]);
  analyzeMovementConstraintsPainIssue.mockResolvedValue({ status: "analyzed" });
  getOnboardingCycleConflicts.mockResolvedValue({
    window: {
      timezone: "America/Toronto",
      startDate: "2026-08-17",
      endDate: "2026-09-27",
      durationWeeks: 6,
    },
    conflicts: [],
  });
  getAIWeeklyPlanGenerationProgress.mockResolvedValue({
    generationId: "generation_test",
    status: "RUNNING",
    stage: "RESOLVING_EXERCISES",
  });
  createAIWeeklyPlanDraft.mockResolvedValue({
    weeklyPlanParentId: "weekly_parent_1",
    weeklyPlanVersionId: "weekly_version_1",
    name: "Generated Program",
    status: "PUBLISHED",
    presentation: { summary: "A six-week hypertrophy program." },
  });
  createCycleFromWeeklyPlan.mockResolvedValue({
    cycleId: "cycle_new",
    cycle: { startDate: "2026-08-17", endDate: "2026-09-27" },
  });
  mockLifecycle();
});

afterEach(() => {
  jest.resetAllMocks();
  if (originalOnboardingFlag === undefined) {
    delete process.env[ONBOARDING_FLAG];
  } else {
    process.env[ONBOARDING_FLAG] = originalOnboardingFlag;
  }
});

test("a completed user cannot remain on the onboarding route", async () => {
  getUserSettings.mockResolvedValue(
    createSettings({ status: "COMPLETED", lastCompletedStep: 5, isComplete: true })
  );

  renderPage();

  expect(await screen.findByText("Home destination")).toBeInTheDocument();
  expect(updateUserOnboarding).not.toHaveBeenCalled();
});

test("restores a local draft before the first canonical save", async () => {
  const settings = createNewSettings();
  getUserSettings.mockResolvedValue(settings);
  saveOnboardingRecovery("user_123", {
    draft: createCanonicalProfile({
      experience: "advanced",
      availability: { sessionsPerWeek: null, durationPerSession: null },
      environment: { equipmentPreset: null, availableEquipment: ["bodyweight"] },
    }),
    profile: { displayName: "Local Alex", age: 28, sex: "MALE" },
    step: 2,
  });

  renderPage();

  expect(await screen.findByRole("heading", { name: "Your training" })).toBeInTheDocument();
  expect(updateUserOnboarding).toHaveBeenCalledWith({ action: "BEGIN" });
});

test("uses canonical server state after Step 2 even when stale local recovery exists", async () => {
  getUserSettings.mockResolvedValue(
    createSettings({ lastCompletedStep: 2, trainingProfile: createCanonicalProfile() })
  );
  saveOnboardingRecovery("user_123", {
    draft: createCanonicalProfile({
      experience: "advanced",
      availability: { sessionsPerWeek: 7, durationPerSession: 120 },
    }),
    profile: { displayName: "Stale", age: 25, sex: "MALE" },
    step: 5,
  });

  renderPage();
  expect(await screen.findByRole("heading", { name: "Muscle focus" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Go to previous onboarding step" }));
  expect(await screen.findByRole("heading", { name: "Your training" })).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByText("60")).toBeInTheDocument();
  expect(screen.queryByText("120")).not.toBeInTheDocument();
});

test("saves Step 1 demographics and always persists HYPERTROPHY at Step 2", async () => {
  const newSettings = createNewSettings();
  getUserSettings.mockResolvedValue(newSettings);
  updateUserProfile.mockResolvedValue({
    profile: {
      displayName: "Taylor",
      age: 30,
      currentAge: 30,
      sex: "FEMALE",
      demographicsStatus: "LOCKED",
    },
  });
  updateTrainingProfileSettings.mockImplementation(async (payload) =>
    createSettings({ lastCompletedStep: 1, trainingProfile: payload })
  );

  renderPage();
  expect(await screen.findByRole("heading", { name: "About you" })).toBeInTheDocument();

  const progress = screen.getByRole("progressbar", { name: "Onboarding progress" });
  const progressRoot = progress.closest(".lz-onboarding-progress-top");
  expect(progressRoot).toBeTruthy();
  expect(progressRoot.parentElement.tagName).toBe("HEADER");
  expect(progressRoot.parentElement.firstElementChild).toBe(progressRoot);

  const experienceControl = screen.getByRole("combobox", {
    name: "Training experience",
  });
  expect(experienceControl).not.toHaveTextContent(/experience|select|choose/i);

  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Taylor" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Female" }));
  fireEvent.click(experienceControl);
  fireEvent.click(screen.getByRole("option", { name: "Beginner" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByRole("heading", { name: "Your training" })).toBeInTheDocument();
  expect(updateUserProfile).toHaveBeenCalledWith({
    displayName: "Taylor",
    age: 30,
    sex: "FEMALE",
  });

  fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase session duration" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByRole("heading", { name: "Muscle focus" })).toBeInTheDocument();
  expect(updateTrainingProfileSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      primaryGoal: "HYPERTROPHY",
      experience: "beginner",
      availability: {
        sessionsPerWeek: 1,
        durationPerSession: 15,
        preferredTrainingDays: ["MONDAY"],
      },
    })
  );
  expect(window.localStorage.getItem("lyft_zone_onboarding_draft_v1:user_123")).toBeNull();
});

test("preserves edits on failure, prevents duplicate saves, and supports retry", async () => {
  const settings = createSettings({
    lastCompletedStep: 1,
    trainingProfile: createCanonicalProfile(),
  });
  getUserSettings.mockResolvedValue(settings);

  let rejectSave;
  updateTrainingProfileSettings.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectSave = reject;
    })
  );

  renderPage();
  expect(await screen.findByRole("heading", { name: "Your training" })).toBeInTheDocument();

  const continueButton = screen.getByRole("button", { name: "Continue" });
  fireEvent.click(continueButton);
  fireEvent.click(continueButton);
  await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));

  await act(async () => {
    rejectSave(new Error("Temporary save failure"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Temporary save failure");

  updateTrainingProfileSettings.mockResolvedValueOnce(
    createSettings({ lastCompletedStep: 1, trainingProfile: createCanonicalProfile() })
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Muscle focus" })).toBeInTheDocument();
  expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(2);
});

test("generates a published weekly plan, converts it once, then completes onboarding", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);

  renderPage();
  expect(
    await screen.findByRole("heading", { name: "Anything we should know?" })
  ).toBeInTheDocument();

  const summaryToggle = screen.getByRole("button", { name: "Expand profile summary" });
  expect(summaryToggle).toHaveTextContent(
    "Intermediate · 4 days/week · 60 min/session · Minimal"
  );
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeInTheDocument();
  fireEvent.click(summaryToggle);
  expect(screen.getByRole("region", { name: "Full profile summary" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeInTheDocument();

  const pageMain = document.querySelector(".lz-v2-mobile-page__main");
  pageMain.scrollTop = 640;
  document.documentElement.scrollTop = 640;
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));

  expect(await findGeneratedProgramHeading()).toBeInTheDocument();
  expect(pageMain.scrollTop).toBe(0);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(window.scrollTo).toHaveBeenCalledWith({
    top: 0,
    left: 0,
    behavior: "auto",
  });
  expect(getOnboardingCycleConflicts).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledWith(expect.objectContaining({
    generationId: expect.any(String),
    signal: expect.any(AbortSignal),
  }));
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledWith({
    weeklyPlanParentId: "weekly_parent_1",
    weeklyPlanVersionId: "weekly_version_1",
    name: "Generated Program",
    startDate: "2026-08-17",
    durationWeeks: 6,
    workoutDayAssignments: [
      { workoutOrderIndex: 1, scheduledDay: "MONDAY" },
      { workoutOrderIndex: 2, scheduledDay: "TUESDAY" },
      { workoutOrderIndex: 3, scheduledDay: "THURSDAY" },
      { workoutOrderIndex: 4, scheduledDay: "FRIDAY" },
    ],
    conflictWindow: {
      timezone: "America/Toronto",
      startDate: "2026-08-17",
      endDate: "2026-09-27",
      durationWeeks: 6,
    },
    confirmedConflicts: [],
  });
  expect(updateUserOnboarding).toHaveBeenCalledWith({ action: "COMPLETE" });

  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(await screen.findByText("Cycle details destination")).toBeInTheDocument();
});

test("double submit mints one generationId and dispatches generation once", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  let releaseProfileSave;
  updateTrainingProfileSettings.mockReturnValue(new Promise((resolve) => {
    releaseProfileSave = () => resolve(settings);
  }));

  renderPage();
  const generateButton = await screen.findByRole("button", { name: "Generate my program" });
  fireEvent.click(generateButton);
  fireEvent.click(generateButton);

  await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
  await act(async () => releaseProfileSave());
  await findGeneratedProgramHeading();
  expect(getOnboardingCycleConflicts).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft.mock.calls[0][0].generationId).toEqual(expect.any(String));
});

test("conflict confirmation preserves the generationId minted by the original attempt", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  getOnboardingCycleConflicts.mockResolvedValue({
    window: {
      timezone: "America/Toronto",
      startDate: "2026-08-17",
      endDate: "2026-09-27",
      durationWeeks: 6,
    },
    conflicts: [{
      cycleId: "cycle_existing",
      name: "Existing cycle",
      startDate: "2026-08-17",
      endDate: "2026-09-01",
      updatedAt: "2026-08-11T10:00:00.000Z",
    }],
  });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  const recovery = JSON.parse(
    window.localStorage.getItem(getOnboardingDraftStorageKey("user_123"))
  );
  fireEvent.click(screen.getByRole("button", { name: "Yes, replace cycles" }));

  await findGeneratedProgramHeading();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft.mock.calls[0][0].generationId).toBe(
    recovery.generation.generationId
  );
});

test("unmount aborts the active AI request and late completion cannot continue the flow", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  let resolveGeneration;
  createAIWeeklyPlanDraft.mockReturnValue(new Promise((resolve) => {
    resolveGeneration = resolve;
  }));

  const view = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  await waitFor(() => expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1));
  const { signal } = createAIWeeklyPlanDraft.mock.calls[0][0];
  expect(signal.aborted).toBe(false);

  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveGeneration({
      weeklyPlanParentId: "weekly_parent_late",
      weeklyPlanVersionId: "weekly_version_late",
      name: "Late program",
    });
    await Promise.resolve();
  });
  expect(createCycleFromWeeklyPlan).not.toHaveBeenCalled();
});

test("refresh recovery reuses the generationId and frozen training days, then clears recovery", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      availability: {
        sessionsPerWeek: 4,
        durationPerSession: 60,
        preferredTrainingDays: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
      },
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  const frozenTrainingDays = ["SUNDAY", "TUESDAY", "THURSDAY", "SATURDAY"];
  saveOnboardingRecovery("user_123", {
    draft: settings.trainingProfile.profile,
    profile: settings.account.profile,
    step: 5,
    generation: {
      generationId: "generation_recovered_success",
      startedAt: new Date().toISOString(),
      trainingDays: frozenTrainingDays,
      phase: "converting",
      window: {
        timezone: "America/Toronto",
        startDate: "2026-08-17",
        endDate: "2026-09-27",
        durationWeeks: 6,
      },
      conflicts: [],
    },
  });

  renderPage();
  await findGeneratedProgramHeading();

  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft.mock.calls[0][0].generationId).toBe(
    "generation_recovered_success"
  );
  expect(createCycleFromWeeklyPlan.mock.calls[0][0].workoutDayAssignments).toEqual(
    frozenTrainingDays.map((scheduledDay, index) => ({
      workoutOrderIndex: index + 1,
      scheduledDay,
    }))
  );
  expect(window.localStorage.getItem(getOnboardingDraftStorageKey("user_123"))).toBeNull();
  expect(updateTrainingProfileSettings).not.toHaveBeenCalled();
});

test("refresh while RUNNING polls existing progress and replays with the same generationId", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  const inProgress = new Error("Still running");
  inProgress.code = "AI_GENERATION_IN_PROGRESS";
  createAIWeeklyPlanDraft
    .mockRejectedValueOnce(inProgress)
    .mockResolvedValueOnce({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: "weekly_version_1",
      name: "Generated Program",
      status: "PUBLISHED",
    });
  getAIWeeklyPlanGenerationProgress.mockResolvedValue({
    generationId: "generation_running_recovery",
    status: "SUCCEEDED",
    stage: "SAVING_PROGRAM",
  });
  saveOnboardingRecovery("user_123", {
    draft: settings.trainingProfile.profile,
    profile: settings.account.profile,
    step: 5,
    generation: {
      generationId: "generation_running_recovery",
      startedAt: new Date().toISOString(),
      trainingDays: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
      phase: "generating",
      window: {
        timezone: "America/Toronto",
        startDate: "2026-08-17",
        endDate: "2026-09-27",
        durationWeeks: 6,
      },
      conflicts: [],
    },
  });

  renderPage();
  await findGeneratedProgramHeading();

  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(2);
  expect(createAIWeeklyPlanDraft.mock.calls.map(([input]) => input.generationId)).toEqual([
    "generation_running_recovery",
    "generation_running_recovery",
  ]);
  expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledWith(
    "generation_running_recovery",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("persistent RUNNING recovery polling failure preserves recovery for an explicit same-ID retry", async () => {
  jest.useFakeTimers();
  let view;

  try {
    const settings = createSettings({
      lastCompletedStep: 4,
      trainingProfile: createCanonicalProfile({
        cardioProfile: { cardioRole: "none", preferredModalities: [] },
      }),
    });
    getUserSettings.mockResolvedValue(settings);
    const inProgress = new Error("Still running");
    inProgress.code = "AI_GENERATION_IN_PROGRESS";
    createAIWeeklyPlanDraft
      .mockRejectedValueOnce(inProgress)
      .mockImplementationOnce(() => new Promise(() => {}));
    getAIWeeklyPlanGenerationProgress.mockRejectedValue(
      new Error("Progress unavailable")
    );
    saveOnboardingRecovery("user_123", {
      draft: settings.trainingProfile.profile,
      profile: settings.account.profile,
      step: 5,
      generation: {
        generationId: "generation_running_unavailable",
        startedAt: new Date().toISOString(),
        trainingDays: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
        phase: "generating",
        window: {
          timezone: "America/Toronto",
          startDate: "2026-08-17",
          endDate: "2026-09-27",
          durationWeeks: 6,
        },
        conflicts: [],
      },
    });

    view = renderPage();
    await waitFor(() => expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Program generation was interrupted."
    );
    expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(createCycleFromWeeklyPlan).not.toHaveBeenCalled();
    const recovery = JSON.parse(
      window.localStorage.getItem(getOnboardingDraftStorageKey("user_123"))
    );
    expect(recovery.generation).toEqual(expect.objectContaining({
      generationId: "generation_running_unavailable",
      phase: "generating",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(2));
    expect(createAIWeeklyPlanDraft.mock.calls.map(([input]) => input.generationId)).toEqual([
      "generation_running_unavailable",
      "generation_running_unavailable",
    ]);
  } finally {
    view?.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("holds the completed loader at 100% before showing the result", async () => {
  jest.useFakeTimers();
  let view;
  let resolveCompletion;

  try {
    const settings = createSettings({
      lastCompletedStep: 4,
      trainingProfile: createCanonicalProfile({
        cardioProfile: { cardioRole: "none", preferredModalities: [] },
      }),
    });
    getUserSettings.mockResolvedValue(settings);
    updateTrainingProfileSettings.mockResolvedValue(settings);
    updateUserOnboarding.mockImplementation((payload) => {
      if (payload.action === "COMPLETE") {
        return new Promise((resolve) => {
          resolveCompletion = resolve;
        });
      }
      return Promise.resolve({
        onboarding: { status: "IN_PROGRESS", lastCompletedStep: 4, isComplete: false },
      });
    });

    view = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
    await waitFor(() => expect(resolveCompletion).toEqual(expect.any(Function)));

    await act(async () => {
      resolveCompletion({
        onboarding: { status: "COMPLETED", lastCompletedStep: 5, isComplete: true },
      });
      await Promise.resolve();
    });

    expect(
      screen.getByRole("progressbar", { name: "Program generation progress" })
    ).not.toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByRole("heading", { name: "Generated Program" })).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(3200);
    });
    expect(
      screen.getByRole("progressbar", { name: "Program generation progress" })
    ).toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByRole("heading", { name: "Generated Program" })).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(screen.queryByRole("heading", { name: "Generated Program" })).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("heading", { name: "Generated Program" })).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(180);
    });
    expect(screen.getByRole("heading", { name: "Generated Program" })).toBeInTheDocument();
  } finally {
    view?.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("result Modify opens the created cycle in the multi-week builder", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  await findGeneratedProgramHeading();
  fireEvent.click(screen.getByRole("button", { name: "Modify" }));

  expect(await screen.findByText("Cycle builder destination")).toBeInTheDocument();
  expect(screen.queryByText("AI Builder destination")).not.toBeInTheDocument();
});

test("conflict cancellation completes onboarding without generation or deletion", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  getOnboardingCycleConflicts.mockResolvedValue({
    window: {
      timezone: "America/Toronto",
      startDate: "2026-08-17",
      endDate: "2026-09-27",
      durationWeeks: 6,
    },
    conflicts: [
      {
        cycleId: "cycle_existing",
        name: "Current cycle",
        startDate: "2026-08-10",
        endDate: "2026-09-20",
        updatedAt: "2026-08-10T10:00:00.000Z",
      },
    ],
  });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "No, go Home" }));

  expect(await screen.findByText("Home destination")).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
  expect(createCycleFromWeeklyPlan).not.toHaveBeenCalled();
});

test("conversion retry reuses the generated weekly plan without calling AI again", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  createCycleFromWeeklyPlan
    .mockRejectedValueOnce(new Error("Conversion unavailable"))
    .mockResolvedValueOnce({
      cycleId: "cycle_new",
      cycle: { startDate: "2026-08-17", endDate: "2026-09-27" },
    });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conversion unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await findGeneratedProgramHeading()).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(2);
});

test("AI retry generates again only after the first AI request fails", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  createAIWeeklyPlanDraft
    .mockRejectedValueOnce(new Error("Generation unavailable"))
    .mockResolvedValueOnce({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: "weekly_version_1",
      name: "Generated Program",
      status: "PUBLISHED",
    });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Generation unavailable");
  expect(createCycleFromWeeklyPlan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await findGeneratedProgramHeading()).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(2);
  expect(createAIWeeklyPlanDraft.mock.calls[0][0].generationId).toBe(
    createAIWeeklyPlanDraft.mock.calls[1][0].generationId
  );
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(1);
});

test("stale conflicts return to confirmation and reconvert without regenerating AI", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  const staleError = new Error("Confirmation required");
  staleError.code = "CYCLE_CONFLICT_CONFIRMATION_REQUIRED";
  staleError.details = {
    window: {
      timezone: "America/Toronto",
      startDate: "2026-08-17",
      endDate: "2026-09-27",
      durationWeeks: 6,
    },
    conflicts: [
      {
        cycleId: "cycle_new_conflict",
        name: "New conflict",
        startDate: "2026-08-20",
        endDate: "2026-09-10",
        updatedAt: "2026-08-10T13:00:00.000Z",
      },
    ],
  };
  createCycleFromWeeklyPlan
    .mockRejectedValueOnce(staleError)
    .mockResolvedValueOnce({
      cycleId: "cycle_new",
      cycle: { startDate: "2026-08-17", endDate: "2026-09-27" },
    });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("New conflict");
  fireEvent.click(screen.getByRole("button", { name: "Yes, replace cycles" }));

  expect(await findGeneratedProgramHeading()).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(2);
  expect(createCycleFromWeeklyPlan.mock.calls[1][0].confirmedConflicts).toEqual(
    staleError.details.conflicts
  );
});

test("onboarding completion retry does not repeat generation or conversion", async () => {
  const settings = createSettings({
    lastCompletedStep: 4,
    trainingProfile: createCanonicalProfile({
      cardioProfile: { cardioRole: "none", preferredModalities: [] },
    }),
  });
  getUserSettings.mockResolvedValue(settings);
  updateTrainingProfileSettings.mockResolvedValue(settings);
  let completeAttempts = 0;
  updateUserOnboarding.mockImplementation(async (payload) => {
    if (payload.action === "COMPLETE") {
      completeAttempts += 1;
      if (completeAttempts === 1) {
        throw new Error("Lifecycle unavailable");
      }
      return {
        onboarding: { status: "COMPLETED", lastCompletedStep: 5, isComplete: true },
      };
    }
    return {
      onboarding: { status: "IN_PROGRESS", lastCompletedStep: 4, isComplete: false },
    };
  });

  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Lifecycle unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await findGeneratedProgramHeading()).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(1);
  expect(completeAttempts).toBe(2);
});

test("Generate remains disabled until Step 5 has an explicit cardio choice", async () => {
  const settings = createSettings({ lastCompletedStep: 4 });
  getUserSettings.mockResolvedValue(settings);

  renderPage();
  expect(
    await screen.findByRole("heading", { name: "Anything we should know?" })
  ).toBeInTheDocument();

  const generateButton = screen.getByRole("button", { name: "Generate my program" });
  expect(generateButton).toBeDisabled();
  expect(updateTrainingProfileSettings).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(generateButton).toBeEnabled();
});

test("the rollout flag disables the onboarding route", async () => {
  delete process.env[ONBOARDING_FLAG];
  renderPage();

  expect(await screen.findByText("Home destination")).toBeInTheDocument();
  expect(getUserSettings).not.toHaveBeenCalled();
});
