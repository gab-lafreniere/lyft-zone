import { render, waitFor } from "@testing-library/react";
import ManualWorkoutEditor from "../ManualWorkoutEditor";
import { fetchExercises } from "../../services/api";

const mockNavigate = jest.fn();
const mockEditableProgram = {
  programDraft: {
    isMultiWeek: false,
    workouts: [{ id: "workout_1", name: "Workout A", blocks: [] }],
    weeks: [],
    selectedWeek: 1,
    startDate: "2026-01-01",
    timezone: "America/Toronto",
  },
  draftMetadata: {
    loadedFromBackend: true,
    saveState: "idle",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    draftState: { localDate: "2026-01-01" },
  },
  getMultiWeekTodayDateKey: jest.fn(() => "2026-01-01"),
  setSelectedWeek: jest.fn(),
  updateWorkoutName: jest.fn(),
  updateBlock: jest.fn(),
  reorderBlocks: jest.fn(),
  updateSupersetExercise: jest.fn(),
  updateSupersetSetCount: jest.fn(),
  removeBlock: jest.fn(),
  addSet: jest.fn(),
  removeSet: jest.fn(),
  updateSet: jest.fn(),
  appendSingleBlockFromExercise: jest.fn(),
  convertSingleBlockToSuperset: jest.fn(),
  assignSupersetExercise: jest.fn(),
  hasIncompleteSupersets: jest.fn(() => false),
};

jest.mock("../../services/api", () => ({
  fetchExercises: jest.fn(),
}));

jest.mock("../../context/EditableProgramContext", () => ({
  useEditableProgram: () => mockEditableProgram,
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => ({
    pathname: "/program/manual-builder/workout/workout_1",
    state: null,
  }),
  useNavigate: () => mockNavigate,
  useParams: () => ({ workoutId: "workout_1" }),
}));

describe("ManualWorkoutEditor exercise search", () => {
  beforeEach(() => {
    fetchExercises.mockReset();
    fetchExercises.mockResolvedValue([]);
    mockNavigate.mockReset();
  });

  test("requests approved exercises for selection search", async () => {
    render(<ManualWorkoutEditor />);

    await waitFor(() => expect(fetchExercises).toHaveBeenCalled());

    expect(fetchExercises).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "",
        limit: 50,
        status: "approved",
      })
    );
  });
});
