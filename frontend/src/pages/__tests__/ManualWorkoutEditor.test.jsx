import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ManualWorkoutEditor from "../ManualWorkoutEditor";
import {
  ensureCurrentUserId,
  fetchExercises,
  fetchUserExercisePoolResponse,
} from "../../services/api";

const mockNavigate = jest.fn();
const mockEditableProgram = {
  programDraft: {
    isMultiWeek: false,
    workouts: [
      {
        id: "workout_1",
        name: "Workout A",
        blocks: [
          {
            id: "block_1",
            type: "single",
            exerciseId: "ex_saved",
            exercise: "Saved Incline Press",
            sets: [],
          },
        ],
      },
    ],
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
  ensureCurrentUserId: jest.fn(),
  fetchExercises: jest.fn(),
  fetchUserExercisePoolResponse: jest.fn(),
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
    ensureCurrentUserId.mockReset();
    ensureCurrentUserId.mockResolvedValue("user_123");
    fetchExercises.mockReset();
    fetchExercises.mockResolvedValue([]);
    fetchUserExercisePoolResponse.mockReset();
    fetchUserExercisePoolResponse.mockResolvedValue({ items: [] });
    mockNavigate.mockReset();
  });

  test("requests user exercise pool for selection search", async () => {
    render(<ManualWorkoutEditor />);

    await waitFor(() => expect(fetchUserExercisePoolResponse).toHaveBeenCalled());

    expect(fetchUserExercisePoolResponse).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        q: "",
        limit: 50,
        bodyParts: [],
        muscleFocus: [],
        equipmentCategory: [],
        trainingType: [],
        difficulty: [],
      })
    );
    expect(fetchExercises).not.toHaveBeenCalled();
  });

  test("passes query and structured filters to user exercise pool search", async () => {
    render(<ManualWorkoutEditor />);

    await waitFor(() => expect(fetchUserExercisePoolResponse).toHaveBeenCalled());
    fetchUserExercisePoolResponse.mockClear();

    const searchInput = screen.getByPlaceholderText("Search exercises...");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, {
      target: { value: "press" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Muscle/i }));
    fireEvent.click(screen.getByRole("button", { name: "chest" }));
    fireEvent.click(screen.getByRole("button", { name: /Equipment/i }));
    fireEvent.click(screen.getByRole("button", { name: "dumbbell" }));
    fireEvent.click(screen.getByRole("button", { name: /Type/i }));
    fireEvent.click(screen.getByRole("button", { name: "strength" }));
    fireEvent.click(screen.getByRole("button", { name: /Difficulty/i }));
    fireEvent.click(screen.getByRole("button", { name: "beginner" }));

    await waitFor(() =>
      expect(fetchUserExercisePoolResponse).toHaveBeenCalledWith(
        "user_123",
        expect.objectContaining({
          q: "press",
          limit: 50,
          bodyParts: ["chest"],
          equipmentCategory: ["dumbbell"],
          trainingType: ["strength"],
          difficulty: ["beginner"],
        })
      )
    );
    expect(fetchExercises).not.toHaveBeenCalled();
  });

  test("renders normal pool search results when items are returned", async () => {
    fetchUserExercisePoolResponse.mockResolvedValue({
      items: [{ exerciseId: "ex_pool_press", name: "Pool Bench Press" }],
    });

    render(<ManualWorkoutEditor />);

    fireEvent.focus(screen.getByPlaceholderText("Search exercises..."));

    expect(await screen.findByRole("button", { name: /Pool Bench Press/i })).toBeTruthy();
    expect(screen.queryByText("No exercises found.")).toBeNull();
  });

  test("shows generic empty state when no pool items or excluded matches exist", async () => {
    fetchUserExercisePoolResponse.mockImplementation(async () => ({
      items: [],
      excluded: [],
    }));

    render(<ManualWorkoutEditor />);

    fireEvent.focus(screen.getByPlaceholderText("Search exercises..."));
    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "notreal" },
    });

    expect(await screen.findByText("No exercises found.")).toBeTruthy();
    expect(
      screen.queryByText("No exercises available with your current profile filters.")
    ).toBeNull();
    await waitFor(() =>
      expect(fetchUserExercisePoolResponse).toHaveBeenCalledWith(
        "user_123",
        expect.objectContaining({ q: "notreal", includeExcluded: true })
      )
    );
  });

  test("shows profile-filter empty state when excluded exercises match the query", async () => {
    fetchUserExercisePoolResponse.mockImplementation(async (_userId, params = {}) => {
      if (params.includeExcluded) {
        return {
          items: [],
          excluded: [{ exerciseId: "ex_squat", name: "Barbell Squat" }],
        };
      }

      return {
        items: [],
      };
    });

    render(<ManualWorkoutEditor />);

    fireEvent.focus(screen.getByPlaceholderText("Search exercises..."));
    fireEvent.change(screen.getByPlaceholderText("Search exercises..."), {
      target: { value: "squat" },
    });

    expect(
      await screen.findByText("No exercises available with your current profile filters.")
    ).toBeTruthy();
    expect(screen.queryByText("No exercises found.")).toBeNull();
  });

  test("keeps saved exercises visible when pool search returns empty results", async () => {
    fetchUserExercisePoolResponse.mockResolvedValue({ items: [] });

    render(<ManualWorkoutEditor />);

    expect(screen.getByText("Saved Incline Press")).toBeTruthy();
    await waitFor(() => expect(fetchUserExercisePoolResponse).toHaveBeenCalled());
  });
});
