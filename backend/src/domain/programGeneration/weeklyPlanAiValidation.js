const { normalizeCardioPrescription } = require('../../../services/cardioPrescription');
const {
  AI_WEEKLY_PLAN_BLOCK_TYPES,
  AI_WEEKLY_PLAN_BODY_PARTS,
} = require('./weeklyPlanAiSchema');
const {
  validateCompleteSentenceText,
} = require('./completeSentenceValidation');
const {
  buildEligibleExerciseCoverageCounts,
  resolveEligibleExerciseCoverageLevel,
} = require('./programGenerationPoolCoverage');

const AI_WEEKLY_PLAN_BODY_PART_SET = new Set(AI_WEEKLY_PLAN_BODY_PARTS);

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
  const hasTargetSeconds = setTemplate.targetSeconds != null;
  const hasRange = hasMinReps || hasMaxReps;
  const modeCount =
    (hasTargetReps ? 1 : 0) +
    (hasRange ? 1 : 0) +
    (hasTargetSeconds ? 1 : 0);

  if (modeCount > 1) {
    pushIssue(
      issues,
      path,
      'AMBIGUOUS_PRESCRIPTION_TARGET',
      'Set template must use exactly one of targetReps, minReps/maxReps, or targetSeconds'
    );
    return;
  }

  if (
    modeCount === 0 ||
    (hasRange && !(hasMinReps && hasMaxReps))
  ) {
    pushIssue(
      issues,
      path,
      'MISSING_PRESCRIPTION_TARGET',
      'Set template must include targetReps, both minReps and maxReps, or targetSeconds'
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

function validateStrengthExercise(
  exercise = {},
  path,
  issues,
  { defaultRestSecondsRequired = true } = {}
) {
  if (!normalizeOptionalString(exercise.exerciseId)) {
    pushIssue(issues, `${path}.exerciseId`, 'REQUIRED', 'exerciseId is required');
  }

  if (!normalizeOptionalString(exercise.defaultTempo)) {
    pushIssue(issues, `${path}.defaultTempo`, 'REQUIRED', 'defaultTempo is required for strength exercises');
  }

  if (defaultRestSecondsRequired && exercise.defaultRestSeconds == null) {
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
        'setType must be WORKING in AI Weekly Plan Output V4',
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
      'Block type is not supported in AI Weekly Plan Output V4',
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
    const isSupersetLaneB =
      block.blockType === 'SUPERSET' && exercise?.orderIndex === 2;
    validateStrengthExercise(exercise, exercisePath, issues, {
      defaultRestSecondsRequired: !isSupersetLaneB,
    });

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

function validateNotesPolicy(notesStats) {
  const allowedExerciseNotes = Math.min(
    5,
    Math.max(1, Math.ceil(notesStats.strengthExerciseCount * 0.3))
  );

  return {
    ...notesStats,
    allowedExerciseNotes,
    exceedsRecommendedExerciseNotes:
      notesStats.strengthExerciseNoteCount > allowedExerciseNotes,
  };
}

function appendCompleteSentenceIssues(value, path, issues) {
  const result = validateCompleteSentenceText(value, { path });
  issues.push(...result.issues);
}

function validateMuscleDistributionDebug(aiOutput, issues) {
  const debug = aiOutput?.muscleDistributionDebug || {};
  const omittedBodyParts = toArray(debug.omittedBodyParts);
  const seen = new Set();

  appendCompleteSentenceIssues(
    debug.rationale,
    'muscleDistributionDebug.rationale',
    issues
  );

  omittedBodyParts.forEach((omission, index) => {
    const path = `muscleDistributionDebug.omittedBodyParts[${index}]`;
    const area = normalizeOptionalString(omission?.area);

    if (!AI_WEEKLY_PLAN_BODY_PART_SET.has(area)) {
      pushIssue(
        issues,
        `${path}.area`,
        'INVALID_OMITTED_BODY_PART',
        'Omitted area must be a canonical AI Weekly Plan body part',
        { actual: omission?.area }
      );
    } else if (seen.has(area)) {
      pushIssue(
        issues,
        `${path}.area`,
        'DUPLICATE_OMITTED_BODY_PART',
        'Each omitted body part may be declared only once',
        { actual: area }
      );
    }
    if (area) {
      seen.add(area);
    }

    appendCompleteSentenceIssues(
      omission?.explanation,
      `${path}.explanation`,
      issues
    );
  });
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

  validateMuscleDistributionDebug(aiOutput, issues);

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

  const notesPolicy = validateNotesPolicy(notesStats);

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

function buildMuscleDistributionDebugAudit({
  generatedAIOutput = {},
  analytics = {},
  context = {},
} = {}) {
  const bodyPartMetricByKey = new Map(
    toArray(analytics?.muscleMetrics)
      .filter((entry) => entry?.taxonomy === 'body_part')
      .map((entry) => [entry.key, entry])
  );
  const actualZeroDirectBodyParts = AI_WEEKLY_PLAN_BODY_PARTS.filter(
    (area) =>
      !bodyPartMetricByKey.has(area) ||
      bodyPartMetricByKey.get(area)?.directWorkingSets === 0
  );
  const omissions = toArray(
    generatedAIOutput?.muscleDistributionDebug?.omittedBodyParts
  );
  const declaredOmittedBodyParts = AI_WEEKLY_PLAN_BODY_PARTS.filter((area) =>
    omissions.some((omission) => omission?.area === area)
  );
  const missingOmissionExplanations = actualZeroDirectBodyParts.filter(
    (area) => !declaredOmittedBodyParts.includes(area)
  );
  const falselyDeclaredOmissions = declaredOmittedBodyParts.filter(
    (area) => !actualZeroDirectBodyParts.includes(area)
  );
  const eligibleBodyPartCounts = buildEligibleExerciseCoverageCounts(
    toArray(context?.exercisePoolItems),
    'bodyParts',
    AI_WEEKLY_PLAN_BODY_PARTS
  );
  const unsupportedPoolLimitationClaims = omissions
    .filter(
      (omission) =>
        omission?.reasonCode === 'limited_by_eligible_pool' &&
        resolveEligibleExerciseCoverageLevel(
          eligibleBodyPartCounts.get(omission?.area)
        ) === null
    )
    .map((omission) => omission.area);

  return {
    actualZeroDirectBodyParts,
    declaredOmittedBodyParts,
    missingOmissionExplanations,
    falselyDeclaredOmissions,
    unsupportedPoolLimitationClaims,
    omissionDeclarationMatchesActualCoverage:
      missingOmissionExplanations.length === 0 &&
      falselyDeclaredOmissions.length === 0,
    poolLimitationClaimsVerified:
      unsupportedPoolLimitationClaims.length === 0,
  };
}

function validateWeeklyPlanAiDebugContractAgainstAnalytics(options = {}) {
  const audit = buildMuscleDistributionDebugAudit(options);
  const issues = [];

  audit.missingOmissionExplanations.forEach((area) => {
    pushIssue(
      issues,
      'muscleDistributionDebug.omittedBodyParts',
      'MISSING_OMISSION_EXPLANATION',
      'Every body part with zero direct working sets must be declared and explained',
      { actual: area }
    );
  });
  audit.falselyDeclaredOmissions.forEach((area) => {
    pushIssue(
      issues,
      'muscleDistributionDebug.omittedBodyParts',
      'FALSE_OMISSION_DECLARATION',
      'A declared omission must have zero direct working sets in backend Analytics',
      { actual: area }
    );
  });
  audit.unsupportedPoolLimitationClaims.forEach((area) => {
    pushIssue(
      issues,
      'muscleDistributionDebug.omittedBodyParts',
      'UNSUPPORTED_POOL_LIMITATION_CLAIM',
      'limited_by_eligible_pool requires unavailable, severely_limited, or limited canonical eligible-pool coverage',
      { actual: area }
    );
  });

  return {
    ok: issues.length === 0,
    issues,
    audit,
  };
}

module.exports = {
  buildMuscleDistributionDebugAudit,
  collectGeneratedExerciseIds,
  validateWeeklyPlanAiDebugContractAgainstAnalytics,
  validateWeeklyPlanAiOutputSemantics,
  validateGeneratedExerciseIdsAgainstPool,
};
