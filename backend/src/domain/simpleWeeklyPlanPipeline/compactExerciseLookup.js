class SimpleWeeklyPlanLookupError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SimpleWeeklyPlanLookupError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function projectEligiblePoolItem(item = {}) {
  return {
    exerciseId: String(item.exerciseId || '').trim(),
    name: String(item.name || '').trim(),
    bodyParts: Array.isArray(item.attributes?.bodyParts)
      ? [...item.attributes.bodyParts]
      : [],
    muscleFocus: Array.isArray(item.attributes?.muscleFocus)
      ? [...item.attributes.muscleFocus]
      : [],
    trainingType: String(item.trainingType || '').trim().toLowerCase(),
    cardioModality:
      String(item.attributes?.cardioModality || '').trim().toLowerCase() ||
      null,
  };
}

function buildEligibleExerciseLookup(poolResult = {}) {
  const items = Array.isArray(poolResult?.pool?.items)
    ? poolResult.pool.items
    : [];
  const lookup = {};

  items.forEach((item) => {
    const projected = projectEligiblePoolItem(item);
    if (!projected.exerciseId || !projected.name) {
      return;
    }
    lookup[projected.exerciseId] = projected;
  });

  return lookup;
}

function extractExactExerciseIds(text) {
  return Array.from(
    new Set(
      String(text || '').match(/\b(?:exr|ex)_[A-Za-z0-9_:-]+\b/g) || []
    )
  );
}

function tokenOverlapScore(query, candidate) {
  const queryTokens = new Set(normalizeText(query).split(' ').filter(Boolean));
  const candidateTokens = new Set(
    normalizeText(candidate).split(' ').filter(Boolean)
  );
  if (!queryTokens.size || !candidateTokens.size) {
    return 0;
  }
  let matches = 0;
  queryTokens.forEach((token) => {
    if (candidateTokens.has(token)) {
      matches += 1;
    }
  });
  return matches / Math.max(queryTokens.size, candidateTokens.size);
}

function findExerciseNameCandidates(
  name,
  eligibleExerciseLookup,
  limit = 3
) {
  const normalizedName = normalizeText(name);
  return Object.values(eligibleExerciseLookup || {})
    .map((item) => {
      const normalizedCandidate = normalizeText(item.name);
      let score = tokenOverlapScore(name, item.name);
      if (normalizedCandidate === normalizedName) {
        score += 10;
      } else if (
        normalizedCandidate.includes(normalizedName) ||
        normalizedName.includes(normalizedCandidate)
      ) {
        score += 3;
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.exerciseId.localeCompare(right.item.exerciseId)
    )
    .slice(0, Math.min(Math.max(limit, 0), 3))
    .map((entry) => entry.item);
}

function extractUnresolvedExerciseNames(text, knownIds = new Set()) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => {
      const hasPrescription =
        /\b(?:sets?|reps?|RIR|tempo|seconds?|minutes?)\b/i.test(line);
      const hasKnownId = Array.from(knownIds).some((id) => line.includes(id));
      return hasPrescription && !hasKnownId;
    })
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)]|[A-Z][.)])\s*/, '')
        .replace(/^(?:SINGLE|SUPERSET|CARDIO)\s*[-—:]\s*/i, '')
        .split(/\s+\(|:|\s+-\s+/)[0]
        .trim()
    )
    .filter(Boolean);
}

function buildCompactExerciseLookup({
  generatedPlanText,
  eligibleExerciseLookup,
}) {
  const exactIds = extractExactExerciseIds(generatedPlanText);
  const unknownExerciseIds = exactIds.filter(
    (exerciseId) => !eligibleExerciseLookup?.[exerciseId]
  );
  if (unknownExerciseIds.length) {
    throw new SimpleWeeklyPlanLookupError(
      'EXERCISE_ID_OUTSIDE_ELIGIBLE_POOL',
      'Generated plan contains an exerciseId outside the eligible pool',
      { exerciseIds: unknownExerciseIds }
    );
  }

  const selected = new Map(
    exactIds.map((exerciseId) => [
      exerciseId,
      eligibleExerciseLookup[exerciseId],
    ])
  );
  const unresolvedNames = extractUnresolvedExerciseNames(
    generatedPlanText,
    new Set(exactIds)
  );
  const candidatesByName = {};

  unresolvedNames.forEach((name) => {
    const candidates = findExerciseNameCandidates(
      name,
      eligibleExerciseLookup,
      3
    );
    candidatesByName[name] = candidates.map((item) => item.exerciseId);
    candidates.forEach((item) => selected.set(item.exerciseId, item));
  });

  const items = Array.from(selected.values())
    .sort((left, right) => left.exerciseId.localeCompare(right.exerciseId))
    .map((item) => ({
      exerciseId: item.exerciseId,
      name: item.name,
    }));

  return {
    items,
    text: items
      .map((item) => `${item.exerciseId} | ${item.name}`)
      .join('\n'),
    exactExerciseIds: exactIds,
    unresolvedNames,
    candidatesByName,
  };
}

module.exports = {
  SimpleWeeklyPlanLookupError,
  buildCompactExerciseLookup,
  buildEligibleExerciseLookup,
  extractExactExerciseIds,
  extractUnresolvedExerciseNames,
  findExerciseNameCandidates,
  normalizeText,
  projectEligiblePoolItem,
};
