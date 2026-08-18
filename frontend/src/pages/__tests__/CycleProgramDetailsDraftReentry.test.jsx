import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useMultiWeekProgram } from "../../context/MultiWeekProgramContext";
import {
  getCycleDetails,
  openOrCreateCycleEditDraft,
} from "../../services/api";
import CycleProgramDetails from "../CycleProgramDetails";

jest.mock("../../context/MultiWeekProgramContext", () => ({
  useMultiWeekProgram: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  deleteCycle: jest.fn(),
  getCycleDetails: jest.fn(),
  openOrCreateCycleEditDraft: jest.fn(),
}));

function cycleDetails(temporalStatus = "upcoming") {
  return {
    cycle: {
      id: "cycle_1",
      name: "Cycle One",
      startDate: "2026-09-01",
      endDate: "2026-10-01",
      durationWeeks: 4,
      temporalStatus,
    },
    draftPlanId: null,
    builderPayload: { weeks: [] },
  };
}

function contextValue(overrides = {}) {
  return {
    draftMetadata: {
      cycleId: "cycle_1",
      cyclePlanId: "plan_1",
      status: "draft",
      temporalStatus: "upcoming",
      loadedFromBackend: true,
      ...overrides,
    },
    beginHydrationTarget: jest.fn().mockResolvedValue(null),
    hydrateProgramDraft: jest.fn(),
  };
}

function renderDetails(context, temporalStatus = "upcoming") {
  useMultiWeekProgram.mockReturnValue(context);
  getCycleDetails.mockResolvedValue(cycleDetails(temporalStatus));
  return render(
    <MemoryRouter initialEntries={["/program/cycles/cycle_1"]}>
      <Routes>
        <Route path="/program/cycles/:cycleId" element={<CycleProgramDetails />} />
        <Route path="/program/cycles/:cycleId/builder" element={<div>cycle builder</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("CycleProgramDetails editable-draft reuse", () => {
  beforeEach(() => {
    getCycleDetails.mockReset();
    openOrCreateCycleEditDraft.mockReset().mockResolvedValue({
      cycleId: "cycle_1",
      planId: "new_draft_plan",
      status: "DRAFT",
      temporalStatus: "UPCOMING",
      builderPayload: { weeks: [] },
    });
  });

  test.each(["upcoming", "active"])(
    "matching %s published state re-opens and hydrates a new editable draft",
    async (temporalStatus) => {
      const context = contextValue({
        cyclePlanId: null,
        status: "published",
        temporalStatus,
      });
      renderDetails(context, temporalStatus);

      fireEvent.click(await screen.findByRole("button", { name: "Edit program" }));

      await waitFor(() => expect(openOrCreateCycleEditDraft).toHaveBeenCalledWith("cycle_1"));
      expect(context.beginHydrationTarget).toHaveBeenCalledWith({
        cycleId: "cycle_1",
        planId: null,
      });
      expect(context.hydrateProgramDraft).toHaveBeenCalledWith(
        expect.objectContaining({ planId: "new_draft_plan", status: "DRAFT" })
      );
      expect(await screen.findByText("cycle builder")).toBeInTheDocument();
    }
  );

  test("same active editable draft navigates immediately without re-opening", async () => {
    const context = contextValue({ temporalStatus: "active" });
    renderDetails(context, "active");

    fireEvent.click(await screen.findByRole("button", { name: "Edit program" }));

    expect(await screen.findByText("cycle builder")).toBeInTheDocument();
    expect(openOrCreateCycleEditDraft).not.toHaveBeenCalled();
    expect(context.hydrateProgramDraft).not.toHaveBeenCalled();
  });

  test("full-page state with no loaded draft opens one", async () => {
    const context = contextValue({
      cycleId: null,
      cyclePlanId: null,
      loadedFromBackend: false,
    });
    renderDetails(context);

    fireEvent.click(await screen.findByRole("button", { name: "Edit program" }));

    await waitFor(() => expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1));
    expect(context.hydrateProgramDraft).toHaveBeenCalledTimes(1);
  });
});
