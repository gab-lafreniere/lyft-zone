const PRIMARY_WEIGHT = 1.0;
const SECONDARY_WEIGHT = 0.65;
const DEPRIORITIZED_WEIGHT = 0.35;

const AREA_DEFINITIONS = {
  // REGIONS
  upper_body: { kind: 'region', parent: null },
  lower_body: { kind: 'region', parent: null },
  core: { kind: 'region', parent: null },

  // MAJOR GROUPS
  chest: { kind: 'major', parent: 'upper_body' },
  back: { kind: 'major', parent: 'upper_body' },
  shoulders: { kind: 'major', parent: 'upper_body' },
  biceps: { kind: 'major', parent: 'upper_body' },
  triceps: { kind: 'major', parent: 'upper_body' },
  forearms: { kind: 'major', parent: 'upper_body' },

  quadriceps: { kind: 'major', parent: 'lower_body' },
  hamstrings: { kind: 'major', parent: 'lower_body' },
  glutes: { kind: 'major', parent: 'lower_body' },
  calves: { kind: 'major', parent: 'lower_body' },
  adductors: { kind: 'major', parent: 'lower_body' },

  abs: { kind: 'major', parent: 'core' },
  obliques: { kind: 'major', parent: 'core' },
  lower_back: { kind: 'major', parent: 'core' },

  // MICRO FOCUS
  upper_chest: { kind: 'micro', parent: 'chest' },

  front_delts: { kind: 'micro', parent: 'shoulders' },
  side_delts: { kind: 'micro', parent: 'shoulders' },
  rear_delts: { kind: 'micro', parent: 'shoulders' },

  lats: { kind: 'micro', parent: 'back' },
  upper_back: { kind: 'micro', parent: 'back' },

  biceps_long_head: { kind: 'micro', parent: 'biceps' },
  biceps_short_head: { kind: 'micro', parent: 'biceps' },

  triceps_long_head: { kind: 'micro', parent: 'triceps' },
  triceps_lateral_head: { kind: 'micro', parent: 'triceps' },

  glute_max: { kind: 'micro', parent: 'glutes' },
  glute_med: { kind: 'micro', parent: 'glutes' },

  gastrocnemius: { kind: 'micro', parent: 'calves' },
  soleus: { kind: 'micro', parent: 'calves' },

  upper_abs: { kind: 'micro', parent: 'abs' },
  lower_abs: { kind: 'micro', parent: 'abs' },
};

const DEPRIORITIZABLE_AREAS = new Set(
  Object.entries(AREA_DEFINITIONS)
    .filter(([, definition]) => definition.kind === 'region' || definition.kind === 'major')
    .map(([area]) => area)
);

const BIOMECHANICAL_CONFLICT_MATRIX = new Map([
  ['chest', new Set(['shoulders'])],
  ['shoulders', new Set(['chest'])],
  ['biceps', new Set(['triceps'])],
  ['triceps', new Set(['biceps'])],
  ['quadriceps', new Set(['hamstrings'])],
  ['hamstrings', new Set(['quadriceps'])],
]);

function normalizeAreaName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function getAreaDefinition(area) {
  return AREA_DEFINITIONS[normalizeAreaName(area)] || null;
}

function isKnownArea(area) {
  return Boolean(getAreaDefinition(area));
}

function getParentArea(area) {
  return getAreaDefinition(area)?.parent || null;
}

function isMicroFocus(area) {
  return getAreaDefinition(area)?.kind === 'micro';
}

function isDeprioritizableArea(area) {
  return DEPRIORITIZABLE_AREAS.has(normalizeAreaName(area));
}

function getAncestorAreas(area) {
  const ancestors = [];
  let current = getParentArea(area);

  while (current) {
    ancestors.push(current);
    current = getParentArea(current);
  }

  return ancestors;
}

function resolveComparableArea(area) {
  const normalizedArea = normalizeAreaName(area);

  if (!isKnownArea(normalizedArea)) {
    return null;
  }

  return isMicroFocus(normalizedArea) ? getParentArea(normalizedArea) : normalizedArea;
}

function isInvalidParentChildConflict(focusArea, deprioritizedArea) {
  const normalizedFocus = normalizeAreaName(focusArea);
  const normalizedDeprioritized = normalizeAreaName(deprioritizedArea);

  if (!normalizedFocus || !normalizedDeprioritized) {
    return false;
  }

  return getAncestorAreas(normalizedFocus).includes(normalizedDeprioritized);
}

function isInvalidSiblingCombination(focusArea, deprioritizedArea) {
  const comparableFocus = resolveComparableArea(focusArea);
  const comparableDeprioritized = resolveComparableArea(deprioritizedArea);

  if (!comparableFocus || !comparableDeprioritized) {
    return false;
  }

  return Boolean(
    BIOMECHANICAL_CONFLICT_MATRIX.get(comparableFocus)?.has(comparableDeprioritized)
  );
}

module.exports = {
  AREA_DEFINITIONS,
  BIOMECHANICAL_CONFLICT_MATRIX,
  DEPRIORITIZED_WEIGHT,
  DEPRIORITIZABLE_AREAS,
  PRIMARY_WEIGHT,
  SECONDARY_WEIGHT,
  getAncestorAreas,
  getAreaDefinition,
  getParentArea,
  isDeprioritizableArea,
  isInvalidParentChildConflict,
  isInvalidSiblingCombination,
  isKnownArea,
  isMicroFocus,
  normalizeAreaName,
  resolveComparableArea,
};
