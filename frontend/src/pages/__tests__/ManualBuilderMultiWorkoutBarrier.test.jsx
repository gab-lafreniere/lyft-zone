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

function buildSet(reps, id = "set_1") {
  return {
    id,
    reps,
    rpe: 2,
    persistence: {
      id,
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

function buildWorkout({
  id = "workout_1",
  reps = 8,
  contentRevision = 5,
  orderIndex = 1,
  scheduledDay = orderIndex === 1 ? "MONDAY" : "WEDNESDAY",
  blockId = id === "workout_1" ? "block_1" : `${id}_block`,
  exerciseRowId = id === "workout_1" ? "exercise_row_1" : `${id}_exercise_row`,
  setId = id === "workout_1" ? "set_1" : `${id}_set`,
} = {}) {
  return {
    id,
    name: `Workout ${orderIndex}`,
    orderIndex,
    scheduledDay,
    contentRevision,
    estimatedDurationMinutes: null,
    notes: null,
    persistence: {
      id,
      name: `Workout ${orderIndex}`,
      orderIndex,
      scheduledDay,
      estimatedDurationMinutes: null,
      notes: null,
    },
    blocks: [
      {
        id: blockId,
        type: "single",
        exercise: "Bench Press",
        exerciseId: "exercise_catalog_1",
        exerciseRowId,
        bodyParts: ["chest"],
        muscleFocus: ["upper_chest"],
        tempo: "3010",
        rest: "120s",
        sets: [buildSet(reps, setId)],
        notes: "",
        persistence: {
          id: blockId,
          orderIndex: 1,
          blockType: "SINGLE",
          label: null,
          roundCount: null,
          restStrategy: "AFTER_EXERCISE",
          restSeconds: 120,
          notes: null,
        },
        exercisePersistence: {
          id: exerciseRowId,
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
  repsByIndex = [],
  contentRevision = 5,
  contentRevisions = [],
  revision = 10,
  status = "DRAFT",
  workoutCount = 1,
} = {}) {
  const startDate = getFutureMonday();
  const workouts = Array.from({ length: workoutCount }, (_, index) => buildWorkout({
    id: `workout_${index + 1}`,
    reps: repsByIndex[index] ?? (index === 0 ? reps : reps + index),
    contentRevision:
      contentRevisions[index] ?? (index === 0 ? contentRevision : contentRevision + index),
    orderIndex: index + 1,
  }));

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
      sessionsPerWeek: workoutCount,
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
          workouts,
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

function buildWorkoutSaveResponse(payload, {
  contentRevision = 6,
  planRevision = 11,
  workoutId = payload.workout.id,
} = {}) {
  const sentBlock = payload.workout.blocks[0];
  const sentExercise = sentBlock.exercises[0];
  return {
    cycleId: "cycle_1",
    planId: "plan_1",
    workoutId,
    contentRevision,
    planRevision,
    updatedAt: "2026-08-18T12:01:00.000Z",
    workout: buildWorkout({
      id: workoutId,
      reps: getPayloadReps(payload),
      contentRevision,
      orderIndex: payload.workout.orderIndex,
      scheduledDay: payload.workout.scheduledDay,
      blockId: sentBlock.id,
      exerciseRowId: sentExercise.id,
      setId: sentExercise.setTemplates[0].id,
    }),
  };
}

function buildStructuralResponseFromPayload(baseResponse, payload, { revision } = {}) {
  return {
    ...baseResponse,
    revision,
    updatedAt: "2026-08-18T12:02:00.000Z",
    builderPayload: {
      ...baseResponse.builderPayload,
      programName: payload.name,
      sessionsPerWeek: payload.sessionsPerWeek,
      weeks: payload.weeks.map((week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          const sentBlock = workout.blocks[0];
          const sentExercise = sentBlock.exercises[0];
          return buildWorkout({
            id: workout.id,
            reps: sentExercise.setTemplates[0].targetReps,
            contentRevision: Number(workout.contentRevision) || 1,
            orderIndex: workout.orderIndex,
            scheduledDay: workout.scheduledDay,
            blockId: sentBlock.id,
            exerciseRowId: sentExercise.id,
            setId: sentExercise.setTemplates[0].id,
          });
        }),
      })),
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((res, rej) => {
    resolve = (value) => {
      settled = true;
      res(value);
    };
    reject = (error) => {
      settled = true;
      rej(error);
    };
  });
  return {
    promise,
    reject,
    resolve,
    get settled() {
      return settled;
    },
  };
}

let currentContext;

function ContextProbe() {
  currentContext = useMultiWeekProgram();
  const workouts = currentContext.programDraft.workouts || [];

  return (
    <>
      <output data-testid="local-workout-reps">
        {String(workouts[0]?.blocks?.[0]?.sets?.[0]?.reps)}
      </output>
      {workouts.map((workout) => (
        <output key={workout.id} data-testid={`local-reps-${workout.id}`}>
          {String(workout.blocks?.[0]?.sets?.[0]?.reps)}
        </output>
      ))}
    </>
  );
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

function editWorkoutReps(
  reps,
  workoutId = "workout_1",
  blockId = workoutId === "workout_1" ? "block_1" : `${workoutId}_block`
) {
  act(() => {
    currentContext.updateSet(workoutId, blockId, 0, { reps });
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

  test("Publish terminally flushes three rapid workouts including an edit-during-save follow-up", async () => {
    const response = buildCycleResponse({
      workoutCount: 3,
      repsByIndex: [8, 9, 10],
      contentRevisions: [5, 6, 7],
    });
    const saveA = createDeferred();
    const saveB = createDeferred();
    const saveC1 = createDeferred();
    const saveC2 = createDeferred();
    let workoutCCallCount = 0;
    saveCycleWorkoutContent.mockImplementation((_cycleId, _planId, workoutId) => {
      if (workoutId === "workout_1") {
        return saveA.promise;
      }
      if (workoutId === "workout_2") {
        return saveB.promise;
      }
      workoutCCallCount += 1;
      return workoutCCallCount === 1 ? saveC1.promise : saveC2.promise;
    });
    publishCycleDraft.mockResolvedValue(buildCycleResponse({
      workoutCount: 3,
      repsByIndex: [18, 21, 33],
      contentRevisions: [6, 7, 9],
      status: "PUBLISHED",
      revision: 15,
    }));
    await renderBuilder(response);

    editWorkoutReps(21, "workout_2");
    act(() => {
      currentContext.persistWorkoutNow("workout_2");
    });
    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1));
    editWorkoutReps(30, "workout_3");
    act(() => {
      currentContext.persistWorkoutNow("workout_3");
    });
    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2));
    editWorkoutReps(33, "workout_3");
    editWorkoutReps(18, "workout_1");

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(3));
    expect(publishCycleDraft).not.toHaveBeenCalled();

    const callFor = (workoutId, occurrence = 0) =>
      saveCycleWorkoutContent.mock.calls
        .filter((call) => call[2] === workoutId)[occurrence];
    await act(async () => {
      saveA.resolve(buildWorkoutSaveResponse(callFor("workout_1")[3], {
        contentRevision: 6,
        planRevision: 11,
        workoutId: "workout_1",
      }));
      saveB.resolve(buildWorkoutSaveResponse(callFor("workout_2")[3], {
        contentRevision: 7,
        planRevision: 12,
        workoutId: "workout_2",
      }));
      saveC1.resolve(buildWorkoutSaveResponse(callFor("workout_3")[3], {
        contentRevision: 8,
        planRevision: 13,
        workoutId: "workout_3",
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(4));
    const followUpCall = callFor("workout_3", 1);
    expect(followUpCall[3].contentRevision).toBe(8);
    expect(getPayloadReps(followUpCall[3])).toBe(33);
    expect(publishCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      saveC2.resolve(buildWorkoutSaveResponse(followUpCall[3], {
        contentRevision: 9,
        planRevision: 14,
        workoutId: "workout_3",
      }));
      await saveC2.promise;
    });

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(saveA.settled).toBe(true);
    expect(saveB.settled).toBe(true);
    expect(saveC1.settled).toBe(true);
    expect(saveC2.settled).toBe(true);
    expect(updateCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-reps-workout_1")).toHaveTextContent("18");
    expect(screen.getByTestId("local-reps-workout_2")).toHaveTextContent("21");
    expect(screen.getByTestId("local-reps-workout_3")).toHaveTextContent("33");
  });

  test("Publish re-flushes workout content preserved as newer than an in-flight structural save", async () => {
    const response = buildCycleResponse({ workoutCount: 2 });
    const structuralSave = createDeferred();
    const workoutSave = createDeferred();
    updateCycleDraft.mockImplementation(() => structuralSave.promise);
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    publishCycleDraft.mockResolvedValue(buildCycleResponse({
      workoutCount: 2,
      repsByIndex: [8, 44],
      contentRevisions: [5, 7],
      status: "PUBLISHED",
      revision: 13,
    }));
    await renderBuilder(response);

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    let structuralPromise;
    act(() => {
      structuralPromise = currentContext.persistDraftNow();
    });
    await waitFor(() => expect(updateCycleDraft).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));
    editWorkoutReps(44, "workout_2");
    expect(publishCycleDraft).not.toHaveBeenCalled();

    const structuralPayload = updateCycleDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(buildStructuralResponseFromPayload(response, structuralPayload, {
        revision: 11,
      }));
      await structuralPromise;
    });

    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1));
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[0][3])).toBe(44);
    expect(publishCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSave.resolve(buildWorkoutSaveResponse(
        saveCycleWorkoutContent.mock.calls[0][3],
        { contentRevision: 7, planRevision: 12, workoutId: "workout_2" }
      ));
      await workoutSave.promise;
    });

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("local-reps-workout_2")).toHaveTextContent("44");
  });

  test("a structural mutation during the Publish workout flush is persisted with the latest Plan revision", async () => {
    const response = buildCycleResponse({ workoutCount: 2, revision: 10 });
    const workoutSave = createDeferred();
    const structuralSave = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    updateCycleDraft.mockImplementation(() => structuralSave.promise);
    publishCycleDraft.mockResolvedValue({ ...response, status: "PUBLISHED", revision: 26 });
    await renderBuilder(response);

    editWorkoutReps(52, "workout_2");
    act(() => {
      currentContext.persistWorkoutNow("workout_2");
    });
    await waitFor(() => expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    act(() => {
      currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY");
    });
    expect(updateCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSave.resolve(buildWorkoutSaveResponse(
        saveCycleWorkoutContent.mock.calls[0][3],
        { contentRevision: 7, planRevision: 24, workoutId: "workout_2" }
      ));
      await workoutSave.promise;
    });

    await waitFor(() => expect(updateCycleDraft).toHaveBeenCalledTimes(1));
    expect(updateCycleDraft.mock.calls[0][2].revision).toBe(24);
    expect(publishCycleDraft).not.toHaveBeenCalled();

    const structuralPayload = updateCycleDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(buildStructuralResponseFromPayload(response, structuralPayload, {
        revision: 25,
      }));
      await structuralSave.promise;
    });

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(updateCycleDraft.mock.invocationCallOrder[0]).toBeLessThan(
      publishCycleDraft.mock.invocationCallOrder[0]
    );
  });

  test("Publish blocks on a terminal workout error and preserves local content", async () => {
    saveCycleWorkoutContent.mockRejectedValueOnce(new Error("workout network failure"));
    await renderBuilder();
    editWorkoutReps(78);

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    expect(await screen.findByText(
      "Resolve workout autosave conflicts or errors before publishing."
    )).toBeInTheDocument();
    expect(publishCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("78");
  });

  test("a document revision conflict reached during Publish blocks without retry", async () => {
    const structuralSave = createDeferred();
    updateCycleDraft.mockImplementation(() => structuralSave.promise);
    await renderBuilder();

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    let structuralPromise;
    act(() => {
      structuralPromise = currentContext.persistDraftNow().catch(() => null);
    });
    await waitFor(() => expect(updateCycleDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await act(async () => {
      structuralSave.reject(Object.assign(
        new Error("This draft was updated elsewhere."),
        { code: "DRAFT_REVISION_CONFLICT", status: 409 }
      ));
      await structuralPromise;
    });

    expect(await screen.findByText("This draft was updated elsewhere.")).toBeInTheDocument();
    expect(currentContext.draftMetadata.saveState).toBe("conflict");
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(publishCycleDraft).not.toHaveBeenCalled();
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

  test("Publish gives a generic document error one explicit retry and blocks when it fails", async () => {
    updateCycleDraft
      .mockRejectedValueOnce(new Error("initial network failure"))
      .mockRejectedValueOnce(new Error("retry network failure"));
    await renderBuilder();

    act(() => currentContext.updateProgramMeta({ programName: "Unsaved Rename" }));
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toThrow(
        "initial network failure"
      );
    });
    expect(currentContext.draftMetadata.saveState).toBe("error");

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(updateCycleDraft).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("retry network failure").length).toBeGreaterThan(0);
    expect(publishCycleDraft).not.toHaveBeenCalled();
    expect(currentContext.programDraft.programName).toBe("Unsaved Rename");
  });

  test("DRAFT_EXPIRED recovery during Publish preparation aborts the current Publish", async () => {
    const recovered = buildCycleResponse({
      reps: 63,
      contentRevision: 20,
      revision: 20,
    });
    recovered.planId = "plan_recovered";
    saveCycleWorkoutContent.mockRejectedValueOnce(Object.assign(
      new Error("draft expired"),
      { code: "DRAFT_EXPIRED", status: 409 }
    ));
    await renderBuilder();
    openOrCreateCycleEditDraft.mockResolvedValueOnce(recovered);
    editWorkoutReps(62);

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(currentContext.draftMetadata.cyclePlanId)
      .toBe("plan_recovered"));
    expect(publishCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-workout-reps")).toHaveTextContent("63");
    expect(screen.getByRole("button", { name: "Publish Cycle" })).not.toBeDisabled();
  });

  test("flag OFF uses only the legacy document persistence barrier before Publish", async () => {
    process.env[FLAG] = "false";
    const response = buildCycleResponse();
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, { revision: 11 })
    );
    publishCycleDraft.mockResolvedValue({ ...response, status: "PUBLISHED", revision: 12 });
    await renderBuilder(response);
    editWorkoutReps(64);

    fireEvent.click(screen.getByRole("button", { name: "Publish Cycle" }));

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(updateCycleDraft.mock.invocationCallOrder[0]).toBeLessThan(
      publishCycleDraft.mock.invocationCallOrder[0]
    );
  });
});
