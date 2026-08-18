import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MultiWeekProgramProvider,
  useMultiWeekProgram,
} from "../MultiWeekProgramContext";
import { openOrCreateCycleEditDraft, updateCycleDraft } from "../../services/api";

jest.mock("../../services/api", () => ({
  openOrCreateCycleEditDraft: jest.fn(),
  updateCycleDraft: jest.fn(),
}));

// Phase 1B: this is the direct regression test for the live-observed,
// previously-reproduced bug -- navigating away from a workout mid-save and
// back used to silently revert on-screen content and, if the user kept
// editing, permanently lose the in-flight edit. The fix is the
// loadedIdentityRef/targetIdentityRef pair plus the local-authority guard in
// hydrateProgramDraft, exercised here directly against the real context (not
// a hand-written approximation).

function buildResponse({
  cycleId = "cycle_1",
  planId = "plan_1",
  reps = 8,
  updatedAt = "2026-08-16T12:00:00.000Z",
  blocks = null,
} = {}) {
  return {
    cycleId,
    planId,
    status: "DRAFT",
    updatedAt,
    cycle: {
      id: cycleId,
      name: "Six day hypertrophy",
      startDate: "2026-09-07",
      endDate: "2026-10-18",
      durationWeeks: 1,
    },
    draftTimeline: { startDate: "2026-09-07", endDate: "2026-10-18", durationWeeks: 1 },
    draftState: { state: "fresh" },
    builderPayload: {
      programName: "Six day hypertrophy",
      sessionsPerWeek: 1,
      programLength: 1,
      selectedWeek: 1,
      isMultiWeek: true,
      weeks: [
        {
          id: "week_1",
          weekNumber: 1,
          orderIndex: 1,
          label: "Week 1",
          notes: "",
          workouts: [
            {
              id: "workout_1",
              name: "Day 1",
              orderIndex: 1,
              scheduledDay: null,
              blocks: blocks || [
                {
                  id: "block_1",
                  type: "single",
                  exercise: "Bench Press",
                  exerciseId: "exr_bench_press",
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
      ],
    },
  };
}

let currentContext;

function ContextProbe() {
  currentContext = useMultiWeekProgram();
  const reps = currentContext.programDraft.workouts?.[0]?.blocks?.[0]?.sets?.[0]?.reps;

  return (
    <>
      <div data-testid="reps">{String(reps)}</div>
      <div data-testid="save-state">{currentContext.draftMetadata.saveState}</div>
      <div data-testid="cycle-id">{String(currentContext.draftMetadata.cycleId)}</div>
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MultiWeekProgramProvider navigation/hydration guard (Phase 1B)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateCycleDraft.mockReset();
    openOrCreateCycleEditDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("a same-cycle hydrate while a save is in flight is dropped -- the reproduced navigation-revert bug no longer occurs", async () => {
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));

    // Edit A + B, made inside the workout editor: reps 8 -> 10 -> 12.
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 10 }));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 12 }));

    const saveAB = deferred();
    updateCycleDraft.mockReturnValueOnce(saveAB.promise);
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reps")).toHaveTextContent("12");

    // User navigates back to the week/program view. ManualBuilderMulti's
    // mount effect (Phase 1B) now skips the fetch entirely when already
    // loaded -- but this test exercises the defense-in-depth response-time
    // guard directly: even if a stale "open draft" response somehow arrived
    // for the same, already-loaded, currently-dirty/saving cycle, it must be
    // dropped rather than reverting the screen.
    act(() =>
      currentContext.hydrateProgramDraft(buildResponse({ reps: 8, updatedAt: "2026-08-16T12:05:00.000Z" }))
    );

    expect(screen.getByTestId("reps")).toHaveTextContent("12");

    await act(async () => {
      saveAB.resolve(buildResponse({ reps: 12, updatedAt: "2026-08-16T12:06:00.000Z" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("reps")).toHaveTextContent("12");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
  });

  test("a hydrate for a different cycle is applied even while the previous cycle was dirty", async () => {
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(buildResponse({ cycleId: "cycle_1", reps: 8 })));
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 50 }));

    expect(screen.getByTestId("save-state")).toHaveTextContent("dirty");

    // A real caller declares its target before dispatching the fetch that
    // eventually resolves into this hydrate call (plan §D hardening).
    act(() => currentContext.beginHydrationTarget({ cycleId: "cycle_2", planId: null }));
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({ cycleId: "cycle_2", planId: "plan_2", reps: 20 })
      )
    );

    expect(screen.getByTestId("cycle-id")).toHaveTextContent("cycle_2");
    expect(screen.getByTestId("reps")).toHaveTextContent("20");
  });

  test("a clamped no-op superset count does not add round-count edit intent", () => {
    const createSuperset = (id, count) => ({
      id,
      type: "superset",
      sets: count,
      rest: "120s",
      exercises: ["A1", "A2"].map((label) => ({
        label,
        name: label === "A1" ? "Incline Press" : "Cable Row",
        exerciseId: label === "A1" ? "exercise_1" : "exercise_2",
        tempo: "3010",
        sets: Array.from({ length: count }, () => ({ reps: 10, rpe: 2 })),
        notes: "",
      })),
    });

    renderProvider();
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({
          blocks: [
            createSuperset("superset_floor", 1),
            createSuperset("superset_ceiling", 10),
          ],
        })
      )
    );
    act(() => {
      currentContext.updateSupersetSetCount("workout_1", "superset_floor", 0);
      currentContext.updateSupersetSetCount("workout_1", "superset_ceiling", 11);
    });

    const [floorBlock, ceilingBlock] = currentContext.programDraft.workouts[0].blocks;
    expect(floorBlock.sets).toBe(1);
    expect(floorBlock.editIntent).toBeUndefined();
    expect(ceilingBlock.sets).toBe(10);
    expect(ceilingBlock.editIntent).toBeUndefined();
  });

  test("a rejected save still attempts a coalesced follow-up, and awaiting persistDraftNow() resolves only once the follow-up settles", async () => {
    renderProvider();
    act(() => currentContext.hydrateProgramDraft(buildResponse({ reps: 8 })));

    const firstAttempt = deferred();
    updateCycleDraft.mockReturnValueOnce(firstAttempt.promise);

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 10 }));

    let awaitedPromise;
    let awaitedResolved = false;
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);

    // A second edit arrives while the first save is still in flight -- it
    // must queue, not fire a second concurrent request.
    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 11 }));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);

    const secondAttempt = deferred();
    updateCycleDraft.mockReturnValueOnce(secondAttempt.promise);

    awaitedPromise = currentContext.persistDraftNow().then(() => {
      awaitedResolved = true;
    });

    // Settling the first (in-flight) save should trigger the queued
    // follow-up automatically; the awaited promise from the explicit
    // persistDraftNow() call above must not resolve until that follow-up
    // (which is what's actually still in flight) also settles.
    await act(async () => {
      firstAttempt.resolve(buildResponse({ reps: 10, updatedAt: "2026-08-16T12:01:00.000Z" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(awaitedResolved).toBe(false);
    expect(updateCycleDraft).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondAttempt.resolve(buildResponse({ reps: 11, updatedAt: "2026-08-16T12:02:00.000Z" }));
      await awaitedPromise;
    });

    expect(awaitedResolved).toBe(true);
    expect(screen.getByTestId("reps")).toHaveTextContent("11");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
  });
});

// Hardening: the audit against the accepted blueprint found that no caller
// ever declared a hydration target ahead of dispatching its fetch --
// hydrateProgramDraft self-declared its own target from whatever response
// arrived, which made the cross-document mismatch-drop branch structurally
// unreachable. beginHydrationTarget() closes that gap: callers (mount
// effects, click handlers) now declare the cycle they're requesting
// synchronously, before the fetch starts, so a late response for a
// superseded target is dropped instead of silently applying.
describe("MultiWeekProgramProvider proactive target-identity declaration (hardening)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateCycleDraft.mockReset();
    openOrCreateCycleEditDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("loaded A, request B, request C before B resolves: late response B is dropped, response C is applied", async () => {
    renderProvider();

    // loaded A
    act(() => currentContext.beginHydrationTarget({ cycleId: "cycle_a", planId: null }));
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({ cycleId: "cycle_a", planId: "plan_a", reps: 8 })
      )
    );
    expect(screen.getByTestId("cycle-id")).toHaveTextContent("cycle_a");
    expect(screen.getByTestId("reps")).toHaveTextContent("8");

    const programDraftBeforeRace = currentContext.programDraft;
    const draftMetadataBeforeRace = currentContext.draftMetadata;

    // request B
    act(() => currentContext.beginHydrationTarget({ cycleId: "cycle_b", planId: null }));
    // request C, dispatched before B has resolved
    act(() => currentContext.beginHydrationTarget({ cycleId: "cycle_c", planId: null }));

    // B's response arrives late (after C was already requested).
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({ cycleId: "cycle_b", planId: "plan_b", reps: 99 })
      )
    );

    // B must be dropped: on-screen identity/content and metadata are
    // byte-for-byte what they were before the race -- not partially applied,
    // not silently mutated.
    expect(screen.getByTestId("cycle-id")).toHaveTextContent("cycle_a");
    expect(screen.getByTestId("reps")).toHaveTextContent("8");
    expect(currentContext.programDraft).toEqual(programDraftBeforeRace);
    expect(currentContext.draftMetadata).toEqual(draftMetadataBeforeRace);

    // C's response arrives and is applied -- it is still the declared target.
    act(() =>
      currentContext.hydrateProgramDraft(
        buildResponse({ cycleId: "cycle_c", planId: "plan_c", reps: 42 })
      )
    );

    expect(screen.getByTestId("cycle-id")).toHaveTextContent("cycle_c");
    expect(screen.getByTestId("reps")).toHaveTextContent("42");
  });
});
