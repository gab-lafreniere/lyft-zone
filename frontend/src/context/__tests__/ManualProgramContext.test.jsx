import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../ManualProgramContext";
import { updateWeeklyPlanDraft } from "../../services/api";

jest.mock("../../services/api", () => ({
  updateWeeklyPlanDraft: jest.fn(),
}));

const hydratedResponse = {
  weeklyPlanParentId: "weekly_parent_1",
  weeklyPlanVersionId: "weekly_version_1",
  status: "DRAFT",
  source: "MANUAL",
  updatedAt: "2026-07-21T12:00:00.000Z",
  builderPayload: {
    programName: "Weekly Plan",
    sessionsPerWeek: 1,
    programLength: 8,
    startDate: null,
    endDate: null,
    isMultiWeek: false,
    selectedWeek: 1,
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
            sets: [{ id: "set_1", reps: 8, rpe: 2 }],
            notes: "",
          },
        ],
      },
    ],
  },
};

let currentContext;

function ContextProbe() {
  currentContext = useManualProgram();

  return (
    <>
      <div data-testid="save-state">{currentContext.draftMetadata.saveState}</div>
      <div data-testid="program-name">{currentContext.programDraft.programName}</div>
    </>
  );
}

function renderProvider() {
  return render(
    <ManualProgramProvider>
      <ContextProbe />
    </ManualProgramProvider>
  );
}

function createSaveResponse() {
  return {
    ...hydratedResponse,
    updatedAt: "2026-07-21T12:01:00.000Z",
    builderPayload: currentContext.programDraft,
  };
}

async function advanceAutosave() {
  await act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
  });
}

describe("ManualProgramProvider weekly draft persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateWeeklyPlanDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("debounces a hydrated weekly draft change and transitions dirty to saving to saved", async () => {
    let resolveSave;
    updateWeeklyPlanDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.updateProgramMeta({ programName: "Updated Plan" }));

    expect(screen.getByTestId("save-state")).toHaveTextContent("dirty");
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(699));
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId("save-state")).toHaveTextContent("saving");
    expect(updateWeeklyPlanDraft).toHaveBeenCalledWith(
      "weekly_parent_1",
      "weekly_version_1",
      expect.objectContaining({ name: "Updated Plan" })
    );

    await act(async () => {
      resolveSave(createSaveResponse());
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
    expect(currentContext.draftMetadata.lastSavedAt).toBe(
      "2026-07-21T12:01:00.000Z"
    );
  });

  test("sets saveState to error when autosave fails", async () => {
    updateWeeklyPlanDraft.mockRejectedValue(new Error("Save failed"));
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.updateWorkoutName("workout_1", "Push Day"));
    await advanceAutosave();

    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
  });

  test("does not autosave before backend hydration or without backend identifiers", async () => {
    renderProvider();

    act(() => currentContext.updateProgramMeta({ programName: "Local only" }));
    await advanceAutosave();
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    act(() =>
      currentContext.hydrateProgramDraft({
        ...hydratedResponse,
        weeklyPlanParentId: null,
        weeklyPlanVersionId: null,
      })
    );
    act(() => currentContext.updateProgramMeta({ programName: "Still local" }));
    await advanceAutosave();

    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
  });

  test("persistDraftNow saves the latest weekly draft immediately", async () => {
    updateWeeklyPlanDraft.mockImplementation(async () => createSaveResponse());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.updateProgramMeta({ programName: "Publish-ready Plan" }));

    await act(async () => {
      await currentContext.persistDraftNow();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(updateWeeklyPlanDraft).toHaveBeenCalledWith(
      "weekly_parent_1",
      "weekly_version_1",
      expect.objectContaining({ name: "Publish-ready Plan" })
    );
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
  });

  test("autosaves each supported builder edit through the same weekly endpoint flow", async () => {
    updateWeeklyPlanDraft.mockImplementation(async () => createSaveResponse());
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(hydratedResponse));

    const edits = [
      () => currentContext.updateProgramMeta({ programName: "Renamed Plan" }),
      () => currentContext.updateWorkoutName("workout_1", "Renamed Workout"),
      () => currentContext.addSet("workout_1", "block_1"),
      () => currentContext.updateSet("workout_1", "block_1", 0, { reps: 12 }),
      () =>
        currentContext.appendSingleBlockFromExercise("workout_1", {
          exerciseId: "exercise_2",
          name: "Incline Press",
          trainingType: "strength",
          bodyParts: ["chest"],
          muscleFocus: ["upper_chest"],
        }),
      () => {
        const addedBlock = currentContext.programDraft.workouts[0].blocks[1];
        currentContext.removeBlock("workout_1", addedBlock.id);
      },
    ];

    for (const [index, edit] of edits.entries()) {
      act(edit);
      await advanceAutosave();
      expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(index + 1);
      expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
    }
  });
});
