import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  analyzeMovementConstraintsPainIssue,
  ensureCurrentUserId,
  fetchExercises,
  getUserSettings,
  updateTrainingProfileSettings,
  updateUserOnboarding,
  updateUserProfile,
} from "../../../services/api";
import OnboardingPage from "../OnboardingPage";
import { saveOnboardingRecovery } from "../onboardingStorage";

jest.mock("../../../services/api", () => ({
  analyzeMovementConstraintsPainIssue: jest.fn(),
  ensureCurrentUserId: jest.fn(),
  fetchExercises: jest.fn(),
  getUserSettings: jest.fn(),
  updateTrainingProfileSettings: jest.fn(),
  updateUserOnboarding: jest.fn(),
  updateUserProfile: jest.fn(),
}));

const ONBOARDING_FLAG = "REACT_APP_ENABLE_ONBOARDING_FRONTEND";
const AI_FLAG = "REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND";
const originalOnboardingFlag = process.env[ONBOARDING_FLAG];
const originalAiFlag = process.env[AI_FLAG];

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
      </Routes>
    </MemoryRouter>
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
  delete process.env[AI_FLAG];
  window.localStorage.clear();
  ensureCurrentUserId.mockResolvedValue("user_123");
  fetchExercises.mockResolvedValue([]);
  analyzeMovementConstraintsPainIssue.mockResolvedValue({ status: "analyzed" });
  mockLifecycle();
});

afterEach(() => {
  jest.resetAllMocks();
  if (originalOnboardingFlag === undefined) {
    delete process.env[ONBOARDING_FLAG];
  } else {
    process.env[ONBOARDING_FLAG] = originalOnboardingFlag;
  }
  if (originalAiFlag === undefined) {
    delete process.env[AI_FLAG];
  } else {
    process.env[AI_FLAG] = originalAiFlag;
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
      availability: { sessionsPerWeek: 1, durationPerSession: 15 },
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
  expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1);

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

test.each([
  ["true", "AI Builder destination"],
  ["false", "Program destination"],
])("completion routes according to the AI Builder flag %s", async (flagValue, destination) => {
  process.env[AI_FLAG] = flagValue;
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

  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));

  expect(await screen.findByText(destination)).toBeInTheDocument();
  expect(updateUserOnboarding).toHaveBeenCalledWith({ action: "COMPLETE" });
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
