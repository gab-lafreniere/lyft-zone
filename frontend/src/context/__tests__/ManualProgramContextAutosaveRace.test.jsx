import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../ManualProgramContext";
import { openOrCreateWeeklyPlanEditDraft, updateWeeklyPlanDraft } from "../../services/api";

jest.mock("../../services/api", () => ({
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  updateWeeklyPlanDraft: jest.fn(),
}));

// Phase 1A regression coverage: the Weekly Plan builder's autosave used to
// have no in-flight guard at all, so two edits made close together could
// dispatch two overlapping PATCH requests, and whichever transaction
// committed last silently won -- regardless of which was sent first. This
// suite proves the corrected invariant: after Phase 1A, a second save is
// never sent while a first is still unresolved; it is queued and re-dispatched
// from the freshest snapshot once the first settles.

function buildResponse({
  weeklyPlanParentId = "weekly_parent_1",
  weeklyPlanVersionId = "weekly_version_1",
  reps = 8,
  updatedAt = "2026-07-21T12:00:00.000Z",
} = {}) {
  return {
    weeklyPlanParentId,
    weeklyPlanVersionId,
    status: "DRAFT",
    source: "MANUAL",
    updatedAt,
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
              sets: [{ id: "set_1", reps, rpe: 2 }],
              notes: "",
            },
          ],
        },
      ],
    },
  };
}

let currentContext;

function ContextProbe() {
  currentContext = useManualProgram();
  const reps = currentContext.programDraft.workouts?.[0]?.blocks?.[0]?.sets?.[0]?.reps;

  return (
    <>
      <div data-testid="save-state">{currentContext.draftMetadata.saveState}</div>
      <div data-testid="reps">{String(reps)}</div>
      <div data-testid="program-name">{currentContext.programDraft.programName}</div>
      <div data-testid="parent-id">{String(currentContext.draftMetadata.weeklyPlanParentId)}</div>
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

/**
 * Wraps updateWeeklyPlanDraft with a controllable, trackable mock: each call
 * returns a deferred promise the test resolves explicitly, and the mock
 * tracks the maximum number of simultaneously-unresolved calls observed.
 */
function createTrackedSaveMock() {
  const deferreds = [];
  let activeCount = 0;
  let maxActiveCount = 0;

  updateWeeklyPlanDraft.mockImplementation(() => {
    activeCount += 1;
    maxActiveCount = Math.max(maxActiveCount, activeCount);

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = (value) => {
        activeCount -= 1;
        res(value);
      };
      reject = (error) => {
        activeCount -= 1;
        rej(error);
      };
    });

    deferreds.push({ promise, resolve, reject });
    return promise;
  });

  return {
    deferreds,
    getMaxActiveCount: () => maxActiveCount,
    getActiveCount: () => activeCount,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ManualProgramProvider autosave race (Phase 1A)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateWeeklyPlanDraft.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("(a) a second edit made while a save is in flight is queued, not sent concurrently, and the persisted result reflects it", async () => {
    const tracked = createTrackedSaveMock();
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));

    // Edit A: 8 -> 10.
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 10 }));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(tracked.getActiveCount()).toBe(1);

    // Edit B, made while save A is still unresolved: 10 -> 12.
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 12 }));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });

    // The critical assertion: B's own debounce firing must NOT dispatch a
    // second concurrent PATCH. Only save A's request may be in flight.
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(tracked.getActiveCount()).toBe(1);

    // Settle save A. This should trigger the coalesced follow-up (save B),
    // built from the freshest local snapshot (reps=12), automatically.
    await act(async () => {
      tracked.deferreds[0].resolve(buildResponse({ reps: 10, updatedAt: "2026-07-21T12:01:00.000Z" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(2);
    const secondCallPayload = updateWeeklyPlanDraft.mock.calls[1][2];
    expect(secondCallPayload.workouts[0].blocks[0].exercises[0].setTemplates[0].targetReps).toBe(12);

    // Settle save B.
    await act(async () => {
      tracked.deferreds[1].resolve(buildResponse({ reps: 12, updatedAt: "2026-07-21T12:02:00.000Z" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("reps")).toHaveTextContent("12");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");

    // No point in this whole sequence may two saves have been unresolved at
    // the same time.
    expect(tracked.getMaxActiveCount()).toBe(1);
  });

  test("(b) three rapid edits within one debounce window coalesce into a single in-flight request", async () => {
    const tracked = createTrackedSaveMock();
    updateWeeklyPlanDraft.mockImplementation(async (...args) => {
      tracked.deferreds.length; // no-op to keep lint happy about unused var pattern
      return buildResponse({ reps: args[2].workouts[0].blocks[0].exercises[0].setTemplates[0].targetReps });
    });
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 9 }));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 10 }));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 11 }));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(
      updateWeeklyPlanDraft.mock.calls[0][2].workouts[0].blocks[0].exercises[0].setTemplates[0]
        .targetReps
    ).toBe(11);
  });

  test("(c) a hydrate for the same identity while local state is dirty is dropped", async () => {
    updateWeeklyPlanDraft.mockImplementation(async () => buildResponse({ reps: 999 }));
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 50 }));

    expect(screen.getByTestId("save-state")).toHaveTextContent("dirty");
    expect(screen.getByTestId("reps")).toHaveTextContent("50");

    // A redundant hydrate for the SAME document arrives while local state is
    // dirty and unsaved -- it must not overwrite the in-progress local edit.
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({ reps: 8, updatedAt: "2026-07-21T13:00:00.000Z" })
      )
    );

    expect(screen.getByTestId("reps")).toHaveTextContent("50");
    expect(screen.getByTestId("save-state")).toHaveTextContent("dirty");
  });

  test("(d) a hydrate for a different identity is applied", async () => {
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    expect(screen.getByTestId("parent-id")).toHaveTextContent("weekly_parent_1");
    expect(screen.getByTestId("reps")).toHaveTextContent("8");

    // A real caller declares its target before dispatching the fetch that
    // eventually resolves into this hydrate call (plan §D hardening).
    act(() =>
      currentContext.beginHydrationTarget({
        weeklyPlanParentId: "weekly_parent_2",
        weeklyPlanVersionId: null,
      })
    );
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({
          weeklyPlanParentId: "weekly_parent_2",
          weeklyPlanVersionId: "weekly_version_2",
          reps: 20,
        })
      )
    );

    expect(screen.getByTestId("parent-id")).toHaveTextContent("weekly_parent_2");
    expect(screen.getByTestId("reps")).toHaveTextContent("20");
  });

  test("a rejected save still attempts a coalesced follow-up built from the freshest snapshot", async () => {
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));

    let rejectFirst;
    updateWeeklyPlanDraft.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 10 }));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 11 }));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);

    updateWeeklyPlanDraft.mockImplementationOnce(async () => buildResponse({ reps: 11 }));

    await act(async () => {
      rejectFirst(Object.assign(new Error("network error"), { code: "NETWORK_ERROR" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(2);
    expect(
      updateWeeklyPlanDraft.mock.calls[1][2].workouts[0].blocks[0].exercises[0].setTemplates[0]
        .targetReps
    ).toBe(11);
  });
});

// Phase 2: DRAFT_REVISION_CONFLICT must never silently discard local content --
// deliberately NOT the same recovery path as DRAFT_EXPIRED (which is cycle-only anyway).
describe("ManualProgramProvider revision conflict (Phase 2)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateWeeklyPlanDraft.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function conflictError() {
    return Object.assign(new Error("This draft was updated elsewhere."), {
      code: "DRAFT_REVISION_CONFLICT",
      status: 409,
    });
  }

  test("preserves local content untouched on conflict and does not call hydrate/openOrCreateWeeklyPlanEditDraft", async () => {
    updateWeeklyPlanDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 42 }));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
    // The edit the user actually made is still exactly what's on screen --
    // nothing was reverted or overwritten by the rejected response.
    expect(screen.getByTestId("reps")).toHaveTextContent("42");
    expect(openOrCreateWeeklyPlanEditDraft).not.toHaveBeenCalled();
  });

  test("autosave suspends while saveState is conflict -- further edits and elapsed time never fire another PATCH", async () => {
    updateWeeklyPlanDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 42 }));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);

    // Further edits while conflicted must not re-arm autosave.
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 43 }));
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(updateWeeklyPlanDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
    expect(screen.getByTestId("reps")).toHaveTextContent("43");
  });

  test("reloadLatestAfterConflict() is the only path back to saved, and it discards local edits by calling hydrateProgramDraft", async () => {
    updateWeeklyPlanDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 42 }));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");

    openOrCreateWeeklyPlanEditDraft.mockResolvedValue(
      buildResponse({ reps: 99, updatedAt: "2026-07-21T13:00:00.000Z" })
    );

    await act(async () => {
      await currentContext.reloadLatestAfterConflict();
    });

    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(1);
    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledWith("weekly_parent_1");
    // The local edit (42) is gone -- the server's fresh value (99) won instead,
    // because the user explicitly confirmed the discard-and-reload.
    expect(screen.getByTestId("reps")).toHaveTextContent("99");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
  });

  test("DRAFT_EXPIRED-style behavior is irrelevant here -- a generic error still uses the plain error path, not conflict", async () => {
    updateWeeklyPlanDraft.mockRejectedValue(new Error("network down"));
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 42 }));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
  });
});

// Hardening: the audit against the accepted blueprint found that no caller
// ever declared a hydration target ahead of dispatching its fetch --
// hydrateProgramDraft self-declared its own target from whatever response
// arrived, which made the cross-document mismatch-drop branch structurally
// unreachable. beginHydrationTarget() closes that gap: callers (ProgramDetails.jsx's
// open-draft click) now declare the weekly plan they're requesting
// synchronously, before the fetch starts, so a late response for a
// superseded target is dropped instead of silently applying.
describe("ManualProgramProvider proactive target-identity declaration (hardening)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateWeeklyPlanDraft.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("loaded A, request B, request C before B resolves: late response B is dropped, response C is applied", async () => {
    renderProvider();

    // loaded A
    act(() =>
      currentContext.beginHydrationTarget({
        weeklyPlanParentId: "weekly_parent_a",
        weeklyPlanVersionId: null,
      })
    );
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({
          weeklyPlanParentId: "weekly_parent_a",
          weeklyPlanVersionId: "weekly_version_a",
          reps: 8,
        })
      )
    );
    expect(screen.getByTestId("parent-id")).toHaveTextContent("weekly_parent_a");
    expect(screen.getByTestId("reps")).toHaveTextContent("8");

    const programDraftBeforeRace = currentContext.programDraft;
    const draftMetadataBeforeRace = currentContext.draftMetadata;

    // request B
    act(() =>
      currentContext.beginHydrationTarget({
        weeklyPlanParentId: "weekly_parent_b",
        weeklyPlanVersionId: null,
      })
    );
    // request C, dispatched before B has resolved
    act(() =>
      currentContext.beginHydrationTarget({
        weeklyPlanParentId: "weekly_parent_c",
        weeklyPlanVersionId: null,
      })
    );

    // B's response arrives late (after C was already requested).
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({
          weeklyPlanParentId: "weekly_parent_b",
          weeklyPlanVersionId: "weekly_version_b",
          reps: 99,
        })
      )
    );

    // B must be dropped: on-screen identity/content and metadata are
    // byte-for-byte what they were before the race -- not partially applied,
    // not silently mutated.
    expect(screen.getByTestId("parent-id")).toHaveTextContent("weekly_parent_a");
    expect(screen.getByTestId("reps")).toHaveTextContent("8");
    expect(currentContext.programDraft).toEqual(programDraftBeforeRace);
    expect(currentContext.draftMetadata).toEqual(draftMetadataBeforeRace);

    // C's response arrives and is applied -- it is still the declared target.
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({
          weeklyPlanParentId: "weekly_parent_c",
          weeklyPlanVersionId: "weekly_version_c",
          reps: 42,
        })
      )
    );

    expect(screen.getByTestId("parent-id")).toHaveTextContent("weekly_parent_c");
    expect(screen.getByTestId("reps")).toHaveTextContent("42");
  });
});
