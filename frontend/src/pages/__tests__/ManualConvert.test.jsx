import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ManualConvert from "../ManualConvert";
import { useManualProgram } from "../../context/ManualProgramContext";
import { useMultiWeekProgram } from "../../context/MultiWeekProgramContext";
import {
  createCycleFromWeeklyPlan,
  getCycleStartAvailability,
  openOrCreateWeeklyPlanEditDraft,
} from "../../services/api";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

jest.mock("../../context/ManualProgramContext", () => ({
  useManualProgram: jest.fn(),
}));

jest.mock("../../context/MultiWeekProgramContext", () => ({
  useMultiWeekProgram: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  createCycleFromWeeklyPlan: jest.fn(),
  getCycleStartAvailability: jest.fn(),
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
}));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createManualContext(startDate = null, overrides = {}) {
  return {
    programDraft: {
      programName: "Converted Program",
      sessionsPerWeek: 1,
      programLength: 6,
      startDate,
      workouts: [{
        id: "workout_1",
        name: "Workout One",
        orderIndex: 1,
        blocks: [],
      }],
    },
    draftMetadata: {
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: null,
      status: "published",
    },
    beginHydrationTarget: jest.fn().mockResolvedValue(null),
    hydrateProgramDraft: jest.fn(),
    ...overrides,
  };
}

function availabilityResponse(candidateStartDates, durationWeeks, hasConflict) {
  return {
    durationWeeks,
    candidates: candidateStartDates.map((startDate) => ({
      startDate,
      endDate: startDate,
      hasConflict: hasConflict(startDate, durationWeeks),
      conflicts: [],
    })),
  };
}

function installAvailability(hasConflict = () => false) {
  getCycleStartAvailability.mockImplementation(
    async ({ candidateStartDates, durationWeeks }) =>
      availabilityResponse(candidateStartDates, durationWeeks, hasConflict)
  );
}

function editableWeeklyDraft() {
  return {
    weeklyPlanParentId: "weekly_parent_1",
    weeklyPlanVersionId: "weekly_draft_2",
    status: "DRAFT",
    source: "MANUAL",
    revision: 1,
    builderPayload: {
      programName: "Converted Program",
      sessionsPerWeek: 1,
      workouts: [],
    },
  };
}

function renderConvert(startDate = null, manualOverrides = {}) {
  const manualContext = createManualContext(startDate, manualOverrides);
  const cycleContext = {
    beginHydrationTarget: jest.fn().mockResolvedValue(null),
    hydrateProgramDraft: jest.fn(),
  };
  useManualProgram.mockReturnValue(manualContext);
  useMultiWeekProgram.mockReturnValue(cycleContext);
  render(<ManualConvert />);
  return { cycleContext, manualContext };
}

async function waitForAvailability() {
  await waitFor(() =>
    expect(screen.queryByText("Checking Cycle availability...")).not.toBeInTheDocument()
  );
}

describe("ManualConvert earliest Cycle start availability", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-18T14:00:00.000Z"));
    mockNavigate.mockReset();
    createCycleFromWeeklyPlan.mockReset();
    getCycleStartAvailability.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset().mockResolvedValue(editableWeeklyDraft());
    installAvailability();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("automatically selects Oct 5 for a six-week Cycle blocked through Oct 4", async () => {
    installAvailability((startDate) => startDate < "2026-10-05");
    renderConvert();

    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Oct 5, 2026"
    );
    expect(getCycleStartAvailability).toHaveBeenCalledTimes(1);
    expect(getCycleStartAvailability).toHaveBeenCalledWith({
      candidateStartDates: expect.arrayContaining(["2026-10-05"]),
      durationWeeks: 6,
    });
  });

  test("selects the canonical minimum Monday when it is already available", async () => {
    installAvailability();
    renderConvert();

    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Aug 17, 2026"
    );
  });

  test("preserves a current start when the backend still marks it valid", async () => {
    installAvailability((startDate) => startDate !== "2026-09-14");
    renderConvert("2026-09-14");

    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Sep 14, 2026"
    );
  });

  test("duration 6 to 8 preserves the selected start when it remains valid", async () => {
    installAvailability((startDate) => startDate !== "2026-10-05");
    renderConvert("2026-10-05");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "8 weeks" }));
    await waitFor(() =>
      expect(getCycleStartAvailability).toHaveBeenLastCalledWith(
        expect.objectContaining({ durationWeeks: 8 })
      )
    );
    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Oct 5, 2026"
    );
  });

  test("duration 6 to 8 replaces an invalid selection with the new earliest valid Monday", async () => {
    installAvailability((startDate, durationWeeks) =>
      startDate < (durationWeeks === 8 ? "2026-10-19" : "2026-10-05")
    );
    renderConvert("2026-10-05");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "8 weeks" }));
    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Oct 19, 2026"
    );
  });

  test("continues in bounded batches across back-to-back future Cycles", async () => {
    installAvailability((startDate) => startDate < "2026-11-09");
    renderConvert();

    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Nov 9, 2026"
    );
    expect(getCycleStartAvailability).toHaveBeenCalledTimes(2);
    getCycleStartAvailability.mock.calls.forEach(([request]) => {
      expect(request.candidateStartDates.length).toBeLessThanOrEqual(12);
    });
    expect(getCycleStartAvailability.mock.calls[1][0].candidateStartDates[0]).toBe(
      "2026-11-09"
    );
  });

  test("loading and API failure never auto-select or enable an unverified date", async () => {
    getCycleStartAvailability.mockRejectedValue(new Error("network unavailable"));
    renderConvert();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent("--");
    expect(screen.getByRole("button", { name: /Convert to Multi week/i })).toBeDisabled();
    expect(
      await screen.findByText(/Unable to check Cycle availability/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent("--");
    expect(screen.getByRole("button", { name: /Convert to Multi week/i })).toBeDisabled();
  });

  test("Retry restarts the search and selects the earliest verified start without a fetch loop", async () => {
    getCycleStartAvailability
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockImplementation(async ({ candidateStartDates, durationWeeks }) =>
        availabilityResponse(
          candidateStartDates,
          durationWeeks,
          (startDate) => startDate < "2026-10-05"
        )
      );
    renderConvert();
    await screen.findByText(/Unable to check Cycle availability/i);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitForAvailability();

    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Oct 5, 2026"
    );
    expect(getCycleStartAvailability).toHaveBeenCalledTimes(2);
  });

  test("conflicting visible weeks remain disabled and cannot replace a verified selection", async () => {
    installAvailability((startDate) => startDate === "2026-08-24");
    renderConvert("2026-08-31");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "Select start week" }));
    const conflictOption = screen.getByRole("button", { name: /Aug 24 to 30/i });
    expect(conflictOption).toBeDisabled();
    expect(conflictOption).toHaveAttribute("aria-disabled", "true");
    expect(conflictOption).toHaveTextContent("Overlaps an existing Cycle");

    fireEvent.click(conflictOption);
    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Aug 31, 2026"
    );
  });

  test("conversion hydrates the exact published Cycle response before navigation", async () => {
    const response = {
      cycleId: "cycle_new",
      planId: "published_plan",
      publishedPlanId: "published_plan",
      status: "PUBLISHED",
      temporalStatus: "UPCOMING",
      builderPayload: { weeks: [] },
    };
    installAvailability();
    createCycleFromWeeklyPlan.mockResolvedValue(response);
    const { cycleContext } = renderConvert("2026-10-05");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: /Convert to Multi week/i }));

    await waitFor(() => expect(cycleContext.hydrateProgramDraft).toHaveBeenCalledTimes(1));
    expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(1);
    expect(cycleContext.beginHydrationTarget).toHaveBeenCalledWith({
      cycleId: "cycle_new",
      planId: null,
    });
    expect(cycleContext.hydrateProgramDraft).toHaveBeenCalledWith(response);
    expect(mockNavigate).toHaveBeenCalledWith("/program/cycles/cycle_new/builder");
  });
});

describe("ManualConvert safe Back to Weekly Builder", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-18T14:00:00.000Z"));
    mockNavigate.mockReset();
    createCycleFromWeeklyPlan.mockReset();
    getCycleStartAvailability.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset().mockResolvedValue(editableWeeklyDraft());
    installAvailability();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("opens and hydrates a real DRAFT before navigating to the Weekly Builder", async () => {
    const { manualContext } = renderConvert();
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/program/manual-builder"));
    expect(manualContext.beginHydrationTarget).toHaveBeenCalledWith({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: null,
    });
    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledWith("weekly_parent_1");
    expect(manualContext.hydrateProgramDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "DRAFT",
        weeklyPlanVersionId: "weekly_draft_2",
      })
    );
    expect(manualContext.beginHydrationTarget.mock.invocationCallOrder[0]).toBeLessThan(
      openOrCreateWeeklyPlanEditDraft.mock.invocationCallOrder[0]
    );
    expect(openOrCreateWeeklyPlanEditDraft.mock.invocationCallOrder[0]).toBeLessThan(
      manualContext.hydrateProgramDraft.mock.invocationCallOrder[0]
    );
    expect(manualContext.hydrateProgramDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]
    );
  });

  test("an open failure stays on ManualConvert and Retry completes the safe lifecycle", async () => {
    openOrCreateWeeklyPlanEditDraft
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(editableWeeklyDraft());
    renderConvert();
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      await screen.findByText(/Unable to reopen an editable Weekly draft/i)
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith("/program/manual-builder");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/program/manual-builder"));
    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(2);
  });

  test("repeated Back clicks cannot create duplicate open or navigation races", async () => {
    const deferred = createDeferred();
    openOrCreateWeeklyPlanEditDraft.mockReturnValue(deferred.promise);
    renderConvert();
    await waitForAvailability();

    const backButton = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backButton);
    fireEvent.click(backButton);
    await waitFor(() => expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(1));

    await act(async () => {
      deferred.resolve(editableWeeklyDraft());
      await deferred.promise;
    });

    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/program/manual-builder");
  });
});
