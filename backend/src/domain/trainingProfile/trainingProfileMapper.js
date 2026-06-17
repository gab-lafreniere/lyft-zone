const { resolveEquipmentContext } = require('../programGeneration/equipmentResolver');
const { resolveMovementConstraints } = require('../programGeneration/movementConstraintResolver');
const { resolveMusclePriorityProfile } = require('../programGeneration/musclePriorityResolver');

const TRAINING_PROFILE_SCHEMA_VERSION = 2;

function mapTrainingProfileToUserProfileUpdate(normalizedProfile) {
  const musclePriorityProfile = resolveMusclePriorityProfile(normalizedProfile);
  const equipmentContext = resolveEquipmentContext(normalizedProfile);
  const movementConstraints = resolveMovementConstraints(normalizedProfile);

  return {
    primaryGoal: normalizedProfile.primaryGoal,
    availableSessionsPerWeek: normalizedProfile.availability.sessionsPerWeek,
    sessionDurationMinutes: normalizedProfile.availability.durationPerSession,
    trainingPreferences: {
      experience: normalizedProfile.experience,
      exercisePreference: normalizedProfile.exercisePreference,
      cardioProfile: normalizedProfile.cardioProfile,
      physicalNotes: normalizedProfile.physicalNotes,
    },
    equipmentContext: {
      equipmentPreset: equipmentContext.equipmentPreset,
      availableEquipment: equipmentContext.availableEquipment,
      equipmentBias: equipmentContext.equipmentBias,
      hardConstraints: equipmentContext.hardConstraints,
      softBiases: equipmentContext.softBiases,
    },
    constraints: movementConstraints,
    musclePriorities: {
      primaryFocus: musclePriorityProfile.primaryFocus,
      secondaryFocuses: musclePriorityProfile.secondaryFocuses,
      deprioritizedArea: musclePriorityProfile.deprioritizedArea,
      weights: musclePriorityProfile.weights,
      perAreaWeights: musclePriorityProfile.perAreaWeights,
    },
    onboardingSnapshot: {
      schemaVersion: TRAINING_PROFILE_SCHEMA_VERSION,
      profile: normalizedProfile,
      derived: {
        musclePriorityProfile,
        equipmentContext,
        movementConstraints,
      },
    },
  };
}

module.exports = {
  TRAINING_PROFILE_SCHEMA_VERSION,
  mapTrainingProfileToUserProfileUpdate,
};
