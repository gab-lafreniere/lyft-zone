const { getPrisma } = require('../../../lib/prisma');
const {
  buildExercisePoolFromSnapshot,
  ExercisePoolServiceError,
} = require('../../../services/exercisePoolService');
const {
  createExercisePoolItems,
  createPoolSnapshot,
  createPoolSummary,
} = require('./poolSnapshot');

const PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION = 2;

function attachCoachInputsToProgramGenerationContext(
  context,
  { doctrine, promptVersion } = {}
) {
  return {
    ...context,
    schemaVersion: PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
    coachInputs: {
      doctrineId: doctrine?.id || null,
      doctrineVersion: doctrine?.version || null,
      derivedFromDoctrineVersion: doctrine?.derivedFromDoctrineVersion || null,
      promptVersion: promptVersion || null,
    },
  };
}

async function buildProgramGenerationContext(userId, options = {}, deps = {}) {
  if (!userId) {
    throw new ExercisePoolServiceError('VALIDATION_ERROR', 'userId is required');
  }

  const prisma = deps.prisma || getPrisma();
  const profileRecord = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      onboardingSnapshot: true,
    },
  });
  const snapshot = profileRecord?.onboardingSnapshot;
  const poolResult = await buildExercisePoolFromSnapshot(
    userId,
    snapshot,
    options.poolOptions || {},
    deps
  );
  const profile = snapshot.profile;
  const poolSnapshot = createPoolSnapshot(poolResult);

  return {
    schemaVersion: PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
    generationMode: 'weekly_plan_draft',
    coachInputs: null,
    userId,
    createdAt: poolSnapshot.generatedAt,
    profileSchemaVersion: snapshot.schemaVersion,
    primaryGoal: profile.primaryGoal || null,
    experience: profile.experience || null,
    availability: {
      sessionsPerWeek: profile.availability?.sessionsPerWeek ?? null,
      durationPerSession: profile.availability?.durationPerSession ?? null,
    },
    musclePriorityProfile: poolResult.context?.musclePriorityProfile || {},
    equipmentContext: poolResult.context?.equipmentContext || {},
    movementConstraints: poolResult.context?.movementConstraints || {},
    cardioProfile: poolResult.context?.cardioProfile || {
      cardioRole: null,
      preferredModalities: [],
    },
    physicalNotes: profile.physicalNotes || null,
    poolSummary: createPoolSummary(poolResult),
    poolSnapshot,
    exercisePoolItems: createExercisePoolItems(poolResult),
  };
}

module.exports = {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
  attachCoachInputsToProgramGenerationContext,
  buildProgramGenerationContext,
};
