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
const {
  resolvePromptPhysicalConsiderations,
} = require('./movementConstraintResolver');
const {
  DEMOGRAPHICS_STATUS,
  calculateCurrentAge,
  deriveDemographicsStatus,
} = require('../userProfile/userProfileDemographics');
const { formatAgeBand } = require('./ageBand');

const PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION = 5;

function attachCoachInputsToProgramGenerationContext(
  context,
  { doctrine, promptVersion } = {}
) {
  return {
    ...context,
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
      age: true,
      ageInputDate: true,
      sex: true,
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
  const includeEvaluationPolicy = options.includeEvaluationPolicy !== false;
  const evaluationPolicy = includeEvaluationPolicy
    ? deps.evaluationPolicy ||
      require('./weeklyPlanEvaluationPolicy').WEEKLY_PLAN_EVALUATION_POLICY
    : null;
  const demographicsStatus = deriveDemographicsStatus(profileRecord, deps.now);
  const currentAge = demographicsStatus === DEMOGRAPHICS_STATUS.LOCKED
    ? calculateCurrentAge({
      storedAge: profileRecord.age,
      ageInputDate: profileRecord.ageInputDate,
      referenceDate: deps.now,
    })
    : null;
  const ageBand = formatAgeBand(currentAge);
  const demographics =
    demographicsStatus === DEMOGRAPHICS_STATUS.LOCKED && ageBand
      ? { sex: profileRecord.sex, ageBand }
      : null;

  return {
    schemaVersion: PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
    generationMode: 'weekly_plan_draft',
    coachInputs: null,
    userId,
    createdAt: poolSnapshot.generatedAt,
    profileSchemaVersion: snapshot.schemaVersion,
    primaryGoal: profile.primaryGoal || null,
    experience: profile.experience || null,
    demographics,
    availability: {
      sessionsPerWeek: profile.availability?.sessionsPerWeek ?? null,
      durationPerSession: profile.availability?.durationPerSession ?? null,
    },
    evaluationPolicy,
    musclePriorityProfile: poolResult.context?.musclePriorityProfile || {},
    equipmentContext: poolResult.context?.equipmentContext || {},
    movementConstraints: poolResult.context?.movementConstraints || {},
    promptPhysicalConsiderations:
      resolvePromptPhysicalConsiderations(profile),
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
