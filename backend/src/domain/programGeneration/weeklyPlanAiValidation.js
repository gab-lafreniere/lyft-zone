const { normalizeCardioPrescription } = require('../../../services/cardioPrescription');
const {
  AI_WEEKLY_PLAN_BLOCK_TYPES,
  AI_WEEKLY_PLAN_BODY_PART_TARGET_AREAS,
  AI_WEEKLY_PLAN_MUSCLE_FOCUS_TARGET_AREAS,
} = require('./weeklyPlanAiSchema');

const BODY_PART_TARGET_AREA_SET = new Set(
  AI_WEEKLY_PLAN_BODY_PART_TARGET_AREAS
);
const MUSCLE_FOCUS_TARGET_AREA_SET = new Set(
  AI_WEEKLY_PLAN_MUSCLE_FOCUS_TARGET_AREAS
);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function pushIssue(issues, path, code, message, extra = {}) {
  issues.push({
    code,
    path,
    message,
    ...extra,
  });
}

function collectGeneratedExerciseIds(document = {}) {
  const entries = [];

  (Array.isArray(document.workouts) ? document.workouts : []).forEach((workout, workoutIndex) => {
    (Array.isArray(workout.blocks) ? workout.blocks : []).forEach((block, blockIndex) => {
      (Array.isArray(block.exercises) ? block.exercises : []).forEach((exercise, exerciseIndex) => {
        const exerciseId = String(exercise?.exerciseId || '').trim();

        if (!exerciseId) {
          return;
        }

        entries.push({
          exerciseId,
          path: `workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}].exerciseId`,
        });
      });
    });
  });

  return entries;
}

function validateSequentialOrderIndexes(items = [], path, issues, key = 'orderIndex') {
  const seen = new Set();

  items.forEach((item, index) => {
    const expected = index + 1;
    const actual = item?.[key];

    if (actual !== expected) {
      pushIssue(
        issues,
        `${path}[${index}].${key}`,
        'ORDER_INDEX_NOT_SEQUENTIAL',
        `${key} must be unique and sequential starting at 1`,
        {
          expected,
          actual,
        }
      );
    }

    if (seen.has(actual)) {
      pushIssue(
        issues,
        `${path}[${index}].${key}`,
        'DUPLICATE_ORDER_INDEX',
        `${key} must be unique`,
        {
          actual,
        }
      );
    }

    seen.add(actual);
  });
}

function validateRepTargetContract(setTemplate = {}, path, issues) {
  const hasTargetReps = setTemplate.targetReps != null;
  const hasMinReps = setTemplate.minReps != null;
  const hasMaxReps = setTemplate.maxReps != null;
  const hasRange = hasMinReps || hasMaxReps;

  if (hasTargetReps && hasRange) {
    pushIssue(
      issues,
      path,
      'AMBIGUOUS_REP_TARGET',
      'Set template must use either targetReps or minReps/maxReps, not both'
    );
    return;
  }

  if (!hasTargetReps && !(hasMinReps && hasMaxReps)) {
    pushIssue(
      issues,
      path,
      'MISSING_REP_TARGET',
      'Set template must include targetReps or both minReps and maxReps'
    );
    return;
  }

  if (hasMinReps && hasMaxReps && setTemplate.minReps > setTemplate.maxReps) {
    pushIssue(
      issues,
      `${path}.minReps`,
      'INVALID_REP_RANGE',
      'minReps must be less than or equal to maxReps',
      {
        expected: 'minReps <= maxReps',
        actual: {
          minReps: setTemplate.minReps,
          maxReps: setTemplate.maxReps,
        },
      }
    );
  }
}

function validateStrengthExercise(exercise = {}, path, issues) {
  if (!normalizeOptionalString(exercise.exerciseId)) {
    pushIssue(issues, `${path}.exerciseId`, 'REQUIRED', 'exerciseId is required');
  }

  if (!normalizeOptionalString(exercise.defaultTempo)) {
    pushIssue(issues, `${path}.defaultTempo`, 'REQUIRED', 'defaultTempo is required for strength exercises');
  }

  if (exercise.defaultRestSeconds == null) {
    pushIssue(
      issues,
      `${path}.defaultRestSeconds`,
      'REQUIRED',
      'defaultRestSeconds is required for strength exercises'
    );
  }

  if (exercise.defaultTargetRir == null) {
    pushIssue(
      issues,
      `${path}.defaultTargetRir`,
      'REQUIRED',
      'defaultTargetRir is required for strength exercises'
    );
  }

  const setTemplates = toArray(exercise.setTemplates);
  if (setTemplates.length < 1) {
    pushIssue(
      issues,
      `${path}.setTemplates`,
      'MIN_ITEMS_REQUIRED',
      'Strength exercises must include at least one setTemplate'
    );
  }

  validateSequentialOrderIndexes(setTemplates, `${path}.setTemplates`, issues, 'setIndex');

  setTemplates.forEach((setTemplate, setIndex) => {
    const setPath = `${path}.setTemplates[${setIndex}]`;

    if (setTemplate.setType !== 'WORKING') {
      pushIssue(
        issues,
        `${setPath}.setType`,
        'INVALID_SET_TYPE',
        'setType must be WORKING in AI Weekly Plan Output V2',
        {
          expected: 'WORKING',
          actual: setTemplate.setType,
        }
      );
    }

    validateRepTargetContract(setTemplate, setPath, issues);
  });
}

function validateCardioExercise(exercise = {}, path, issues) {
  if (!normalizeOptionalString(exercise.exerciseId)) {
    pushIssue(issues, `${path}.exerciseId`, 'REQUIRED', 'exerciseId is required');
  }

  if (toArray(exercise.setTemplates).length > 0) {
    pushIssue(
      issues,
      `${path}.setTemplates`,
      'INVALID_CARDIO_BLOCK',
      'CARDIO exercises cannot contain setTemplates'
    );
  }

  if (!exercise.cardioPrescription) {
    pushIssue(
      issues,
      `${path}.cardioPrescription`,
      'INVALID_CARDIO_BLOCK',
      'cardioPrescription is required for CARDIO exercises'
    );
    return;
  }

  try {
    normalizeCardioPrescription(exercise.cardioPrescription, {
      path: `${path}.cardioPrescription`,
    });
  } catch (error) {
    pushIssue(
      issues,
      `${path}.cardioPrescription`,
      'INVALID_CARDIO_BLOCK',
      error.message || 'cardioPrescription is invalid'
    );
  }
}

function validateBlockExercises(block = {}, blockPath, issues, notesStats) {
  const exercises = toArray(block.exercises);

  validateSequentialOrderIndexes(exercises, `${blockPath}.exercises`, issues);

  if (!AI_WEEKLY_PLAN_BLOCK_TYPES.includes(block.blockType)) {
    pushIssue(
      issues,
      `${blockPath}.blockType`,
      'UNSUPPORTED_BLOCK_TYPE',
      'Block type is not supported in AI Weekly Plan Output V2',
      {
        expected: AI_WEEKLY_PLAN_BLOCK_TYPES,
        actual: block.blockType,
      }
    );
    return;
  }

  if (block.blockType === 'SINGLE' && exercises.length !== 1) {
    pushIssue(
      issues,
      `${blockPath}.exercises`,
      'INVALID_SINGLE_BLOCK',
      'SINGLE blocks must contain exactly one exercise',
      {
        expected: 1,
        actual: exercises.length,
      }
    );
  }

  if (block.blockType === 'SUPERSET' && exercises.length !== 2) {
    pushIssue(
      issues,
      `${blockPath}.exercises`,
      'INVALID_SUPERSET_BLOCK',
      'SUPERSET blocks must contain exactly two exercises',
      {
        expected: 2,
        actual: exercises.length,
      }
    );
  }

  if (block.blockType === 'CARDIO' && exercises.length !== 1) {
    pushIssue(
      issues,
      `${blockPath}.exercises`,
      'INVALID_CARDIO_BLOCK',
      'CARDIO blocks must contain exactly one exercise',
      {
        expected: 1,
        actual: exercises.length,
      }
    );
  }

  if (block.blockType === 'CARDIO') {
    exercises.forEach((exercise, exerciseIndex) => {
      validateCardioExercise(exercise, `${blockPath}.exercises[${exerciseIndex}]`, issues);
    });
    return;
  }

  const supersetSetTemplateCounts = [];
  exercises.forEach((exercise, exerciseIndex) => {
    const exercisePath = `${blockPath}.exercises[${exerciseIndex}]`;
    validateStrengthExercise(exercise, exercisePath, issues);

    notesStats.strengthExerciseCount += 1;
    if (normalizeOptionalString(exercise.notes)) {
      notesStats.strengthExerciseNoteCount += 1;
    }

    if (block.blockType === 'SUPERSET') {
      supersetSetTemplateCounts.push(toArray(exercise.setTemplates).length);
    }
  });

  if (block.blockType === 'SUPERSET' && supersetSetTemplateCounts.length > 1) {
    const expected = supersetSetTemplateCounts[0];
    supersetSetTemplateCounts.slice(1).forEach((actual, index) => {
      if (actual !== expected) {
        pushIssue(
          issues,
          `${blockPath}.exercises[${index + 1}].setTemplates`,
          'SUPERSET_SET_COUNT_MISMATCH',
          'SUPERSET exercises must use the same number of setTemplates',
          {
            expected,
            actual,
          }
        );
      }
    });
  }
}

function validateNotesPolicy(notesStats, issues) {
  const allowedExerciseNotes = Math.min(
    5,
    Math.max(1, Math.ceil(notesStats.strengthExerciseCount * 0.3))
  );

  if (notesStats.strengthExerciseNoteCount > allowedExerciseNotes) {
    pushIssue(
      issues,
      'notesPolicy',
      'NOTES_POLICY_VIOLATION',
      'Too many strength exercise notes for AI Weekly Plan Output V2',
      {
        expected: {
          allowedExerciseNotes,
        },
        actual: {
          strengthExerciseNoteCount: notesStats.strengthExerciseNoteCount,
        },
      }
    );
  }

  return {
    ...notesStats,
    allowedExerciseNotes,
  };
}

function validateTargetArray({
  targets,
  path,
  canonicalAreas,
  valueKey,
  sessionsPerWeek,
  issues,
}) {
  const seenAreas = new Set();

  toArray(targets).forEach((target, index) => {
    const targetPath = `${path}[${index}]`;
    const area = normalizeOptionalString(target?.area);
    const value = target?.[valueKey];

    if (!area || !canonicalAreas.has(area)) {
      pushIssue(
        issues,
        `${targetPath}.area`,
        'INVALID_TARGET_AREA',
        `area must be a canonical ${path.includes('bodyParts') ? 'bodyParts' : 'muscleFocus'} key`,
        { actual: target?.area }
      );
    } else if (seenAreas.has(area)) {
      pushIssue(
        issues,
        `${targetPath}.area`,
        'DUPLICATE_TARGET_AREA',
        'Target areas must be unique within their explicit taxonomy',
        { actual: area }
      );
    }

    if (area) {
      seenAreas.add(area);
    }

    if (!Number.isSafeInteger(value) || value < 0) {
      pushIssue(
        issues,
        `${targetPath}.${valueKey}`,
        'INVALID_TARGET_VALUE',
        `${valueKey} must be a non-negative integer`,
        { actual: value }
      );
    }

    if (
      valueKey === 'targetSessionsPerWeek' &&
      Number.isSafeInteger(value) &&
      Number.isSafeInteger(sessionsPerWeek) &&
      value > sessionsPerWeek
    ) {
      pushIssue(
        issues,
        `${targetPath}.${valueKey}`,
        'TARGET_FREQUENCY_EXCEEDS_SESSIONS',
        'targetSessionsPerWeek must not exceed sessionsPerWeek',
        { expected: sessionsPerWeek, actual: value }
      );
    }
  });
}

function validateTargetContract(aiOutput, issues) {
  const targetGroups = [
    {
      targets: aiOutput?.volumeTargets?.bodyParts,
      path: 'volumeTargets.bodyParts',
      canonicalAreas: BODY_PART_TARGET_AREA_SET,
      valueKey: 'targetSetsPerWeek',
    },
    {
      targets: aiOutput?.volumeTargets?.muscleFocuses,
      path: 'volumeTargets.muscleFocuses',
      canonicalAreas: MUSCLE_FOCUS_TARGET_AREA_SET,
      valueKey: 'targetSetsPerWeek',
    },
    {
      targets: aiOutput?.frequencyTargets?.bodyParts,
      path: 'frequencyTargets.bodyParts',
      canonicalAreas: BODY_PART_TARGET_AREA_SET,
      valueKey: 'targetSessionsPerWeek',
    },
    {
      targets: aiOutput?.frequencyTargets?.muscleFocuses,
      path: 'frequencyTargets.muscleFocuses',
      canonicalAreas: MUSCLE_FOCUS_TARGET_AREA_SET,
      valueKey: 'targetSessionsPerWeek',
    },
  ];

  if (
    Object.prototype.hasOwnProperty.call(aiOutput?.volumeTargets || {}, 'perMuscle') ||
    Object.prototype.hasOwnProperty.call(aiOutput?.frequencyTargets || {}, 'perMuscle')
  ) {
    pushIssue(
      issues,
      'volumeTargets',
      'LEGACY_TARGET_SHAPE_UNSUPPORTED',
      'perMuscle is not supported by AI Weekly Plan Output V2'
    );
  }

  targetGroups.forEach((group) =>
    validateTargetArray({
      ...group,
      sessionsPerWeek: aiOutput?.sessionsPerWeek,
      issues,
    })
  );
}

function validateWeeklyPlanAiOutputSemantics(aiOutput = {}) {
  const issues = [];
  const workouts = toArray(aiOutput.workouts);
  const notesStats = {
    strengthExerciseCount: 0,
    strengthExerciseNoteCount: 0,
  };

  if (aiOutput.sessionsPerWeek !== workouts.length) {
    pushIssue(
      issues,
      'sessionsPerWeek',
      'SESSIONS_PER_WEEK_MISMATCH',
      'sessionsPerWeek must match workouts.length',
      {
        expected: workouts.length,
        actual: aiOutput.sessionsPerWeek,
      }
    );
  }

  validateTargetContract(aiOutput, issues);

  validateSequentialOrderIndexes(workouts, 'workouts', issues);

  workouts.forEach((workout, workoutIndex) => {
    const workoutPath = `workouts[${workoutIndex}]`;
    const blocks = toArray(workout.blocks);

    validateSequentialOrderIndexes(blocks, `${workoutPath}.blocks`, issues);

    blocks.forEach((block, blockIndex) => {
      validateBlockExercises(
        block,
        `${workoutPath}.blocks[${blockIndex}]`,
        issues,
        notesStats
      );
    });
  });

  const notesPolicy = validateNotesPolicy(notesStats, issues);

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? aiOutput : null,
    issues,
    summary: {
      notesPolicy,
    },
  };
}

function validateGeneratedExerciseIdsAgainstPool(document = {}, poolSnapshot = {}) {
  const allowedExerciseIds = new Set(
    Array.isArray(poolSnapshot.allowedExerciseIds) ? poolSnapshot.allowedExerciseIds : []
  );
  const entries = collectGeneratedExerciseIds(document);
  const issues = entries
    .filter((entry) => !allowedExerciseIds.has(entry.exerciseId))
    .map((entry) => ({
      code: 'EXERCISE_OUTSIDE_POOL',
      path: entry.path,
      exerciseId: entry.exerciseId,
    }));

  return {
    ok: issues.length === 0,
    issues,
    exerciseIds: entries.map((entry) => entry.exerciseId),
    uniqueExerciseIds: Array.from(new Set(entries.map((entry) => entry.exerciseId))).sort(),
  };
}

module.exports = {
  collectGeneratedExerciseIds,
  validateWeeklyPlanAiOutputSemantics,
  validateGeneratedExerciseIdsAgainstPool,
};
