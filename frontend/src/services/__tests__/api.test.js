import {
  fetchExercises,
  fetchUserExercisePool,
  fetchUserExercisePoolResponse,
} from "../api";

function mockExerciseResponse(items = []) {
  mockJsonResponse({ items });
}

function mockJsonResponse(json) {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => json,
  });
}

describe("fetchExercises", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("adds status query parameter when provided", async () => {
    mockExerciseResponse();

    await fetchExercises({ q: "dead", limit: 10, status: "approved" });

    const requestUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/api/exercises");
    expect(requestUrl.searchParams.get("q")).toBe("dead");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.get("status")).toBe("approved");
  });

  test("omits status query parameter when not provided", async () => {
    mockExerciseResponse();

    await fetchExercises({ q: "dead", limit: 10 });

    const requestUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/api/exercises");
    expect(requestUrl.searchParams.get("q")).toBe("dead");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.has("status")).toBe(false);
  });
});

describe("fetchUserExercisePoolResponse", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("requests the user exercise pool with supported query parameters", async () => {
    const fullResponse = {
      items: [{ exerciseId: "ex_pool_1", name: "Pool Exercise" }],
      nextCursor: "45",
      total: 120,
      poolSummary: {
        totalExercises: 400,
        availableExercises: 180,
        excludedExercises: 220,
      },
      meta: { schemaVersion: 1 },
      hardConstraints: { allowedDifficulties: ["beginner"] },
      excluded: [{ exerciseId: "ex_blocked", reasons: ["blocked_exercise_id"] }],
      excludedByReason: { blocked_exercise_id: 1 },
    };
    mockJsonResponse(fullResponse);

    const result = await fetchUserExercisePoolResponse("user_123", {
      q: "press",
      limit: 15,
      cursor: "30",
      bodyParts: ["chest", "shoulders"],
      muscleFocus: ["upper_chest"],
      equipmentCategory: ["dumbbell"],
      trainingType: ["strength"],
      difficulty: ["beginner", "intermediate"],
      includeExcluded: true,
    });

    const requestUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/api/users/user_123/exercise-pool");
    expect(requestUrl.searchParams.get("q")).toBe("press");
    expect(requestUrl.searchParams.get("limit")).toBe("15");
    expect(requestUrl.searchParams.get("cursor")).toBe("30");
    expect(requestUrl.searchParams.get("bodyParts")).toBe("chest,shoulders");
    expect(requestUrl.searchParams.get("muscleFocus")).toBe("upper_chest");
    expect(requestUrl.searchParams.get("equipmentCategory")).toBe("dumbbell");
    expect(requestUrl.searchParams.get("trainingType")).toBe("strength");
    expect(requestUrl.searchParams.get("difficulty")).toBe("beginner,intermediate");
    expect(requestUrl.searchParams.get("includeExcluded")).toBe("true");
    expect(result).toEqual(fullResponse);
  });
});

describe("fetchUserExercisePool", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("returns only items from the user exercise pool response", async () => {
    mockJsonResponse({
      items: [{ exerciseId: "ex_pool_1", name: "Pool Exercise" }],
      nextCursor: null,
      total: 1,
      poolSummary: {
        totalExercises: 1,
        availableExercises: 1,
        excludedExercises: 0,
      },
      meta: {},
      hardConstraints: {},
    });

    const result = await fetchUserExercisePool("user_123", {
      q: "press",
      limit: 15,
    });

    const requestUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/api/users/user_123/exercise-pool");
    expect(requestUrl.searchParams.get("q")).toBe("press");
    expect(requestUrl.searchParams.get("limit")).toBe("15");
    expect(result).toEqual([{ exerciseId: "ex_pool_1", name: "Pool Exercise" }]);
  });
});
