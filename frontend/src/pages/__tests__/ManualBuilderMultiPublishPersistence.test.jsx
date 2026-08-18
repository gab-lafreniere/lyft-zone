import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ManualBuilderMulti from "../ManualBuilderMulti";
import { useMultiWeekProgram } from "../../context/MultiWeekProgramContext";
import { openOrCreateCycleEditDraft, publishCycleDraft } from "../../services/api";

// Phase 1B: mirrors ManualBuilderPersistence.test.jsx's coverage of the
// Weekly Plan builder's publish flush, which the Cycle builder never had --
// `handlePublish` used to call publishCycleDraft directly with no preceding
// persistDraftNow(), so a debounced or in-flight edit could publish an
// older snapshot than what's on screen.

jest.mock("../../context/MultiWeekProgramContext", () => ({
  useMultiWeekProgram: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  openOrCreateCycleEditDraft: jest.fn(),
  publishCycleDraft: jest.fn(),
  updateUpcomingDraftTimeline: jest.fn(),
  deleteCycle: jest.fn(),
}));

function createDraftMetadata(overrides = {}) {
  return {
    cycleId: "cycle_1",
    cyclePlanId: "plan_1",
    status: "draft",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    loadedFromBackend: true,
    lastSavedAt: null,
    saveState: "saved",
    lastPersistedSignature: "",
    draftState: null,
    draftTimeline: null,
    allowCrossDayDraft: false,
    lastSaveErrorMessage: null,
    lastSaveErrorCode: null,
    isRecoveringDraft: false,
    recoveryMessage: null,
    ...overrides,
  };
}

function createProgramDraft(overrides = {}) {
  return {
    programName: "Six Week Cycle",
    sessionsPerWeek: 1,
    programLength: 1,
    startDate: null,
    endDate: null,
    isMultiWeek: true,
    selectedWeek: 1,
    weeks: [
      {
        id: "week_1",
        weekNumber: 1,
        orderIndex: 1,
        label: "Week 1",
        notes: "",
        workouts: [],
      },
    ],
    workouts: [],
    ...overrides,
  };
}

function createContextValue(persistDraftNow) {
  const draftMetadata = createDraftMetadata();
  return {
    programDraft: createProgramDraft(),
    draftMetadata,
    hydrateProgramDraft: jest.fn(),
    handleDraftExpired: jest.fn(),
    persistDraftNow,
    prepareCycleDraftForPublish: jest.fn(async () => {
      await persistDraftNow();
      return { status: "ready", metadata: draftMetadata };
    }),
    flushAllWorkouts: jest.fn(),
    workoutScopedAutosaveEnabled: false,
    setSelectedWeek: jest.fn(),
    updateDraftMetadata: jest.fn(),
    moveSelectedWeekWorkoutToScheduledDay: jest.fn(),
    duplicateSelectedWeekWorkout: jest.fn(),
    deleteSelectedWeekWorkout: jest.fn(),
  };
}

function renderAtCycle(cycleId, contextValue) {
  useMultiWeekProgram.mockReturnValue(contextValue);

  render(
    <MemoryRouter initialEntries={[`/program/cycles/${cycleId}/builder`]}>
      <Routes>
        <Route path="/program/cycles/:cycleId/builder" element={<ManualBuilderMulti />} />
        <Route path="*" element={<div>post-publish destination</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManualBuilderMulti publish persistence (Phase 1B)", () => {
  beforeEach(() => {
    openOrCreateCycleEditDraft.mockReset();
    publishCycleDraft.mockReset().mockResolvedValue({
      cycleId: "cycle_1",
      planId: "plan_1",
      status: "PUBLISHED",
      builderPayload: { weeks: [] },
    });
  });

  test("persists the latest draft before Publish Cycle", async () => {
    const persistDraftNow = jest.fn().mockResolvedValue({});
    const contextValue = createContextValue(persistDraftNow);

    renderAtCycle("cycle_1", contextValue);

    fireEvent.click(await screen.findByRole("button", { name: /Publish Cycle/ }));

    await waitFor(() => expect(publishCycleDraft).toHaveBeenCalledTimes(1));
    expect(persistDraftNow).toHaveBeenCalledTimes(1);
    expect(persistDraftNow.mock.invocationCallOrder[0]).toBeLessThan(
      publishCycleDraft.mock.invocationCallOrder[0]
    );
    expect(contextValue.prepareCycleDraftForPublish).toHaveBeenCalledTimes(1);
    expect(contextValue.flushAllWorkouts).not.toHaveBeenCalled();
  });
});
