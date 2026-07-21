const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('./programGenerationContextBuilder');
const {
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('./weeklyPlanEvaluationPolicy');
const {
  getParentArea,
  isMicroFocus,
  normalizeAreaName,
} = require('../trainingProfile/trainingProfileRules');
const exerciseEnums = require('../../exercise-library/exercise-enums.json');

const PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION = 1;
const ALLOWED_ACTIVATION_WEIGHTS = new Set(
  exerciseEnums.muscleActivationValues || []
);
const CARDIO_ROLES = new Set([
  'none',
  'warm_up_only',
  'cardio_sessions',
  'warm_up_and_cardio',
]);

class ProgramGenerationPromptInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProgramGenerationPromptInputError';
    this.code = code;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCanonicalArray(value) {
  const result = [];
  const seen = new Set();

  toArray(value).forEach((entry) => {
    const normalized = normalizeValue(entry);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result;
}

function copyArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function assignNonEmpty(target, key, value) {
  if (value == null || value === '') {
    return;
  }

  if (Array.isArray(value) && value.length === 0) {
    return;
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return;
  }

  target[key] = value;
}

function invalidContext(message) {
  return new ProgramGenerationPromptInputError(
    'INVALID_PROGRAM_GENERATION_CONTEXT',
    message
  );
}

function assertProgramGenerationContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw invalidContext('ProgramGenerationContext V4 is required');
  }

  if (context.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION) {
    throw invalidContext('ProgramGenerationContext V4 is required');
  }

  if (
    context.evaluationPolicy?.id !== WEEKLY_PLAN_EVALUATION_POLICY_ID ||
    context.evaluationPolicy?.version !== WEEKLY_PLAN_EVALUATION_POLICY_VERSION
  ) {
    throw invalidContext('Canonical Evaluation Policy V1 is required');
  }

  if (
    !context.availability ||
    typeof context.availability !== 'object' ||
    Array.isArray(context.availability) ||
    !Number.isInteger(context.availability.sessionsPerWeek) ||
    context.availability.sessionsPerWeek <= 0 ||
    !Number.isInteger(context.availability.durationPerSession) ||
    context.availability.durationPerSession <= 0
  ) {
    throw invalidContext('ProgramGenerationContext availability is invalid');
  }

  if (!Array.isArray(context.exercisePoolItems)) {
    throw invalidContext('ProgramGenerationContext exercisePoolItems are required');
  }
}

function ratioMatchesBand(ratio, band = {}) {
  if (Number.isFinite(band.minInclusive) && ratio < band.minInclusive) {
    return false;
  }

  if (Number.isFinite(band.minExclusive) && ratio <= band.minExclusive) {
    return false;
  }

  if (Number.isFinite(band.maxInclusive) && ratio > band.maxInclusive) {
    return false;
  }

  if (Number.isFinite(band.maxExclusive) && ratio >= band.maxExclusive) {
    return false;
  }

  return true;
}

function getFiniteUpperBound(band = {}) {
  if (Number.isFinite(band.maxInclusive)) {
    return band.maxInclusive;
  }

  if (Number.isFinite(band.maxExclusive)) {
    return band.maxExclusive;
  }

  return null;
}

function buildIntegerRange(values, label) {
  if (!values.length) {
    throw invalidContext(`${label} duration range is unavailable`);
  }

  const minimum = values[0];
  const maximum = values[values.length - 1];
  const expectedCount = maximum - minimum + 1;

  if (values.length !== expectedCount) {
    throw invalidContext(`${label} duration range is not contiguous`);
  }

  return { minimum, maximum };
}

function projectTrainingSchedule(context) {
  const requestedMinutes = context.availability.durationPerSession;
  const bands = context.evaluationPolicy?.duration?.alignment?.bands;

  if (!Array.isArray(bands) || bands.length === 0) {
    throw invalidContext('Evaluation Policy duration bands are required');
  }

  const acceptableBands = bands.filter((band) => band?.requiresCorrection === false);
  const finiteUpperBounds = acceptableBands
    .map(getFiniteUpperBound)
    .filter(Number.isFinite);

  if (
    acceptableBands.length === 0 ||
    finiteUpperBounds.length !== acceptableBands.length
  ) {
    throw invalidContext('Evaluation Policy non-correction bands must be bounded');
  }

  const maximumRatio = Math.max(...finiteUpperBounds);
  const maximumCandidateMinutes = Math.ceil(requestedMinutes * maximumRatio) + 1;
  const acceptableMinutes = [];
  const preferredMinutes = [];

  for (let minutes = 0; minutes <= maximumCandidateMinutes; minutes += 1) {
    const ratio = minutes / requestedMinutes;
    const matchingBand = acceptableBands.find((band) => ratioMatchesBand(ratio, band));

    if (!matchingBand) {
      continue;
    }

    acceptableMinutes.push(minutes);
    if (matchingBand.status === 'preferred') {
      preferredMinutes.push(minutes);
    }
  }

  return {
    sessionsPerWeek: context.availability.sessionsPerWeek,
    approximateDurationMinutes: requestedMinutes,
    acceptableDurationMinutes: buildIntegerRange(acceptableMinutes, 'Acceptable'),
    preferredDurationMinutes: buildIntegerRange(preferredMinutes, 'Preferred'),
  };
}

function projectMusclePriorities(value = {}) {
  const primary = normalizeAreaName(value.primaryFocus);
  const secondary = normalizeCanonicalArray(value.secondaryFocuses);
  const deprioritized = normalizeAreaName(value.deprioritizedArea);
  const result = {};
  const microFocuses = [];

  assignNonEmpty(result, 'primary', primary);
  assignNonEmpty(result, 'secondary', secondary);
  assignNonEmpty(result, 'deprioritized', deprioritized);

  if (primary && isMicroFocus(primary)) {
    microFocuses.push({
      area: primary,
      parentArea: getParentArea(primary),
      priority: 'primary',
    });
  }

  secondary.forEach((area) => {
    if (isMicroFocus(area)) {
      microFocuses.push({
        area,
        parentArea: getParentArea(area),
        priority: 'secondary',
      });
    }
  });

  assignNonEmpty(result, 'microFocuses', microFocuses);
  return result;
}

function projectExercisePreference(equipmentContext = {}) {
  const preference = normalizeValue(equipmentContext.equipmentBias);

  if (preference !== 'machines' && preference !== 'free_weights') {
    return null;
  }

  return {
    preference,
    isSoftPreference: true,
  };
}

function projectCardioGuidance(cardioProfile = {}) {
  const role = normalizeValue(cardioProfile.cardioRole);

  if (!role) {
    return null;
  }

  if (!CARDIO_ROLES.has(role)) {
    throw invalidContext('ProgramGenerationContext cardio role is invalid');
  }

  const result = { role };
  if (role !== 'none') {
    assignNonEmpty(
      result,
      'preferredModalities',
      normalizeCanonicalArray(cardioProfile.preferredModalities)
    );
  }

  return result;
}

function projectMovementConsiderations(movementConstraints = {}) {
  const cautionMovementPatterns = normalizeCanonicalArray(
    movementConstraints.cautionMovementPatterns
  );
  const cautionJointStressTags = normalizeCanonicalArray(
    movementConstraints.cautionJointStressTags
  );

  if (!cautionMovementPatterns.length && !cautionJointStressTags.length) {
    return null;
  }

  const result = {};
  assignNonEmpty(result, 'cautionMovementPatterns', cautionMovementPatterns);
  assignNonEmpty(result, 'cautionJointStressTags', cautionJointStressTags);
  return result;
}

function readMuscleActivation(value) {
  const result = {
    weights: new Map(),
    validMuscles: [],
    invalidActivationEntryCount: 0,
  };

  if (value == null) {
    return result;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    result.invalidActivationEntryCount = 1;
    return result;
  }

  Object.entries(value).forEach(([rawMuscle, weight]) => {
    const muscle = normalizeValue(rawMuscle);
    if (
      !muscle ||
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      !ALLOWED_ACTIVATION_WEIGHTS.has(weight)
    ) {
      result.invalidActivationEntryCount += 1;
      return;
    }

    if (!result.weights.has(muscle)) {
      result.weights.set(muscle, weight);
      result.validMuscles.push(muscle);
    }
  });

  return result;
}

function projectMuscleContributions(item = {}) {
  const primaryMuscles = normalizeCanonicalArray(item.targetMuscles);
  const primarySet = new Set(primaryMuscles);
  const secondaryMuscles = normalizeCanonicalArray(item.secondaryMuscles).filter(
    (muscle) => !primarySet.has(muscle)
  );
  const classifiedMuscles = new Set([...primaryMuscles, ...secondaryMuscles]);
  const activation = readMuscleActivation(item.muscleActivation);
  const contributions = [];

  primaryMuscles.forEach((muscle) => {
    contributions.push({
      muscle,
      role: 'primary',
      activationWeight: activation.weights.get(muscle) ?? null,
    });
  });

  secondaryMuscles.forEach((muscle) => {
    contributions.push({
      muscle,
      role: 'secondary',
      activationWeight: activation.weights.get(muscle) ?? null,
    });
  });

  return {
    contributions,
    diagnostics: {
      activationMusclesNotClassifiedCount: activation.validMuscles.filter(
        (muscle) => !classifiedMuscles.has(muscle)
      ).length,
      primaryMusclesMissingActivationCount: primaryMuscles.filter(
        (muscle) => !activation.weights.has(muscle)
      ).length,
      secondaryMusclesMissingActivationCount: secondaryMuscles.filter(
        (muscle) => !activation.weights.has(muscle)
      ).length,
      invalidActivationEntryCount: activation.invalidActivationEntryCount,
    },
  };
}

function mergeDiagnostics(target, source) {
  Object.keys(target).forEach((key) => {
    target[key] += source[key] || 0;
  });
}

function projectCautionMatches(item = {}) {
  const movementContext = item.softSignals?.movementContext || {};
  return normalizeCanonicalArray([
    ...toArray(movementContext.matchedCautionPatterns),
    ...toArray(movementContext.matchedCautionJointStressTags),
  ]);
}

function projectStrengthExercise(item, diagnostics) {
  const result = {
    exerciseId: item.exerciseId,
    name: item.name,
    trainingType: item.trainingType,
  };
  const muscleProjection = projectMuscleContributions(item);
  const cautionMatches = projectCautionMatches(item);

  assignNonEmpty(result, 'equipmentCategory', item.equipmentCategory);
  assignNonEmpty(result, 'difficulty', item.difficulty);
  if (Number.isFinite(item.fatigueScore)) {
    result.fatigueScore = item.fatigueScore;
  }
  if (typeof item.isSupersetFriendly === 'boolean') {
    result.isSupersetFriendly = item.isSupersetFriendly;
  }
  assignNonEmpty(result, 'mechanicType', item.mechanicType);
  assignNonEmpty(result, 'movementPattern', item.movementPattern);
  assignNonEmpty(result, 'bodyParts', copyArray(item.bodyParts));
  assignNonEmpty(result, 'muscleFocus', copyArray(item.muscleFocus));
  result.muscleContributions = muscleProjection.contributions;
  assignNonEmpty(result, 'unilateralType', item.unilateralType);
  assignNonEmpty(result, 'cautionMatches', cautionMatches);

  mergeDiagnostics(diagnostics, muscleProjection.diagnostics);
  return result;
}

function projectCardioExercise(item) {
  const result = {
    exerciseId: item.exerciseId,
    name: item.name,
    trainingType: item.trainingType,
  };
  const fatigue = item.softSignals?.fatigue || {};

  assignNonEmpty(result, 'cardioModality', item.cardioModality);
  const cardioFatigueScore = item.cardioFatigueScore ?? fatigue.cardioFatigueScore;
  if (Number.isFinite(cardioFatigueScore)) {
    result.cardioFatigueScore = cardioFatigueScore;
  }
  assignNonEmpty(
    result,
    'lowerBodyFatigueBias',
    item.lowerBodyFatigueBias ?? fatigue.lowerBodyFatigueBias
  );
  assignNonEmpty(result, 'cardioImpactLevel', item.cardioImpactLevel);

  return result;
}

function projectExercisePool(items) {
  const diagnostics = {
    activationMusclesNotClassifiedCount: 0,
    primaryMusclesMissingActivationCount: 0,
    secondaryMusclesMissingActivationCount: 0,
    invalidActivationEntryCount: 0,
  };
  const exercises = items.map((item) =>
    normalizeValue(item?.trainingType) === 'cardio'
      ? projectCardioExercise(item || {})
      : projectStrengthExercise(item || {}, diagnostics)
  );

  return { exercises, diagnostics };
}

function buildProjectionResult(context) {
  assertProgramGenerationContext(context);

  const athleteBrief = {};
  const musclePriorities = projectMusclePriorities(context.musclePriorityProfile);
  const exercisePreference = projectExercisePreference(context.equipmentContext);
  const cardio = projectCardioGuidance(context.cardioProfile);
  const movementConsiderations = projectMovementConsiderations(
    context.movementConstraints
  );
  const physicalNotes =
    typeof context.physicalNotes === 'string' ? context.physicalNotes.trim() : '';
  const poolProjection = projectExercisePool(context.exercisePoolItems);

  assignNonEmpty(athleteBrief, 'primaryGoal', context.primaryGoal);
  assignNonEmpty(athleteBrief, 'experience', context.experience);
  athleteBrief.trainingSchedule = projectTrainingSchedule(context);
  assignNonEmpty(athleteBrief, 'musclePriorities', musclePriorities);
  assignNonEmpty(athleteBrief, 'exercisePreference', exercisePreference);
  assignNonEmpty(athleteBrief, 'cardio', cardio);
  assignNonEmpty(athleteBrief, 'movementConsiderations', movementConsiderations);
  assignNonEmpty(athleteBrief, 'physicalNotes', physicalNotes);

  return {
    promptInput: {
      schemaVersion: PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
      athleteBrief,
      eligibleExercisePool: poolProjection.exercises,
    },
    muscleContributionDiagnostics: poolProjection.diagnostics,
  };
}

function buildProgramGenerationPromptInput(context) {
  return buildProjectionResult(context).promptInput;
}

function buildProgramGenerationPromptInputDiagnostics(context) {
  return buildProjectionResult(context).muscleContributionDiagnostics;
}

module.exports = {
  PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
  ProgramGenerationPromptInputError,
  buildProgramGenerationPromptInput,
  buildProgramGenerationPromptInputDiagnostics,
};
