import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ManualBuilderMulti from "../ManualBuilderMulti";
import { useMultiWeekProgram } from "../../context/MultiWeekProgramContext";
import { openOrCreateCycleEditDraft } from "../../services/api";

// Phase 1B regression coverage: ManualBuilderMulti's mount effect used to
// call openOrCreateCycleEditDraft unconditionally on every mount -- i.e.
// every navigation back into the builder -- and force-hydrate the response
// with no regard for in-flight saves or dirty local state. That's the
// mechanism behind the live-observed "navigate away mid-save and back
// reverts the screen" bug. This suite proves the mount effect now skips the
// redundant fetch when the target cycle is already loaded.

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
    cycleId: null,
    cyclePlanId: null,
    status: "draft",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    loadedFromBackend: false,
    lastSavedAt: null,
    saveState: "idle",
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
    weeks: [],
    workouts: [],
    ...overrides,
  };
}

function createContextValue(overrides = {}) {
  return {
    programDraft: createProgramDraft(),
    draftMetadata: createDraftMetadata(),
    hydrateProgramDraft: jest.fn(),
    beginHydrationTarget: jest.fn(),
    handleDraftExpired: jest.fn(),
    persistDraftNow: jest.fn().mockResolvedValue(null),
    setSelectedWeek: jest.fn(),
    updateDraftMetadata: jest.fn(),
    moveSelectedWeekWorkoutToScheduledDay: jest.fn(),
    duplicateSelectedWeekWorkout: jest.fn(),
    deleteSelectedWeekWorkout: jest.fn(),
    ...overrides,
  };
}

function renderAtCycle(cycleId, contextValue) {
  useMultiWeekProgram.mockReturnValue(contextValue);

  return render(
    <MemoryRouter initialEntries={[`/program/cycles/${cycleId}/builder`]}>
      <Routes>
        <Route path="/program/cycles/:cycleId/builder" element={<ManualBuilderMulti />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManualBuilderMulti mount-effect hydration race (Phase 1B)", () => {
  beforeEach(() => {
    openOrCreateCycleEditDraft.mockReset();
    openOrCreateCycleEditDraft.mockResolvedValue({
      planId: "plan_1",
      cycleId: "cycle_1",
      builderPayload: { weeks: [] },
    });
  });

  test("does not re-fetch when the target cycle is already loaded", () => {
    const contextValue = createContextValue({
      draftMetadata: createDraftMetadata({
        cycleId: "cycle_1",
        cyclePlanId: "plan_1",
        loadedFromBackend: true,
      }),
    });

    renderAtCycle("cycle_1", contextValue);

    expect(openOrCreateCycleEditDraft).not.toHaveBeenCalled();
    expect(contextValue.hydrateProgramDraft).not.toHaveBeenCalled();
  });

  test.each(["upcoming", "active"])(
    "re-opens a %s cycle when the matching loaded state is published",
    async (temporalStatus) => {
      const contextValue = createContextValue({
        draftMetadata: createDraftMetadata({
          cycleId: "cycle_1",
          cyclePlanId: null,
          status: "published",
          temporalStatus,
          loadedFromBackend: true,
        }),
      });
      openOrCreateCycleEditDraft.mockResolvedValueOnce({
        planId: "plan_new_draft",
        cycleId: "cycle_1",
        status: "DRAFT",
        temporalStatus: temporalStatus.toUpperCase(),
        builderPayload: { weeks: [] },
      });

      renderAtCycle("cycle_1", contextValue);

      await waitFor(() => {
        expect(contextValue.hydrateProgramDraft).toHaveBeenCalledWith(
          expect.objectContaining({ planId: "plan_new_draft", status: "DRAFT" })
        );
      });
      expect(openOrCreateCycleEditDraft).toHaveBeenCalledWith("cycle_1");
      expect(contextValue.updateDraftMetadata).toHaveBeenCalledWith({
        cyclePlanId: "plan_new_draft",
      });
    }
  );

  test("an active editable draft keeps the same-cycle no-fetch navigation guard", () => {
    const contextValue = createContextValue({
      draftMetadata: createDraftMetadata({
        cycleId: "cycle_1",
        cyclePlanId: "plan_1",
        status: "draft",
        temporalStatus: "active",
        loadedFromBackend: true,
      }),
    });

    renderAtCycle("cycle_1", contextValue);

    expect(openOrCreateCycleEditDraft).not.toHaveBeenCalled();
  });

  test("fetches on first mount when nothing is loaded yet", async () => {
    const contextValue = createContextValue({
      draftMetadata: createDraftMetadata({ loadedFromBackend: false }),
    });

    renderAtCycle("cycle_1", contextValue);

    await waitFor(() => {
      expect(contextValue.hydrateProgramDraft).toHaveBeenCalledTimes(1);
    });
    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
    expect(openOrCreateCycleEditDraft).toHaveBeenCalledWith("cycle_1");
  });

  test("fetches again when the route points at a different cycle", async () => {
    const contextValue = createContextValue({
      draftMetadata: createDraftMetadata({
        cycleId: "cycle_1",
        cyclePlanId: "plan_1",
        loadedFromBackend: true,
      }),
    });

    renderAtCycle("cycle_2", contextValue);

    await waitFor(() => {
      expect(openOrCreateCycleEditDraft).toHaveBeenCalledWith("cycle_2");
    });
    expect(openOrCreateCycleEditDraft).toHaveBeenCalledTimes(1);
  });
});
