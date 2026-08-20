import { act, render } from "@testing-library/react";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../ManualProgramContext";

jest.mock("../../services/api", () => ({
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  saveWeeklyPlanWorkoutContent: jest.fn(),
  updateWeeklyPlanDraft: jest.fn(),
}));

const hydratedResponse = {
  weeklyPlanParentId: "weekly_parent_1",
  weeklyPlanVersionId: "weekly_version_1",
  status: "DRAFT",
  source: "MANUAL",
  revision: 1,
  updatedAt: "2026-07-21T12:00:00.000Z",
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
        contentRevision: 1,
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
            sets: [{ id: "set_1", reps: 8, rpe: 2 }],
            notes: "",
          },
        ],
      },
    ],
  },
};

let currentContext;

function ContextProbe() {
  currentContext = useManualProgram();
  return null;
}

function renderProvider(response = hydratedResponse) {
  render(
    <ManualProgramProvider>
      <ContextProbe />
    </ManualProgramProvider>
  );
  act(() => currentContext.hydrateProgramDraft(response));
}

describe("ManualProgramProvider edit intent", () => {
  beforeEach(() => {
    currentContext = null;
  });

  test("records explicit edit intent separately from displayed builder values", () => {
    renderProvider();

    expect(
      currentContext.programDraft.workouts[0].blocks[0].sets[0].editIntent
    ).toBeUndefined();

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { reps: 9 }));
    expect(
      currentContext.programDraft.workouts[0].blocks[0].sets[0].editIntent
    ).toEqual({ reps: true });

    act(() => currentContext.updateSet("workout_1", "block_1", 0, { rpe: 1 }));
    expect(
      currentContext.programDraft.workouts[0].blocks[0].sets[0].editIntent
    ).toEqual({ reps: true, rir: true });

    act(() => currentContext.updateBlock("workout_1", "block_1", { tempo: "2010" }));
    expect(currentContext.programDraft.workouts[0].blocks[0].editIntent).toEqual({
      tempo: true,
    });
  });

  test("does not add superset round-count intent when a clamped count is unchanged", () => {
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
    renderProvider({
      ...hydratedResponse,
      builderPayload: {
        ...hydratedResponse.builderPayload,
        workouts: [
          {
            ...hydratedResponse.builderPayload.workouts[0],
            blocks: [
              createSuperset("superset_floor", 1),
              createSuperset("superset_ceiling", 10),
            ],
          },
        ],
      },
    });

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
});
