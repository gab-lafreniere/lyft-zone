const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('./programGenerationContextBuilder');
const {
  buildWeeklyPlanTrainingMetricsPromptProjection,
} = require('./weeklyPlanTrainingMetricsPromptProjection');
const {
  buildEligibleExerciseCoverageCounts,
  resolveEligibleExerciseCoverageLevel,
} = require('./programGenerationPoolCoverage');
const {
  getParentArea,
  isMicroFocus,
  normalizeAreaName,
} = require('../trainingProfile/trainingProfileRules');
const exerciseEnums = require('../../exercise-library/exercise-enums.json');

const PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION = 6;
const MAX_DURATION_PER_SESSION_MINUTES = 120;
const MAX_POOL_COVERAGE_NOTES = 3;
const CANONICAL_BODY_PARTS = Object.freeze([
  ...(exerciseEnums.bodyParts || []),
]);
const CANONICAL_MUSCLE_FOCUSES = Object.freeze([
  ...(exerciseEnums.muscleFocus || []),
]);
const BODY_PART_SET = new Set(CANONICAL_BODY_PARTS);
const MUSCLE_FOCUS_SET = new Set(CANONICAL_MUSCLE_FOCUSES);
const COVERAGE_LEVEL_ORDER = Object.freeze({
  unavailable: 0,
  severely_limited: 1,
  limited: 2,
});
const ALLOWED_ACTIVATION_WEIGHTS = new Set(
  exerciseEnums.muscleActivationValues || []
);
const CARDIO_ROLES = new Set([
  'none',
  'warm_up_only',
  'cardio_sessions',
  'warm_up_and_cardio',
]);
const PHYSICAL_SIGNAL_TYPES = new Set([
  'movementPattern',
  'jointStressTag',
]);
const PHYSICAL_SIGNAL_DECISIONS = new Set(['monitor', 'caution']);
const EXERCISE_PREFERENCES = new Set([
  'machines',
  'free_weights',
  'no_preference',
]);
const SEX_VALUES = new Set(['MALE', 'FEMALE']);

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
  if (
    value == null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
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
    throw invalidContext('ProgramGenerationContext V5 is required');
  }

  if (context.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION) {
    throw invalidContext('ProgramGenerationContext V5 is required');
  }

  if (
    !context.availability ||
    typeof context.availability !== 'object' ||
    Array.isArray(context.availability) ||
    !Number.isInteger(context.availability.sessionsPerWeek) ||
    context.availability.sessionsPerWeek <= 0 ||
    !Number.isInteger(context.availability.durationPerSession) ||
    context.availability.durationPerSession <= 0 ||
    context.availability.durationPerSession >
      MAX_DURATION_PER_SESSION_MINUTES
  ) {
    throw invalidContext('ProgramGenerationContext availability is invalid');
  }

  if (!Array.isArray(context.exercisePoolItems)) {
    throw invalidContext('ProgramGenerationContext exercisePoolItems are required');
  }
}

function projectTrainingSchedule(context, trainingMetricsGuidance) {
  return {
    sessionsPerWeek: context.availability.sessionsPerWeek,
    approximateDurationMinutes: trainingMetricsGuidance.requestedMinutes,
  };
}

function projectDemographics(value) {
  if (value == null) {
    return null;
  }

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !SEX_VALUES.has(value.sex) ||
    typeof value.ageBand !== 'string' ||
    !value.ageBand.trim()
  ) {
    throw invalidContext('ProgramGenerationContext demographics are invalid');
  }

  return {
    sex: value.sex,
    ageBand: value.ageBand.trim(),
  };
}

function projectConfirmedCautions(value) {
  const cautions = [];
  const seen = new Set();

  toArray(value).forEach((issue) => {
    toArray(issue?.confirmedSignals).forEach((signal) => {
      const type = String(signal?.type || '').trim();
      const signalValue = normalizeValue(signal?.value);
      const decision = normalizeValue(signal?.decision);
      if (
        !PHYSICAL_SIGNAL_TYPES.has(type) ||
        !signalValue ||
        decision !== 'caution'
      ) {
        return;
      }

      const key = `${type}:${signalValue}`;
      if (!seen.has(key)) {
        seen.add(key);
        cautions.push({ type, value: signalValue });
      }
    });
  });

  return cautions;
}

function projectAppliedConstraints(context) {
  const movementConstraints = context.movementConstraints || {};
  const equipmentContext = context.equipmentContext || {};
  const result = {};

  assignNonEmpty(
    result,
    'blockedMovementPatterns',
    normalizeCanonicalArray(movementConstraints.blockedMovementPatterns)
  );
  assignNonEmpty(
    result,
    'blockedJointStressTags',
    normalizeCanonicalArray(movementConstraints.blockedJointStressTags)
  );
  assignNonEmpty(
    result,
    'confirmedCautions',
    projectConfirmedCautions(context.promptPhysicalConsiderations)
  );
  assignNonEmpty(
    result,
    'equipmentPreset',
    normalizeValue(equipmentContext.equipmentPreset)
  );
  assignNonEmpty(
    result,
    'availableEquipment',
    normalizeCanonicalArray(equipmentContext.availableEquipment)
  );
  assignNonEmpty(
    result,
    'cardioRole',
    normalizeValue(context.cardioProfile?.cardioRole)
  );

  if (
    Number.isSafeInteger(context.poolSummary?.excludedExercises) &&
    context.poolSummary.excludedExercises >= 0
  ) {
    result.excludedExerciseCount = context.poolSummary.excludedExercises;
  }

  return result;
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

  if (!preference) {
    return null;
  }
  if (!EXERCISE_PREFERENCES.has(preference)) {
    throw invalidContext(
      'ProgramGenerationContext exercise preference is invalid'
    );
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

function projectPhysicalConsiderations(value) {
  return toArray(value)
    .filter((issue) => issue && typeof issue === 'object' && !Array.isArray(issue))
    .map((issue) => {
      const confirmedSignals = [];
      const seen = new Set();

      toArray(issue.confirmedSignals).forEach((signal) => {
        if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
          return;
        }

        const type = String(signal.type || '').trim();
        const signalValue = normalizeValue(signal.value);
        const decision = normalizeValue(signal.decision);

        if (
          !PHYSICAL_SIGNAL_TYPES.has(type) ||
          !signalValue ||
          !PHYSICAL_SIGNAL_DECISIONS.has(decision)
        ) {
          return;
        }

        const key = `${decision}:${type}:${signalValue}`;
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        confirmedSignals.push({
          type,
          value: signalValue,
          decision,
        });
      });

      return {
        aiSummary:
          typeof issue.aiSummary === 'string' && issue.aiSummary.trim()
            ? issue.aiSummary.trim()
            : null,
        confirmedSignals,
      };
    })
    .filter((issue) => issue.confirmedSignals.length > 0);
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

function projectMuscles(item = {}) {
  const primaryMuscles = normalizeCanonicalArray(item.targetMuscles);
  const primarySet = new Set(primaryMuscles);
  const secondaryMuscles = normalizeCanonicalArray(item.secondaryMuscles).filter(
    (muscle) => !primarySet.has(muscle)
  );
  const classifiedMuscles = new Set([...primaryMuscles, ...secondaryMuscles]);
  const activation = readMuscleActivation(item.muscleActivation);
  const primary = {};
  const secondary = {};

  primaryMuscles.forEach((muscle) => {
    primary[muscle] = activation.weights.get(muscle) ?? null;
  });

  secondaryMuscles.forEach((muscle) => {
    secondary[muscle] = activation.weights.get(muscle) ?? null;
  });

  const muscles = {};
  assignNonEmpty(muscles, 'primary', primary);
  assignNonEmpty(muscles, 'secondary', secondary);

  return {
    muscles,
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
  };
  const muscleProjection = projectMuscles(item);
  const cautionMatches = projectCautionMatches(item);

  assignNonEmpty(result, 'equipmentCategory', item.equipmentCategory);
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
  assignNonEmpty(result, 'muscles', muscleProjection.muscles);
  assignNonEmpty(result, 'unilateralType', item.unilateralType);
  assignNonEmpty(result, 'cautionMatches', cautionMatches);

  mergeDiagnostics(diagnostics, muscleProjection.diagnostics);
  return result;
}

function projectCardioExercise(item) {
  const result = {
    exerciseId: item.exerciseId,
    name: item.name,
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

function buildProgramGenerationExercisePoolPromptProjection(items) {
  const diagnostics = {
    activationMusclesNotClassifiedCount: 0,
    primaryMusclesMissingActivationCount: 0,
    secondaryMusclesMissingActivationCount: 0,
    invalidActivationEntryCount: 0,
  };
  const strengthExercises = [];
  const cardioExercises = [];

  items.forEach((item) => {
    const trainingType = item?.trainingType;
    if (trainingType === 'cardio') {
      cardioExercises.push(projectCardioExercise(item || {}));
      return;
    }

    if (trainingType === 'strength') {
      strengthExercises.push(projectStrengthExercise(item || {}, diagnostics));
      return;
    }

    throw invalidContext(
      'ProgramGenerationContext exercise trainingType is invalid'
    );
  });

  return {
    exercises: {
      strengthExercises,
      cardioExercises,
    },
    diagnostics,
  };
}

function buildCoverageNote(taxonomy, area, eligibleExerciseCount) {
  const coverageLevel = resolveEligibleExerciseCoverageLevel(
    eligibleExerciseCount
  );
  if (!coverageLevel) {
    return null;
  }

  return {
    taxonomy,
    area,
    eligibleExerciseCount,
    coverageLevel,
  };
}

function resolvePriorityTaxonomy(area) {
  if (BODY_PART_SET.has(area)) {
    return 'bodyPart';
  }
  if (MUSCLE_FOCUS_SET.has(area)) {
    return 'muscleFocus';
  }
  return null;
}

function buildProgramGenerationPoolCoverageNotes({
  eligibleExercisePool,
  musclePriorities,
} = {}) {
  const exercises = [
    ...(eligibleExercisePool?.strengthExercises || []),
    ...(eligibleExercisePool?.cardioExercises || []),
  ];
  const bodyPartCounts = buildEligibleExerciseCoverageCounts(
    exercises,
    'bodyParts',
    CANONICAL_BODY_PARTS
  );
  const muscleFocusCounts = buildEligibleExerciseCoverageCounts(
    exercises,
    'muscleFocus',
    CANONICAL_MUSCLE_FOCUSES
  );
  const notes = [];
  const seen = new Set();
  const priorities = [
    musclePriorities?.primary,
    ...(musclePriorities?.secondary || []),
  ].filter(Boolean);

  priorities.forEach((area) => {
    const taxonomy = resolvePriorityTaxonomy(area);
    if (!taxonomy) {
      return;
    }

    const key = `${taxonomy}:${area}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const eligibleExerciseCount =
      taxonomy === 'bodyPart'
        ? bodyPartCounts.get(area)
        : muscleFocusCounts.get(area);
    const note = buildCoverageNote(
      taxonomy,
      area,
      eligibleExerciseCount
    );
    if (note) {
      notes.push(note);
    }
  });

  const deprioritizedArea = musclePriorities?.deprioritized || null;
  const generalBodyPartNotes = CANONICAL_BODY_PARTS
    .filter((area) => area !== deprioritizedArea)
    .filter((area) => !seen.has(`bodyPart:${area}`))
    .map((area, canonicalIndex) => ({
      note: buildCoverageNote(
        'bodyPart',
        area,
        bodyPartCounts.get(area)
      ),
      canonicalIndex,
    }))
    .filter(({ note }) => Boolean(note))
    .sort(
      (left, right) =>
        COVERAGE_LEVEL_ORDER[left.note.coverageLevel] -
          COVERAGE_LEVEL_ORDER[right.note.coverageLevel] ||
        left.canonicalIndex - right.canonicalIndex
    )
    .map(({ note }) => note);

  return [...notes, ...generalBodyPartNotes].slice(
    0,
    MAX_POOL_COVERAGE_NOTES
  );
}

function buildProjectionResult(context) {
  assertProgramGenerationContext(context);

  let trainingMetricsGuidance;
  try {
    trainingMetricsGuidance = buildWeeklyPlanTrainingMetricsPromptProjection({
      requestedDurationMinutes: context.availability.durationPerSession,
    });
  } catch (_error) {
    throw invalidContext('Canonical Training Metrics Guidance is invalid');
  }

  const athleteBrief = {};
  const demographics = projectDemographics(context.demographics);
  const musclePriorities = projectMusclePriorities(context.musclePriorityProfile);
  const exercisePreference = projectExercisePreference(context.equipmentContext);
  const cardio = projectCardioGuidance(context.cardioProfile);
  const physicalConsiderations = projectPhysicalConsiderations(
    context.promptPhysicalConsiderations
  );
  const physicalNotes =
    typeof context.physicalNotes === 'string' ? context.physicalNotes.trim() : '';
  const poolProjection =
    buildProgramGenerationExercisePoolPromptProjection(
      context.exercisePoolItems
    );
  const poolCoverageNotes = buildProgramGenerationPoolCoverageNotes({
    eligibleExercisePool: poolProjection.exercises,
    musclePriorities,
  });

  assignNonEmpty(athleteBrief, 'primaryGoal', context.primaryGoal);
  assignNonEmpty(athleteBrief, 'experience', context.experience);
  assignNonEmpty(athleteBrief, 'demographics', demographics);
  athleteBrief.trainingSchedule = projectTrainingSchedule(
    context,
    trainingMetricsGuidance
  );
  assignNonEmpty(athleteBrief, 'musclePriorities', musclePriorities);
  assignNonEmpty(athleteBrief, 'exercisePreference', exercisePreference);
  assignNonEmpty(athleteBrief, 'cardio', cardio);
  assignNonEmpty(
    athleteBrief,
    'physicalConsiderations',
    physicalConsiderations
  );
  assignNonEmpty(athleteBrief, 'physicalNotes', physicalNotes);

  const promptInput = {
    schemaVersion: PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
    athleteBrief,
    trainingMetricsGuidance,
    appliedConstraints: projectAppliedConstraints(context),
    eligibleExercisePool: poolProjection.exercises,
  };
  assignNonEmpty(promptInput, 'poolCoverageNotes', poolCoverageNotes);

  return {
    promptInput,
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
  buildProgramGenerationExercisePoolPromptProjection,
  buildProgramGenerationPoolCoverageNotes,
  buildProgramGenerationPromptInput,
  buildProgramGenerationPromptInputDiagnostics,
};
