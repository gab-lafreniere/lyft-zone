import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SettingsDrawer from "../SettingsDrawer";
import {
  analyzeMovementConstraintsPainIssue,
  fetchExercises,
  getUserSettings,
  updateTrainingProfileSettings,
} from "../../../services/api";

jest.mock("../../../services/api", () => ({
  analyzeMovementConstraintsPainIssue: jest.fn(),
  fetchExercises: jest.fn(),
  getUserSettings: jest.fn(),
  updateTrainingProfileSettings: jest.fn(),
}));

const MINIMAL_PRESET = [
  "adjustable_bench",
  "bodyweight",
  "dumbbells",
  "flat_bench",
  "incline_bench",
  "loop_band",
  "mini_band",
  "pull_up_bar",
  "resistance_band",
  "treadmill",
];

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
          equipmentPreset: "full_gym",
          availableEquipment: ["bodyweight", "dumbbells"],
        },
        musclePriorities: {
          primaryFocus: "chest",
          secondaryFocuses: ["back"],
          deprioritizedArea: null,
        },
        movementConstraints: {
          painIssues: [],
          manualBlockedExerciseIds: [],
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

function clickEquipmentCategory(categoryName) {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^${categoryName}( \\d+)? expand_more$`),
    })
  );
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.useFakeTimers();
  fetchExercises.mockReset();
  analyzeMovementConstraintsPainIssue.mockReset();
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

describe("SettingsDrawer environment equipment setup", () => {
  test("shows default bodyweight equipment without Training Environment controls", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: null,
              availableEquipment: ["bodyweight"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");

    expect(screen.queryByText("Training Environment")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Gym$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull-up Bar" })).not.toBeInTheDocument();

    clickEquipmentCategory("Bodyweight");

    expect(
      screen.getAllByRole("button", { name: "Bodyweight" }).some((button) => button.disabled)
    ).toBe(true);
  });

  test("keeps equipment categories closed by default and allows only one open category", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: null,
              availableEquipment: ["bodyweight", "dumbbells"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");

    expect(screen.queryByRole("button", { name: "Pull-up Bar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dumbbells" })).not.toBeInTheDocument();

    clickEquipmentCategory("Bodyweight");
    expect(screen.getByRole("button", { name: "Pull-up Bar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dumbbells" })).not.toBeInTheDocument();

    clickEquipmentCategory("Free Weights");
    expect(screen.queryByRole("button", { name: "Pull-up Bar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dumbbells" })).toBeInTheDocument();

    clickEquipmentCategory("Free Weights");
    expect(screen.queryByRole("button", { name: "Dumbbells" })).not.toBeInTheDocument();
  });

  test("applies an initial preset without confirmation and saves the modern environment shape", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    updateTrainingProfileSettings.mockResolvedValue(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: "minimal",
              availableEquipment: MINIMAL_PRESET,
            },
          },
        },
      })
    );

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: null,
              availableEquipment: ["bodyweight"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");
    clickEquipmentCategory("Free Weights");
    expect(screen.getByRole("button", { name: "Dumbbells" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Minimal/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dumbbells" })).not.toBeInTheDocument();

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment: {
          equipmentPreset: "minimal",
          availableEquipment: MINIMAL_PRESET,
        },
      })
    );
  });

  test("asks before replacing a legacy multi-equipment selection", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    updateTrainingProfileSettings.mockResolvedValue(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: "full_gym",
              availableEquipment: ["bodyweight", "dumbbells", "shoulder_press_machine"],
            },
          },
        },
      })
    );

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentSetup: null,
              equipmentList: ["dumbbells", "selectorized_shoulder_press"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");
    fireEvent.click(screen.getByRole("button", { name: /Full Gym/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Replace equipment selection?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await advance(700);
    expect(updateTrainingProfileSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Full Gym/i }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({
          equipmentPreset: "full_gym",
          availableEquipment: expect.arrayContaining([
            "bodyweight",
            "dumbbells",
            "shoulder_press_machine",
          ]),
        }),
      })
    );
  });

  test("manual equipment changes keep the preset and mark the setup as customized", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    updateTrainingProfileSettings.mockResolvedValue(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: "minimal",
              availableEquipment: [...MINIMAL_PRESET, "kettlebell"],
            },
          },
        },
      })
    );

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: "minimal",
              availableEquipment: MINIMAL_PRESET,
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");
    clickEquipmentCategory("Free Weights");
    fireEvent.click(screen.getByRole("button", { name: "Kettlebell" }));

    expect(screen.getByText("Customized")).toBeInTheDocument();

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment: {
          equipmentPreset: "minimal",
          availableEquipment: [...MINIMAL_PRESET, "kettlebell"],
        },
      })
    );
  });

  test("manual equipment changes never allow an empty availableEquipment list", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    updateTrainingProfileSettings.mockResolvedValue(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: null,
              availableEquipment: ["bodyweight"],
            },
          },
        },
      })
    );

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            environment: {
              equipmentPreset: null,
              availableEquipment: ["dumbbells"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Environment");
    clickEquipmentCategory("Free Weights");
    fireEvent.click(screen.getByRole("button", { name: "Dumbbells" }));

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment: {
          equipmentPreset: null,
          availableEquipment: ["bodyweight"],
        },
      })
    );
  });
});

describe("SettingsDrawer movement constraints V2", () => {
  function createPainIssue(overrides = {}) {
    return {
      id: "issue_existing",
      description: "Shoulder irritation",
      affectedArea: "shoulder",
      painSeverity: "moderate",
      trainingRule: "modify",
      analysisStatus: "analyzed",
      clarificationQuestions: [],
      clarificationAnswers: [],
      aiSummary: "Overhead pressing is the main training trigger described.",
      detectedSignals: [
        {
          type: "movementPattern",
          value: "vertical_push",
          recommendedDecision: "caution",
          cautionLevel: "medium",
          confidence: "medium",
          reason: "Overhead pressing is reported as the main trigger.",
        },
        {
          type: "jointStressTag",
          value: "overhead_shoulder_position",
          recommendedDecision: "caution",
          cautionLevel: "medium",
          confidence: "medium",
          reason: "The discomfort appears around overhead shoulder positioning.",
        },
      ],
      confirmedSignals: [
        {
          type: "movementPattern",
          value: "vertical_push",
          decision: "caution",
          cautionLevel: "medium",
        },
      ],
      ...overrides,
    };
  }

  test("renders V2 defaults and does not autosave an incomplete local issue", async () => {
    await renderDrawer();
    await openTrainingProfileSection("Movement Constraints");

    expect(screen.getByText("No active movement restrictions")).toBeInTheDocument();
    expect(screen.queryByText("Training Rule")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add pain issue/i }));
    expect(screen.getByText("Pain issue 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Analyze with AI$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Low" })).toHaveClass("bg-white");

    fireEvent.change(screen.getByPlaceholderText(/Shoulder irritation/i), {
      target: { value: "Shoulder irritation during overhead pressing" },
    });
    expect(screen.getByRole("button", { name: /^Analyze with AI$/i })).toBeDisabled();

    await advance(700);

    expect(updateTrainingProfileSettings).not.toHaveBeenCalled();
  });

  test("analyzes a complete issue, confirms a signal, and sends only V2 payload", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    updateTrainingProfileSettings.mockImplementation(async (payload) =>
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            ...payload,
          },
        },
      })
    );

    await renderDrawer();
    await openTrainingProfileSection("Movement Constraints");

    analyzeMovementConstraintsPainIssue.mockResolvedValue({
      status: "analyzed",
      clarificationQuestions: [],
      aiSummary: "Overhead pressing is the main training trigger described.",
      detectedSignals: [
        {
          type: "movementPattern",
          value: "vertical_push",
          recommendedDecision: "caution",
          cautionLevel: "medium",
          confidence: "medium",
          reason: "Overhead pressing is reported as the main trigger.",
        },
        {
          type: "jointStressTag",
          value: "overhead_shoulder_position",
          recommendedDecision: "monitor",
          cautionLevel: "none",
          confidence: "medium",
          reason: "This signal is relevant context for future check-ins.",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Add pain issue/i }));
    fireEvent.change(screen.getByPlaceholderText(/Shoulder irritation/i), {
      target: { value: "Shoulder irritation during overhead pressing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shoulder" }));
    fireEvent.click(screen.getByRole("button", { name: "Moderate" }));

    fireEvent.click(screen.getByRole("button", { name: /^Analyze with AI$/i }));
    await screen.findByText("Vertical Push");
    expect(screen.getByText("Overhead Shoulder Position")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Answer briefly...")).not.toBeInTheDocument();
    expect(analyzeMovementConstraintsPainIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        painIssue: expect.objectContaining({
          description: "Shoulder irritation during overhead pressing",
          affectedArea: "shoulder",
          painSeverity: "moderate",
        }),
      })
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Caution" })[0]);

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    const payload = updateTrainingProfileSettings.mock.calls[0][0];
    expect(payload.movementConstraints).toEqual({
      painIssues: [
        expect.objectContaining({
          description: "Shoulder irritation during overhead pressing",
          affectedArea: "shoulder",
          painSeverity: "moderate",
          analysisStatus: "analyzed",
          detectedSignals: [
            expect.objectContaining({ type: "movementPattern", value: "vertical_push" }),
            expect.objectContaining({
              type: "jointStressTag",
              value: "overhead_shoulder_position",
            }),
          ],
          confirmedSignals: [
            {
              type: "movementPattern",
              value: "vertical_push",
              decision: "caution",
              cautionLevel: "medium",
            },
          ],
        }),
      ],
      manualBlockedExerciseIds: [],
    });
    expect(payload.movementConstraints.painDescription).toBeUndefined();
    expect(payload.movementConstraints.blockedExerciseIds).toBeUndefined();
  });

  test("keeps one issue open and marks analyzed source edits as needs_reanalysis", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [
                createPainIssue({ id: "issue_one", description: "Shoulder irritation" }),
                createPainIssue({
                  id: "issue_two",
                  description: "Knee discomfort",
                  affectedArea: "knee",
                }),
              ],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");

    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    expect(screen.getByDisplayValue("Shoulder irritation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 2" }));
    expect(screen.queryByDisplayValue("Shoulder irritation")).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Knee discomfort"), {
      target: { value: "Knee discomfort during deep squats" },
    });

    expect(screen.getByText("Needs re-analysis")).toBeInTheDocument();
  });

  test("re-analyze uses custom confirmation before replacing signals", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    analyzeMovementConstraintsPainIssue.mockResolvedValue({
      status: "analyzed",
      clarificationQuestions: [],
      aiSummary: "Deep squats are the main training trigger described.",
      detectedSignals: [
        {
          type: "movementPattern",
          value: "squat_pattern",
          recommendedDecision: "caution",
          cautionLevel: "medium",
          confidence: "medium",
          reason: "Deep squats are reported as the main trigger.",
        },
        {
          type: "jointStressTag",
          value: "deep_knee_flexion",
          recommendedDecision: "caution",
          cautionLevel: "medium",
          confidence: "medium",
          reason: "Deep knee bending is described as the main trigger.",
        },
      ],
    });

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [
                createPainIssue({
                  affectedArea: "knee",
                  detectedSignals: [
                    { type: "movementPattern", value: "vertical_push" },
                    { type: "jointStressTag", value: "overhead_shoulder_position" },
                  ],
                  confirmedSignals: [
                    { type: "movementPattern", value: "vertical_push", decision: "caution" },
                  ],
                }),
              ],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");
    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Re-analyze with AI$/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Re-analyze this pain issue?");
    expect(
      screen.getByText(
        "This will request a fresh analysis. Confirmed decisions stay in place unless the new analysis returns final detected signals."
      )
    ).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Vertical Push").length).toBeGreaterThan(0);
    expect(screen.queryByText("Squat Pattern")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Re-analyze with AI$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Re-analyze with AI",
      })
    );

    await screen.findByText("Squat Pattern");
    expect(screen.getByText("Deep Knee Flexion")).toBeInTheDocument();
    expect(screen.queryByText("Vertical Push")).not.toBeInTheDocument();
    expect(screen.getByText("No active movement restrictions")).toBeInTheDocument();
  });

  test("re-analyze preserves confirmed signals when clarification is needed", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    analyzeMovementConstraintsPainIssue.mockResolvedValue({
      status: "needs_clarification",
      clarificationQuestions: [
        {
          id: "q1",
          question: "Does this happen during deep squats, lunges, or both?",
        },
      ],
      aiSummary: null,
      detectedSignals: [],
    });

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [createPainIssue()],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");
    expect(screen.getByText("Vertical Push")).toBeInTheDocument();
    expect(screen.getByText("1 caution")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Re-analyze with AI$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Re-analyze with AI",
      })
    );

    await screen.findByText("Does this happen during deep squats, lunges, or both?");
    expect(screen.getByText("1 caution")).toBeInTheDocument();
    expect(screen.getAllByText("Vertical Push").length).toBeGreaterThan(0);
  });

  test("failed analyze keeps existing local data", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    const error = new Error("AI movement constraint analysis is not enabled");
    error.code = "AI_MOVEMENT_CONSTRAINTS_DISABLED";
    analyzeMovementConstraintsPainIssue.mockRejectedValue(error);

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [createPainIssue()],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");
    expect(screen.getByText("1 caution")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Re-analyze with AI$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Re-analyze with AI",
      })
    );

    await screen.findByText("AI analysis is not enabled yet.");
    expect(screen.getByText("1 caution")).toBeInTheDocument();
    expect(screen.getAllByText("Vertical Push").length).toBeGreaterThan(0);
  });

  test("rate limited analyze shows a friendly message and keeps existing local data", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    const error = new Error("Please wait before running another AI analysis.");
    error.code = "AI_ANALYZE_RATE_LIMITED";
    analyzeMovementConstraintsPainIssue.mockRejectedValue(error);

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [createPainIssue()],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");
    expect(screen.getByText("1 caution")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Re-analyze with AI$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Re-analyze with AI",
      })
    );

    await screen.findByText("Please wait a few seconds before running another AI analysis.");
    expect(screen.getByText("1 caution")).toBeInTheDocument();
    expect(screen.getAllByText("Vertical Push").length).toBeGreaterThan(0);
  });

  test("delete pain issue asks for confirmation before removing it", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [createPainIssue()],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");
    fireEvent.click(screen.getByRole("button", { name: "Toggle pain issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Remove Shoulder irritation/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Remove this pain issue?");
    expect(
      screen.getByText(
        "This will remove its detected and confirmed signals. This action cannot be undone."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Shoulder irritation").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Remove Shoulder irritation/i }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByRole("button", { name: /Shoulder irritation/i })).not.toBeInTheDocument();
    expect(screen.getByText("No pain issues added.")).toBeInTheDocument();
  });

  test("active constraints ignore detected-only, draft, and needs_reanalysis issues", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [
                createPainIssue({
                  id: "draft_issue",
                  analysisStatus: "draft",
                  confirmedSignals: [
                    { type: "movementPattern", value: "vertical_push", decision: "blocked" },
                  ],
                }),
                createPainIssue({
                  id: "stale_issue",
                  analysisStatus: "needs_reanalysis",
                  confirmedSignals: [
                    { type: "jointStressTag", value: "deep_knee_flexion", decision: "blocked" },
                  ],
                }),
                createPainIssue({
                  id: "detected_only",
                  confirmedSignals: [],
                }),
              ],
              manualBlockedExerciseIds: [],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");

    expect(screen.getByText("No active movement restrictions")).toBeInTheDocument();
    expect(screen.queryByText("Deep Knee Flexion")).not.toBeInTheDocument();
  });

  test("manual blocked exercises use approved exercise search and can add or remove ids", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    fetchExercises.mockResolvedValue([
      { exerciseId: "exr_deadlift", name: "Deadlift", status: "approved" },
    ]);
    updateTrainingProfileSettings.mockImplementation(async (payload) =>
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            ...payload,
          },
        },
      })
    );

    await renderDrawer();
    await openTrainingProfileSection("Movement Constraints");

    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "dead" },
    });

    await advance(250);
    await waitFor(() =>
      expect(fetchExercises).toHaveBeenCalledWith({
        q: "dead",
        limit: 25,
        status: "approved",
      })
    );
    await screen.findByRole("button", { name: /Deadlift/i });

    fireEvent.click(screen.getByRole("button", { name: /Deadlift/i }));

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(1));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        movementConstraints: {
          painIssues: [],
          manualBlockedExerciseIds: ["exr_deadlift"],
        },
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove exr_deadlift/i }));

    await advance(700);

    await waitFor(() => expect(updateTrainingProfileSettings).toHaveBeenCalledTimes(2));
    expect(updateTrainingProfileSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        movementConstraints: {
          painIssues: [],
          manualBlockedExerciseIds: [],
        },
      })
    );
  });

  test("manual blocked exercise search closes on outside click and clear without removing selected ids", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;
    fetchExercises.mockResolvedValue([
      { exerciseId: "exr_deadlift", name: "Deadlift", status: "approved" },
    ]);

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: [],
              manualBlockedExerciseIds: ["exr_deadlift"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");

    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "dead" },
    });

    await advance(250);
    await screen.findByRole("button", { name: /^Deadlift/i });

    fireEvent.pointerDown(document.body);

    expect(screen.getByPlaceholderText("Search exercises...")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^Deadlift/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("exr_deadlift").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "dead" },
    });

    await advance(250);
    await screen.findByRole("button", { name: /^Deadlift/i });

    fireEvent.click(screen.getByRole("button", { name: "Clear exercise search" }));

    expect(screen.getByPlaceholderText("Search exercises...")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^Deadlift/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("exr_deadlift").length).toBeGreaterThan(0);
  });

  test("manual blocked exercise search requests approved exercises", async () => {
    fetchExercises.mockResolvedValue([
      { exerciseId: "exr_deadlift", name: "Deadlift", status: "approved" },
    ]);

    await renderDrawer();
    await openTrainingProfileSection("Movement Constraints");

    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "pull" },
    });

    await advance(250);

    await waitFor(() =>
      expect(fetchExercises).toHaveBeenCalledWith({
        q: "pull",
        limit: 25,
        status: "approved",
      })
    );
    expect(await screen.findByRole("button", { name: /Deadlift/i })).toBeInTheDocument();
  });

  test("limits pain issues to five and shows readonly advanced signals", async () => {
    const baseProfile = createSettingsResponse().trainingProfile.profile;

    await renderDrawer(
      createSettingsResponse({
        trainingProfile: {
          profile: {
            ...baseProfile,
            movementConstraints: {
              painIssues: Array.from({ length: 5 }, (_, index) =>
                createPainIssue({
                  id: `issue_${index}`,
                  description: `Issue ${index + 1}`,
                  confirmedSignals:
                    index === 0
                      ? [
                          {
                            type: "movementPattern",
                            value: "vertical_push",
                            decision: "blocked",
                          },
                        ]
                      : [],
                })
              ),
              manualBlockedExerciseIds: ["exr_deadlift"],
            },
          },
        },
      })
    );

    await openTrainingProfileSection("Movement Constraints");

    expect(screen.getByRole("button", { name: /Add pain issue/i })).toBeDisabled();
    expect(screen.getByText("You can add up to 5 pain issues.")).toBeInTheDocument();
    expect(screen.getByText("Vertical Push")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Advanced signals/i }));

    expect(screen.getByText("Manual Blocked Exercise IDs")).toBeInTheDocument();
    expect(screen.getAllByText("exr_deadlift").length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText(/horizontal_press/i)).not.toBeInTheDocument();
  });
});
