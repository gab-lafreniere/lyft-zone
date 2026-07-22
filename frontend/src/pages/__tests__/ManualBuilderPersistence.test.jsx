import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ManualBuilder from "../ManualBuilder";
import { useManualProgram } from "../../context/ManualProgramContext";
import { publishWeeklyPlanDraft } from "../../services/api";

jest.mock("../../context/ManualProgramContext", () => ({
  useManualProgram: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  deleteWeeklyPlan: jest.fn(),
  publishWeeklyPlanDraft: jest.fn(),
}));

function createContextValue(persistDraftNow) {
  return {
    programDraft: {
      programName: "Complete Plan",
      sessionsPerWeek: 1,
      workouts: [
        {
          id: "workout_1",
          name: "Workout 1",
          blocks: [
            {
              id: "block_1",
              type: "single",
              exercise: "Bench Press",
              exerciseId: "exercise_1",
              bodyParts: ["chest"],
              muscleFocus: ["upper_chest"],
              tempo: "3010",
              rest: "120s",
              sets: [{ reps: 8, rpe: 2 }],
              notes: "",
            },
          ],
        },
      ],
    },
    draftMetadata: {
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: "weekly_version_1",
      status: "draft",
      loadedFromBackend: true,
      saveState: "saved",
      lastSavedAt: "2026-07-21T12:00:00.000Z",
    },
    addWorkout: jest.fn(),
    moveWorkouts: jest.fn(),
    duplicateWorkouts: jest.fn(),
    persistDraftNow,
    removeWorkouts: jest.fn(),
    updateProgramMeta: jest.fn(),
    updateSessionsPerWeek: jest.fn(),
    resetProgramDraft: jest.fn(),
  };
}

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={["/program/manual-builder"]}>
      <ManualBuilder />
    </MemoryRouter>
  );
}

describe("ManualBuilder explicit persistence", () => {
  beforeEach(() => {
    publishWeeklyPlanDraft.mockReset().mockResolvedValue({ status: "PUBLISHED" });
  });

  test.each(["Publish Program", "Turn into multi-week program"])(
    "persists the latest draft before %s",
    async (buttonName) => {
      const persistDraftNow = jest.fn().mockResolvedValue({});
      useManualProgram.mockReturnValue(createContextValue(persistDraftNow));
      renderBuilder();

      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(buttonName) })
      );

      await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
      expect(persistDraftNow).toHaveBeenCalledTimes(1);
      expect(persistDraftNow.mock.invocationCallOrder[0]).toBeLessThan(
        publishWeeklyPlanDraft.mock.invocationCallOrder[0]
      );
    }
  );
});
