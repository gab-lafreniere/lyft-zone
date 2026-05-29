import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SettingsDrawer from "../SettingsDrawer";
import {
  getUserSettings,
  updateTrainingProfileSettings,
} from "../../../services/api";

jest.mock("../../../services/api", () => ({
  getUserSettings: jest.fn(),
  updateTrainingProfileSettings: jest.fn(),
}));

function createSettingsResponse(overrides = {}) {
  return {
    account: { profile: { name: "Alex", email: "alex@example.com", username: "alex" } },
    aiCoaching: { mode: "manual", autonomyLevel: "low" },
    workoutExperience: { defaultRestTimer: 90, soundVibrationAlerts: true },
    interface: { units: { weight: "kg", height: "cm" } },
    trainingProfile: {
      profile: {
        primaryGoal: "HYPERTROPHY",
        experience: "beginner",
        availability: {
          sessionsPerWeek: 4,
          durationPerSession: 60,
        },
        environment: {
          trainingEnvironment: "gym",
          equipmentSetup: "full_gym",
        },
        musclePriorities: {
          primaryFocus: "chest",
          secondaryFocuses: ["back"],
          deprioritizedArea: null,
        },
        movementConstraints: {
          painDescription: "",
          aiDetectedPatterns: ["vertical_push"],
          confirmedPatterns: ["shoulder_issue"],
          blockedMovementPatterns: [],
          blockedJointStressTags: [],
          blockedExerciseIds: [],
          cautionMovementPatterns: [],
          cautionJointStressTags: [],
          affectedArea: null,
          painSeverity: "none",
          trainingRule: "none",
        },
        exercisePreference: {
          equipmentBias: "no_preference",
        },
        cardioProfile: {
          cardioRole: "none",
          preferredModalities: [],
        },
        physicalNotes: "",
      },
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

async function renderDrawer(response = createSettingsResponse()) {
  getUserSettings.mockResolvedValue(response);

  await act(async () => {
    render(<SettingsDrawer isOpen onClose={jest.fn()} />);
    await Promise.resolve();
  });

  await screen.findByRole("button", { name: /Training Profile/i });
}

async function openTrainingProfileSection(sectionName) {
  fireEvent.click(screen.getByRole("button", { name: /Training Profile/i }));
  await screen.findByRole("heading", { name: "Training Profile" });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(sectionName, "i") }));
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.useFakeTimers();
  getUserSettings.mockReset();
  updateTrainingProfileSettings.mockReset();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("SettingsDrawer autosave", () => {
  test("debounces rapid edits into one PATCH and removes manual save UI", async () => {
    updateTrainingProfileSettings.mockResolvedValue(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...createSettingsResponse().trainingProfile.profile,
            experience: "advanced",
          },
        },
      })
    );

    await renderDrawer();
    expect(screen.queryAllByRole("heading", { name: "Settings" })).toHaveLength(1);
    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(
      screen.queryByText(/Move through each area like a focused mobile app/i)
    ).not.toBeInTheDocument();

    await openTrainingProfileSection("Experience");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByText("No unsaved changes.")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { name: "Experience" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Intermediate/i }));

    await advance(500);

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));

    await advance(699);

    expect(updateTrainingProfileSettings).not.toHaveBeenCalled();

    await advance(1);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ experience: "advanced" })
    );
  });

  test("keeps newer local edits, triggers a follow-up save, and stays on the current screen", async () => {
    const firstSave = deferred();
    const secondSave = deferred();

    updateTrainingProfileSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    await renderDrawer();
    await openTrainingProfileSection("Experience");

    fireEvent.click(screen.getByRole("button", { name: /Intermediate/i }));

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ experience: "intermediate" })
    );

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));

    await act(async () => {
      firstSave.resolve(
        createSettingsResponse({
          trainingProfile: {
            profile: {
              ...createSettingsResponse().trainingProfile.profile,
              experience: "intermediate",
            },
          },
        })
      );
      await firstSave.promise;
    });

    await flushMicrotasks();

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(2));
    expect(updateTrainingProfileSettings).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ experience: "advanced" })
    );
    expect(screen.getByRole("heading", { name: "Experience" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByText("Saving...")).toBeInTheDocument();

    await act(async () => {
      secondSave.resolve(
        createSettingsResponse({
          trainingProfile: {
            profile: {
              ...createSettingsResponse().trainingProfile.profile,
              experience: "advanced",
            },
          },
        })
      );
      await secondSave.promise;
    });

    await flushMicrotasks();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  test("does not autosave while local validation is blocking", async () => {
    await renderDrawer();
    await openTrainingProfileSection("Physical Notes");

    fireEvent.change(screen.getByPlaceholderText(/Optional notes/i), {
      target: { value: "x".repeat(1001) },
    });

    await advance(700);

    expect(updateTrainingProfileSettings).not.toHaveBeenCalled();
    expect(
      screen.getByText("Physical notes must be at most 1000 characters.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });

  test("surfaces backend save errors in the header and keeps the local draft intact", async () => {
    const error = new Error("Could not save");
    error.details = [{ path: "physicalNotes", message: "Server rejected this note." }];
    updateTrainingProfileSettings.mockRejectedValue(error);

    await renderDrawer();
    await openTrainingProfileSection("Physical Notes");

    fireEvent.change(screen.getByPlaceholderText(/Optional notes/i), {
      target: { value: "Keep this note" },
    });

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Could not save")).toBeInTheDocument());
    expect(screen.getByText("Server rejected this note.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Keep this note")).toBeInTheDocument();
  });

  test("hides duplicate titles in the training profile menu", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Training Profile/i }));
    await screen.findByRole("heading", { name: "Training Profile" });

    expect(screen.getByText("Plan Inputs")).toBeInTheDocument();
    expect(screen.getByText("Gym Setup")).toBeInTheDocument();
    expect(screen.getByText("Constraints")).toBeInTheDocument();
    expect(screen.getByText("Cardio & Notes")).toBeInTheDocument();
    expect(screen.queryByText(/Each section opens as its own focused screen/i)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { name: "Training Profile" })).toHaveLength(1);
  });
});
