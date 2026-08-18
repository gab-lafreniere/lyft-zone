import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
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

function createContextValue(persistDraftNow, preparedDraft) {
  const programDraft = {
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
    };
  return {
    programDraft,
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
    prepareWeeklyPlanDraftForPublish: jest.fn(async () => {
      await persistDraftNow();
      return {
        status: "ready",
        draft: preparedDraft || programDraft,
        metadata: {
          weeklyPlanParentId: "weekly_parent_1",
          weeklyPlanVersionId: "weekly_version_1",
        },
      };
    }),
    removeWorkouts: jest.fn(),
    updateProgramMeta: jest.fn(),
    updateSessionsPerWeek: jest.fn(),
    updateDraftMetadata: jest.fn(),
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
      const contextValue = createContextValue(persistDraftNow);
      useManualProgram.mockReturnValue(contextValue);
      renderBuilder();

      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(buttonName) })
      );

      await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
      expect(persistDraftNow).toHaveBeenCalledTimes(1);
      expect(persistDraftNow.mock.invocationCallOrder[0]).toBeLessThan(
        publishWeeklyPlanDraft.mock.invocationCallOrder[0]
      );
      expect(contextValue.updateDraftMetadata).toHaveBeenCalledWith({
        status: "published",
        weeklyPlanVersionId: null,
      });
    }
  );

  test.each([
    ["Publish Program", "Publishing..."],
    ["Turn into multi-week program", "Publishing & transforming..."],
  ])(
    "%s surfaces post-barrier validation and exits loading without publishing",
    async (buttonName, loadingName) => {
      let resolvePersistence;
      const persistence = new Promise((resolve) => {
        resolvePersistence = resolve;
      });
      const persistDraftNow = jest.fn().mockReturnValue(persistence);
      const contextValue = createContextValue(persistDraftNow, {
        programName: "Incomplete Plan",
        sessionsPerWeek: 1,
        workouts: [],
      });
      useManualProgram.mockReturnValue(contextValue);
      renderBuilder();

      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(buttonName) })
      );

      expect(
        screen.getByRole("button", { name: new RegExp(loadingName) })
      ).toBeDisabled();
      await act(async () => {
        resolvePersistence({});
        await persistence;
      });
      expect(
        await screen.findByText("Complete all workouts before publishing.")
      ).toBeInTheDocument();
      expect(persistDraftNow).toHaveBeenCalledTimes(1);
      expect(contextValue.prepareWeeklyPlanDraftForPublish).toHaveBeenCalledTimes(1);
      expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: new RegExp(buttonName) })
      ).toBeEnabled();
    }
  );
});
