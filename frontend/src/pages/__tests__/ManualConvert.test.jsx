import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ManualConvert from "../ManualConvert";
import { useManualProgram } from "../../context/ManualProgramContext";
import { useMultiWeekProgram } from "../../context/MultiWeekProgramContext";
import {
  createCycleFromWeeklyPlan,
  getCycleStartAvailability,
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
}));

function manualContext(startDate = "2026-08-24") {
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
    },
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

function renderConvert(startDate = "2026-08-24") {
  const cycleContext = {
    beginHydrationTarget: jest.fn().mockResolvedValue(null),
    hydrateProgramDraft: jest.fn(),
  };
  useManualProgram.mockReturnValue(manualContext(startDate));
  useMultiWeekProgram.mockReturnValue(cycleContext);
  render(<ManualConvert />);
  return cycleContext;
}

async function waitForAvailability() {
  await waitFor(() =>
    expect(screen.queryByText("Checking Cycle availability...")).not.toBeInTheDocument()
  );
}

describe("ManualConvert Cycle start availability", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-18T14:00:00.000Z"));
    mockNavigate.mockReset();
    createCycleFromWeeklyPlan.mockReset();
    getCycleStartAvailability.mockReset();
    installAvailability();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("conflicting weeks are disabled and cannot replace the selection", async () => {
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

  test("Oct 5 is selectable when the backend marks it available", async () => {
    installAvailability((startDate) => !["2026-08-31", "2026-10-05"].includes(startDate));
    renderConvert("2026-08-31");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "Select start week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(getCycleStartAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateStartDates: expect.arrayContaining(["2026-09-07"]),
          durationWeeks: 6,
        })
      )
    );
    await waitForAvailability();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(getCycleStartAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateStartDates: expect.arrayContaining(["2026-10-05"]),
          durationWeeks: 6,
        })
      )
    );
    await waitForAvailability();

    const availableOption = screen.getByRole("button", { name: /Oct 5 to 11/i });
    expect(availableOption).toBeEnabled();
    fireEvent.click(availableOption);
    await waitForAvailability();
    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent(
      "Oct 5, 2026"
    );
  });

  test("changing program length refreshes availability and clears a newly invalid selection", async () => {
    installAvailability((startDate, durationWeeks) =>
      startDate === "2026-10-05" && durationWeeks === 8
    );
    renderConvert("2026-10-05");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: "8 weeks" }));
    await waitFor(() =>
      expect(getCycleStartAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ durationWeeks: 8 })
      )
    );
    expect(
      await screen.findByText(/selected start week overlaps an existing Cycle/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select start week" })).toHaveTextContent("--");
    expect(screen.getByRole("button", { name: /Convert to Multi week/i })).toBeDisabled();
  });

  test("loading and API failure keep unverified dates unavailable", async () => {
    getCycleStartAvailability.mockRejectedValue(new Error("network unavailable"));
    renderConvert("2026-10-05");

    expect(screen.getByRole("button", { name: /Convert to Multi week/i })).toBeDisabled();
    expect(
      await screen.findByText(/Unable to check Cycle availability/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Convert to Multi week/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Select start week" }));
    expect(screen.getByRole("button", { name: /Oct 5 to 11/i })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
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
    const { beginHydrationTarget, hydrateProgramDraft } = renderConvert("2026-10-05");
    await waitForAvailability();

    fireEvent.click(screen.getByRole("button", { name: /Convert to Multi week/i }));

    await waitFor(() => expect(hydrateProgramDraft).toHaveBeenCalledTimes(1));
    expect(createCycleFromWeeklyPlan).toHaveBeenCalledTimes(1);
    expect(beginHydrationTarget).toHaveBeenCalledWith({
      cycleId: "cycle_new",
      planId: null,
    });
    expect(hydrateProgramDraft).toHaveBeenCalledWith(response);
    expect(mockNavigate).toHaveBeenCalledWith("/program/cycles/cycle_new/builder");
  });
});
