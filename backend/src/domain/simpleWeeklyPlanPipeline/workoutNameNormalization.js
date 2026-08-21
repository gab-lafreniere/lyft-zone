const {
  sanitizePresentationText,
} = require('./presentationText');

const ORDINAL_PREFIX =
  /^\s*(?:Day|Session|Workout|Jour)\s*\d+\s*[—–\-:.]?\s*/i;

function alphabeticSuffix(index) {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function normalizeSingleWorkoutName(value) {
  const original = typeof value === 'string' ? value : String(value ?? '');
  const normalized = sanitizePresentationText(original)
    .replace(ORDINAL_PREFIX, '')
    .replace(/[-:,]\s*$/, '')
    .trim();

  return normalized.length >= 2 ? normalized : original;
}

function groupIndexesByName(names) {
  const groups = new Map();
  names.forEach((name, index) => {
    const key = String(name).trim().toLowerCase();
    const indexes = groups.get(key) || [];
    indexes.push(index);
    groups.set(key, indexes);
  });
  return groups;
}

function orderIndexSuffix(workout, index) {
  return Number.isSafeInteger(workout?.orderIndex) && workout.orderIndex > 0
    ? workout.orderIndex
    : index + 1;
}

function normalizeWorkoutNames(workouts) {
  const sourceWorkouts = Array.isArray(workouts) ? workouts : [];
  const sourceNames = sourceWorkouts.map((workout) => workout?.name);
  const names = sourceNames.map(normalizeSingleWorkoutName);

  for (const indexes of groupIndexesByName(names).values()) {
    if (indexes.length < 2) {
      continue;
    }
    indexes.forEach((workoutIndex, duplicateIndex) => {
      names[workoutIndex] = `${names[workoutIndex]} ${alphabeticSuffix(duplicateIndex)}`;
    });
  }

  for (const indexes of groupIndexesByName(names).values()) {
    if (indexes.length < 2) {
      continue;
    }
    indexes.forEach((workoutIndex) => {
      names[workoutIndex] = `${names[workoutIndex]} ${orderIndexSuffix(
        sourceWorkouts[workoutIndex],
        workoutIndex
      )}`;
    });
  }

  const usedNames = new Set();
  names.forEach((name, index) => {
    const baseName = name;
    let candidate = baseName;
    let collisionIndex = 0;
    while (usedNames.has(candidate.trim().toLowerCase())) {
      collisionIndex += 1;
      const suffix = orderIndexSuffix(sourceWorkouts[index], index);
      candidate = `${baseName} ${suffix}${collisionIndex > 1 ? `-${collisionIndex}` : ''}`;
    }
    names[index] = candidate;
    usedNames.add(candidate.trim().toLowerCase());
  });

  return {
    workouts: sourceWorkouts.map((workout, index) => ({
      ...workout,
      name: names[index],
    })),
    sourceNames,
  };
}

module.exports = {
  normalizeWorkoutNames,
};
