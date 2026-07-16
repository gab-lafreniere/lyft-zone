const { isExerciseCompatible } = require('./exerciseCompatibilityRules');
const {
  getAncestorAreas,
  normalizeAreaName,
} = require('../trainingProfile/trainingProfileRules');

const EXERCISE_POOL_SCHEMA_VERSION = 1;

const STATUS_APPROVED = 'approved';
const STATUS_DRAFT = 'draft';
const TRAINING_TYPE_STRENGTH = 'strength';
const TRAINING_TYPE_CARDIO = 'cardio';
const EXCLUDED_TRAINING_TYPES = ['warmup', 'mobility', 'plyometric'];
const DIFFICULTY_BY_EXPERIENCE = Object.freeze({
  beginner: ['beginner'],
  intermediate: ['beginner', 'intermediate'],
  advanced: ['beginner', 'intermediate', 'advanced'],
});

const MACHINE_BIAS_CATEGORIES = new Set([
  'assisted_machine',
  'cable',
  'cardio_machine',
  'plate_loaded_machine',
  'selectorized_machine',
  'smith_machine',
]);

const FREE_WEIGHT_BIAS_CATEGORIES = new Set(['barbell', 'dumbbell', 'kettlebell']);

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeArray(value) {
  return Array.from(new Set(toArray(value).map(normalizeValue).filter(Boolean)));
}

function resolveMovementConstraintList(movementConstraints = {}, primaryKey, legacyKey) {
  if (hasOwn(movementConstraints, primaryKey)) {
    return normalizeArray(movementConstraints[primaryKey]);
  }

  if (legacyKey && hasOwn(movementConstraints, legacyKey)) {
    return normalizeArray(movementConstraints[legacyKey]);
  }

  return [];
}

function normalizeMovementConstraints(movementConstraints = {}) {
  return {
    painDescription: movementConstraints.painDescription || null,
    affectedArea: movementConstraints.affectedArea || null,
    painSeverity: movementConstraints.painSeverity || 'none',
    trainingRule: movementConstraints.trainingRule || 'none',
    cautionMovementPatterns: resolveMovementConstraintList(
      movementConstraints,
      'cautionMovementPatterns',
      'cautionPatterns'
    ),
    blockedMovementPatterns: resolveMovementConstraintList(
      movementConstraints,
      'blockedMovementPatterns',
      'blockedPatterns'
    ),
    cautionJointStressTags: resolveMovementConstraintList(
      movementConstraints,
      'cautionJointStressTags'
    ),
    blockedJointStressTags: resolveMovementConstraintList(
      movementConstraints,
      'blockedJointStressTags'
    ),
    blockedExerciseIds: resolveMovementConstraintList(
      movementConstraints,
      'blockedExerciseIds'
    ),
  };
}

function buildAllowedTrainingTypes(cardioRole) {
  const allowedTrainingTypes = [TRAINING_TYPE_STRENGTH];

  if (cardioRole && cardioRole !== 'none') {
    allowedTrainingTypes.push(TRAINING_TYPE_CARDIO);
  }

  return allowedTrainingTypes;
}

function buildAllowedDifficulties(experience) {
  const normalizedExperience = normalizeValue(experience);
  return DIFFICULTY_BY_EXPERIENCE[normalizedExperience] || [];
}

function getExerciseAreas(exercise = {}) {
  const areas = new Set();

  [exercise.bodyParts, exercise.muscleFocus].forEach((values) => {
    normalizeArray(values).forEach((area) => {
      areas.add(area);
      getAncestorAreas(area).forEach((ancestor) => areas.add(ancestor));
    });
  });

  return areas;
}

function resolveWeightHint(exerciseAreas, musclePriorityProfile = {}) {
  const matches = [];

  if (musclePriorityProfile.primaryFocus && exerciseAreas.has(musclePriorityProfile.primaryFocus)) {
    matches.push(musclePriorityProfile.weights?.primary || 0);
  }

  toArray(musclePriorityProfile.secondaryFocuses).forEach((area) => {
    if (exerciseAreas.has(area)) {
      matches.push(musclePriorityProfile.weights?.secondary || 0);
    }
  });

  if (
    musclePriorityProfile.deprioritizedArea &&
    exerciseAreas.has(musclePriorityProfile.deprioritizedArea)
  ) {
    matches.push(musclePriorityProfile.weights?.deprioritized || 0);
  }

  return matches.length ? Math.max(...matches) : 0;
}

function resolveEquipmentPreference(equipmentBias, equipmentCategory) {
  if (!equipmentBias || equipmentBias === 'no_preference') {
    return null;
  }

  const normalizedCategory = normalizeValue(equipmentCategory);

  if (equipmentBias === 'machines') {
    if (MACHINE_BIAS_CATEGORIES.has(normalizedCategory)) {
      return true;
    }

    if (FREE_WEIGHT_BIAS_CATEGORIES.has(normalizedCategory)) {
      return false;
    }

    return null;
  }

  if (equipmentBias === 'free_weights') {
    if (FREE_WEIGHT_BIAS_CATEGORIES.has(normalizedCategory)) {
      return true;
    }

    if (MACHINE_BIAS_CATEGORIES.has(normalizedCategory)) {
      return false;
    }

    return null;
  }

  return null;
}

function buildSoftSignals(exercise = {}, poolContext = {}) {
  const musclePriorityProfile = poolContext.musclePriorityProfile || {};
  const equipmentContext = poolContext.equipmentContext || {};
  const movementConstraints = normalizeMovementConstraints(poolContext.movementConstraints);
  const cardioProfile = poolContext.cardioProfile || {};
  const exerciseAreas = getExerciseAreas(exercise);
  const primaryFocus = normalizeAreaName(musclePriorityProfile.primaryFocus);
  const secondaryFocuses = normalizeArray(musclePriorityProfile.secondaryFocuses);
  const deprioritizedArea = normalizeAreaName(musclePriorityProfile.deprioritizedArea);
  const cautionPatterns = movementConstraints.cautionMovementPatterns;
  const cautionJointStressTags = movementConstraints.cautionJointStressTags;
  const preferredModalities = normalizeArray(cardioProfile.preferredModalities);
  const movementPattern = normalizeValue(exercise.movementPattern);
  const cardioModality = normalizeValue(exercise.cardioModality);
  const jointStressTags = normalizeArray(exercise.jointStressTags);
  const matchedCautionPatterns =
    movementPattern && cautionPatterns.includes(movementPattern)
      ? [movementPattern]
      : [];
  const matchedCautionJointStressTags = jointStressTags.filter((tag) =>
    cautionJointStressTags.includes(tag)
  );

  return {
    musclePriority: {
      primaryFocusMatch: Boolean(primaryFocus && exerciseAreas.has(primaryFocus)),
      secondaryFocusMatches: secondaryFocuses.filter((area) => exerciseAreas.has(area)),
      deprioritizedAreaMatch: Boolean(
        deprioritizedArea && exerciseAreas.has(deprioritizedArea)
      ),
      weightHint: resolveWeightHint(exerciseAreas, musclePriorityProfile),
    },
    equipmentBias: {
      value: equipmentContext.equipmentBias || 'no_preference',
      preferred: resolveEquipmentPreference(
        equipmentContext.equipmentBias,
        exercise.equipmentCategory
      ),
    },
    movementContext: {
      cautionPatternMatch: matchedCautionPatterns.length > 0,
      matchedCautionPatterns,
      cautionJointStressTagMatch: matchedCautionJointStressTags.length > 0,
      matchedCautionJointStressTags,
    },
    cardioPreference: {
      preferredModalityMatch: Boolean(
        cardioModality && preferredModalities.includes(cardioModality)
      ),
      matchedPreferredModalities:
        cardioModality && preferredModalities.includes(cardioModality)
          ? [cardioModality]
          : [],
    },
    painContext: {
      affectedArea: movementConstraints.affectedArea || null,
      painSeverity: movementConstraints.painSeverity || 'none',
      trainingRule: movementConstraints.trainingRule || 'none',
      painDescription: movementConstraints.painDescription || null,
    },
    fatigue: {
      fatigueScore: exercise.fatigueScore ?? null,
      cardioFatigueScore: exercise.cardioFatigueScore ?? null,
      lowerBodyFatigueBias: normalizeValue(exercise.lowerBodyFatigueBias) || null,
    },
  };
}

function createItem(exercise = {}, poolContext = {}) {
  const bodyParts = normalizeArray(exercise.bodyParts);
  const muscleFocus = normalizeArray(exercise.muscleFocus);

  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    aliases: normalizeArray(exercise.aliases),
    status: normalizeValue(exercise.status) || null,
    trainingType: normalizeValue(exercise.trainingType) || null,
    attributes: {
      movementPattern: normalizeValue(exercise.movementPattern) || null,
      bodyParts,
      muscleFocus,
      targetMuscles: normalizeArray(exercise.targetMuscles),
      secondaryMuscles: normalizeArray(exercise.secondaryMuscles),
      jointStressTags: normalizeArray(exercise.jointStressTags),
      equipmentCategory: normalizeValue(exercise.equipmentCategory) || null,
      equipmentNeeded: normalizeArray(exercise.equipmentNeeded),
      mechanicType: normalizeValue(exercise.mechanicType) || null,
      unilateralType: normalizeValue(exercise.unilateralType) || null,
      difficulty: normalizeValue(exercise.difficulty) || null,
      overview: exercise.overview || null,
      isSupersetFriendly: Boolean(exercise.isSupersetFriendly),
      fatigueScore: exercise.fatigueScore ?? null,
      cardioModality: normalizeValue(exercise.cardioModality) || null,
      cardioImpactLevel: normalizeValue(exercise.cardioImpactLevel) || null,
      cardioFatigueScore: exercise.cardioFatigueScore ?? null,
      lowerBodyFatigueBias: normalizeValue(exercise.lowerBodyFatigueBias) || null,
    },
    grouping: {
      movementPattern: normalizeValue(exercise.movementPattern) || null,
      bodyParts,
      muscleFocus,
      equipmentCategory: normalizeValue(exercise.equipmentCategory) || null,
      trainingType: normalizeValue(exercise.trainingType) || null,
    },
    softSignals: buildSoftSignals(exercise, poolContext),
  };
}

function createGroupedIndex() {
  return {
    byMovementPattern: {},
    byBodyPart: {},
    byMuscleFocus: {},
    byEquipmentCategory: {},
    byTrainingType: {},
  };
}

function addGroupValue(group, key, exerciseId) {
  if (!key) {
    return;
  }

  if (!group[key]) {
    group[key] = [];
  }

  group[key].push(exerciseId);
}

function addGroupValues(group, values, exerciseId) {
  normalizeArray(values).forEach((value) => addGroupValue(group, value, exerciseId));
}

function buildGroupedIndex(items) {
  const grouped = createGroupedIndex();

  items.forEach((item) => {
    addGroupValue(grouped.byMovementPattern, item.grouping.movementPattern, item.exerciseId);
    addGroupValues(grouped.byBodyPart, item.grouping.bodyParts, item.exerciseId);
    addGroupValues(grouped.byMuscleFocus, item.grouping.muscleFocus, item.exerciseId);
    addGroupValue(
      grouped.byEquipmentCategory,
      item.grouping.equipmentCategory,
      item.exerciseId
    );
    addGroupValue(grouped.byTrainingType, item.grouping.trainingType, item.exerciseId);
  });

  return grouped;
}

function buildExercisePool(exercises = [], poolContext = {}, options = {}) {
  const allowDraftFallback = options.allowDraftFallback === true;
  const cardioRole = normalizeValue(poolContext.cardioProfile?.cardioRole) || null;
  const allowedTrainingTypes = buildAllowedTrainingTypes(cardioRole);
  const experience = normalizeValue(poolContext.experience) || null;
  const allowedDifficulties = buildAllowedDifficulties(experience);
  const normalizedMovementConstraints = normalizeMovementConstraints(
    poolContext.movementConstraints
  );
  const normalizedPoolContext = {
    ...poolContext,
    movementConstraints: normalizedMovementConstraints,
  };
  const effectiveAllowedStatuses = allowDraftFallback
    ? [STATUS_APPROVED, STATUS_DRAFT]
    : [STATUS_APPROVED];
  const compatibilityContext = {
    equipment: poolContext.equipmentContext || {},
    movement: normalizedMovementConstraints,
  };
  const items = [];
  const excluded = [];
  const excludedByReason = {
    status_not_allowed: 0,
    training_type_not_allowed: 0,
    difficulty_not_allowed: 0,
    missing_equipment: 0,
    blocked_exercise_id: 0,
    blocked_joint_stress_tag: 0,
    blocked_movement_pattern: 0,
  };

  exercises.forEach((exercise) => {
    const reasons = new Set();
    const status = normalizeValue(exercise.status);
    const trainingType = normalizeValue(exercise.trainingType);
    const difficulty = normalizeValue(exercise.difficulty);

    if (!effectiveAllowedStatuses.includes(status)) {
      reasons.add('status_not_allowed');
    }

    if (!allowedTrainingTypes.includes(trainingType)) {
      reasons.add('training_type_not_allowed');
    }

    if (!difficulty || !allowedDifficulties.includes(difficulty)) {
      reasons.add('difficulty_not_allowed');
    }

    const compatibility = isExerciseCompatible(exercise, compatibilityContext);
    compatibility.reasons
      .filter((reason) =>
        reason === 'missing_equipment' ||
        reason === 'blocked_exercise_id' ||
        reason === 'blocked_joint_stress_tag' ||
        reason === 'blocked_movement_pattern'
      )
      .forEach((reason) => reasons.add(reason));

    if (reasons.size > 0) {
      const reasonList = Array.from(reasons);
      reasonList.forEach((reason) => {
        excludedByReason[reason] += 1;
      });

      excluded.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        reasons: reasonList,
      });
      return;
    }

    items.push(createItem(exercise, normalizedPoolContext));
  });

  const grouped = buildGroupedIndex(items);
  const draftFallbackApplied =
    allowDraftFallback && items.some((item) => item.status === STATUS_DRAFT);

  return {
    meta: {
      schemaVersion: EXERCISE_POOL_SCHEMA_VERSION,
      userId: poolContext.userId || null,
      profileSchemaVersion: poolContext.profileSchemaVersion || null,
      generatedAt: options.generatedAt || new Date().toISOString(),
      statusPolicy: {
        preferredAllowedStatuses: [STATUS_APPROVED],
        effectiveAllowedStatuses,
        allowDraftFallback,
        draftFallbackApplied,
      },
      trainingTypePolicy: {
        allowedTrainingTypes,
        excludedTrainingTypes: EXCLUDED_TRAINING_TYPES,
      },
      difficultyPolicy: {
        experience,
        allowedDifficulties,
      },
    },
    context: {
      primaryGoal: poolContext.primaryGoal || null,
      experience,
      musclePriorityProfile: poolContext.musclePriorityProfile || {
        primaryFocus: null,
        secondaryFocuses: [],
        deprioritizedArea: null,
        weights: {},
        perAreaWeights: {},
      },
      equipmentContext: poolContext.equipmentContext || {
        availableEquipment: [],
        equipmentBias: 'no_preference',
      },
      movementConstraints: normalizedMovementConstraints,
      cardioProfile: {
        cardioRole,
        preferredModalities: normalizeArray(poolContext.cardioProfile?.preferredModalities),
      },
    },
    hardConstraints: {
      blockedExerciseIds: normalizedMovementConstraints.blockedExerciseIds,
      blockedJointStressTags: normalizedMovementConstraints.blockedJointStressTags,
      blockedMovementPatterns: normalizedMovementConstraints.blockedMovementPatterns,
      availableEquipment: normalizeArray(poolContext.equipmentContext?.availableEquipment),
      allowedTrainingTypes,
      effectiveAllowedStatuses,
      allowedDifficulties,
    },
    pool: {
      items,
      excluded,
      grouped,
      stats: {
        fetchedCount: exercises.length,
        eligibleCount: items.length,
        excludedCount: excluded.length,
        excludedByReason,
      },
    },
  };
}

module.exports = {
  EXERCISE_POOL_SCHEMA_VERSION,
  EXCLUDED_TRAINING_TYPES,
  DIFFICULTY_BY_EXPERIENCE,
  STATUS_APPROVED,
  STATUS_DRAFT,
  TRAINING_TYPE_CARDIO,
  TRAINING_TYPE_STRENGTH,
  buildAllowedDifficulties,
  buildExercisePool,
};
