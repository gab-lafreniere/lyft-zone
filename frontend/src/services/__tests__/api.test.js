import {
  createAIWeeklyPlanDraft,
  fetchExercises,
  fetchUserExercisePool,
  fetchUserExercisePoolResponse,
  updateUserProfile,
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

describe("createAIWeeklyPlanDraft", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("posts only the current userId, forwards the signal, and returns the response unchanged", async () => {
    const responseBody = {
      weeklyPlanParentId: "weekly_parent_ai_1",
      weeklyPlanVersionId: "weekly_version_ai_1",
      status: "DRAFT",
      source: "ai",
      builderPayload: {
        programName: "AI Weekly Plan",
        sessionsPerWeek: 4,
        workouts: [],
      },
    };
    const controller = new AbortController();

    global.fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => responseBody,
    });

    const result = await createAIWeeklyPlanDraft({
      signal: controller.signal,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestOptions] = global.fetch.mock.calls[0];
    expect(new URL(requestUrl).pathname).toBe("/api/weekly-plans/ai-drafts");
    expect(requestOptions.method).toBe("POST");
    expect(requestOptions.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(requestOptions.signal).toBe(controller.signal);

    const requestBody = JSON.parse(requestOptions.body);
    expect(Object.keys(requestBody)).toEqual(["userId"]);
    expect(requestBody.userId).toEqual(expect.any(String));
    expect(requestBody.userId).not.toBe("");
    expect(result).toBe(responseBody);
  });

  test("preserves controlled error code, details, and HTTP status", async () => {
    const details = {
      primaryGoal: "STRENGTH",
      supportedPrimaryGoals: ["HYPERTROPHY"],
    };

    global.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: "AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL",
          message: "AI Weekly Plan Builder V1 currently supports HYPERTROPHY only",
          details,
        },
      }),
    });

    await expect(createAIWeeklyPlanDraft()).rejects.toMatchObject({
      code: "AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL",
      details,
      status: 422,
    });
  });
});

describe("updateUserProfile", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("puts only the supplied demographics to the existing profile endpoint", async () => {
    const responseBody = {
      profile: {
        age: 29,
        sex: "MALE",
        currentAge: 29,
        demographicsStatus: "LOCKED",
      },
    };
    mockJsonResponse(responseBody);

    const result = await updateUserProfile({ age: 29, sex: "MALE" });

    const [requestUrl, requestOptions] = global.fetch.mock.calls[0];
    expect(new URL(requestUrl).pathname).toMatch(/^\/api\/users\/[^/]+\/profile$/);
    expect(requestOptions).toEqual({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age: 29, sex: "MALE" }),
    });
    expect(result).toBe(responseBody);
  });
});
