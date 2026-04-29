function createRandomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

export function createBlockUiKey() {
  return `ui-block-${createRandomSuffix()}`;
}

export function getBlockSignature(block) {
  if (!block || typeof block !== "object") {
    return "unknown:empty";
  }

  if (block.type === "cardio") {
    return `cardio:${String(block.exerciseId || block.exercise?.exerciseId || "empty").trim() || "empty"}`;
  }

  if (block.type === "superset") {
    const laneExerciseIds = Array.isArray(block.exercises)
      ? block.exercises.map((exercise) => String(exercise?.exerciseId || "").trim() || "empty")
      : [];

    return `superset:${laneExerciseIds.length ? laneExerciseIds.join("|") : "empty"}`;
  }

  return `single:${String(block.exerciseId || block.exercise?.exerciseId || "empty").trim() || "empty"}`;
}

export function attachBlockUiKeys(nextBlocks = [], previousBlocks = []) {
  const previousBlocksBySignature = new Map();

  previousBlocks.forEach((block) => {
    const signature = getBlockSignature(block);

    if (!previousBlocksBySignature.has(signature)) {
      previousBlocksBySignature.set(signature, []);
    }

    previousBlocksBySignature.get(signature).push(block);
  });

  const consumedCountsBySignature = new Map();

  return nextBlocks.map((block) => {
    const normalizedUiKey = String(block?.uiKey || "").trim();

    if (normalizedUiKey) {
      return block;
    }

    const signature = getBlockSignature(block);
    const previousMatches = previousBlocksBySignature.get(signature) || [];
    const matchIndex = consumedCountsBySignature.get(signature) || 0;
    const previousMatch = previousMatches[matchIndex] || null;

    consumedCountsBySignature.set(signature, matchIndex + 1);

    return {
      ...block,
      uiKey: String(previousMatch?.uiKey || "").trim() || createBlockUiKey(),
    };
  });
}
