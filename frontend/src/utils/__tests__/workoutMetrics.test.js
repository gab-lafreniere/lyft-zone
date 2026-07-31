import { computeWorkoutMetrics } from "../workoutMetrics";

function createSets(count, reps) {
  return Array.from({ length: count }, () => ({ reps }));
}

function createSingleBlock(overrides = {}) {
  return {
    type: "single",
    exerciseId: "ex_bench",
    bodyParts: ["chest"],
    tempo: "2010",
    rest: "120s",
    sets: createSets(4, 8),
    ...overrides,
  };
}

function createSupersetBlock(overrides = {}) {
  return {
    type: "superset",
    sets: 3,
    rest: "90s",
    exercises: [
      {
        exerciseId: "ex_press",
        bodyParts: ["chest"],
        tempo: "2020",
        sets: createSets(3, 12),
      },
      {
        exerciseId: "ex_row",
        bodyParts: ["back"],
        tempo: "2020",
        sets: createSets(3, 15),
      },
    ],
    ...overrides,
  };
}

test("SINGLE uses exact rest, 120-second block overhead, and one workout warmup", () => {
  const metrics = computeWorkoutMetrics({ blocks: [createSingleBlock()] });

  expect(metrics.estimatedDurationMinutes).toBe(20);
  expect(metrics.totalTUTSeconds).toBe(96);
  expect(metrics.totalTUTMinutes).toBe(2);
});

test("SUPERSET uses both lanes, exact R-1 rest, block overhead, and one warmup", () => {
  const metrics = computeWorkoutMetrics({ blocks: [createSupersetBlock()] });

  expect(metrics.estimatedDurationMinutes).toBe(20);
  expect(metrics.totalTUTSeconds).toBe(324);
  expect(metrics.totalTUTMinutes).toBe(5);
});

test("multiple strength blocks receive one warmup and one overhead per block", () => {
  const metrics = computeWorkoutMetrics({
    blocks: [createSingleBlock(), createSupersetBlock()],
  });

  expect(metrics.estimatedDurationMinutes).toBe(30);
  expect(metrics.totalTUTSeconds).toBe(420);
  expect(metrics.totalTUTMinutes).toBe(7);
});

test("cardio receives one workout warmup and no strength block overhead", () => {
  const metrics = computeWorkoutMetrics({
    blocks: [
      {
        type: "cardio",
        exerciseId: "ex_bike",
        cardioPrescription: { durationMinutes: 20 },
      },
    ],
  });

  expect(metrics.estimatedDurationMinutes).toBe(30);
  expect(metrics.totalTUTSeconds).toBe(0);
});

test("empty and unsupported workouts remain at zero without a warmup", () => {
  expect(computeWorkoutMetrics({ blocks: [] }).estimatedDurationMinutes).toBe(0);
  expect(
    computeWorkoutMetrics({
      blocks: [{ type: "circuit", exercises: [] }],
    }).estimatedDurationMinutes
  ).toBe(0);
});

test("cardio without an exploitable duration does not receive a warmup", () => {
  const metrics = computeWorkoutMetrics({
    blocks: [
      {
        type: "cardio",
        exerciseId: "ex_bike",
        cardioPrescription: { durationMinutes: 0 },
      },
    ],
  });

  expect(metrics.estimatedDurationMinutes).toBe(0);
});
