import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../ManualProgramContext";
import {
  openOrCreateWeeklyPlanEditDraft,
  saveWeeklyPlanWorkoutContent,
  updateWeeklyPlanDraft,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  saveWeeklyPlanWorkoutContent: jest.fn(),
  updateWeeklyPlanDraft: jest.fn(),
}));

const FLAG = "REACT_APP_ENABLE_WEEKLY_WORKOUT_SCOPED_AUTOSAVE";

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
  return { promise, resolve, reject, get settled() { return settled; } };
}

function buildWorkout(index = 0, { reps = 8, contentRevision = 5 } = {}) {
  const suffix = index + 1;
  const workoutId = `workout_${suffix}`;
  return {
    id: workoutId,
    name: `Workout ${suffix}`,
    orderIndex: suffix,
    contentRevision,
    persistence: { id: workoutId },
    blocks: [{
      id: `${workoutId}_block_1`,
      type: "single",
      exercise: "Bench Press",
      exerciseId: "exercise_1",
      exerciseRowId: `${workoutId}_exercise_1`,
      bodyParts: ["chest"],
      muscleFocus: ["upper_chest"],
      tempo: "3010",
      rest: "120s",
      sets: [{ id: `${workoutId}_set_1`, reps, rpe: 2 }],
      notes: "",
    }],
  };
}

function buildResponse({
  parentId = "weekly_parent_1",
  versionId = "weekly_version_1",
  revision = 10,
  repsByIndex = [8, 9],
  contentRevisions = [5, 5],
  workoutCount = repsByIndex.length,
} = {}) {
  return {
    weeklyPlanParentId: parentId,
    weeklyPlanVersionId: versionId,
    status: "DRAFT",
    source: "MANUAL",
    revision,
    updatedAt: "2026-08-18T12:00:00.000Z",
    builderPayload: {
      programName: "Weekly Plan",
      sessionsPerWeek: workoutCount,
      workouts: Array.from({ length: workoutCount }, (_, index) =>
        buildWorkout(index, {
          reps: repsByIndex[index] ?? 8,
          contentRevision: contentRevisions[index] ?? 5,
        })
      ),
    },
  };
}

function sentReps(payload) {
  return payload.workout.blocks[0].exercises[0].setTemplates[0].targetReps;
}

function buildWorkoutSaveResponse(payload, {
  workoutId = payload.workout.id,
  contentRevision = 6,
  versionRevision = 11,
  reps = sentReps(payload),
  blockId = payload.workout.blocks[0].id,
} = {}) {
  const index = Number(workoutId.split("_").pop()) - 1;
  const workout = buildWorkout(Number.isInteger(index) ? index : 0, {
    reps,
    contentRevision,
  });
  workout.id = workoutId;
  workout.blocks[0].id = blockId;
  workout.blocks[0].exerciseRowId = payload.workout.blocks[0].exercises[0].id;
  workout.blocks[0].sets[0].id =
    payload.workout.blocks[0].exercises[0].setTemplates[0].id;
  return {
    weeklyPlanParentId: "weekly_parent_1",
    versionId: "weekly_version_1",
    workoutId,
    contentRevision,
    versionRevision,
    workout,
    updatedAt: "2026-08-18T12:01:00.000Z",
  };
}

function apiWorkoutToUi(workout, contentRevision = 6) {
  const block = workout.blocks[0];
  const exercise = block.exercises[0];
  return {
    id: workout.id,
    name: workout.name,
    orderIndex: workout.orderIndex,
    contentRevision,
    persistence: { id: workout.id },
    blocks: [{
      id: block.id,
      type: "single",
      exercise: exercise.exerciseName,
      exerciseId: exercise.exerciseId,
      exerciseRowId: exercise.id,
      bodyParts: exercise.bodyParts || [],
      muscleFocus: exercise.muscleFocus || [],
      tempo: exercise.defaultTempo,
      rest: `${block.restSeconds || 120}s`,
      sets: exercise.setTemplates.map((set) => ({
        id: set.id,
        reps: set.targetReps,
        rpe: set.targetRir,
      })),
      notes: block.notes || "",
    }],
  };
}

function buildStructuralResponse(payload, {
  revision = Number(payload.revision) + 1,
  contentRevisionById = {},
  canonicalIdById = {},
} = {}) {
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
      workouts: payload.workouts.map((workout) => {
        const contentRevision = contentRevisionById[workout.id] || 6;
        const mapped = workout.blocks.length > 0
          ? apiWorkoutToUi(workout, contentRevision)
          : {
            id: workout.id,
            name: workout.name,
            orderIndex: workout.orderIndex,
            contentRevision,
            persistence: { id: workout.id },
            blocks: [],
          };
        const canonicalId = canonicalIdById[workout.id];
        return canonicalId
          ? { ...mapped, id: canonicalId, persistence: { id: canonicalId } }
          : mapped;
      }),
    },
  };
}

let currentContext;

function ContextProbe() {
  currentContext = useManualProgram();
  return (
    <>
      <div data-testid="revision">{String(currentContext.draftMetadata.revision)}</div>
      <div data-testid="reps-a">
        {String(currentContext.programDraft.workouts[0]?.blocks[0]?.sets[0]?.reps)}
      </div>
      <div data-testid="reps-b">
        {String(currentContext.programDraft.workouts[1]?.blocks[0]?.sets[0]?.reps)}
      </div>
    </>
  );
}

function renderProvider(response = buildResponse()) {
  render(
    <ManualProgramProvider>
      <ContextProbe />
    </ManualProgramProvider>
  );
  act(() => currentContext.hydrateProgramDraft(response));
}

async function advanceAutosave() {
  await act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
  });
}

describe("ManualProgramProvider workout-scoped autosave", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
    jest.useFakeTimers();
    currentContext = null;
    openOrCreateWeeklyPlanEditDraft.mockReset();
    saveWeeklyPlanWorkoutContent.mockReset();
    updateWeeklyPlanDraft.mockReset();
  });

  afterEach(() => {
    delete process.env[FLAG];
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("ten rapid edits coalesce into one latest one-workout request", async () => {
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, payload) =>
      buildWorkoutSaveResponse(payload)
    );
    renderProvider();

    act(() => {
      for (let reps = 10; reps < 20; reps += 1) {
        currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps });
      }
    });
    await advanceAutosave();

    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[0][3])).toBe(19);
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
  });

  test("an edit during save preserves v7 and sends one latest follow-up with the returned token", async () => {
    const first = createDeferred();
    const second = createDeferred();
    saveWeeklyPlanWorkoutContent
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderProvider();

    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 15 }));
    await advanceAutosave();
    act(() => {
      currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 16 });
      currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 17 });
    });

    await act(async () => {
      first.resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { contentRevision: 18, versionRevision: 24, reps: 15 }
      ));
      await first.promise;
    });

    expect(screen.getByTestId("reps-a")).toHaveTextContent("17");
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(2);
    expect(saveWeeklyPlanWorkoutContent.mock.calls[1][3].contentRevision).toBe(18);
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[1][3])).toBe(17);

    await act(async () => {
      second.resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[1][3],
        { contentRevision: 19, versionRevision: 25, reps: 17 }
      ));
      await second.promise;
    });
    expect(currentContext.workoutSaveState.get("workout_1")?.status).toBe("clean");
  });

  test("different workouts save concurrently and out-of-order revisions remain monotonic", async () => {
    const saveA = createDeferred();
    const saveB = createDeferred();
    saveWeeklyPlanWorkoutContent.mockImplementation((_parent, _version, workoutId) =>
      workoutId === "workout_1" ? saveA.promise : saveB.promise
    );
    renderProvider();

    act(() => {
      currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 21 });
      currentContext.updateSet("workout_2", "workout_2_block_1", 0, { reps: 22 });
    });
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(2);

    const callA = saveWeeklyPlanWorkoutContent.mock.calls.find((call) => call[2] === "workout_1");
    const callB = saveWeeklyPlanWorkoutContent.mock.calls.find((call) => call[2] === "workout_2");
    await act(async () => {
      saveB.resolve(buildWorkoutSaveResponse(callB[3], {
        workoutId: "workout_2", versionRevision: 24, reps: 22,
      }));
      await saveB.promise;
      saveA.resolve(buildWorkoutSaveResponse(callA[3], {
        workoutId: "workout_1", versionRevision: 23, reps: 21,
      }));
      await saveA.promise;
    });

    expect(screen.getByTestId("revision")).toHaveTextContent("24");
    expect(screen.getByTestId("reps-a")).toHaveTextContent("21");
    expect(screen.getByTestId("reps-b")).toHaveTextContent("22");
  });

  test("Weekly saves use the shared four-request concurrency bound", async () => {
    const saves = Array.from({ length: 5 }, () => createDeferred());
    saveWeeklyPlanWorkoutContent.mockImplementation(() =>
      saves[saveWeeklyPlanWorkoutContent.mock.calls.length - 1].promise
    );
    renderProvider(buildResponse({
      workoutCount: 5,
      repsByIndex: [8, 8, 8, 8, 8],
      contentRevisions: [5, 5, 5, 5, 5],
    }));

    act(() => {
      for (let index = 0; index < 5; index += 1) {
        currentContext.updateSet(
          `workout_${index + 1}`,
          `workout_${index + 1}_block_1`,
          0,
          { reps: 20 + index }
        );
      }
    });
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(4);

    await act(async () => {
      saves[0].resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { workoutId: saveWeeklyPlanWorkoutContent.mock.calls[0][2] }
      ));
      await saves[0].promise;
    });
    await waitFor(() => expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(5));

    for (let index = 1; index < 5; index += 1) {
      const request = saveWeeklyPlanWorkoutContent.mock.calls[index][3];
      saves[index].resolve(buildWorkoutSaveResponse(request, {
        workoutId: saveWeeklyPlanWorkoutContent.mock.calls[index][2],
        versionRevision: 11 + index,
      }));
    }
    await act(async () => Promise.all(saves.slice(1).map((save) => save.promise)));
  });

  test("a safe canonical response applies fully, rebases, and does not loop", async () => {
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, payload) => {
      const response = buildWorkoutSaveResponse(payload, { reps: 30 });
      response.workout.blocks[0].notes = "canonical";
      return response;
    });
    renderProvider();
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 30 }));
    await advanceAutosave();
    await advanceAutosave();

    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(currentContext.programDraft.workouts[0].blocks[0].notes).toBe("canonical");
  });

  test("nested identities follow their sent rows when local blocks reorder during flight", async () => {
    const save = createDeferred();
    const followUp = createDeferred();
    const response = buildResponse({ workoutCount: 1, repsByIndex: [8] });
    response.builderPayload.workouts[0].blocks.push({
      ...response.builderPayload.workouts[0].blocks[0],
      id: "workout_1_block_2",
      exercise: "Row",
      exerciseRowId: "workout_1_exercise_2",
      sets: [{ id: "workout_1_set_2", reps: 12, rpe: 2 }],
    });
    saveWeeklyPlanWorkoutContent
      .mockReturnValueOnce(save.promise)
      .mockReturnValueOnce(followUp.promise);
    renderProvider(response);
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 9 }));
    await advanceAutosave();
    await act(async () => {
      currentContext.reorderBlocks("workout_1", 0, 1);
      await Promise.resolve();
    });
    expect(currentContext.programDraft.workouts[0].blocks.map((block) => block.id))
      .toEqual(["workout_1_block_2", "workout_1_block_1"]);
    expect(currentContext.workoutSaveState.get("workout_1")?.pendingFollowUp).toBe(true);

    const payload = saveWeeklyPlanWorkoutContent.mock.calls[0][3];
    const canonical = buildWorkoutSaveResponse(payload, { reps: 9 });
    canonical.workout.blocks = [
      { ...currentContext.programDraft.workouts[0].blocks[1], id: "canonical_a" },
      { ...currentContext.programDraft.workouts[0].blocks[0], id: "canonical_b" },
    ];
    await act(async () => {
      save.resolve(canonical);
      await save.promise;
    });

    expect(currentContext.programDraft.workouts[0].blocks.map((block) => block.id))
      .toEqual(["canonical_b", "canonical_a"]);

    const followUpPayload = saveWeeklyPlanWorkoutContent.mock.calls[1][3];
    const followUpResponse = buildWorkoutSaveResponse(followUpPayload, {
      contentRevision: 7,
      versionRevision: 12,
      reps: sentReps(followUpPayload),
    });
    followUpResponse.workout.blocks = currentContext.programDraft.workouts[0].blocks;
    await act(async () => {
      followUp.resolve(followUpResponse);
      await followUp.promise;
    });
  });

  test("hydration rebases the reference baseline without a false workout save", async () => {
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(buildResponse({ revision: 20 })));
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
  });

  test("flag OFF preserves whole-document autosave and never calls workout PATCH", async () => {
    process.env[FLAG] = "false";
    const response = buildResponse();
    updateWeeklyPlanDraft.mockResolvedValue(response);
    renderProvider(response);
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 40 }));
    await advanceAutosave();
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
  });

  test("deleting a debounced workout cancels its PATCH and persists structurally", async () => {
    const response = buildResponse();
    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, payload) =>
      buildStructuralResponse(payload)
    );
    renderProvider(response);
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 41 }));
    act(() => currentContext.removeWorkouts(["workout_1"]));
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(updateWeeklyPlanDraft.mock.calls[0][2].workouts.map((workout) => workout.id))
      .toEqual(["workout_2"]);
  });

  test("deleting an in-flight workout waits, uses the returned version, and never reinserts it", async () => {
    const workoutSave = createDeferred();
    saveWeeklyPlanWorkoutContent.mockReturnValue(workoutSave.promise);
    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, request) =>
      buildStructuralResponse(request, { revision: 25 })
    );
    renderProvider();
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 41 }));
    await advanceAutosave();
    act(() => currentContext.removeWorkouts(["workout_1"]));
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSave.resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { contentRevision: 6, versionRevision: 24, reps: 41 }
      ));
      await workoutSave.promise;
    });
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    expect(updateWeeklyPlanDraft.mock.calls[0][2].revision).toBe(24);
    expect(updateWeeklyPlanDraft.mock.calls[0][2].workouts.map((workout) => workout.id))
      .toEqual(["workout_2"]);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_2"]);
  });

  test("structural persistence waits for an in-flight workout and uses its versionRevision", async () => {
    const workoutSave = createDeferred();
    saveWeeklyPlanWorkoutContent.mockReturnValue(workoutSave.promise);
    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, payload) =>
      buildStructuralResponse(payload, { revision: 25 })
    );
    renderProvider();
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 42 }));
    await advanceAutosave();
    act(() => currentContext.moveWorkouts(["workout_1"], "down"));
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSave.resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { versionRevision: 24, reps: 42 }
      ));
      await workoutSave.promise;
    });
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    expect(updateWeeklyPlanDraft.mock.calls[0][2].revision).toBe(24);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_2", "workout_1"]);
  });

  test("content plus structure in one local commit uses only the whole-document save", async () => {
    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, request) =>
      buildStructuralResponse(request, { revision: 11 })
    );
    renderProvider();

    act(() => {
      currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 46 });
      currentContext.moveWorkouts(["workout_1"], "down");
    });
    await act(async () => currentContext.persistDraftNow());

    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(updateWeeklyPlanDraft.mock.calls[0][2].revision).toBe(10);
    expect(
      updateWeeklyPlanDraft.mock.calls[0][2].workouts
        .find((workout) => workout.id === "workout_1")
        .blocks[0].exercises[0].setTemplates[0].targetReps
    ).toBe(46);
  });

  test("a structural response preserves newer paused workout content and resumes its PATCH", async () => {
    const structuralSave = createDeferred();
    updateWeeklyPlanDraft.mockReturnValue(structuralSave.promise);
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, request) =>
      buildWorkoutSaveResponse(request, {
        contentRevision: 7,
        versionRevision: 12,
        reps: sentReps(request),
      })
    );
    renderProvider();

    act(() => currentContext.moveWorkouts(["workout_1"], "down"));
    let persistPromise;
    act(() => {
      persistPromise = currentContext.persistDraftNow();
    });
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 47 }));

    const sentDocument = updateWeeklyPlanDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(buildStructuralResponse(sentDocument, { revision: 11 }));
      await persistPromise;
    });
    expect(
      currentContext.programDraft.workouts
        .find((workout) => workout.id === "workout_1")
        .blocks[0].sets[0].reps
    ).toBe(47);

    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(saveWeeklyPlanWorkoutContent.mock.calls[0][3].contentRevision).toBe(6);
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[0][3])).toBe(47);
  });

  test("new and duplicated workouts stay suppressed until structural confirmation, then use canonical ids", async () => {
    const structuralSave = createDeferred();
    const initial = buildResponse({ workoutCount: 1, repsByIndex: [8] });
    initial.builderPayload.sessionsPerWeek = 3;
    updateWeeklyPlanDraft.mockReturnValue(structuralSave.promise);
    const canonicalizeStructuralRequest = (request) => {
      const addedIds = request.workouts
        .map((workout) => workout.id)
        .filter((id) => id !== "workout_1");
      return buildStructuralResponse(request, {
        revision: 11,
        contentRevisionById: Object.fromEntries(addedIds.map((id) => [id, 1])),
        canonicalIdById: Object.fromEntries(
          addedIds.map((id, index) => [id, `canonical_new_${index + 1}`])
        ),
      });
    };
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, request) =>
      buildWorkoutSaveResponse(request, {
        workoutId: request.workout.id,
        contentRevision: 2,
        versionRevision: 12,
      })
    );
    renderProvider(initial);

    act(() => {
      currentContext.addWorkout("New Workout");
      currentContext.duplicateWorkouts(["workout_1"]);
    });
    const localIds = currentContext.programDraft.workouts.map((workout) => workout.id);
    expect(localIds).toHaveLength(3);
    const duplicate = currentContext.programDraft.workouts[1];
    act(() => currentContext.updateSet(
      duplicate.id,
      duplicate.blocks[0].id,
      0,
      { reps: 48 }
    ));
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();

    let persistPromise;
    act(() => {
      persistPromise = currentContext.persistDraftNow();
    });
    await waitFor(() => expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1));
    act(() => currentContext.updateSet(
      duplicate.id,
      duplicate.blocks[0].id,
      0,
      { reps: 49 }
    ));
    expect(saveWeeklyPlanWorkoutContent).not.toHaveBeenCalled();
    const structuralRequest = updateWeeklyPlanDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(canonicalizeStructuralRequest(structuralRequest));
      await persistPromise;
    });
    expect(updateWeeklyPlanDraft.mock.calls[0][2].workouts.map((workout) => workout.id))
      .toEqual(localIds);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id)).toEqual([
      "workout_1",
      "canonical_new_1",
      "canonical_new_2",
    ]);

    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(saveWeeklyPlanWorkoutContent.mock.calls[0][2]).toBe("canonical_new_1");
    expect(saveWeeklyPlanWorkoutContent.mock.calls[0][3].contentRevision).toBe(1);
    expect(sentReps(saveWeeklyPlanWorkoutContent.mock.calls[0][3])).toBe(49);
  });

  test("a Weekly draft from a previous date remains editable without an expiry lifecycle", async () => {
    const oldResponse = buildResponse({ workoutCount: 1, repsByIndex: [8] });
    oldResponse.updatedAt = "2020-01-01T00:00:00.000Z";
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, request) =>
      buildWorkoutSaveResponse(request, { reps: 52 })
    );
    renderProvider(oldResponse);

    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 52 }));
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    expect(currentContext.workoutSaveState.get("workout_1")?.status).toBe("clean");
  });

  test("surviving workout conflict blocks structural persistence but removed conflict does not", async () => {
    saveWeeklyPlanWorkoutContent.mockRejectedValue(Object.assign(
      new Error("conflict"),
      { code: "WORKOUT_REVISION_CONFLICT", status: 409 }
    ));
    renderProvider();
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 43 }));
    await advanceAutosave();
    act(() => currentContext.updateProgramMeta({ programName: "Blocked" }));
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toMatchObject({
        code: "WORKOUT_AUTOSAVE_BLOCKED",
      });
    });
    expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();

    updateWeeklyPlanDraft.mockImplementation(async (_parent, _version, payload) =>
      buildStructuralResponse(payload)
    );
    act(() => currentContext.removeWorkouts(["workout_1"]));
    await act(async () => currentContext.persistDraftNow());
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  });

  test("generic structural failure releases its pause and a later workout can save", async () => {
    updateWeeklyPlanDraft.mockRejectedValueOnce(new Error("network unavailable"));
    saveWeeklyPlanWorkoutContent.mockImplementation(async (_parent, _version, _id, payload) =>
      buildWorkoutSaveResponse(payload)
    );
    renderProvider();
    act(() => currentContext.updateProgramMeta({ programName: "Retry Later" }));
    await act(async () => {
      await expect(currentContext.persistDraftNow()).rejects.toThrow("network unavailable");
    });
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 44 }));
    await advanceAutosave();
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
  });

  test("different-document navigation flushes while the same document remains immediate", async () => {
    const save = createDeferred();
    saveWeeklyPlanWorkoutContent.mockReturnValue(save.promise);
    renderProvider();
    act(() => currentContext.updateSet("workout_1", "workout_1_block_1", 0, { reps: 45 }));
    expect(currentContext.beginHydrationTarget({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: null,
    })).toBeNull();

    let switchPromise;
    act(() => {
      switchPromise = currentContext.beginHydrationTarget({
        weeklyPlanParentId: "weekly_parent_2",
        weeklyPlanVersionId: null,
      });
    });
    await act(async () => Promise.resolve());
    expect(saveWeeklyPlanWorkoutContent).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve(buildWorkoutSaveResponse(
        saveWeeklyPlanWorkoutContent.mock.calls[0][3],
        { reps: 45 }
      ));
      await switchPromise;
    });
  });
});
