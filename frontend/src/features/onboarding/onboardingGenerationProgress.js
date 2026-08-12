const PROFILE_MESSAGES = [
  {
    title: "Reading Your Profile",
    description: "Loading your training background, availability, and equipment.",
  },
];

const DESIGN_MESSAGES = [
  {
    title: "Understanding Your Goal",
    description: "Translating your objective into a weekly training strategy.",
  },
  {
    title: "Mapping Your Priorities",
    description: "Applying your muscle focus, cardio role, and training constraints.",
  },
  {
    title: "Designing Your Weekly Split",
    description: "Organizing training across your available sessions.",
  },
  {
    title: "Drafting Your Training Strategy",
    description: "Building the overall logic for your weekly plan.",
  },
];

const STRUCTURE_MESSAGES = [
  {
    title: "Structuring Your Workouts",
    description: "Turning the strategy into workouts and training blocks.",
  },
  {
    title: "Building the Workout Framework",
    description: "Creating the validated structure for every session.",
  },
];

const BUILDING_MESSAGE_TITLES = [
  "Selecting Exercises",
  "Building Set Structure",
  "Setting Rep Targets",
  "Adding Tempo & Rest",
  "Setting Effort Targets",
];

const VALIDATION_MESSAGES = [
  {
    title: "Reviewing Training Flow",
    description: "Checking workout order and structural consistency.",
  },
  {
    title: "Checking Workout Length",
    description: "Comparing estimated session length with your availability.",
  },
];

const SAVING_MESSAGES = [
  {
    title: "Finalizing Your Program",
    description: "Saving your weekly plan and preparing your 6-week cycle.",
  },
];

export const STAGE_PROGRESS = {
  PROFILE_SETUP: { floor: 2, ceiling: 8, interpolationMs: 1800 },
  DESIGNING_PROGRAM: { floor: 8, ceiling: 25, interpolationMs: 16000 },
  EXTRACTING_STRUCTURE: { floor: 25, ceiling: 35, interpolationMs: 9000 },
  BUILDING_PROGRAM: { floor: 35, ceiling: 90, interpolationMs: 65000 },
  VALIDATING_PROGRAM: { floor: 90, ceiling: 93, interpolationMs: 4000 },
  SAVING_PROGRAM: { floor: 93, ceiling: 94, interpolationMs: 2500 },
};

const GENERATION_STAGES = Object.keys(STAGE_PROGRESS);
export const SMALL_PROGRAM_PACING_MULTIPLIER = 2.5;
export const LARGE_PROGRAM_PACING_MULTIPLIER = 1;
export const MAX_VISUAL_STEP = 0.75;
export const COMPLETION_HOLD_MS = 500;
export const COMPLETION_FADE_MS = 180;
export const REDUCED_MOTION_COMPLETION_HOLD_MS = 80;
export const FINALIZATION_PROGRESS = {
  floor: 95,
  ceiling: 98.95,
  interpolationMs: 2500,
};

const SMALL_PROGRAM_LOAD = 2 * 45;
const LARGE_PROGRAM_LOAD = 5 * 90;
const BASE_CATCH_UP_SPEED_PER_SECOND = 1.5;
const CATCH_UP_SPEED_PER_POINT = 0.6;
const MAX_CATCH_UP_ACCELERATION = 18;
const EARLY_PROGRESS_MINIMUM_MULTIPLIER = 2.5;
const FINAL_MILESTONE_SPEED_BOOST = 10;
const MAX_ELAPSED_STEP_MS = 64;

const FALLBACK_STAGES = [
  [0, "PROFILE_SETUP"],
  [1500, "DESIGNING_PROGRAM"],
  [23000, "EXTRACTING_STRUCTURE"],
  [35000, "BUILDING_PROGRAM"],
];

const STATIC_MESSAGES_BY_STAGE = {
  PROFILE_SETUP: PROFILE_MESSAGES,
  DESIGNING_PROGRAM: DESIGN_MESSAGES,
  EXTRACTING_STRUCTURE: STRUCTURE_MESSAGES,
  VALIDATING_PROGRAM: VALIDATION_MESSAGES,
  SAVING_PROGRAM: SAVING_MESSAGES,
};

function normalizeWorkoutCount(sessionsPerWeek) {
  const parsed = Number(sessionsPerWeek);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getProgramPacingProfile({
  sessionsPerWeek,
  durationPerSession,
} = {}) {
  const sessions = Number(sessionsPerWeek);
  const duration = Number(durationPerSession);
  const hasValidProgramSize = Number.isFinite(sessions) && sessions > 0 &&
    Number.isFinite(duration) && duration > 0;
  const programLoad = hasValidProgramSize
    ? sessions * duration
    : LARGE_PROGRAM_LOAD;
  const complexity = clamp(
    (programLoad - SMALL_PROGRAM_LOAD) /
      (LARGE_PROGRAM_LOAD - SMALL_PROGRAM_LOAD),
    0,
    1
  );
  const pacingMultiplier = SMALL_PROGRAM_PACING_MULTIPLIER -
    complexity * (
      SMALL_PROGRAM_PACING_MULTIPLIER - LARGE_PROGRAM_PACING_MULTIPLIER
    );

  return { programLoad, complexity, pacingMultiplier };
}

export function getStageInterpolationMs(stage, pacingMultiplier = 1) {
  const baseDuration = STAGE_PROGRESS[stage]?.interpolationMs || 1;
  return baseDuration / Math.max(1, Number(pacingMultiplier) || 1);
}

export function buildBuildingProgramMessages(sessionsPerWeek) {
  const workoutCount = normalizeWorkoutCount(sessionsPerWeek);
  return BUILDING_MESSAGE_TITLES.flatMap((title) =>
    Array.from({ length: workoutCount }, (_, index) => ({
      title,
      description: `Workout ${index + 1} of ${workoutCount}`,
    }))
  );
}

export function getFallbackStage(elapsedMs) {
  return FALLBACK_STAGES.reduce(
    (current, [threshold, stage]) => (elapsedMs >= threshold ? stage : current),
    "PROFILE_SETUP"
  );
}

export function resolveGenerationStage(backendStage, elapsedMs = 0) {
  return backendStage || getFallbackStage(elapsedMs);
}

export function resolveDisplayStage({
  displayStage,
  targetStage,
  visualPercent,
}) {
  const currentIndex = Math.max(0, GENERATION_STAGES.indexOf(displayStage));
  const targetIndex = GENERATION_STAGES.indexOf(targetStage);
  if (targetIndex <= currentIndex) {
    return GENERATION_STAGES[currentIndex];
  }

  let nextIndex = currentIndex;
  for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
    if (visualPercent < STAGE_PROGRESS[GENERATION_STAGES[index]].floor) {
      break;
    }
    nextIndex = index;
  }
  return GENERATION_STAGES[nextIndex];
}

export function getProgressBounds({ phase, backendStage, elapsedMs = 0 }) {
  if (phase === "success") {
    return { floor: 100, ceiling: 100 };
  }
  if (phase === "completing") {
    return FINALIZATION_PROGRESS;
  }
  if (phase === "converting") {
    return FINALIZATION_PROGRESS;
  }
  if (phase === "checking") {
    return { floor: 2, ceiling: 4 };
  }
  if (phase === "generating") {
    return STAGE_PROGRESS[resolveGenerationStage(backendStage, elapsedMs)];
  }
  return null;
}

export function getCatchUpSpeedPerSecond({
  current,
  target,
  pacingMultiplier = 1,
}) {
  const gap = Math.max(0, Number(target) - Number(current));
  if (gap <= 0) return 0;

  const normalizedMultiplier = Math.max(1, Number(pacingMultiplier) || 1);
  const effectiveMultiplier = Number(current) < 4
    ? Math.max(EARLY_PROGRESS_MINIMUM_MULTIPLIER, normalizedMultiplier)
    : normalizedMultiplier;
  const distanceAcceleration = Math.min(
    MAX_CATCH_UP_ACCELERATION,
    gap * CATCH_UP_SPEED_PER_POINT
  );
  const finalMilestoneBoost = Number(current) >= 90
    ? FINAL_MILESTONE_SPEED_BOOST
    : 0;

  return (
    BASE_CATCH_UP_SPEED_PER_SECOND +
    distanceAcceleration +
    finalMilestoneBoost
  ) * effectiveMultiplier;
}

export function advanceVisualPercent(current, target, {
  elapsedMs = 16,
  pacingMultiplier = 1,
} = {}) {
  const normalizedCurrent = clamp(Number(current) || 0, 0, 100);
  const normalizedTarget = clamp(
    Number(target) || 0,
    normalizedCurrent,
    100
  );
  const gap = normalizedTarget - normalizedCurrent;
  if (gap <= 0) {
    return normalizedCurrent;
  }

  const boundedElapsedSeconds = clamp(
    Number(elapsedMs) || 0,
    0,
    MAX_ELAPSED_STEP_MS
  ) / 1000;
  const speedPerSecond = getCatchUpSpeedPerSecond({
    current: normalizedCurrent,
    target: normalizedTarget,
    pacingMultiplier,
  });
  const elapsedStep = speedPerSecond * boundedElapsedSeconds;
  const next = Math.min(
    normalizedTarget,
    normalizedCurrent + MAX_VISUAL_STEP,
    normalizedCurrent + elapsedStep
  );
  return Math.round(next * 1000) / 1000;
}

function resolveFinalizationTarget(elapsedTimeMs) {
  const elapsedMs = Math.max(0, Number(elapsedTimeMs) || 0);
  const availableRange = FINALIZATION_PROGRESS.ceiling -
    FINALIZATION_PROGRESS.floor;
  return FINALIZATION_PROGRESS.floor + availableRange *
    (1 - Math.exp(-elapsedMs / FINALIZATION_PROGRESS.interpolationMs));
}

export function resolveProgressTarget(current, input) {
  const bounds = getProgressBounds(input);
  if (!bounds) {
    return current;
  }

  if (input.phase === "success" || input.phase === "checking") {
    return bounds.ceiling;
  }

  if (input.phase === "converting" || input.phase === "completing") {
    return Math.max(
      current,
      resolveFinalizationTarget(
        input.finalizationElapsedMs ?? input.phaseElapsedMs
      )
    );
  }

  const stage = resolveGenerationStage(input.backendStage, input.elapsedMs);
  const stageConfig = STAGE_PROGRESS[stage];
  const displayStageConfig = STAGE_PROGRESS[input.displayStage] || stageConfig;
  if (
    stageConfig.floor > displayStageConfig.floor &&
    current < stageConfig.floor
  ) {
    return stageConfig.floor;
  }
  const stageElapsedMs = Math.max(0, Number(input.stageElapsedMs) || 0);
  const availableRange = stageConfig.ceiling - stageConfig.floor - 0.1;
  const interpolationMs = getStageInterpolationMs(
    stage,
    input.pacingMultiplier
  );
  return Math.max(
    current,
    stageConfig.floor +
      availableRange *
        (1 - Math.exp(-stageElapsedMs / interpolationMs))
  );
}

export function advanceProgress(current, input, timing) {
  return advanceVisualPercent(
    current,
    resolveProgressTarget(current, input),
    {
      elapsedMs: timing?.elapsedMs,
      pacingMultiplier: input?.pacingMultiplier,
    }
  );
}

export function getCompletionTiming(reducedMotion = false) {
  return reducedMotion
    ? {
      holdMs: REDUCED_MOTION_COMPLETION_HOLD_MS,
      fadeMs: 0,
    }
    : {
      holdMs: COMPLETION_HOLD_MS,
      fadeMs: COMPLETION_FADE_MS,
    };
}

export function getGenerationMessages(stage, sessionsPerWeek) {
  if (stage === "BUILDING_PROGRAM") {
    return buildBuildingProgramMessages(sessionsPerWeek);
  }
  return STATIC_MESSAGES_BY_STAGE[stage] || PROFILE_MESSAGES;
}

export function getGenerationMessage({
  stage,
  messageIndex = 0,
  sessionsPerWeek,
}) {
  const messages = getGenerationMessages(stage, sessionsPerWeek);
  const normalizedIndex = Math.max(0, Number(messageIndex) || 0) % messages.length;
  return messages[normalizedIndex];
}
