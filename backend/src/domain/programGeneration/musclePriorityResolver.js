const {
  DEPRIORITIZED_WEIGHT,
  PRIMARY_WEIGHT,
  SECONDARY_WEIGHT,
  getParentArea,
} = require('../trainingProfile/trainingProfileRules');

function resolveMusclePriorityProfile(normalizedProfile = {}) {
  const priorities = normalizedProfile.musclePriorities || {};
  const primaryFocus = priorities.primaryFocus || null;
  const secondaryFocuses = Array.isArray(priorities.secondaryFocuses)
    ? priorities.secondaryFocuses
    : [];
  const deprioritizedArea = priorities.deprioritizedArea || null;
  const perAreaWeights = {};

  if (primaryFocus) {
    perAreaWeights[primaryFocus] = PRIMARY_WEIGHT;
  }

  secondaryFocuses.forEach((area) => {
    perAreaWeights[area] = SECONDARY_WEIGHT;
  });

  if (deprioritizedArea) {
    perAreaWeights[deprioritizedArea] = DEPRIORITIZED_WEIGHT;
  }

  return {
    primaryFocus,
    secondaryFocuses,
    deprioritizedArea,
    weights: {
      primary: PRIMARY_WEIGHT,
      secondary: SECONDARY_WEIGHT,
      deprioritized: DEPRIORITIZED_WEIGHT,
    },
    perAreaWeights,
    parentAreas: {
      primaryFocus: primaryFocus ? getParentArea(primaryFocus) : null,
      secondaryFocuses: secondaryFocuses.map((area) => ({
        area,
        parentArea: getParentArea(area),
      })),
      deprioritizedArea: deprioritizedArea
        ? getParentArea(deprioritizedArea)
        : null,
    },
  };
}

module.exports = {
  resolveMusclePriorityProfile,
};
