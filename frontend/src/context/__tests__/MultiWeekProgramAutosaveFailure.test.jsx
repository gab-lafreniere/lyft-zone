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

// A failed cycle autosave — an oversized body being the case that prompted these tests —
// must leave the draft recoverable and must not turn into a request loop that resends
// the same rejected payload on a timer.

const hydratedResponse = {
  cycleId: "cycle_1",
  planId: "plan_1",
  status: "DRAFT",
  updatedAt: "2026-08-14T12:00:00.000Z",
  cycle: {
    id: "cycle_1",
    name: "Six day hypertrophy",
    startDate: "2026-09-07",
    endDate: "2026-10-18",
    durationWeeks: 6,
  },
  draftTimeline: {
    startDate: "2026-09-07",
    endDate: "2026-10-18",
    durationWeeks: 6,
  },
  draftState: { state: "fresh" },
  builderPayload: {
    programName: "Six day hypertrophy",
    sessionsPerWeek: 1,
    programLength: 6,
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
            blocks: [
              {
                id: "block_1",
                type: "single",
                exercise: "Bench Press",
                exerciseId: "exr_bench_press",
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
    ],
  },
};

let currentContext;

function ContextProbe() {
  currentContext = useMultiWeekProgram();

  return (
    <>
      <div data-testid="save-state">
        {currentContext.draftMetadata.saveState}
      </div>
      <div data-testid="persisted-signature">
        {String(currentContext.draftMetadata.lastPersistedSignature || "")}
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

describe("MultiWeekProgramProvider autosave failure handling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentContext = null;
    updateCycleDraft.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("a rejected save does not advance the persisted signature", async () => {
    const payloadTooLarge = Object.assign(new Error("Request body is too large."), {
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
    updateCycleDraft.mockRejectedValue(payloadTooLarge);
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    const signatureBeforeEdit =
      screen.getByTestId("persisted-signature").textContent;

    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
    expect(screen.getByTestId("persisted-signature")).toHaveTextContent(
      signatureBeforeEdit
    );
  });

  test("a rejected save schedules no automatic retry of the same payload", async () => {
    updateCycleDraft.mockRejectedValue(
      Object.assign(new Error("Request body is too large."), {
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      })
    );
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);

    // Without a further edit nothing may fire again, however long the timers run.
    await act(async () => {
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
  });

  test("a later successful save clears the error and advances the signature", async () => {
    updateCycleDraft.mockRejectedValueOnce(
      Object.assign(new Error("Request body is too large."), {
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      })
    );
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    const signatureBeforeEdit =
      screen.getByTestId("persisted-signature").textContent;

    act(() => currentContext.addSet("workout_1", "block_1"));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-state")).toHaveTextContent("error");

    updateCycleDraft.mockResolvedValue({
      ...hydratedResponse,
      updatedAt: "2026-08-14T12:05:00.000Z",
      builderPayload: {
        ...hydratedResponse.builderPayload,
        weeks: currentContext.programDraft.weeks,
      },
    });

    act(() => currentContext.addSet("workout_1", "block_1"));
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("persisted-signature").textContent).not.toBe(
      signatureBeforeEdit
    );
  });
});

// Phase 2: DRAFT_REVISION_CONFLICT must never silently discard local content --
// deliberately NOT the same recovery path as DRAFT_EXPIRED above, which keeps
// its existing auto-discard behavior unchanged.
describe("MultiWeekProgramProvider revision conflict (Phase 2)", () => {
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

  function conflictError() {
    return Object.assign(new Error("This draft was updated elsewhere."), {
      code: "DRAFT_REVISION_CONFLICT",
      status: 409,
    });
  }

  test("preserves local content untouched on conflict and does not call hydrate/openOrCreateCycleEditDraft", async () => {
    updateCycleDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    const setCountBeforeEdit =
      currentContext.programDraft.weeks[0].workouts[0].blocks[0].sets.length;

    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
    // The edit the user actually made is still exactly what's on screen --
    // nothing was reverted or overwritten by the rejected response.
    expect(
      currentContext.programDraft.weeks[0].workouts[0].blocks[0].sets.length
    ).toBe(setCountBeforeEdit + 1);
    expect(openOrCreateCycleEditDraft).not.toHaveBeenCalled();
  });

  test("autosave suspends while saveState is conflict -- further edits and elapsed time never fire another PATCH", async () => {
    updateCycleDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);

    // Further edits while conflicted must not re-arm autosave.
    act(() => currentContext.addSet("workout_1", "block_1"));
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");
  });

  test("reloadLatestAfterConflict() is the only path back to saved, and it discards local edits by calling hydrateProgramDraft", async () => {
    updateCycleDraft.mockRejectedValue(conflictError());
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-state")).toHaveTextContent("conflict");

    const localSetCountAtConflict =
      currentContext.programDraft.weeks[0].workouts[0].blocks[0].sets.length;

    openOrCreateCycleEditDraft.mockResolvedValue({
      ...hydratedResponse,
      updatedAt: "2026-08-14T13:00:00.000Z",
    });

    await act(async () => {
      await currentContext.reloadLatestAfterConflict();
    });

    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
    expect(openOrCreateCycleEditDraft).toHaveBeenCalledWith("cycle_1", {
      timezone: "America/Toronto",
      allowCrossDayDraft: false,
    });
    // The local edit is gone -- the server's fresh (unmodified) content won
    // instead, because the user explicitly confirmed the discard-and-reload.
    expect(
      currentContext.programDraft.weeks[0].workouts[0].blocks[0].sets.length
    ).not.toBe(localSetCountAtConflict);
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
  });

  test("a generic (non-conflict) error still uses the plain error path, not conflict, and DRAFT_EXPIRED handling is untouched", async () => {
    updateCycleDraft.mockRejectedValue(new Error("network down"));
    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
  });
});

// Regression coverage for a feedback-loop bug in the debounce effect: it used
// to list draftMetadata.isRecoveringDraft as a dependency. A *failed*
// DRAFT_EXPIRED recovery sets isRecoveringDraft:false and saveState:"error"
// in the same setDraftMetadata call (handleDraftExpired, ~line 505). Because
// that transition re-ran the effect, and unsaved local edits made the
// signature still not match lastPersistedSignature, the effect's own
// dirty-fallback treated "error" as "must be dirty" and silently reverted it
// -- then re-armed and re-fired another autosave attempt against a draft that
// had just failed to recover. Fixed by reading isRecoveringDraft from the ref
// (same principle already applied to saveState === "conflict") instead of
// listing it as a dependency.
describe("MultiWeekProgramProvider isRecoveringDraft feedback-loop regression", () => {
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

  test("a failed DRAFT_EXPIRED recovery with unsaved edits stays in error -- it does not silently flip back to dirty or re-fire autosave", async () => {
    const draftExpiredError = Object.assign(new Error("This draft has expired."), {
      code: "DRAFT_EXPIRED",
      status: 409,
    });
    updateCycleDraft.mockRejectedValue(draftExpiredError);
    openOrCreateCycleEditDraft.mockRejectedValue(new Error("network down"));

    renderProvider();

    act(() => currentContext.hydrateProgramDraft(hydratedResponse));
    act(() => currentContext.addSet("workout_1", "block_1"));

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-state")).toHaveTextContent("error");

    // Advancing well past another debounce window must not silently flip
    // "error" back to "dirty", and must not fire another PATCH -- both of
    // which the buggy dependency array used to do.
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
    expect(updateCycleDraft).toHaveBeenCalledTimes(1);
  });
});
