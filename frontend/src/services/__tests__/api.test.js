import { fetchExercises } from "../api";

function mockExerciseResponse(items = []) {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ items }),
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
