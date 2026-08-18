import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useManualProgram } from "../../context/ManualProgramContext";
import {
  getWeeklyPlanById,
  openOrCreateWeeklyPlanEditDraft,
} from "../../services/api";
import ProgramDetails from "../ProgramDetails";

jest.mock("../../context/ManualProgramContext", () => ({
  useManualProgram: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  getWeeklyPlanById: jest.fn(),
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
}));

function weeklyDetails() {
  return {
    weeklyPlanParentId: "weekly_parent_1",
    visibleVersionId: "weekly_published_version",
    name: "Weekly One",
    status: "PUBLISHED",
    source: "MANUAL",
    summary: {
      totalExercises: 0,
      totalWeeklySets: 0,
      averageWorkoutDurationMinutes: 0,
      averageWorkoutTUTMinutes: 0,
      weeklyTotals: {},
    },
    workouts: [],
  };
}

function contextValue(overrides = {}) {
  return {
    draftMetadata: {
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: "weekly_draft_1",
      status: "draft",
      loadedFromBackend: true,
      lastSavedAt: "2020-01-01T00:00:00.000Z",
      ...overrides,
    },
    beginHydrationTarget: jest.fn().mockResolvedValue(null),
    hydrateProgramDraft: jest.fn(),
  };
}

function renderDetails(context) {
  useManualProgram.mockReturnValue(context);
  getWeeklyPlanById.mockResolvedValue(weeklyDetails());
  return render(
    <MemoryRouter initialEntries={["/program/all/weekly_parent_1"]}>
      <Routes>
        <Route path="/program/all/:programId" element={<ProgramDetails />} />
        <Route path="/program/manual-builder" element={<div>weekly builder</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProgramDetails editable-draft reuse", () => {
  beforeEach(() => {
    getWeeklyPlanById.mockReset();
    openOrCreateWeeklyPlanEditDraft.mockReset().mockResolvedValue({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: "weekly_draft_2",
      status: "DRAFT",
      source: "MANUAL",
      builderPayload: { programName: "Weekly One", sessionsPerWeek: 1, workouts: [] },
    });
  });

  test("matching published state opens and hydrates a new editable draft", async () => {
    const context = contextValue({
      weeklyPlanVersionId: null,
      status: "published",
    });
    renderDetails(context);

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit program settings" })
    );

    await waitFor(() =>
      expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledWith("weekly_parent_1")
    );
    expect(context.beginHydrationTarget).toHaveBeenCalledWith({
      weeklyPlanParentId: "weekly_parent_1",
      weeklyPlanVersionId: null,
    });
    expect(context.hydrateProgramDraft).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyPlanVersionId: "weekly_draft_2", status: "DRAFT" }),
      expect.any(Object)
    );
    expect(await screen.findByText("weekly builder")).toBeInTheDocument();
  });

  test("same old editable Weekly draft remains immediate with no expiry re-open", async () => {
    const context = contextValue();
    renderDetails(context);

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit program settings" })
    );

    expect(await screen.findByText("weekly builder")).toBeInTheDocument();
    expect(openOrCreateWeeklyPlanEditDraft).not.toHaveBeenCalled();
    expect(context.hydrateProgramDraft).not.toHaveBeenCalled();
  });

  test("full-page state with no loaded Weekly draft opens one", async () => {
    const context = contextValue({
      weeklyPlanParentId: null,
      weeklyPlanVersionId: null,
      loadedFromBackend: false,
    });
    renderDetails(context);

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit program settings" })
    );

    await waitFor(() => expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(1));
    expect(context.hydrateProgramDraft).toHaveBeenCalledTimes(1);
  });
});
