import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../../context/ManualProgramContext";
import ManualBuilder from "../ManualBuilder";
import {
  publishWeeklyPlanDraft,
  saveWeeklyPlanWorkoutContent,
  updateWeeklyPlanDraft,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  deleteWeeklyPlan: jest.fn(),
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  publishWeeklyPlanDraft: jest.fn(),
  saveWeeklyPlanWorkoutContent: jest.fn(),
  updateWeeklyPlanDraft: jest.fn(),
}));

const FLAG = "REACT_APP_ENABLE_WEEKLY_WORKOUT_SCOPED_AUTOSAVE";

function deferred() {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((res, rej) => {
    resolve = (value) => { settled = true; res(value); };
    reject = (error) => { settled = true; rej(error); };
  });
  return { promise, resolve, reject, get settled() { return settled; } };
}

function workout(index, reps = 8, contentRevision = 5) {
  const id = `workout_${index + 1}`;
  return {
    id,
    name: `Workout ${index + 1}`,
    orderIndex: index + 1,
    contentRevision,
    persistence: { id },
    blocks: [{
      id: `${id}_block`,
      type: "single",
      exercise: "Bench Press",
      exerciseId: "exercise_1",
      exerciseRowId: `${id}_exercise`,
      bodyParts: ["chest"],
      muscleFocus: ["chest"],
      tempo: "3010",
      rest: "120s",
      sets: [{ id: `${id}_set`, reps, rpe: 2 }],
      notes: "",
    }],
  };
}

function response({ workoutCount = 3, revision = 10, reps = [8, 9, 10] } = {}) {
  return {
    weeklyPlanParentId: "weekly_parent_1",
    weeklyPlanVersionId: "weekly_version_1",
    status: "DRAFT",
    source: "MANUAL",
    revision,
    updatedAt: "2026-08-18T12:00:00.000Z",
    builderPayload: {
      programName: "Weekly Plan",
      sessionsPerWeek: workoutCount,
      workouts: Array.from({ length: workoutCount }, (_, index) =>
        workout(index, reps[index] ?? 8)
      ),
    },
  };
}

function sentReps(payload) {
  return payload.workout.blocks[0].exercises[0].setTemplates[0].targetReps;
}

function workoutSave(payload, {
  versionRevision = 11,
  contentRevision = 6,
  reps = sentReps(payload),
} = {}) {
  const index = Number(payload.workout.id.split("_").pop()) - 1;
  return {
    weeklyPlanParentId: "weekly_parent_1",
    versionId: "weekly_version_1",
    workoutId: payload.workout.id,
    contentRevision,
    versionRevision,
    workout: workout(index, reps, contentRevision),
    updatedAt: "2026-08-18T12:01:00.000Z",
  };
}

function structuralResponse(payload, revision = Number(payload.revision) + 1) {
  const workouts = payload.workouts.map((entry, index) => workout(
    index,
    entry.blocks[0].exercises[0].setTemplates[0].targetReps,
    6
  ));
  workouts.forEach((entry, index) => {
    entry.id = payload.workouts[index].id;
    entry.name = payload.workouts[index].name;
    entry.orderIndex = payload.workouts[index].orderIndex;
  });
  return {
    weeklyPlanParentId: "weekly_parent_1",
    weeklyPlanVersionId: "weekly_version_1",
    status: "DRAFT",
    source: "MANUAL",
    revision,
    updatedAt: "2026-08-18T12:02:00.000Z",
    builderPayload: {
      programName: payload.name,
      sessionsPerWeek: payload.sessionsPerWeek,
      workouts,
    },
  };
}

let context;

function Probe() {
  context = useManualProgram();
  return null;
}

function renderBuilder(initialResponse = response()) {
  render(
    <MemoryRouter initialEntries={["/program/manual-builder"]}>
      <ManualProgramProvider>
        <Probe />
        <ManualBuilder />
      </ManualProgramProvider>
    </MemoryRouter>
  );
  act(() => context.hydrateProgramDraft(initialResponse));
}

async function tickDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
  });
}

describe("ManualBuilder Weekly terminal publish barrier", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
    jest.useFakeTimers();
    context = null;
    publishWeeklyPlanDraft.mockReset().mockResolvedValue({ status: "PUBLISHED" });
    saveWeeklyPlanWorkoutContent.mockReset();
    updateWeeklyPlanDraft.mockReset();
  });

  afterEach(() => {
    delete process.env[FLAG];
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("multiple pending workouts and a newest follow-up all settle before Publish", async () => {
    const saves = [deferred(), deferred(), deferred(), deferred()];
    saveWeeklyPlanWorkoutContent.mockImplementation(() =>
      saves[saveWeeklyPlanWorkoutContent.mock.calls.length - 1].promise
    );
    renderBuilder();
    act(() => {
      context.updateSet("workout_1", "workout_1_block", 0, { reps: 31 });
      context.updateSet("workout_2", "workout_2_block", 0, { reps: 32 });
      context.updateSet("workout_3", "workout_3_block", 0, { reps: 33 });
    });
    await tickDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();

    act(() => context.updateSet("workout_3", "workout_3_block", 0, { reps: 34 }));
    for (let index = 0; index < 3; index += 1) {
      const payload = saveWeeklyPlanWorkoutContent.mock.calls[index][3];
      await act(async () => {
        saves[index].resolve(workoutSave(payload, {
          versionRevision: 11 + index,
          reps: sentReps(payload),
        }));
        await saves[index].promise;
      });
    }
    await waitFor(() => expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(4));
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[3][3])).toBe(34);

    await act(async () => {
      saves[3].resolve(workoutSave(saveWeeklyPlanWorkoutContent.mock.calls[3][3], {
        versionRevision: 14,
        contentRevision: 7,
        reps: 34,
      }));
      await saves[3].promise;
    });
    await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    expect(saves.every((save) => save.settled)).toBe(true);
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
  });

  test("a structural mutation during workout flush persists at the newest version first", async () => {
    const pendingWorkout = deferred();
    const pendingDocument = deferred();
    saveWeeklyPlanWorkoutContent.mockReturnValue(pendingWorkout.promise);
    updateWeeklyPlanDraft.mockReturnValue(pendingDocument.promise);
    renderBuilder(response({ workoutCount: 1, reps: [8] }));
    act(() => context.updateSet("workout_1", "workout_1_block", 0, { reps: 40 }));
    await tickDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    act(() => context.updateProgramMeta({ programName: "Renamed" }));
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    await act(async () => {
      pendingWorkout.resolve(workoutSave(saveWeeklyPlanWorkoutContent.mock.calls[0][3], {
        versionRevision: 24,
        reps: 40,
      }));
      await pendingWorkout.promise;
    });
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    expect(updateWeeklyPlanDraft.mock.calls[0][2].revision).toBe(24);
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();

    await act(async () => {
      pendingDocument.resolve(structuralResponse(updateWeeklyPlanDraft.mock.calls[0][2], 25));
      await pendingDocument.promise;
    });
    await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
  });

  test("Publish re-flushes workout content made dirty during structural reconciliation", async () => {
    const documentSave = deferred();
    const workoutSaveDeferred = deferred();
    updateWeeklyPlanDraft.mockReturnValue(documentSave.promise);
    saveWeeklyPlanWorkoutContent.mockReturnValue(workoutSaveDeferred.promise);
    renderBuilder(response({ workoutCount: 2, reps: [8, 9] }));

    act(() => context.moveWorkouts(["workout_1"], "down"));
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    act(() => context.updateSet("workout_1", "workout_1_block", 0, { reps: 81 }));
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();

    const documentRequest = updateWeeklyPlanDraft.mock.calls[0][2];
    await act(async () => {
      documentSave.resolve(structuralResponse(documentRequest, 11));
      await documentSave.promise;
    });
    await waitFor(() => expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1));
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[0][3])).toBe(81);
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSaveDeferred.resolve(workoutSave(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { versionRevision: 12, contentRevision: 7, reps: 81 }
      ));
      await workoutSaveDeferred.promise;
    });
    await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    await tickDebounce();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["conflict", Object.assign(new Error("workout conflict"), {
      code: "WORKOUT_REVISION_CONFLICT", status: 409,
    })],
    ["terminal error", new Error("workout network failure")],
  ])("workout %s blocks Publish with local content preserved", async (_label, error) => {
    saveWeeklyPlanWorkoutContent.mockRejectedValueOnce(error);
    renderBuilder(response({ workoutCount: 1, reps: [8] }));
    act(() => context.updateSet("workout_1", "workout_1_block", 0, { reps: 50 }));
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    await waitFor(() => expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1));
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
    expect(context.programDraft.workouts[0].blocks[0].sets[0].reps).toBe(50);
  });

  test("document conflict blocks without retry", async () => {
    updateWeeklyPlanDraft.mockRejectedValueOnce(Object.assign(
      new Error("This draft was updated elsewhere."),
      { code: "DRAFT_REVISION_CONFLICT", status: 409 }
    ));
    renderBuilder(response({ workoutCount: 1, reps: [8] }));
    act(() => context.updateProgramMeta({ programName: "Local name" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    expect(await screen.findByText("This draft was updated elsewhere.")).toBeInTheDocument();
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
    expect(context.programDraft.programName).toBe("Local name");
  });

  test("Publish+Transform uses the same terminal barrier", async () => {
    const save = deferred();
    saveWeeklyPlanWorkoutContent.mockReturnValue(save.promise);
    renderBuilder(response({ workoutCount: 1, reps: [8] }));
    act(() => context.updateSet("workout_1", "workout_1_block", 0, { reps: 60 }));
    fireEvent.click(screen.getByRole("button", { name: /Turn into multi-week program/ }));
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1));
    await act(async () => {
      save.resolve(workoutSave(saveWeeklyPlanWorkoutContent.mock.calls[0][3], { reps: 60 }));
      await save.promise;
    });
    await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
  });

  test("flag OFF uses only the legacy document barrier", async () => {
    process.env[FLAG] = "false";
    const initial = response({ workoutCount: 1, reps: [8] });
    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, payload) =>
      structuralResponse(payload)
    );
    renderBuilder(initial);
    act(() => context.updateSet("workout_1", "workout_1_block", 0, { reps: 70 }));
    fireEvent.click(screen.getByRole("button", { name: "Publish Program" }));
    await waitFor(() => expect(publishWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
  });

  test("incomplete render state disables both publish actions", () => {
    const initial = response({ workoutCount: 1, reps: [8] });
    initial.builderPayload.sessionsPerWeek = 2;
    renderBuilder(initial);

    expect(screen.getByRole("button", { name: "Publish Program" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Turn into multi-week program/ })
    ).toBeDisabled();
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
    expect(publishWeeklyPlanDraft).not.toHaveBeenCalled();
  });
});
