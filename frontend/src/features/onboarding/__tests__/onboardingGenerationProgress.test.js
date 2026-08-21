import {
  FINALIZATION_PROGRESS,
  GENERATION_PROGRESS_CEILING,
  LARGE_PROGRAM_PACING_MULTIPLIER,
  MAX_VISUAL_STEP,
  SMALL_PROGRAM_PACING_MULTIPLIER,
  STAGE_PROGRESS,
  SLOW_GENERATION_THRESHOLD_MS,
  advanceProgress,
  advanceVisualPercent,
  getCatchUpSpeedPerSecond,
  getCompletionTiming,
  getGenerationMessage,
  getProgramPacingProfile,
  getProgressBounds,
  getFallbackStage,
  getStageInterpolationMs,
  resolveProgressTarget,
  resolveCollapsedGenerationPercent,
  resolveDisplayStage,
} from "../onboardingGenerationProgress";

test("real stages use the recalibrated pipeline bounds", () => {
  expect(Object.fromEntries(
    Object.entries(STAGE_PROGRESS).map(([stage, { floor, ceiling }]) => [
      stage,
      { floor, ceiling },
    ])
  )).toEqual({
    PROFILE_SETUP: { floor: 0, ceiling: 6 },
    DESIGNING_PROGRAM: { floor: 6, ceiling: 24 },
    EXTRACTING_STRUCTURE: { floor: 24, ceiling: 62 },
    RESOLVING_EXERCISES: { floor: 62, ceiling: 80 },
    COMPLETING_DETAILS: { floor: 80, ceiling: 88 },
    VALIDATING_PROGRAM: { floor: 88, ceiling: 93 },
    SAVING_PROGRAM: { floor: 93, ceiling: 96 },
  });
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

test("small-program passive exercise resolution is 2.5x the large base rate", () => {
  const smallMultiplier = getProgramPacingProfile({
    sessionsPerWeek: 2,
    durationPerSession: 45,
  }).pacingMultiplier;
  const largeMultiplier = getProgramPacingProfile({
    sessionsPerWeek: 5,
    durationPerSession: 90,
  }).pacingMultiplier;

  expect(getStageInterpolationMs("RESOLVING_EXERCISES", smallMultiplier))
    .toBe(8000);
  expect(getStageInterpolationMs("RESOLVING_EXERCISES", largeMultiplier))
    .toBe(20000);

  const commonInput = {
    phase: "generating",
    backendStage: "RESOLVING_EXERCISES",
    displayStage: "RESOLVING_EXERCISES",
    stageElapsedMs: 10000,
  };
  const smallTarget = resolveProgressTarget(62, {
    ...commonInput,
    pacingMultiplier: smallMultiplier,
  });
  const largeTarget = resolveProgressTarget(62, {
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
    visualPercent: 23.999,
  })).toBe("DESIGNING_PROGRAM");
  expect(resolveDisplayStage({
    displayStage: "DESIGNING_PROGRAM",
    targetStage: "EXTRACTING_STRUCTURE",
    visualPercent: 24,
  })).toBe("EXTRACTING_STRUCTURE");
});

test("88 to 96 catches up quickly without a large frame jump", () => {
  let visualPercent = 88;
  let elapsedMs = 0;
  while (visualPercent < 96) {
    const previous = visualPercent;
    visualPercent = advanceVisualPercent(visualPercent, 96, {
      elapsedMs: 16,
      pacingMultiplier: 1,
    });
    expect(visualPercent - previous).toBeLessThanOrEqual(MAX_VISUAL_STEP);
    elapsedMs += 16;
  }
  expect(elapsedMs).toBeLessThanOrEqual(1000);
});

test("both lifecycle phases share one continuous 96 to 99 runway", () => {
  const elapsedSamples = [0, 1000, 2500, 5000, 10000, 15000];
  const convertingTargets = elapsedSamples.map((finalizationElapsedMs) =>
    resolveProgressTarget(96, {
      phase: "converting",
      finalizationElapsedMs,
    })
  );
  const completingTargets = elapsedSamples.map((finalizationElapsedMs) =>
    resolveProgressTarget(96, {
      phase: "completing",
      finalizationElapsedMs,
    })
  );

  expect(convertingTargets).toEqual(completingTargets);
  expect(convertingTargets[0]).toBe(96);
  expect(convertingTargets.at(-1)).toBeGreaterThan(98.9);
  expect(convertingTargets.every((target) => target < 99)).toBe(true);
  expect(convertingTargets.map(Math.floor)).toEqual([96, 96, 97, 98, 98, 98]);
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

test("stage copy describes exercise resolution and conditional detail completion", () => {
  expect(getGenerationMessage({ stage: "RESOLVING_EXERCISES" })).toEqual({
    title: "Matching Your Exercises",
    description: "Connecting planned movements with exercises available to you.",
  });
  expect(getGenerationMessage({ stage: "COMPLETING_DETAILS" })).toEqual({
    title: "Completing Workout Details",
    description: "Filling in a few remaining training details.",
  });
});

test("slow generation copy is concise, reassuring, and percentage-free", () => {
  const message = getGenerationMessage({
    stage: "EXTRACTING_STRUCTURE",
    generationElapsedMs: SLOW_GENERATION_THRESHOLD_MS,
  });
  expect(message).toEqual({
    title: "Still Working",
    description: "Larger programs can take a little longer. We're continuing to prepare yours.",
  });
  expect(`${message.title} ${message.description}`).not.toMatch(/\d+%|retry|schema|binder|creator/i);
});

test("blind fallback never advances beyond structure extraction", () => {
  expect(getFallbackStage(0)).toBe("PROFILE_SETUP");
  expect(getFallbackStage(1500)).toBe("DESIGNING_PROGRAM");
  expect(getFallbackStage(23000)).toBe("EXTRACTING_STRUCTURE");
  expect(getFallbackStage(Number.MAX_SAFE_INTEGER)).toBe("EXTRACTING_STRUCTURE");
  expect(
    getProgressBounds({ phase: "generating", elapsedMs: 240000 })
  ).toEqual(expect.objectContaining({ floor: 24, ceiling: 62 }));
});

test("timer-driven generation targets never exceed the hard 96 percent ceiling", () => {
  Object.keys(STAGE_PROGRESS).forEach((backendStage) => {
    const target = resolveProgressTarget(0, {
      phase: "generating",
      backendStage,
      displayStage: backendStage,
      stageElapsedMs: Number.MAX_SAFE_INTEGER,
      pacingMultiplier: SMALL_PROGRAM_PACING_MULTIPLIER,
    });
    expect(target).toBeLessThanOrEqual(GENERATION_PROGRESS_CEILING);
  });
  expect(resolveProgressTarget(96, {
    phase: "generating",
    backendStage: "SAVING_PROGRAM",
    displayStage: "SAVING_PROGRAM",
    stageElapsedMs: Number.MAX_SAFE_INTEGER,
  })).toBe(96);
});

test("a validation signal collapses an unreported conditional detail band monotonically", () => {
  expect(resolveCollapsedGenerationPercent(79, {
    displayStage: "RESOLVING_EXERCISES",
    targetStage: "VALIDATING_PROGRAM",
  })).toBe(88);
  expect(resolveDisplayStage({
    displayStage: "RESOLVING_EXERCISES",
    targetStage: "VALIDATING_PROGRAM",
    visualPercent: 87.999,
  })).toBe("RESOLVING_EXERCISES");
  expect(resolveDisplayStage({
    displayStage: "RESOLVING_EXERCISES",
    targetStage: "VALIDATING_PROGRAM",
    visualPercent: 88,
  })).toBe("VALIDATING_PROGRAM");
});
