import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MultiWeekProgramProvider,
  useMultiWeekProgram,
} from "../MultiWeekProgramContext";
import { updateCycleDraft } from "../../services/api";

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
