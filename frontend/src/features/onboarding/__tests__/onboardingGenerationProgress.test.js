import {
  FINALIZATION_PROGRESS,
  LARGE_PROGRAM_PACING_MULTIPLIER,
  MAX_VISUAL_STEP,
  SMALL_PROGRAM_PACING_MULTIPLIER,
  STAGE_PROGRESS,
  advanceProgress,
  advanceVisualPercent,
  buildBuildingProgramMessages,
  getCatchUpSpeedPerSecond,
  getCompletionTiming,
  getGenerationMessage,
  getProgramPacingProfile,
  getProgressBounds,
  getStageInterpolationMs,
  resolveProgressTarget,
  resolveDisplayStage,
} from "../onboardingGenerationProgress";

test("real stages use the recalibrated pipeline bounds", () => {
  expect(STAGE_PROGRESS).toEqual(
    expect.objectContaining({
      PROFILE_SETUP: expect.objectContaining({ floor: 2, ceiling: 8 }),
      DESIGNING_PROGRAM: expect.objectContaining({ floor: 8, ceiling: 25 }),
      EXTRACTING_STRUCTURE: expect.objectContaining({ floor: 25, ceiling: 75 }),
      BUILDING_PROGRAM: expect.objectContaining({ floor: 75, ceiling: 90 }),
      VALIDATING_PROGRAM: expect.objectContaining({ floor: 90, ceiling: 93 }),
      SAVING_PROGRAM: expect.objectContaining({ floor: 93, ceiling: 94 }),
    })
  );
  expect(getProgressBounds({ phase: "converting" }))
    .toEqual(FINALIZATION_PROGRESS);
  expect(getProgressBounds({ phase: "completing" }))
    .toEqual(FINALIZATION_PROGRESS);
});

test("program load produces a continuous 2.5 to 1 pacing multiplier", () => {
  const small = getProgramPacingProfile({
    sessionsPerWeek: 2,
    durationPerSession: 45,
  });
  const intermediate = getProgramPacingProfile({
    sessionsPerWeek: 3,
    durationPerSession: 90,
  });
  const large = getProgramPacingProfile({
    sessionsPerWeek: 5,
    durationPerSession: 90,
  });

  expect(small).toEqual({
    programLoad: 90,
    complexity: 0,
    pacingMultiplier: SMALL_PROGRAM_PACING_MULTIPLIER,
  });
  expect(large).toEqual({
    programLoad: 450,
    complexity: 1,
    pacingMultiplier: LARGE_PROGRAM_PACING_MULTIPLIER,
  });
  expect(intermediate.complexity).toBe(0.5);
  expect(intermediate.pacingMultiplier).toBe(1.75);
});

test("small-program passive BUILDING interpolation is 2.5x the large base rate", () => {
  const smallMultiplier = getProgramPacingProfile({
    sessionsPerWeek: 2,
    durationPerSession: 45,
  }).pacingMultiplier;
  const largeMultiplier = getProgramPacingProfile({
    sessionsPerWeek: 5,
    durationPerSession: 90,
  }).pacingMultiplier;

  expect(getStageInterpolationMs("BUILDING_PROGRAM", smallMultiplier))
    .toBe(3200);
  expect(getStageInterpolationMs("BUILDING_PROGRAM", largeMultiplier))
    .toBe(8000);

  const commonInput = {
    phase: "generating",
    backendStage: "BUILDING_PROGRAM",
    displayStage: "BUILDING_PROGRAM",
    stageElapsedMs: 10000,
  };
  const smallTarget = resolveProgressTarget(75, {
    ...commonInput,
    pacingMultiplier: smallMultiplier,
  });
  const largeTarget = resolveProgressTarget(75, {
    ...commonInput,
    pacingMultiplier: largeMultiplier,
  });
  expect(smallTarget).toBeGreaterThan(largeTarget);
});

test("initial target starts visually at zero and reaches four smoothly in about 640ms", () => {
  const pacingMultiplier = getProgramPacingProfile({
    sessionsPerWeek: 2,
    durationPerSession: 45,
  }).pacingMultiplier;
  const target = resolveProgressTarget(0, { phase: "checking" });
  let visualPercent = 0;
  let elapsedMs = 0;

  expect(target).toBe(4);
  expect(visualPercent).toBe(0);
  const firstFrame = advanceVisualPercent(visualPercent, target, {
    elapsedMs: 16,
    pacingMultiplier,
  });
  expect(firstFrame).toBeGreaterThan(0);
  expect(firstFrame).toBeLessThan(1);

  while (visualPercent < target) {
    visualPercent = advanceVisualPercent(visualPercent, target, {
      elapsedMs: 16,
      pacingMultiplier,
    });
    elapsedMs += 16;
  }
  expect(elapsedMs).toBeGreaterThanOrEqual(400);
  expect(elapsedMs).toBeLessThanOrEqual(700);
});

test("backend target jumps catch up monotonically without mutating visual progress", () => {
  const current = 42;
  const target = 80;
  const next = advanceVisualPercent(current, target, { elapsedMs: 16 });

  expect(current).toBe(42);
  expect(next).toBeGreaterThan(current);
  expect(next).toBeLessThanOrEqual(current + MAX_VISUAL_STEP);
  expect(next).toBeLessThan(target);

  let visualPercent = next;
  for (let index = 0; index < 120; index += 1) {
    const previous = visualPercent;
    visualPercent = advanceVisualPercent(visualPercent, target, {
      elapsedMs: 16,
    });
    expect(visualPercent).toBeGreaterThanOrEqual(previous);
    expect(visualPercent - previous).toBeLessThanOrEqual(MAX_VISUAL_STEP);
  }
});

test("catch-up speed increases with distance and respects complexity pacing", () => {
  const nearLarge = getCatchUpSpeedPerSecond({
    current: 42,
    target: 45,
    pacingMultiplier: 1,
  });
  const farLarge = getCatchUpSpeedPerSecond({
    current: 42,
    target: 80,
    pacingMultiplier: 1,
  });
  const farSmall = getCatchUpSpeedPerSecond({
    current: 42,
    target: 80,
    pacingMultiplier: 2.5,
  });

  expect(farLarge).toBeGreaterThan(nearLarge);
  expect(farSmall).toBeCloseTo(farLarge * 2.5);
});

test("display stage changes only after its visual threshold", () => {
  expect(resolveDisplayStage({
    displayStage: "DESIGNING_PROGRAM",
    targetStage: "EXTRACTING_STRUCTURE",
    visualPercent: 24.999,
  })).toBe("DESIGNING_PROGRAM");
  expect(resolveDisplayStage({
    displayStage: "DESIGNING_PROGRAM",
    targetStage: "EXTRACTING_STRUCTURE",
    visualPercent: 25,
  })).toBe("EXTRACTING_STRUCTURE");
});

test("90 to 95 catches up quickly without a large frame jump", () => {
  let visualPercent = 90;
  let elapsedMs = 0;
  while (visualPercent < 95) {
    const previous = visualPercent;
    visualPercent = advanceVisualPercent(visualPercent, 95, {
      elapsedMs: 16,
      pacingMultiplier: 1,
    });
    expect(visualPercent - previous).toBeLessThanOrEqual(MAX_VISUAL_STEP);
    elapsedMs += 16;
  }
  expect(elapsedMs).toBeLessThanOrEqual(500);
});

test("both lifecycle phases share one continuous 95 to 98.95 runway", () => {
  const elapsedSamples = [0, 1000, 2500, 5000, 10000, 15000];
  const convertingTargets = elapsedSamples.map((finalizationElapsedMs) =>
    resolveProgressTarget(95, {
      phase: "converting",
      finalizationElapsedMs,
    })
  );
  const completingTargets = elapsedSamples.map((finalizationElapsedMs) =>
    resolveProgressTarget(95, {
      phase: "completing",
      finalizationElapsedMs,
    })
  );

  expect(convertingTargets).toEqual(completingTargets);
  expect(convertingTargets[0]).toBe(95);
  expect(convertingTargets.at(-1)).toBeGreaterThan(98.9);
  expect(convertingTargets.every((target) => target < 98.95)).toBe(true);
  expect(convertingTargets.map(Math.floor)).toEqual([95, 96, 97, 98, 98, 98]);
  expect(convertingTargets.every((target, index) =>
    index === 0 || target >= convertingTargets[index - 1]
  )).toBe(true);
});

test("only true success unlocks 99 and 100 and crosses both smoothly", () => {
  expect(resolveProgressTarget(98.9, {
    phase: "completing",
    finalizationElapsedMs: 30000,
  })).toBeLessThan(99);

  let completed = 98.5;
  const firstFrame = advanceProgress(
    completed,
    { phase: "success", pacingMultiplier: 1 },
    { elapsedMs: 16 }
  );
  expect(firstFrame).toBeGreaterThan(98.5);
  expect(firstFrame).toBeLessThan(100);

  let frames = 0;
  const displayedPercents = [Math.floor(completed)];
  while (completed < 100) {
    completed = advanceProgress(
      completed,
      { phase: "success", pacingMultiplier: 1 },
      { elapsedMs: 16 }
    );
    displayedPercents.push(Math.floor(completed));
    frames += 1;
  }
  expect(frames).toBeGreaterThan(1);
  expect(displayedPercents).toContain(99);
  expect(completed).toBe(100);
});

test("completion timing preserves ordering and shortens decorative motion when reduced", () => {
  expect(getCompletionTiming(false)).toEqual({ holdMs: 500, fadeMs: 180 });
  expect(getCompletionTiming(true)).toEqual({ holdMs: 80, fadeMs: 0 });
});

test("BUILDING_PROGRAM messages scale with workout count and loop gracefully", () => {
  const twoWorkoutMessages = buildBuildingProgramMessages(2);
  const fiveWorkoutMessages = buildBuildingProgramMessages(5);

  expect(twoWorkoutMessages).toHaveLength(10);
  expect(fiveWorkoutMessages).toHaveLength(25);
  expect(fiveWorkoutMessages[0]).toEqual({
    title: "Selecting Exercises",
    description: "Workout 1 of 5",
  });
  expect(fiveWorkoutMessages[4]).toEqual({
    title: "Selecting Exercises",
    description: "Workout 5 of 5",
  });
  expect(fiveWorkoutMessages[5]).toEqual({
    title: "Building Set Structure",
    description: "Workout 1 of 5",
  });
  expect(
    getGenerationMessage({
      stage: "BUILDING_PROGRAM",
      messageIndex: fiveWorkoutMessages.length,
      sessionsPerWeek: 5,
    })
  ).toEqual(fiveWorkoutMessages[0]);
});

test("fallback pacing holds the long structuring phase until real backend progress arrives", () => {
  // Without backend stages the loader must keep moving inside a stage it can justify,
  // rather than advancing blind into a later one.
  expect(
    getProgressBounds({ phase: "generating", elapsedMs: 240000 })
  ).toEqual(expect.objectContaining({ floor: 25, ceiling: 75 }));
});
