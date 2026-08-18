import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  MultiWeekProgramProvider,
  useMultiWeekProgram,
} from "../../context/MultiWeekProgramContext";
import {
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  saveCycleWorkoutContent,
  updateCycleDraft,
  updateUpcomingDraftTimeline,
} from "../../services/api";
import ManualBuilderMulti from "../ManualBuilderMulti";

jest.mock("../../services/api", () => ({
  deleteCycle: jest.fn(),
  openOrCreateCycleEditDraft: jest.fn(),
  publishCycleDraft: jest.fn(),
  saveCycleWorkoutContent: jest.fn(),
  updateCycleDraft: jest.fn(),
  updateUpcomingDraftTimeline: jest.fn(),
}));

const FLAG = "REACT_APP_ENABLE_WORKOUT_SCOPED_AUTOSAVE";

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getFutureMonday() {
  const date = new Date();
  const daysUntilMonday = date.getDay() === 1 ? 7 : (8 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilMonday);
  return formatDateInput(date);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
}

function buildSet(reps) {
  return {
    id: "set_1",
    reps,
    rpe: 2,
    persistence: {
      id: "set_1",
      setIndex: 1,
      setType: "WORKING",
      targetReps: reps,
      minReps: reps,
      maxReps: reps,
      targetSeconds: null,
      targetRir: 2,
      targetRpe: null,
      tempo: "3010",
      restSeconds: 120,
      notes: null,
    },
  };
}

function buildWorkout({ reps = 8, contentRevision = 5 } = {}) {
  return {
    id: "workout_1",
    name: "Workout 1",
    orderIndex: 1,
    scheduledDay: "MONDAY",
    contentRevision,
    estimatedDurationMinutes: null,
    notes: null,
    persistence: {
      id: "workout_1",
      name: "Workout 1",
      orderIndex: 1,
      scheduledDay: "MONDAY",
      estimatedDurationMinutes: null,
      notes: null,
    },
    blocks: [
      {
        id: "block_1",
        type: "single",
        exercise: "Bench Press",
        exerciseId: "exercise_catalog_1",
        exerciseRowId: "exercise_row_1",
        bodyParts: ["chest"],
        muscleFocus: ["upper_chest"],
        tempo: "3010",
        rest: "120s",
        sets: [buildSet(reps)],
        notes: "",
        persistence: {
          id: "block_1",
          orderIndex: 1,
          blockType: "SINGLE",
          label: null,
          roundCount: null,
          restStrategy: "AFTER_EXERCISE",
          restSeconds: 120,
          notes: null,
        },
        exercisePersistence: {
          id: "exercise_row_1",
          exerciseId: "exercise_catalog_1",
          exerciseName: "Bench Press",
          bodyParts: ["chest"],
          muscleFocus: ["upper_chest"],
          orderIndex: 1,
          executionNotes: null,
          defaultTempo: "3010",
          defaultRestSeconds: 120,
          defaultTargetRir: null,
          defaultTargetRpe: null,
          intensificationMethod: "NONE",
          cardioPrescription: null,
          notes: null,
        },
      },
    ],
  };
}

function buildCycleResponse({
  reps = 8,
  contentRevision = 5,
  revision = 10,
  status = "DRAFT",
} = {}) {
  const startDate = getFutureMonday();

  return {
    cycleId: "cycle_1",
    planId: "plan_1",
    status,
    temporalStatus: "UPCOMING",
    timezone: "America/Toronto",
    revision,
    updatedAt: "2026-08-18T12:00:00.000Z",
    builderPayload: {
      programName: "Cycle Draft",
      sessionsPerWeek: 1,
      programLength: 1,
      startDate,
      endDate: addDays(startDate, 6),
      selectedWeek: 1,
      weeks: [
        {
          id: "week_1",
          weekNumber: 1,
          orderIndex: 1,
          label: "Week 1",
          notes: null,
          workouts: [buildWorkout({ reps, contentRevision })],
        },
      ],
    },
    draftState: {
      effectiveTimezone: "America/Toronto",
      localDate: formatDateInput(new Date()),
      isGraceWindow: false,
      canExtendDraft: false,
    },
  };
}

function getPayloadReps(payload) {
  return payload.workout.blocks[0].exercises[0].setTemplates[0].targetReps;
}

function buildWorkoutSaveResponse(payload, { contentRevision = 6, planRevision = 11 } = {}) {
  return {
    cycleId: "cycle_1",
    planId: "plan_1",
    workoutId: "workout_1",
    contentRevision,
    planRevision,
    updatedAt: "2026-08-18T12:01:00.000Z",
    workout: buildWorkout({
      reps: getPayloadReps(payload),
      contentRevision,
    }),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

let currentContext;

function ContextProbe() {
  currentContext = useMultiWeekProgram();
  const reps = currentContext.programDraft.workouts?.[0]?.blocks?.[0]?.sets?.[0]?.reps;

  return <output data-testid="local-workout-reps">{String(reps)}</output>;
}

async function renderBuilder(response = buildCycleResponse()) {
  openOrCreateCycleEditDraft.mockResolvedValueOnce(response);

  render(
    <MultiWeekProgramProvider>
      <ContextProbe />
      <MemoryRouter initialEntries={["/program/cycles/cycle_1/builder"]}>
        <Routes>
          <Route
            path="/program/cycles/:cycleId/builder"
            element={<ManualBuilderMulti />}
          />
          <Route path="*" element={<div>post-action destination</div>} />
        </Routes>
      </MemoryRouter>
    </MultiWeekProgramProvider>
  );

  await screen.findByRole("button", { name: "Publish Cycle" });
  await waitFor(() => expect(currentContext.draftMetadata.loadedFromBackend).toBe(true));
}

function editWorkoutReps(reps) {
  act(() => {
    currentContext.updateSet("workout_1", "block_1", 0, { reps });
  });
}

describe("ManualBuilderMulti workout terminal-action barrier", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
    currentContext = null;
    openOrCreateCycleEditDraft.mockReset();
    publishCycleDraft.mockReset();
    saveCycleWorkoutContent.mockReset();
    updateCycleDraft.mockReset();
    updateUpcomingDraftTimeline.mockReset();
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  test("Publish remains pending until the terminal workout flush completes", async () => {
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockReturnValueOnce(workoutSave.promise);
    updateCycleDraft.mockResolvedValue(buildCycleResponse({
      reps: 12,
      contentRevision: 6,
      revision: 12,
    }));
    publishCycleDraft.mockResolvedValue(buildCycleResponse({
      reps: 12,
      contentRevision: 6,
      revision: 13,
      status: "PUBLISHED",
    }));
    await renderBuilder();
    editWorkoutReps(12);

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1));
    expect(publishCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publishing..." })).toBeDisabled();

    await act(async () => {
      workoutSave.resolve(
        buildWorkoutSaveResponse(saveCycleWorkoutContent.mock.calls[0][3])
      );
      await workoutSave.promise;
    });

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(saveCycleWorkoutContent.mock.invocationCallOrder[0]).toBeLessThan(
      publishCycleDraft.mock.invocationCallOrder[0]
    );
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("12");
  });

  test("Publish blocks on a workout conflict, preserves local content, and reports the error", async () => {
    saveCycleWorkoutContent.mockRejectedValueOnce(Object.assign(
      new Error("This workout was updated elsewhere."),
      { code: "WORKOUT_REVISION_CONFLICT", status: 409 }
    ));
    await renderBuilder();
    editWorkoutReps(77);

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    expect(await screen.findByText(
      "Resolve workout autosave conflicts or errors before publishing."
    )).toBeInTheDocument();
    expect(publishCycleDraft).not.toHaveBeenCalled();
    expect(updateCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("77");
  });

  test("Save Settings remains pending until the terminal workout flush completes", async () => {
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockReturnValueOnce(workoutSave.promise);
    updateUpcomingDraftTimeline.mockResolvedValue(buildCycleResponse({
      reps: 21,
      contentRevision: 6,
      revision: 12,
    }));
    await renderBuilder();
    editWorkoutReps(21);
    fireEvent.click(screen.getByRole("button", { name: "Open cycle settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1));
    expect(updateUpcomingDraftTimeline).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    await act(async () => {
      workoutSave.resolve(
        buildWorkoutSaveResponse(saveCycleWorkoutContent.mock.calls[0][3])
      );
      await workoutSave.promise;
    });

    await waitFor(() => expect(updateUpcomingDraftTimeline).toHaveBeenCalledTimes(1));
    expect(saveCycleWorkoutContent.mock.invocationCallOrder[0]).toBeLessThan(
      updateUpcomingDraftTimeline.mock.invocationCallOrder[0]
    );
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("21");
  });

  test("Save Settings blocks on a workout conflict and leaves the local workout intact", async () => {
    saveCycleWorkoutContent.mockRejectedValueOnce(Object.assign(
      new Error("This workout was updated elsewhere."),
      { code: "WORKOUT_REVISION_CONFLICT", status: 409 }
    ));
    await renderBuilder();
    editWorkoutReps(88);
    fireEvent.click(screen.getByRole("button", { name: "Open cycle settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(
      "Resolve workout autosave conflicts or errors before saving cycle settings."
    )).toBeInTheDocument();
    expect(updateUpcomingDraftTimeline).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("88");
  });

  test("Save Settings settles after a structural revision conflict without overwriting local content", async () => {
    updateCycleDraft.mockRejectedValueOnce(Object.assign(
      new Error("This draft was updated elsewhere."),
      { code: "DRAFT_REVISION_CONFLICT", status: 409 }
    ));
    await renderBuilder();

    act(() => {
      currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY");
      currentContext.updateSet("workout_1", "block_1", 0, { reps: 91 });
    });
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toMatchObject({
        code: "DRAFT_REVISION_CONFLICT",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Open cycle settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(
      "Resolve workout autosave conflicts or errors before saving cycle settings."
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(updateUpcomingDraftTimeline).not.toHaveBeenCalled();
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("91");
    expect(screen.getByRole("button", { name: "Publish Cycle" })).toBeDisabled();
  });

  test("Save Settings blocks a generic structural error after flushing healthy workout content", async () => {
    updateCycleDraft.mockRejectedValueOnce(new Error("network unavailable"));
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, _workoutId, payload) =>
      buildWorkoutSaveResponse(payload, { contentRevision: 6, planRevision: 11 })
    );
    await renderBuilder();

    act(() => {
      currentContext.updateProgramMeta({ programName: "Locally Renamed Cycle" });
      currentContext.updateSet("workout_1", "block_1", 0, { reps: 92 });
    });
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toThrow("network unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open cycle settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(
      "Resolve draft autosave conflicts or errors before saving cycle settings."
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(updateUpcomingDraftTimeline).not.toHaveBeenCalled();
    expect(currentContext.programDraft.programName).toBe("Locally Renamed Cycle");
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("92");
  });

  test("Publish completes after a generic structural failure releases its temporary pause", async () => {
    const retryResponse = buildCycleResponse({
      reps: 31,
      contentRevision: 6,
      revision: 12,
    });
    retryResponse.builderPayload.programName = "Renamed Cycle";
    const publishedResponse = {
      ...retryResponse,
      status: "PUBLISHED",
      revision: 13,
    };
    updateCycleDraft
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(retryResponse);
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, _workoutId, payload) =>
      buildWorkoutSaveResponse(payload, { contentRevision: 6, planRevision: 11 })
    );
    publishCycleDraft.mockResolvedValueOnce(publishedResponse);
    await renderBuilder();

    act(() => currentContext.updateProgramMeta({ programName: "Renamed Cycle" }));
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toThrow("network unavailable");
    });
    expect(currentContext.draftMetadata.saveState).toBe("error");

    editWorkoutReps(31);
    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByText("post-action destination")).toBeInTheDocument();
  });
});
