import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ManualProgramProvider } from "../../context/ManualProgramContext";
import {
  createAIWeeklyPlanDraft,
  getUserSettings,
  openOrCreateWeeklyPlanEditDraft,
  updateTrainingProfileAvailability,
} from "../../services/api";
import AIWeeklyPlanBuilder from "../AIWeeklyPlanBuilder";

jest.mock("../../services/api", () => ({
  createAIWeeklyPlanDraft: jest.fn(),
  getUserSettings: jest.fn(),
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  updateTrainingProfileAvailability: jest.fn(),
}));

jest.mock("../../features/settings/SettingsDrawer", () => ({
  __esModule: true,
  default: function MockSettingsDrawer({ isOpen, onClose }) {
    return isOpen ? (
      <div role="dialog" aria-label="Training Profile settings">
        <button type="button" onClick={onClose}>Close settings</button>
      </div>
    ) : null;
  },
}));

const FEATURE_FLAG = "REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND";
const originalFeatureFlag = process.env[FEATURE_FLAG];
const availabilityOptions = {
  sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
  durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
};

function createSettingsResponse({
  sessionsPerWeek = 4,
  durationPerSession = 60,
  hasTrainingProfile = true,
} = {}) {
  return {
    meta: { hasTrainingProfile },
    trainingProfile: {
      options: { availability: availabilityOptions },
      profile: {
        primaryGoal: "HYPERTROPHY",
        experience: "intermediate",
        availability: { sessionsPerWeek, durationPerSession },
        musclePriorities: {
          primaryFocus: "chest",
          secondaryFocuses: ["back"],
        },
        environment: {
          equipmentPreset: "full_gym",
          availableEquipment: ["bodyweight", "dumbbells"],
        },
      },
    },
  };
}

const settingsResponse = createSettingsResponse();
const generatedDraft = {
  weeklyPlanParentId: "weekly_parent_ai_1",
  weeklyPlanVersionId: "weekly_version_ai_1",
  name: "Balanced hypertrophy",
  status: "PUBLISHED",
  source: "ai",
  metrics: {
    totalExercises: 11,
    strengthSets: 30,
    averageDurationMinutes: 50,
    averageTUTMinutes: 17,
    weeklyMuscleDistribution: [
      { key: "chest", label: "Chest", rawSets: 16, percentage: 53 },
    ],
  },
  presentation: {
    title: "Balanced hypertrophy",
    summary: "A balanced split that prioritizes upper chest and back.",
    weeklyStructure: ["Upper A", "Lower A"],
    musclePriorities: ["upper_chest", "back"],
    constraintNotes: ["Use pain-free ranges of motion."],
    progression: "Add repetitions before increasing load.",
    coachingNotes: ["Keep technique consistent."],
  },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function controlledError(code, status = 503) {
  const error = new Error("Private provider message");
  error.code = code;
  error.status = status;
  return error;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
}

function renderBuilder(entry = "/program/ai-builder") {
  return render(
    <ManualProgramProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/program/ai-builder" element={<AIWeeklyPlanBuilder />} />
          <Route path="/program/all" element={<p>Programs</p>} />
          <Route path="/program/all/:programId" element={<p>Program details</p>} />
          <Route path="/program" element={<p>Program home</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </ManualProgramProvider>
  );
}

async function renderLoaded(response = settingsResponse) {
  getUserSettings.mockResolvedValue(response);
  const result = renderBuilder();
  await screen.findByText("Hypertrophy");
  return result;
}

beforeEach(() => {
  process.env[FEATURE_FLAG] = "true";
  jest.clearAllMocks();
  getUserSettings.mockResolvedValue(settingsResponse);
  updateTrainingProfileAvailability.mockResolvedValue(settingsResponse);
  createAIWeeklyPlanDraft.mockResolvedValue(generatedDraft);
  openOrCreateWeeklyPlanEditDraft.mockResolvedValue({
    weeklyPlanParentId: "weekly_parent_ai_1",
    weeklyPlanVersionId: "weekly_version_draft_2",
    source: "ai",
    builderPayload: { programName: "Balanced hypertrophy", sessionsPerWeek: 2, workouts: [] },
  });
});

afterEach(() => {
  jest.useRealTimers();
  if (originalFeatureFlag === undefined) delete process.env[FEATURE_FLAG];
  else process.env[FEATURE_FLAG] = originalFeatureFlag;
});

test("renders the disabled feature state without loading or generating", () => {
  process.env[FEATURE_FLAG] = "false";
  renderBuilder();
  expect(screen.getByText("AI weekly plan generation is currently unavailable.")).toBeInTheDocument();
  expect(getUserSettings).not.toHaveBeenCalled();
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("loads the backend profile and renders the complete launcher in English", async () => {
  await renderLoaded();
  expect(screen.getByText("4 sessions per week")).toBeInTheDocument();
  expect(screen.getByText("60 min per session")).toBeInTheDocument();
  expect(screen.getByText("Intermediate")).toBeInTheDocument();
  expect(screen.getByText("Full gym")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeEnabled();
  expect(document.body.textContent).not.toMatch(
    /Ton|Génér|Séances|Durée|Priorités|Équipement|Résumé indicatif|Réessayer/
  );
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("keeps Generate disabled until the Training Profile loads", () => {
  getUserSettings.mockReturnValue(new Promise(() => {}));
  renderBuilder();
  expect(screen.getByText("Loading your Training Profile…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeDisabled();
});

test("shows a retryable load error and never generates from unavailable settings", async () => {
  getUserSettings.mockRejectedValueOnce(new Error("private detail"));
  renderBuilder();
  expect(await screen.findByText("We couldn't load your Training Profile.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeDisabled();
  getUserSettings.mockResolvedValueOnce(settingsResponse);
  fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
  expect(await screen.findByText("Hypertrophy")).toBeInTheDocument();
});

test("incomplete profiles cannot generate and can open Settings", async () => {
  await renderLoaded(createSettingsResponse({ hasTrainingProfile: false }));
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Open Training Profile" }));
  expect(screen.getByRole("dialog", { name: "Training Profile settings" })).toBeInTheDocument();
});

test("plus and minus use adjacent backend-provided session and duration values locally", async () => {
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  fireEvent.click(screen.getByRole("button", { name: "Decrease duration per session" }));
  expect(screen.getByText("5 sessions per week")).toBeInTheDocument();
  expect(screen.getByText("45 min per session")).toBeInTheDocument();
  expect(updateTrainingProfileAvailability).not.toHaveBeenCalled();
});

test.each([
  [1, 15, "Decrease sessions per week", "Decrease duration per session"],
  [7, 120, "Increase sessions per week", "Increase duration per session"],
])("disables both controls at ordered boundaries", async (sessions, duration, first, second) => {
  await renderLoaded(createSettingsResponse({ sessionsPerWeek: sessions, durationPerSession: duration }));
  expect(screen.getByRole("button", { name: first })).toBeDisabled();
  expect(screen.getByRole("button", { name: second })).toBeDisabled();
});

test("legacy availability remains visible and requires an explicit valid selection", async () => {
  await renderLoaded(createSettingsResponse({ durationPerSession: 50 }));
  expect(screen.getByText("50 min per session")).toBeInTheDocument();
  expect(screen.getByText("Select an available value before generating.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Increase duration per session" }));
  expect(screen.getByText("60 min per session")).toBeInTheDocument();
  expect(updateTrainingProfileAvailability).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Generate my program" })).toBeEnabled();
});

test("leaving the launcher discards local changes without saving", async () => {
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByText("Program home")).toBeInTheDocument();
  expect(updateTrainingProfileAvailability).not.toHaveBeenCalled();
});

test("unchanged availability skips PATCH and starts generation", async () => {
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(await screen.findByRole("heading", { name: "Balanced hypertrophy" })).toBeInTheDocument();
  expect(updateTrainingProfileAvailability).not.toHaveBeenCalled();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
});

test("changed availability is saved before generation with only the two intended fields", async () => {
  const save = deferred();
  updateTrainingProfileAvailability.mockReturnValue(save.promise);
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase duration per session" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(updateTrainingProfileAvailability).toHaveBeenCalledWith({
    sessionsPerWeek: 5,
    durationPerSession: 75,
  });
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Saving availability" })).toBeDisabled();

  await act(async () => {
    save.resolve(createSettingsResponse({ sessionsPerWeek: 5, durationPerSession: 75 }));
    await save.promise;
  });
  await waitFor(() => expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1));
});

test("a failed save preserves selections and prevents generation", async () => {
  updateTrainingProfileAvailability.mockRejectedValue(new Error("failed"));
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(await screen.findByText("We couldn't save your availability")).toBeInTheDocument();
  expect(screen.getByText("5 sessions per week")).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("duplicate clicks create at most one save and one generation", async () => {
  const save = deferred();
  updateTrainingProfileAvailability.mockReturnValue(save.promise);
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  const generate = screen.getByRole("button", { name: "Generate my program" });
  fireEvent.click(generate);
  fireEvent.click(generate);
  expect(updateTrainingProfileAvailability).toHaveBeenCalledTimes(1);
  save.resolve(createSettingsResponse({ sessionsPerWeek: 5 }));
  await waitFor(() => expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1));
});

test("generation retry after a successful save does not repeat PATCH", async () => {
  updateTrainingProfileAvailability.mockResolvedValue(createSettingsResponse({ sessionsPerWeek: 5 }));
  createAIWeeklyPlanDraft
    .mockRejectedValueOnce(controlledError("AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE"))
    .mockResolvedValueOnce(generatedDraft);
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Increase sessions per week" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(await screen.findByText(/Your availability was saved/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Balanced hypertrophy" })).toBeInTheDocument();
  expect(updateTrainingProfileAvailability).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(2);
});

test("generation loading copy progresses without fake percentages", async () => {
  jest.useFakeTimers();
  createAIWeeklyPlanDraft.mockReturnValue(new Promise(() => {}));
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(screen.getByText("Analyzing your Training Profile")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(3500));
  expect(screen.getByText("Selecting compatible exercises")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument();
});

test("profile generation errors open Settings with English copy", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(controlledError("PROFILE_NOT_READY", 409));
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  const review = await screen.findByRole("button", { name: "Review Training Profile" });
  fireEvent.click(review);
  expect(screen.getByRole("dialog", { name: "Training Profile settings" })).toBeInTheDocument();
});

test("ambiguous generation errors do not offer retry and can check programs", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(new TypeError("Failed to fetch"));
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(await screen.findByText(/Your program may still have been created/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check my programs" }));
  expect(screen.getByTestId("current-location")).toHaveTextContent("/program/all");
});

test("successful result application copy is entirely English", async () => {
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  expect(await screen.findByText("Generated with AI")).toBeInTheDocument();
  for (const label of [
    "Exercises",
    "Average duration",
    "Average TUT",
    "Weekly muscle distribution",
    "Summary",
    "Weekly structure",
    "Muscle priorities",
    "Constraint management",
    "Coaching notes",
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(document.body.textContent).not.toMatch(/Généré|Exercices|Durée moyenne|Résumé|hebdomadaire|musculaires|contraintes|pratiques/);
});

test("the in-flight guard covers generation and beforeunload", async () => {
  const generation = deferred();
  createAIWeeklyPlanDraft.mockReturnValue(generation.promise);
  await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Generate my program" }));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => {
    generation.resolve(generatedDraft);
    await generation.promise;
  });
  await screen.findByText("Generated with AI");
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

test("the header back button remains mobile-first and returns to Program", async () => {
  await renderLoaded();
  const header = screen.getByRole("banner");
  expect(header).toHaveClass("sticky", "top-0");
  fireEvent.click(within(header).getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("current-location")).toHaveTextContent("/program");
});
