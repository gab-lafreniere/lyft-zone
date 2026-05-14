const { resolveEquipmentContext } = require('../programGeneration/equipmentResolver');
const { resolveMovementConstraints } = require('../programGeneration/movementConstraintResolver');
const { resolveMusclePriorityProfile } = require('../programGeneration/musclePriorityResolver');

const TRAINING_PROFILE_SCHEMA_VERSION = 1;

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
      trainingEnvironment: equipmentContext.trainingEnvironment,
      equipmentSetup: equipmentContext.equipmentSetup,
      equipmentList: equipmentContext.availableEquipment,
      equipmentBias: equipmentContext.equipmentBias,
      hardConstraints: equipmentContext.hardConstraints,
      softBiases: equipmentContext.softBiases,
    },
    constraints: {
      painDescription: movementConstraints.painDescription,
      affectedArea: movementConstraints.affectedArea,
      painSeverity: movementConstraints.painSeverity,
      trainingRule: movementConstraints.trainingRule,
      aiDetectedPatterns: movementConstraints.aiDetectedPatterns,
      confirmedPatterns: movementConstraints.confirmedPatterns,
      cautionMovementPatterns: movementConstraints.cautionMovementPatterns,
      blockedMovementPatterns: movementConstraints.blockedMovementPatterns,
      cautionJointStressTags: movementConstraints.cautionJointStressTags,
      blockedJointStressTags: movementConstraints.blockedJointStressTags,
      blockedExerciseIds: movementConstraints.blockedExerciseIds,
    },
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
