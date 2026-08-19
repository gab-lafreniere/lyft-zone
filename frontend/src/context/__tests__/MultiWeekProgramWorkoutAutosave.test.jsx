import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MultiWeekProgramProvider,
  useMultiWeekProgram,
} from "../MultiWeekProgramContext";
import {
  openOrCreateCycleEditDraft,
  saveCycleWorkoutContent,
  updateCycleDraft,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  openOrCreateCycleEditDraft: jest.fn(),
  saveCycleWorkoutContent: jest.fn(),
  updateCycleDraft: jest.fn(),
}));

const FLAG = "REACT_APP_ENABLE_WORKOUT_SCOPED_AUTOSAVE";

function buildSet(id, reps) {
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
  id,
  name,
  reps,
  contentRevision,
  blockId = `${id}_block`,
  exerciseRowId = `${id}_exercise_row`,
  setId = `${id}_set`,
  orderIndex = 1,
} = {}) {
  return {
    id,
    name,
    orderIndex,
    scheduledDay: orderIndex === 1 ? "MONDAY" : "WEDNESDAY",
    contentRevision,
    estimatedDurationMinutes: null,
    notes: null,
    persistence: {
      id,
      name,
      orderIndex,
      scheduledDay: orderIndex === 1 ? "MONDAY" : "WEDNESDAY",
      estimatedDurationMinutes: null,
      notes: null,
    },
    blocks: [
      {
        id: blockId,
        type: "single",
        exercise: "Bench Press",
        exerciseId: "exercise_1",
        exerciseRowId,
        bodyParts: ["chest"],
        muscleFocus: ["upper_chest"],
        tempo: "3010",
        rest: "120s",
        sets: [buildSet(setId, reps)],
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
          exerciseId: "exercise_1",
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

function buildResponse({
  cycleId = "cycle_1",
  planId = "plan_1",
  revision = 10,
  workoutCount = 2,
  repsByIndex = [],
  contentRevisions = [],
} = {}) {
  const workouts = Array.from({ length: workoutCount }, (_, index) => buildWorkout({
    id: `workout_${index + 1}`,
    name: `Workout ${index + 1}`,
    reps: repsByIndex[index] ?? 8 + index,
    contentRevision: contentRevisions[index] ?? 5 + index,
    orderIndex: index + 1,
  }));

  return {
    cycleId,
    planId,
    status: "DRAFT",
    temporalStatus: "UPCOMING",
    timezone: "America/Toronto",
    revision,
    updatedAt: "2026-08-18T12:00:00.000Z",
    builderPayload: {
      programName: "Cycle Draft",
      sessionsPerWeek: workoutCount,
      programLength: 1,
      selectedWeek: 1,
      weeks: [{
        id: "week_1",
        weekNumber: 1,
        orderIndex: 1,
        label: "Week 1",
        notes: null,
        workouts,
      }],
    },
    draftState: {
      effectiveTimezone: "America/Toronto",
      localDate: "2026-08-18",
      isGraceWindow: false,
      canExtendDraft: false,
    },
  };
}

function getPayloadReps(payload) {
  return payload.workout.blocks[0].exercises[0].setTemplates[0].targetReps;
}

function buildSaveResponse(
  cycleResponse,
  workoutId,
  payload,
  { contentRevision, planRevision, reps, canonicalIds = {} } = {}
) {
  const sourceWorkout = cycleResponse.builderPayload.weeks[0].workouts.find(
    (workout) => workout.id === workoutId
  );
  const canonicalReps = reps ?? getPayloadReps(payload);

  return {
    cycleId: cycleResponse.cycleId,
    planId: cycleResponse.planId,
    workoutId,
    contentRevision,
    planRevision,
    updatedAt: "2026-08-18T12:01:00.000Z",
    workout: buildWorkout({
      id: workoutId,
      name: payload.workout.name,
      reps: canonicalReps,
      contentRevision,
      orderIndex: sourceWorkout.orderIndex,
      blockId: canonicalIds.blockId || sourceWorkout.blocks[0].id,
      exerciseRowId:
        canonicalIds.exerciseRowId || sourceWorkout.blocks[0].exerciseRowId,
      setId: canonicalIds.setId || sourceWorkout.blocks[0].sets[0].id,
    }),
  };
}

function buildStructuralResponseFromPayload(
  baseResponse,
  payload,
  { revision, workoutIdMap = {}, contentRevisionById = {} } = {}
) {
  const originalById = new Map(
    baseResponse.builderPayload.weeks.flatMap((week) => week.workouts)
      .map((workout) => [workout.id, workout])
  );
  const weeks = payload.weeks.map((week) => ({
    ...week,
    workouts: week.workouts.map((sentWorkout) => {
      const canonicalId = workoutIdMap[sentWorkout.id] || sentWorkout.id;
      const source = originalById.get(sentWorkout.id);
      const reps = sentWorkout.blocks[0]?.exercises[0]?.setTemplates[0]?.targetReps ?? 8;
      const workout = buildWorkout({
        id: canonicalId,
        name: sentWorkout.name,
        reps,
        contentRevision:
          contentRevisionById[canonicalId] ??
          contentRevisionById[sentWorkout.id] ??
          source?.contentRevision ??
          1,
        orderIndex: sentWorkout.orderIndex,
        blockId: source?.blocks[0]?.id || `${canonicalId}_block`,
        exerciseRowId: source?.blocks[0]?.exerciseRowId || `${canonicalId}_exercise_row`,
        setId: source?.blocks[0]?.sets[0]?.id || `${canonicalId}_set`,
      });
      return {
        ...workout,
        scheduledDay: sentWorkout.scheduledDay,
        persistence: {
          ...workout.persistence,
          scheduledDay: sentWorkout.scheduledDay,
        },
      };
    }),
  }));

  return {
    ...baseResponse,
    revision,
    updatedAt: "2026-08-18T12:02:00.000Z",
    builderPayload: {
      ...baseResponse.builderPayload,
      programName: payload.name,
      weeks,
    },
  };
}

function buildCanonicalSingleBlock(sentBlock, identity) {
  const sentExercise = sentBlock.exercises[0];
  const blockPersistence = { ...sentBlock };
  const exercisePersistence = { ...sentExercise };
  delete blockPersistence.exercises;
  delete exercisePersistence.setTemplates;

  return {
    id: identity.blockId,
    type: "single",
    exercise: sentExercise.exerciseName,
    exerciseId: sentExercise.exerciseId,
    exerciseRowId: identity.exerciseId,
    bodyParts: sentExercise.bodyParts || [],
    muscleFocus: sentExercise.muscleFocus || [],
    tempo: sentExercise.defaultTempo || "",
    rest:
      sentBlock.restSeconds == null ? "" : `${sentBlock.restSeconds}s`,
    sets: (sentExercise.setTemplates || []).map((sentSet, index) => {
      const setId = identity.setIds[index];
      return {
        id: setId,
        reps: sentSet.targetReps,
        rpe: sentSet.targetRir,
        persistence: { ...sentSet, id: setId },
      };
    }),
    notes: sentBlock.notes || "",
    persistence: {
      ...blockPersistence,
      id: identity.blockId,
    },
    exercisePersistence: {
      ...exercisePersistence,
      id: identity.exerciseId,
    },
  };
}

function buildCanonicalWorkoutFromPayload(
  payload,
  contentRevision,
  identityByExerciseName
) {
  return {
    id: payload.workout.id,
    name: payload.workout.name,
    orderIndex: payload.workout.orderIndex,
    scheduledDay: payload.workout.scheduledDay,
    estimatedDurationMinutes: payload.workout.estimatedDurationMinutes,
    notes: payload.workout.notes,
    contentRevision,
    persistence: {
      id: payload.workout.id,
      name: payload.workout.name,
      orderIndex: payload.workout.orderIndex,
      scheduledDay: payload.workout.scheduledDay,
      estimatedDurationMinutes: payload.workout.estimatedDurationMinutes,
      notes: payload.workout.notes,
    },
    blocks: payload.workout.blocks.map((sentBlock) =>
      buildCanonicalSingleBlock(
        sentBlock,
        identityByExerciseName[sentBlock.exercises[0].exerciseName]
      )
    ),
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

function settleWithinMicrotasks(promise, limit = 100) {
  const boundedFailure = new Promise((_, reject) => {
    let remaining = limit;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        reject(new Error("Promise did not settle within the bounded microtask window."));
        return;
      }
      Promise.resolve().then(tick);
    };
    Promise.resolve().then(tick);
  });

  return Promise.race([promise, boundedFailure]);
}

let currentContext;

function ContextProbe() {
  currentContext = useMultiWeekProgram();
  const workouts = currentContext.programDraft.workouts || [];

  return (
    <>
      <div data-testid="reps-a">{String(workouts[0]?.blocks?.[0]?.sets?.[0]?.reps)}</div>
      <div data-testid="reps-b">{String(workouts[1]?.blocks?.[0]?.sets?.[0]?.reps)}</div>
      <div data-testid="revision">{String(currentContext.draftMetadata.revision)}</div>
      <div data-testid="status-a">
        {String(currentContext.workoutSaveState.get("workout_1")?.status)}
      </div>
      <div data-testid="status-b">
        {String(currentContext.workoutSaveState.get("workout_2")?.status)}
      </div>
    </>
  );
}

function renderProvider() {
  return render(
    <MultiWeekProgramProvider>
      <ContextProbe />
    </MultiWeekProgramProvider>
  );
}

async function advanceAutosave() {
  await act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Cycle workout-scoped autosave (Phases 4 and 5)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
    jest.useFakeTimers();
    currentContext = null;
    openOrCreateCycleEditDraft.mockReset();
    saveCycleWorkoutContent.mockReset();
    updateCycleDraft.mockReset();
  });

  afterEach(() => {
    delete process.env[FLAG];
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("ManualConvert published response re-entry targets the new draft for workout and structural saves", async () => {
    const published = buildResponse({ planId: "published_plan" });
    published.publishedPlanId = "published_plan";
    published.status = "PUBLISHED";
    const reopened = buildResponse({ planId: "new_draft_plan", revision: 20 });
    saveCycleWorkoutContent.mockImplementation(
      async (_cycleId, _planId, workoutId, payload) =>
        buildSaveResponse(reopened, workoutId, payload, {
          contentRevision: 6,
          planRevision: 21,
        })
    );
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(reopened, payload, { revision: 22 })
    );
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(published, { force: true }));
    expect(currentContext.draftMetadata.status).toBe("published");
    expect(currentContext.draftMetadata.cyclePlanId).toBeNull();

    act(() => currentContext.beginHydrationTarget({ cycleId: "cycle_1", planId: null }));
    act(() => currentContext.hydrateProgramDraft(reopened));
    expect(currentContext.draftMetadata.cyclePlanId).toBe("new_draft_plan");
    expect(currentContext.draftMetadata.cyclePlanId).not.toBe("published_plan");

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 41 }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledWith(
      "cycle_1",
      "new_draft_plan",
      "workout_1",
      expect.any(Object)
    );

    act(() => currentContext.updateProgramMeta({ programName: "Reopened draft" }));
    await act(async () => currentContext.persistDraftNow());
    expect(updateCycleDraft).toHaveBeenCalledWith(
      "cycle_1",
      "new_draft_plan",
      expect.any(Object)
    );
    expect(saveCycleWorkoutContent.mock.calls.some((call) => call[1] === "published_plan"))
      .toBe(false);
    expect(updateCycleDraft.mock.calls.some((call) => call[1] === "published_plan"))
      .toBe(false);
  });

  test("flag OFF ManualConvert response sends legacy persistence only to the new draft", async () => {
    process.env[FLAG] = "false";
    const published = buildResponse({ planId: "published_plan" });
    published.publishedPlanId = "published_plan";
    published.status = "PUBLISHED";
    const reopened = buildResponse({ planId: "new_legacy_draft", revision: 30 });
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(reopened, payload, { revision: 31 })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(published, { force: true }));
    act(() => currentContext.hydrateProgramDraft(reopened, { force: true }));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 42 }));
    await advanceAutosave();

    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(updateCycleDraft).toHaveBeenCalledWith(
      "cycle_1",
      "new_legacy_draft",
      expect.any(Object)
    );
    expect(updateCycleDraft.mock.calls.some((call) => call[1] === "published_plan"))
      .toBe(false);
  });

  test("10 rapid edits dirty only one workout, preserve the sibling reference, and send one latest workout snapshot", async () => {
    const response = buildResponse();
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) =>
      buildSaveResponse(response, workoutId, payload, {
        contentRevision: 6,
        planRevision: 11,
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    const siblingBefore = currentContext.programDraft.workouts[1];
    Array.from({ length: 10 }, (_, index) => index + 9).forEach((reps) => {
      act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps }));
    });

    expect(currentContext.programDraft.workouts[1]).toBe(siblingBefore);
    expect(currentContext.workoutSaveState.get("workout_1")?.status).toBe("debounced");
    expect(currentContext.workoutSaveState.get("workout_2")?.status).toBe("clean");

    await advanceAutosave();

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[0][3])).toBe(18);
    expect(updateCycleDraft).not.toHaveBeenCalled();
  });

  test("an in-flight v5 response preserves local v7, accepts its revision and IDs, and chains one newest follow-up", async () => {
    const response = buildResponse({ repsByIndex: [5, 9] });
    const first = createDeferred();
    const second = createDeferred();
    saveCycleWorkoutContent
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 5 }));
    // Force a real reference change while retaining the literal v5 value.
    act(() => currentContext.updateBlock("workout_1", "workout_1_block", { notes: "v5" }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 6 }));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 7 }));

    await act(async () => {
      first.resolve(buildSaveResponse(response, "workout_1", saveCycleWorkoutContent.mock.calls[0][3], {
        contentRevision: 18,
        planRevision: 24,
        reps: 5,
        canonicalIds: {
          blockId: "canonical_block_1",
          exerciseRowId: "canonical_exercise_1",
          setId: "canonical_set_1",
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("reps-a")).toHaveTextContent("7");
    expect(screen.getByTestId("revision")).toHaveTextContent("24");
    expect(currentContext.programDraft.workouts[0].blocks[0].id).toBe("canonical_block_1");
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
    expect(saveCycleWorkoutContent.mock.calls[1][3].contentRevision).toBe(18);
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[1][3])).toBe(7);

    await act(async () => {
      second.resolve(buildSaveResponse(response, "workout_1", saveCycleWorkoutContent.mock.calls[1][3], {
        contentRevision: 19,
        planRevision: 25,
        reps: 7,
        canonicalIds: {
          blockId: "canonical_block_1",
          exerciseRowId: "canonical_exercise_1",
          setId: "canonical_set_1",
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status-a")).toHaveTextContent("clean");
  });

  test("an in-flight block reorder preserves local order and reconciles block, exercise, and set IDs by sent identity", async () => {
    const response = buildResponse({ workoutCount: 1 });
    response.builderPayload.weeks[0].workouts[0].blocks = [];
    const first = createDeferred();
    const second = createDeferred();
    const canonicalIdentities = {
      "Block A": {
        blockId: "canonical_block_a",
        exerciseId: "canonical_exercise_a",
        setIds: [
          "canonical_set_a_1",
          "canonical_set_a_2",
          "canonical_set_a_3",
        ],
      },
      "Block B": {
        blockId: "canonical_block_b",
        exerciseId: "canonical_exercise_b",
        setIds: [
          "canonical_set_b_1",
          "canonical_set_b_2",
          "canonical_set_b_3",
        ],
      },
    };
    saveCycleWorkoutContent
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.appendSingleBlockFromExercise("workout_1", {
      exerciseId: "exercise_catalog_a",
      name: "Block A",
      bodyParts: ["chest"],
      muscleFocus: ["upper_chest"],
      trainingType: "strength",
    }));
    act(() => currentContext.appendSingleBlockFromExercise("workout_1", {
      exerciseId: "exercise_catalog_b",
      name: "Block B",
      bodyParts: ["back"],
      muscleFocus: ["lats"],
      trainingType: "strength",
    }));

    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    const firstPayload = saveCycleWorkoutContent.mock.calls[0][3];
    expect(firstPayload.workout.blocks.map(
      (block) => block.exercises[0].exerciseName
    )).toEqual(["Block A", "Block B"]);

    act(() => currentContext.reorderBlocks("workout_1", 0, 1));
    expect(currentContext.programDraft.workouts[0].blocks.map(
      (block) => block.exercise
    )).toEqual(["Block B", "Block A"]);

    await act(async () => {
      first.resolve({
        cycleId: "cycle_1",
        planId: "plan_1",
        workoutId: "workout_1",
        contentRevision: 6,
        planRevision: 11,
        updatedAt: "2026-08-18T12:01:00.000Z",
        workout: buildCanonicalWorkoutFromPayload(
          firstPayload,
          6,
          canonicalIdentities
        ),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const reconciledBlocks = currentContext.programDraft.workouts[0].blocks;
    expect(reconciledBlocks.map((block) => block.exercise)).toEqual([
      "Block B",
      "Block A",
    ]);
    expect(reconciledBlocks.map((block) => block.id)).toEqual([
      "canonical_block_b",
      "canonical_block_a",
    ]);
    expect(reconciledBlocks.map((block) => block.exerciseRowId)).toEqual([
      "canonical_exercise_b",
      "canonical_exercise_a",
    ]);
    expect(reconciledBlocks.map((block) => block.sets[0].id)).toEqual([
      "canonical_set_b_1",
      "canonical_set_a_1",
    ]);

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
    const secondPayload = saveCycleWorkoutContent.mock.calls[1][3];
    expect(secondPayload.workout.blocks.map(
      (block) => block.exercises[0].exerciseName
    )).toEqual(["Block B", "Block A"]);
    expect(secondPayload.workout.blocks.map((block) => block.id)).toEqual([
      "canonical_block_b",
      "canonical_block_a",
    ]);

    await act(async () => {
      second.resolve({
        cycleId: "cycle_1",
        planId: "plan_1",
        workoutId: "workout_1",
        contentRevision: 7,
        planRevision: 12,
        updatedAt: "2026-08-18T12:02:00.000Z",
        workout: buildCanonicalWorkoutFromPayload(
          secondPayload,
          7,
          canonicalIdentities
        ),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("status-a")).toHaveTextContent("clean");
  });

  test("different workouts save concurrently and planRevision remains monotonic when 24 resolves before 23", async () => {
    const response = buildResponse();
    const deferredA = createDeferred();
    const deferredB = createDeferred();
    saveCycleWorkoutContent.mockImplementation((_cycleId, _planId, workoutId) =>
      workoutId === "workout_1" ? deferredA.promise : deferredB.promise
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 10 }));
    act(() => currentContext.updateSet("workout_2", "workout_2_block", 0, { reps: 11 }));
    await advanceAutosave();

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);

    await act(async () => {
      deferredB.resolve(buildSaveResponse(response, "workout_2", saveCycleWorkoutContent.mock.calls[1][3], {
        contentRevision: 7,
        planRevision: 24,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("revision")).toHaveTextContent("24");

    await act(async () => {
      deferredA.resolve(buildSaveResponse(response, "workout_1", saveCycleWorkoutContent.mock.calls[0][3], {
        contentRevision: 6,
        planRevision: 23,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("revision")).toHaveTextContent("24");
  });

  test("bounds different-workout concurrency at four and starts the queued newest snapshot when a slot opens", async () => {
    const response = buildResponse({ workoutCount: 5 });
    const deferreds = Array.from({ length: 5 }, createDeferred);
    saveCycleWorkoutContent.mockImplementation((_cycleId, _planId, workoutId) =>
      deferreds[Number(workoutId.split("_")[1]) - 1].promise
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    Array.from({ length: 5 }, (_, index) => index + 1).forEach((index) => {
      act(() => currentContext.updateSet(
        `workout_${index}`,
        `workout_${index}_block`,
        0,
        { reps: 20 + index }
      ));
    });
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(4);

    await act(async () => {
      deferreds[0].resolve(buildSaveResponse(response, "workout_1", saveCycleWorkoutContent.mock.calls[0][3], {
        contentRevision: 6,
        planRevision: 11,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(5);

    await act(async () => {
      for (let index = 1; index < 5; index += 1) {
        const call = saveCycleWorkoutContent.mock.calls.find((entry) =>
          entry[2] === `workout_${index + 1}`
        );
        deferreds[index].resolve(buildSaveResponse(response, `workout_${index + 1}`, call[3], {
          contentRevision: 7 + index,
          planRevision: 12 + index,
        }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test("a safe canonical response is fully applied and rebased without an autosave loop", async () => {
    const response = buildResponse();
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) =>
      buildSaveResponse(response, workoutId, payload, {
        contentRevision: 6,
        planRevision: 11,
        reps: 12,
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 10 }));

    await advanceAutosave();
    expect(screen.getByTestId("reps-a")).toHaveTextContent("12");
    expect(screen.getByTestId("status-a")).toHaveTextContent("clean");

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
  });

  test("a workout conflict preserves its local content while another workout still saves", async () => {
    const response = buildResponse();
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) => {
      if (workoutId === "workout_1") {
        throw Object.assign(new Error("This workout was updated elsewhere."), {
          code: "WORKOUT_REVISION_CONFLICT",
          status: 409,
        });
      }
      return buildSaveResponse(response, workoutId, payload, {
        contentRevision: 7,
        planRevision: 11,
      });
    });
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 30 }));
    act(() => currentContext.updateSet("workout_2", "workout_2_block", 0, { reps: 31 }));

    await advanceAutosave();

    expect(screen.getByTestId("reps-a")).toHaveTextContent("30");
    expect(screen.getByTestId("status-a")).toHaveTextContent("conflict");
    expect(screen.getByTestId("status-b")).toHaveTextContent("clean");
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
  });

  test("DRAFT_EXPIRED delegates to existing recovery and rebuilds workout state from hydration", async () => {
    const response = buildResponse();
    const recovered = buildResponse({
      revision: 20,
      repsByIndex: [99, 10],
      contentRevisions: [20, 21],
    });
    saveCycleWorkoutContent.mockRejectedValue(Object.assign(new Error("expired"), {
      code: "DRAFT_EXPIRED",
      status: 409,
    }));
    openOrCreateCycleEditDraft.mockResolvedValue(recovered);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 40 }));

    await advanceAutosave();

    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reps-a")).toHaveTextContent("99");
    expect(currentContext.workoutSaveState.get("workout_1")?.contentRevision).toBe(20);
    expect(screen.getByTestId("status-a")).toHaveTextContent("clean");
  });

  test("a missing hydration contentRevision fails safe without calling the workout endpoint", async () => {
    const response = buildResponse({ contentRevisions: [undefined, 6] });
    delete response.builderPayload.weeks[0].workouts[0].contentRevision;
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 41 }));

    await advanceAutosave();

    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(screen.getByTestId("status-a")).toHaveTextContent("error");
    expect(currentContext.workoutSaveState.get("workout_1")?.lastError?.code)
      .toBe("MISSING_WORKOUT_CONTENT_REVISION");
  });

  test("a different-document target terminally flushes content before hydration while same-draft navigation does not", async () => {
    const response = buildResponse();
    const save = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => save.promise);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 50 }));

    // Same Cycle target is immediate and does not flush the pending debounce.
    expect(currentContext.beginHydrationTarget({ cycleId: "cycle_1", planId: null })).toBeNull();
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();

    let switchPromise;
    act(() => {
      switchPromise = currentContext.beginHydrationTarget({ cycleId: "cycle_2", planId: null });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve(buildSaveResponse(response, "workout_1", saveCycleWorkoutContent.mock.calls[0][3], {
        contentRevision: 6,
        planRevision: 11,
        reps: 50,
      }));
      await switchPromise;
    });

    act(() => currentContext.hydrateProgramDraft(buildResponse({
      cycleId: "cycle_2",
      planId: "plan_2",
      repsByIndex: [60, 10],
    })));
    expect(screen.getByTestId("reps-a")).toHaveTextContent("60");
  });

  test("a document-switch structural save uses the planRevision returned by its terminal workout flush", async () => {
    const response = buildResponse({ revision: 10 });
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, {
        revision: 25,
        contentRevisionById: { workout_1: 6 },
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 51 }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    act(() => currentContext.updateProgramMeta({ programName: "Renamed Cycle" }));

    let switchPromise;
    act(() => {
      switchPromise = currentContext.beginHydrationTarget({ cycleId: "cycle_2", planId: null });
    });
    await act(async () => {
      workoutSave.resolve(buildSaveResponse(
        response,
        "workout_1",
        saveCycleWorkoutContent.mock.calls[0][3],
        { contentRevision: 6, planRevision: 24, reps: 51 }
      ));
      await switchPromise;
    });

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft.mock.calls[0][2].revision).toBe(24);
  });

  test("flag OFF preserves legacy whole-document autosave and never calls the workout endpoint", async () => {
    process.env[FLAG] = "false";
    const response = buildResponse();
    updateCycleDraft.mockResolvedValue(response);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 70 }));

    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
  });

  test("flag ON structural changes remain on the whole-document path and new workouts never call the workout endpoint", async () => {
    const response = buildResponse({ workoutCount: 1 });
    updateCycleDraft.mockResolvedValue(response);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateProgramMeta({ sessionsPerWeek: 2 }));
    act(() => currentContext.addWorkout("New Workout"));

    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
  });

  test("a structural save waits for workout A, uses its Plan revision, and pauses workout B until reconciliation", async () => {
    const response = buildResponse({ revision: 10, repsByIndex: [8, 9] });
    const workoutA = createDeferred();
    const structuralSave = createDeferred();
    saveCycleWorkoutContent
      .mockImplementationOnce(() => workoutA.promise)
      .mockImplementation(async (_cycleId, _planId, workoutId, payload) =>
        buildSaveResponse(response, workoutId, payload, {
          contentRevision: 7,
          planRevision: 26,
        })
      );
    updateCycleDraft.mockImplementation(() => structuralSave.promise);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 20 }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();
    expect(updateCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutA.resolve(buildSaveResponse(
        response,
        "workout_1",
        saveCycleWorkoutContent.mock.calls[0][3],
        { contentRevision: 6, planRevision: 24, reps: 20 }
      ));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft.mock.calls[0][2].revision).toBe(24);
    expect(updateCycleDraft.mock.calls[0][2].weeks[0].workouts[0].scheduledDay)
      .toBe("TUESDAY");

    act(() => currentContext.updateSet("workout_2", "workout_2_block", 0, { reps: 31 }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);

    const structuralPayload = updateCycleDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(buildStructuralResponseFromPayload(response, structuralPayload, {
        revision: 25,
        contentRevisionById: { workout_1: 6, workout_2: 6 },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("reps-b")).toHaveTextContent("31");
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
    expect(currentContext.workoutSaveState.get("workout_2")?.contentRevision).toBe(6);
    expect(currentContext.workoutSaveState.get("workout_2")?.status).toBe("debounced");

    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
    expect(saveCycleWorkoutContent.mock.calls[1][2]).toBe("workout_2");
    expect(saveCycleWorkoutContent.mock.calls[1][3].contentRevision).toBe(6);
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[1][3])).toBe(31);
  });

  test("deleting an in-flight workout lets its conflict settle without blocking or resurrecting it", async () => {
    const response = buildResponse();
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, { revision: 11 })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 40 }));
    await advanceAutosave();
    act(() => currentContext.deleteSelectedWeekWorkout(1));
    await advanceAutosave();
    expect(updateCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      workoutSave.reject(Object.assign(new Error("stale deleted workout"), {
        code: "WORKOUT_REVISION_CONFLICT",
        status: 409,
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft.mock.calls[0][2].weeks[0].workouts.map((workout) => workout.id))
      .toEqual(["workout_2"]);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_2"]);
    expect(currentContext.workoutSaveState.has("workout_1")).toBe(false);
  });

  test("same-week moves preserve workout ids and never use the workout content endpoint", async () => {
    const response = buildResponse();
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, { revision: 11 })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_1", "workout_2"]);
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
  });

  test("a no-op structural gesture releases the pause without issuing a document request", async () => {
    const response = buildResponse();
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) =>
      buildSaveResponse(response, workoutId, payload, {
        contentRevision: 6,
        planRevision: 11,
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "MONDAY"));
    await advanceAutosave();
    expect(updateCycleDraft).not.toHaveBeenCalled();

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 33 }));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
  });

  test("repeated same-week structural moves save serially with stable ids and fresh Plan revisions", async () => {
    const response = buildResponse({ revision: 10 });
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, {
        revision: 11 + updateCycleDraft.mock.calls.length - 1,
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();
    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "MONDAY"));
    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(2);
    expect(updateCycleDraft.mock.calls[0][2].revision).toBe(10);
    expect(updateCycleDraft.mock.calls[1][2].revision).toBe(11);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_1", "workout_2"]);
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("MONDAY");
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
  });

  test("reordering while two workout saves exist waits for both and uses the newest Plan revision", async () => {
    const response = buildResponse({ revision: 10 });
    const saveA = createDeferred();
    const saveB = createDeferred();
    saveCycleWorkoutContent.mockImplementation((_cycleId, _planId, workoutId) =>
      workoutId === "workout_1" ? saveA.promise : saveB.promise
    );
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, {
        revision: 13,
        contentRevisionById: { workout_1: 6, workout_2: 7 },
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => {
      currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 41 });
      currentContext.updateSet("workout_2", "workout_2_block", 0, { reps: 42 });
    });
    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);

    act(() => currentContext.moveWorkouts(["workout_2"], "up"));
    await advanceAutosave();
    expect(updateCycleDraft).not.toHaveBeenCalled();

    await act(async () => {
      saveB.resolve(buildSaveResponse(
        response,
        "workout_2",
        saveCycleWorkoutContent.mock.calls.find((call) => call[2] === "workout_2")[3],
        { contentRevision: 7, planRevision: 11, reps: 42 }
      ));
      saveA.resolve(buildSaveResponse(
        response,
        "workout_1",
        saveCycleWorkoutContent.mock.calls.find((call) => call[2] === "workout_1")[3],
        { contentRevision: 6, planRevision: 12, reps: 41 }
      ));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft.mock.calls[0][2].revision).toBe(12);
    expect(updateCycleDraft.mock.calls[0][2].weeks[0].workouts.map((workout) => workout.id))
      .toEqual(["workout_2", "workout_1"]);
    expect(currentContext.programDraft.workouts.map((workout) => workout.id))
      .toEqual(["workout_2", "workout_1"]);
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(2);
  });

  test("a new workout edited during its structural request is unsuppressed and saved with its canonical id", async () => {
    const response = buildResponse({ workoutCount: 1 });
    const structuralSave = createDeferred();
    updateCycleDraft.mockImplementation(() => structuralSave.promise);
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) => ({
      ...buildSaveResponse(response, "workout_1", payload, {
        contentRevision: 2,
        planRevision: 12,
      }),
      workoutId,
      workout: buildWorkout({
        id: workoutId,
        name: payload.workout.name,
        reps: getPayloadReps(payload),
        contentRevision: 2,
        orderIndex: 2,
      }),
    }));
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.duplicateSelectedWeekWorkout(1, "TUESDAY"));
    const localWorkoutId = currentContext.programDraft.workouts[1].id;
    await advanceAutosave();
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();

    act(() => currentContext.updateSet(
      localWorkoutId,
      currentContext.programDraft.workouts[1].blocks[0].id,
      0,
      { reps: 44 }
    ));
    await advanceAutosave();
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();

    const structuralPayload = updateCycleDraft.mock.calls[0][2];
    await act(async () => {
      structuralSave.resolve(buildStructuralResponseFromPayload(response, structuralPayload, {
        revision: 11,
        workoutIdMap: { [localWorkoutId]: "workout_canonical_2" },
        contentRevisionById: { workout_canonical_2: 1 },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(currentContext.programDraft.workouts[1].id).toBe("workout_canonical_2");
    expect(currentContext.programDraft.workouts[1].blocks[0].sets[0].reps).toBe(44);
    expect(currentContext.workoutSaveState.get("workout_canonical_2")
      ?.createdLocallyPendingStructuralSave).toBe(false);
    expect(currentContext.workoutSaveState.get("workout_canonical_2")?.status)
      .toBe("debounced");

    await advanceAutosave();
    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent.mock.calls[0][2]).toBe("workout_canonical_2");
    expect(saveCycleWorkoutContent.mock.calls[0][3].contentRevision).toBe(1);
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[0][3])).toBe(44);
  });

  test("a same-commit content edit plus structural move is captured by the structural payload", async () => {
    const response = buildResponse();
    updateCycleDraft.mockImplementation(async (_cycleId, _planId, payload) =>
      buildStructuralResponseFromPayload(response, payload, {
        revision: 11,
        contentRevisionById: { workout_1: 6 },
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => {
      currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY");
      currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 55 });
    });
    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft.mock.calls[0][2].weeks[0].workouts[0]
      .blocks[0].exercises[0].setTemplates[0].targetReps).toBe(55);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(screen.getByTestId("reps-a")).toHaveTextContent("55");
    expect(currentContext.workoutSaveState.get("workout_1")?.contentRevision).toBe(6);
  });

  test("a surviving workout conflict blocks the structural request and preserves local state", async () => {
    const response = buildResponse();
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 66 }));
    await advanceAutosave();
    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();

    await act(async () => {
      workoutSave.reject(Object.assign(new Error("workout conflict"), {
        code: "WORKOUT_REVISION_CONFLICT",
        status: 409,
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("reps-a")).toHaveTextContent("66");
    expect(screen.getByTestId("status-a")).toHaveTextContent("conflict");
    expect(currentContext.draftMetadata.lastSaveErrorCode).toBe("WORKOUT_AUTOSAVE_BLOCKED");

    let flushResult;
    await act(async () => {
      flushResult = await settleWithinMicrotasks(currentContext.flushAllWorkouts());
    });

    expect(flushResult.blockedWorkoutIds).toEqual(["workout_1"]);
    expect(updateCycleDraft).not.toHaveBeenCalled();
    expect(currentContext.workoutSaveState.get("workout_2")?.status).toBe("clean");
    expect(screen.getByTestId("reps-b")).toHaveTextContent("9");
  });

  test("DRAFT_REVISION_CONFLICT preserves structural and content edits without declaring the workout clean", async () => {
    const response = buildResponse();
    updateCycleDraft.mockRejectedValue(Object.assign(
      new Error("This draft was updated elsewhere."),
      { code: "DRAFT_REVISION_CONFLICT", status: 409 }
    ));
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => {
      currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY");
      currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 77 });
    });
    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
    expect(screen.getByTestId("reps-a")).toHaveTextContent("77");
    expect(currentContext.draftMetadata.saveState).toBe("conflict");
    expect(currentContext.workoutSaveState.get("workout_1")?.status).toBe("dirty");

    let flushResult;
    await act(async () => {
      flushResult = await settleWithinMicrotasks(currentContext.flushAllWorkouts());
    });

    expect(flushResult).toEqual({
      blockedWorkoutIds: [],
      blockedReason: "DOCUMENT_CONFLICT",
    });
    expect(saveCycleWorkoutContent).not.toHaveBeenCalled();
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
    expect(screen.getByTestId("reps-a")).toHaveTextContent("77");
  });

  test("a generic structural failure releases the barrier so a healthy workout can flush", async () => {
    const response = buildResponse();
    updateCycleDraft.mockRejectedValueOnce(new Error("network unavailable"));
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) =>
      buildSaveResponse(response, workoutId, payload, {
        contentRevision: 7,
        planRevision: 11,
      })
    );
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(currentContext.draftMetadata.saveState).toBe("error");
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");

    act(() => currentContext.updateSet(
      "workout_2",
      "workout_2_block",
      0,
      { reps: 79 }
    ));

    await advanceAutosave();

    expect(saveCycleWorkoutContent).toHaveBeenCalledTimes(1);
    expect(saveCycleWorkoutContent.mock.calls[0][2]).toBe("workout_2");
    expect(getPayloadReps(saveCycleWorkoutContent.mock.calls[0][3])).toBe(79);

    let flushResult;
    await act(async () => {
      flushResult = await settleWithinMicrotasks(currentContext.flushAllWorkouts());
    });

    expect(flushResult).toEqual({ blockedWorkoutIds: [] });
    expect(currentContext.programDraft.workouts[0].scheduledDay).toBe("TUESDAY");
    expect(screen.getByTestId("reps-b")).toHaveTextContent("79");
  });

  test("workout DRAFT_EXPIRED during structural preparation recovers instead of PATCHing the expired Plan", async () => {
    const response = buildResponse();
    const recovered = buildResponse({
      planId: "plan_recovered",
      revision: 20,
      repsByIndex: [88, 9],
      contentRevisions: [20, 21],
    });
    const workoutSave = createDeferred();
    saveCycleWorkoutContent.mockImplementation(() => workoutSave.promise);
    openOrCreateCycleEditDraft.mockResolvedValue(recovered);
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));

    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 87 }));
    await advanceAutosave();
    act(() => currentContext.moveSelectedWeekWorkoutToScheduledDay(1, "TUESDAY"));
    await advanceAutosave();

    await act(async () => {
      workoutSave.reject(Object.assign(new Error("expired"), {
        code: "DRAFT_EXPIRED",
        status: 409,
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
    expect(updateCycleDraft).not.toHaveBeenCalled();
    expect(currentContext.draftMetadata.cyclePlanId).toBe("plan_recovered");
    expect(screen.getByTestId("reps-a")).toHaveTextContent("88");
    expect(screen.getByTestId("status-a")).toHaveTextContent("clean");
  });

  test("a 6-week/36-workout draft sends only the edited workout, never the whole Cycle", async () => {
    const response = buildResponse({ workoutCount: 36 });
    response.builderPayload.weeks = Array.from({ length: 6 }, (_, weekIndex) => ({
      id: `week_${weekIndex + 1}`,
      weekNumber: weekIndex + 1,
      orderIndex: weekIndex + 1,
      label: `Week ${weekIndex + 1}`,
      notes: null,
      workouts: response.builderPayload.weeks[0].workouts
        .slice(weekIndex * 6, weekIndex * 6 + 6),
    }));
    response.builderPayload.programLength = 6;
    response.builderPayload.sessionsPerWeek = 6;
    saveCycleWorkoutContent.mockImplementation(async (_cycleId, _planId, workoutId, payload) => ({
      cycleId: "cycle_1",
      planId: "plan_1",
      workoutId,
      contentRevision: 6,
      planRevision: 11,
      updatedAt: "2026-08-18T12:01:00.000Z",
      workout: buildWorkout({
        id: workoutId,
        name: payload.workout.name,
        reps: getPayloadReps(payload),
        contentRevision: 6,
      }),
    }));
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(response));
    act(() => currentContext.updateSet("workout_1", "workout_1_block", 0, { reps: 80 }));

    await advanceAutosave();

    const [cycleId, planId, workoutId, payload] = saveCycleWorkoutContent.mock.calls[0];
    expect({ cycleId, planId, workoutId }).toEqual({
      cycleId: "cycle_1",
      planId: "plan_1",
      workoutId: "workout_1",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "allowCrossDayDraft",
      "contentRevision",
      "timezone",
      "workout",
    ]);
    expect(payload).not.toHaveProperty("weeks");
    expect(payload).not.toHaveProperty("revision");
    expect(payload.workout.id).toBe("workout_1");
    expect(updateCycleDraft).not.toHaveBeenCalled();
  });
});
