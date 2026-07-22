const {
  PROGRAM_REVIEW_CONTRACT_VERSION,
  PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
  buildProgramReviewJsonSchema,
  validateProgramReviewSchema,
} = require('./programReviewSchema');
const {
  validateProgramReviewSemantics,
} = require('./programReviewValidation');
const {
  PROGRAM_REVIEW_PROMPT_VERSION,
  buildProgramReviewPrompt,
} = require('./prompts/programReviewPrompt');
const {
  reviewWeeklyPlanAi,
} = require('../../../services/weeklyPlanAiReviewService');
const {
  stableStringify,
} = require('./prompts/programGenerationPrompt');
const {
  DURATION_ALIGNMENT_STATUS,
  WEEKLY_PLAN_EVALUATION_POLICY_ID,
  WEEKLY_PLAN_EVALUATION_POLICY_VERSION,
} = require('./weeklyPlanEvaluationPolicy');
const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
} = require('./weeklyPlanAnalytics');

const PROGRAM_REVIEW_INPUT_SCHEMA_VERSION = 2;
const MAX_PROGRAM_REVIEW_INPUT_CHARACTERS = 120000;

class AIProgramReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIProgramReviewError';
    this.code = code;
  }
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeKey(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeStringArray(value) {
  return Array.from(
    new Set(toArray(value).map(normalizeKey).filter(Boolean))
  ).sort();
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(value) {
  const normalized = normalizeNumber(value);
  return normalized == null ? null : Math.trunc(normalized);
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');

  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sortByOrderIndex(items = []) {
  return toArray(items)
    .map((value, originalIndex) => ({ value, originalIndex }))
    .sort((left, right) => {
      const leftOrder = normalizeInteger(left.value?.orderIndex) ?? left.originalIndex + 1;
      const rightOrder = normalizeInteger(right.value?.orderIndex) ?? right.originalIndex + 1;
      return leftOrder - rightOrder || left.originalIndex - right.originalIndex;
    });
}

function compactRepTarget(setTemplate = {}) {
  const targetReps = normalizeInteger(setTemplate.targetReps);
  const minReps = normalizeInteger(setTemplate.minReps);
  const maxReps = normalizeInteger(setTemplate.maxReps);

  if (targetReps != null) {
    return String(targetReps);
  }

  if (minReps != null && maxReps != null) {
    return `${minReps}-${maxReps}`;
  }

  return null;
}

function buildExercisePrescription(exercise = {}) {
  const setTemplates = toArray(exercise.setTemplates);
  const rirValues = [
    normalizeNumber(exercise.defaultTargetRir),
    ...setTemplates.map((setTemplate) => normalizeNumber(setTemplate?.targetRir)),
  ].filter((value) => value != null);
  const tempos = Array.from(
    new Set(
      [
        normalizeOptionalString(exercise.defaultTempo),
        ...setTemplates.map((setTemplate) => normalizeOptionalString(setTemplate?.tempo)),
      ].filter(Boolean)
    )
  ).sort();
  const restSeconds = Array.from(
    new Set(
      [
        normalizeInteger(exercise.defaultRestSeconds),
        ...setTemplates.map((setTemplate) => normalizeInteger(setTemplate?.restSeconds)),
      ].filter((value) => value != null)
    )
  ).sort((left, right) => left - right);

  return {
    setCount: setTemplates.length,
    repTargets: setTemplates.map(compactRepTarget).filter(Boolean),
    targetRirRange: {
      min: rirValues.length ? Math.min(...rirValues) : null,
      max: rirValues.length ? Math.max(...rirValues) : null,
    },
    tempos,
    restSeconds,
  };
}

function buildCardioPrescriptionReviewInput(exercise = {}, blockType = null) {
  if (blockType !== 'CARDIO') {
    return null;
  }

  const cardioPrescription = exercise?.cardioPrescription || {};

  return {
    durationMinutes: normalizeInteger(cardioPrescription.durationMinutes),
    heartRateTargetMode: normalizeKey(cardioPrescription.heartRateTargetMode),
    heartRateTargetValue: normalizeInteger(cardioPrescription.heartRateTargetValue),
  };
}

function buildPlanReviewInput(document = {}) {
  let strengthExerciseCount = 0;
  let notedStrengthExerciseCount = 0;

  const workouts = sortByOrderIndex(document.workouts).map(({ value: workout, originalIndex }) => ({
    orderIndex: normalizeInteger(workout?.orderIndex) ?? originalIndex + 1,
    estimatedDurationMinutes: normalizeInteger(workout?.estimatedDurationMinutes),
    blocks: sortByOrderIndex(workout?.blocks).map(({ value: block, originalIndex: blockIndex }) => {
      const blockType = normalizeOptionalString(block?.blockType)?.toUpperCase() || null;
      const exercises = sortByOrderIndex(block?.exercises).map(
        ({ value: exercise, originalIndex: exerciseIndex }) => {
          const isStrengthExercise = blockType !== 'CARDIO';
          if (isStrengthExercise) {
            strengthExerciseCount += 1;
            if (normalizeOptionalString(exercise?.notes)) {
              notedStrengthExerciseCount += 1;
            }
          }

          return {
            orderIndex: normalizeInteger(exercise?.orderIndex) ?? exerciseIndex + 1,
            exerciseId: normalizeOptionalString(exercise?.exerciseId),
            exerciseName: normalizeOptionalString(exercise?.exerciseName),
            bodyParts: normalizeStringArray(exercise?.bodyParts),
            muscleFocus: normalizeStringArray(exercise?.muscleFocus),
            ...buildExercisePrescription(exercise),
            cardioPrescription: buildCardioPrescriptionReviewInput(exercise, blockType),
            hasNote: Boolean(normalizeOptionalString(exercise?.notes)),
          };
        }
      );

      return {
        orderIndex: normalizeInteger(block?.orderIndex) ?? blockIndex + 1,
        blockType,
        restSeconds: normalizeInteger(block?.restSeconds),
        exercises,
      };
    }),
  }));

  return {
    sessionsPerWeek: normalizeInteger(document?.sessionsPerWeek),
    workouts,
    notesSummary: {
      strengthExerciseCount,
      notedStrengthExerciseCount,
      allowedExerciseNoteCount:
        strengthExerciseCount > 0
          ? Math.min(5, Math.max(1, Math.ceil(strengthExerciseCount * 0.3)))
          : 0,
    },
  };
}

function collectSelectedExerciseIds(document = {}) {
  const selectedExerciseIds = new Set();
  let hasMissingExerciseId = false;

  toArray(document.workouts).forEach((workout) => {
    toArray(workout?.blocks).forEach((block) => {
      toArray(block?.exercises).forEach((exercise) => {
        const exerciseId = normalizeOptionalString(exercise?.exerciseId);
        if (!exerciseId) {
          hasMissingExerciseId = true;
          return;
        }
        selectedExerciseIds.add(exerciseId);
      });
    });
  });

  if (hasMissingExerciseId) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE',
      'AI weekly plan review input is incomplete'
    );
  }

  return Array.from(selectedExerciseIds).sort();
}

function buildSelectedExerciseMetadata(document = {}, context = {}) {
  const selectedExerciseIds = collectSelectedExerciseIds(document);
  const poolItemByExerciseId = new Map(
    toArray(context?.exercisePoolItems)
      .map((item) => [normalizeOptionalString(item?.exerciseId), item])
      .filter(([exerciseId]) => Boolean(exerciseId))
  );
  const missingExerciseIds = [];
  const items = [];

  selectedExerciseIds.forEach((exerciseId) => {
    const item = poolItemByExerciseId.get(exerciseId);

    if (!item) {
      missingExerciseIds.push(exerciseId);
      return;
    }

    const partialFields = [];
    const trainingType = normalizeOptionalString(item.trainingType);
    const movementPattern = normalizeOptionalString(item.movementPattern);
    const equipmentCategory = normalizeOptionalString(item.equipmentCategory);
    const bodyParts = normalizeStringArray(item.bodyParts);
    const muscleFocus = normalizeStringArray(item.muscleFocus);
    const targetMuscles = normalizeStringArray(item.targetMuscles);
    const secondaryMuscles = normalizeStringArray(item.secondaryMuscles);
    const jointStressTags = normalizeStringArray(item.jointStressTags);
    const isCardio = normalizeKey(item.trainingType) === 'cardio';
    const cardioModality = isCardio ? normalizeKey(item.cardioModality) : null;

    if (!trainingType) {
      partialFields.push('trainingType');
    }
    if (!movementPattern) {
      partialFields.push('movementPattern');
    }
    if (!Array.isArray(item.jointStressTags)) {
      partialFields.push('jointStressTags');
    }
    if (!equipmentCategory) {
      partialFields.push('equipmentCategory');
    }
    if (!bodyParts.length) {
      partialFields.push('bodyParts');
    }
    if (!muscleFocus.length) {
      partialFields.push('muscleFocus');
    }
    if (!targetMuscles.length) {
      partialFields.push('targetMuscles');
    }
    if (!secondaryMuscles.length) {
      partialFields.push('secondaryMuscles');
    }
    if (isCardio && !cardioModality) {
      partialFields.push('cardioModality');
    }

    items.push({
      exerciseId,
      trainingType,
      movementPattern,
      jointStressTags,
      equipmentCategory,
      bodyParts,
      muscleFocus,
      targetMuscles,
      secondaryMuscles,
      cardioModality,
      partialFields,
    });
  });

  if (missingExerciseIds.length > 0) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE',
      'AI weekly plan review input is incomplete'
    );
  }

  return {
    items,
    coverage: {
      selectedExerciseCount: selectedExerciseIds.length,
      matchedExerciseCount: items.length,
      missingExerciseIds,
    },
  };
}

function buildProfileReviewInput(context = {}) {
  const priorities = context?.musclePriorityProfile || {};
  const perAreaWeights = priorities?.perAreaWeights || {};

  return {
    primaryGoal: normalizeOptionalString(context?.primaryGoal),
    experience: normalizeOptionalString(context?.experience),
    availability: {
      sessionsPerWeek: normalizeInteger(context?.availability?.sessionsPerWeek),
      durationPerSession: normalizeInteger(context?.availability?.durationPerSession),
    },
    musclePriorities: {
      primaryFocus: normalizeOptionalString(priorities.primaryFocus),
      secondaryFocuses: normalizeStringArray(priorities.secondaryFocuses),
      deprioritizedArea: normalizeOptionalString(priorities.deprioritizedArea),
      perAreaWeights: Object.keys(perAreaWeights)
        .sort()
        .reduce((result, key) => {
          const normalizedValue = normalizeNumber(perAreaWeights[key]);
          if (normalizedValue != null) {
            result[key] = normalizedValue;
          }
          return result;
        }, {}),
    },
    cardioProfile: {
      cardioRole: normalizeOptionalString(context?.cardioProfile?.cardioRole),
      preferredModalities: normalizeStringArray(context?.cardioProfile?.preferredModalities),
    },
  };
}

function buildConstraintsReviewInput(context = {}) {
  const constraints = context?.movementConstraints || {};

  return {
    blockedMovementPatterns: normalizeStringArray(constraints.blockedMovementPatterns),
    blockedJointStressTags: normalizeStringArray(constraints.blockedJointStressTags),
    cautionMovementPatterns: normalizeStringArray(constraints.cautionMovementPatterns),
    cautionJointStressTags: normalizeStringArray(constraints.cautionJointStressTags),
  };
}

function buildTargetIntent(targets, targetKey, includePriority = false) {
  return toArray(targets)
    .map((target) => ({
      area: normalizeOptionalString(target?.area),
      [targetKey]: normalizeNumber(target?.[targetKey]),
      ...(includePriority ? { priority: normalizeOptionalString(target?.priority) } : {}),
    }))
    .sort((left, right) => compareStableStrings(left.area, right.area));
}

function buildExplicitTargetIntent(values, targetKey, includePriority = false) {
  return {
    bodyParts: buildTargetIntent(
      values?.bodyParts,
      targetKey,
      includePriority
    ),
    muscleFocuses: buildTargetIntent(
      values?.muscleFocuses,
      targetKey,
      includePriority
    ),
  };
}

function buildIntentReviewInput(generatedAIOutput, generatedPlanDocument = {}) {
  return {
    splitType: normalizeOptionalString(generatedAIOutput?.splitType),
    strategySummary:
      normalizeOptionalString(generatedAIOutput?.strategySummary) ||
      normalizeOptionalString(generatedPlanDocument?.strategySummary),
    volumeTargets: buildExplicitTargetIntent(
      generatedAIOutput?.volumeTargets,
      'targetSetsPerWeek',
      true
    ),
    frequencyTargets: buildExplicitTargetIntent(
      generatedAIOutput?.frequencyTargets,
      'targetSessionsPerWeek'
    ),
    progressionType: normalizeOptionalString(generatedAIOutput?.progressionModel?.type),
  };
}

function buildProjectionEntries(entries = []) {
  return toArray(entries)
    .map((entry) => ({
      taxonomy: normalizeOptionalString(entry?.taxonomy),
      key: normalizeOptionalString(entry?.key),
      directWorkingSets: normalizeNumber(entry?.directWorkingSets),
      indirectWorkingSets: normalizeNumber(entry?.indirectWorkingSets),
      directWorkoutCount: normalizeInteger(entry?.directWorkoutCount),
      indirectWorkoutCount: normalizeInteger(entry?.indirectWorkoutCount),
    }))
    .sort(
      (left, right) =>
        compareStableStrings(left.taxonomy, right.taxonomy) ||
        compareStableStrings(left.key, right.key)
    );
}

function buildTargetComparisonSummaryReviewInput(summary = {}) {
  return {
    targetCount: normalizeInteger(summary?.targetCount),
    belowTargetCount: normalizeInteger(summary?.belowTargetCount),
    withinTargetCount: normalizeInteger(summary?.withinTargetCount),
    aboveTargetCount: normalizeInteger(summary?.aboveTargetCount),
    unavailableCount: normalizeInteger(summary?.unavailableCount),
  };
}

function buildTargetComparisonReviewInput(group = {}) {
  return {
    summary: buildTargetComparisonSummaryReviewInput(group?.summary),
    items: toArray(group?.items).map((item, index) => ({
      targetIndex: normalizeInteger(item?.targetIndex) ?? index,
      area: normalizeOptionalString(item?.area),
      resolvedTaxonomy: normalizeOptionalString(item?.resolvedTaxonomy),
      targetValue: normalizeNumber(item?.targetValue),
      generatedDirectValue: normalizeNumber(item?.generatedDirectValue),
      difference: normalizeNumber(item?.difference),
      absoluteDifference: normalizeNumber(item?.absoluteDifference),
      relativeDifference: normalizeNumber(item?.relativeDifference),
      status: normalizeOptionalString(item?.status),
    })),
  };
}

function buildExplicitTargetComparisonsReviewInput(group = {}) {
  return {
    bodyParts: buildTargetComparisonReviewInput(group?.bodyParts),
    muscleFocuses: buildTargetComparisonReviewInput(group?.muscleFocuses),
    overallSummary: buildTargetComparisonSummaryReviewInput(
      group?.overallSummary
    ),
  };
}

function buildDurationAlignmentStatusCounts(counts = {}) {
  return Object.values(DURATION_ALIGNMENT_STATUS).reduce((result, status) => {
    result[status] = normalizeInteger(counts?.[status]);
    return result;
  }, {});
}

function assertProgramReviewInputDependencies(context, analytics) {
  const contextPolicy = context?.evaluationPolicy;
  const analyticsPolicy = analytics?.evaluationPolicy;
  const hasValidContextPolicy =
    contextPolicy?.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    contextPolicy?.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION;
  const hasValidAnalyticsPolicy =
    analyticsPolicy?.id === WEEKLY_PLAN_EVALUATION_POLICY_ID &&
    analyticsPolicy?.version === WEEKLY_PLAN_EVALUATION_POLICY_VERSION;
  const hasMatchingPolicyIdentity =
    contextPolicy?.id === analyticsPolicy?.id &&
    contextPolicy?.version === analyticsPolicy?.version;
  const hasAnalyticsPlan =
    analytics?.plan &&
    typeof analytics.plan === 'object' &&
    !Array.isArray(analytics.plan);

  if (
    !hasValidContextPolicy ||
    analytics?.schemaVersion !== WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION ||
    !hasValidAnalyticsPolicy ||
    !hasMatchingPolicyIdentity ||
    !hasAnalyticsPlan ||
    !Array.isArray(analytics?.workouts)
  ) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE',
      'AI weekly plan review input is incomplete'
    );
  }
}

function buildAnalyticsReviewInput(analytics = {}) {
  const plan = analytics?.plan || {};
  const metadataCoverage = analytics?.metadataCoverage || {};

  return {
    schemaVersion: normalizeInteger(analytics?.schemaVersion),
    status: normalizeOptionalString(analytics?.status),
    evaluationPolicy: {
      id: normalizeOptionalString(analytics?.evaluationPolicy?.id),
      version: normalizeInteger(analytics?.evaluationPolicy?.version),
    },
    plan: {
      workoutCount: normalizeInteger(plan.workoutCount),
      blockCount: normalizeInteger(plan.blockCount),
      exerciseCount: normalizeInteger(plan.exerciseCount),
      strengthExerciseCount: normalizeInteger(plan.strengthExerciseCount),
      cardioExerciseCount: normalizeInteger(plan.cardioExerciseCount),
      uniqueExerciseCount: normalizeInteger(plan.uniqueExerciseCount),
      workingSetCount: normalizeInteger(plan.workingSetCount),
      totalSetTemplateCount: normalizeInteger(plan.totalSetTemplateCount),
      requestedDurationMinutesPerWorkout: normalizeNumber(
        plan.requestedDurationMinutesPerWorkout
      ),
      requestedDurationMinutesTotal: normalizeNumber(plan.requestedDurationMinutesTotal),
      calculatedDurationMinutesTotal: normalizeNumber(plan.calculatedDurationMinutesTotal),
      calculatedDurationMinutesAverage: normalizeNumber(
        plan.calculatedDurationMinutesAverage
      ),
      durationDifferenceMinutesTotal: normalizeNumber(plan.durationDifferenceMinutesTotal),
      durationAlignmentStatusCounts: buildDurationAlignmentStatusCounts(
        plan.durationAlignmentStatusCounts
      ),
      correctionRequiredWorkoutCount: normalizeInteger(
        plan.correctionRequiredWorkoutCount
      ),
      minWorkoutDurationMinutes: normalizeNumber(plan.minWorkoutDurationMinutes),
      maxWorkoutDurationMinutes: normalizeNumber(plan.maxWorkoutDurationMinutes),
      singleBlockCount: normalizeInteger(plan.singleBlockCount),
      supersetBlockCount: normalizeInteger(plan.supersetBlockCount),
      cardioBlockCount: normalizeInteger(plan.cardioBlockCount),
      cardioDurationMinutes: normalizeNumber(plan.cardioDurationMinutes),
    },
    workouts: toArray(analytics?.workouts)
      .map((workout, index) => ({
        workoutOrderIndex: normalizeInteger(workout?.workoutOrderIndex) ?? index + 1,
        blockCount: normalizeInteger(workout?.blockCount),
        strengthExerciseCount: normalizeInteger(workout?.strengthExerciseCount),
        cardioExerciseCount: normalizeInteger(workout?.cardioExerciseCount),
        workingSetCount: normalizeInteger(workout?.workingSetCount),
        totalSetTemplateCount: normalizeInteger(workout?.totalSetTemplateCount),
        requestedDurationMinutes: normalizeNumber(workout?.requestedDurationMinutes),
        calculatedDurationMinutes: normalizeNumber(workout?.calculatedDurationMinutes),
        durationDifferenceMinutes: normalizeNumber(workout?.durationDifferenceMinutes),
        durationUtilizationRatio: normalizeNumber(workout?.durationUtilizationRatio),
        durationAlignmentStatus: normalizeOptionalString(
          workout?.durationAlignmentStatus
        ),
        durationRequiresCorrection: Boolean(workout?.durationRequiresCorrection),
        supersetCount: normalizeInteger(workout?.supersetCount),
        cardioDurationMinutes: normalizeNumber(workout?.cardioDurationMinutes),
        muscleProjections: buildProjectionEntries(workout?.muscleProjections),
      }))
      .sort((left, right) => left.workoutOrderIndex - right.workoutOrderIndex),
    muscleMetrics: buildProjectionEntries(analytics?.muscleMetrics),
    targetComparisons: {
      volume: buildExplicitTargetComparisonsReviewInput(
        analytics?.targetComparisons?.volume
      ),
      frequency: buildExplicitTargetComparisonsReviewInput(
        analytics?.targetComparisons?.frequency
      ),
    },
    metadataCoverage: {
      totalStrengthWorkingSets: normalizeInteger(metadataCoverage.totalStrengthWorkingSets),
      attributedStrengthWorkingSets: normalizeInteger(metadataCoverage.attributedStrengthWorkingSets),
      coverageRatio: normalizeNumber(metadataCoverage.coverageRatio),
      unresolvedExerciseCount: toArray(metadataCoverage.unresolvedExerciseIds).length,
    },
  };
}

function assertReviewInputSize(reviewInput) {
  if (stableStringify(reviewInput).length > MAX_PROGRAM_REVIEW_INPUT_CHARACTERS) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INPUT_TOO_LARGE',
      'AI weekly plan review input is too large'
    );
  }
}

function buildProgramReviewInput({
  context = {},
  generatedAIOutput = null,
  generatedPlanDocument = {},
  analytics = {},
} = {}) {
  assertProgramReviewInputDependencies(context, analytics);

  const plan = buildPlanReviewInput(generatedPlanDocument);
  plan.selectedExerciseMetadata = buildSelectedExerciseMetadata(
    generatedPlanDocument,
    context
  );

  const reviewInput = {
    schemaVersion: PROGRAM_REVIEW_INPUT_SCHEMA_VERSION,
    evaluationPolicy: context.evaluationPolicy,
    profile: buildProfileReviewInput(context),
    constraints: buildConstraintsReviewInput(context),
    intent: buildIntentReviewInput(generatedAIOutput, generatedPlanDocument),
    plan,
    analytics: buildAnalyticsReviewInput(analytics),
  };

  assertReviewInputSize(reviewInput);
  return reviewInput;
}

function buildProgramReviewDecisionSummary(review = {}) {
  const severityCounts = {
    INFO: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
  };
  const categoryCounts = {};
  const issues = toArray(review.issues);

  issues.forEach((issue) => {
    if (hasOwn(severityCounts, issue?.severity)) {
      severityCounts[issue.severity] += 1;
    }

    const category = normalizeOptionalString(issue?.category);
    if (category) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
  });

  return {
    decision: review.decision || null,
    requiresRepair: Boolean(review.requiresRepair),
    issueCount: issues.length,
    severityCounts,
    categoryCounts,
  };
}

function buildReviewProviderMetadata(provider) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    return null;
  }

  return {
    type: provider.type === 'openai' ? 'openai' : 'mock',
    model: normalizeOptionalString(provider.model),
    responseId: normalizeOptionalString(provider.responseId),
    usage: {
      inputTokens: normalizeTokenCount(provider.usage?.inputTokens),
      outputTokens: normalizeTokenCount(provider.usage?.outputTokens),
      totalTokens: normalizeTokenCount(provider.usage?.totalTokens),
      reasoningTokens: normalizeTokenCount(provider.usage?.reasoningTokens),
    },
  };
}

function assertPromptDescriptor(promptDescriptor) {
  if (
    promptDescriptor?.promptVersion !== PROGRAM_REVIEW_PROMPT_VERSION ||
    !normalizeOptionalString(promptDescriptor?.systemMessage) ||
    !normalizeOptionalString(promptDescriptor?.userMessage)
  ) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
      'AI weekly plan review could not be prepared'
    );
  }
}

function assertProviderResult(result) {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !result.programReview ||
    typeof result.programReview !== 'object' ||
    Array.isArray(result.programReview) ||
    !result.reviewer ||
    typeof result.reviewer !== 'object' ||
    Array.isArray(result.reviewer)
  ) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
      'AI weekly plan review provider returned an invalid response'
    );
  }
}

async function runAIProgramReview(options = {}, deps = {}) {
  const reviewInput = buildProgramReviewInput(options);
  let promptDescriptor;

  try {
    promptDescriptor = await (
      deps.buildProgramReviewPrompt || buildProgramReviewPrompt
    )({
      doctrine: options.doctrine,
      reviewInput,
    });
    assertPromptDescriptor(promptDescriptor);
  } catch (error) {
    if (error instanceof AIProgramReviewError) {
      throw error;
    }

    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE',
      'AI weekly plan review could not be prepared'
    );
  }

  const schema = (deps.buildProgramReviewJsonSchema || buildProgramReviewJsonSchema)();
  const result = await (deps.reviewWeeklyPlanAi || reviewWeeklyPlanAi)(
    { promptDescriptor, schema },
    deps
  );
  assertProviderResult(result);

  const schemaValidation = (deps.validateProgramReviewSchema || validateProgramReviewSchema)(
    result.programReview
  );
  if (!schemaValidation?.ok) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
      'AI weekly plan review provider returned output that does not match the schema'
    );
  }

  const semanticValidation = (
    deps.validateProgramReviewSemantics || validateProgramReviewSemantics
  )(schemaValidation.value, reviewInput);
  if (!semanticValidation?.ok) {
    throw new AIProgramReviewError(
      'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED',
      'AI weekly plan review provider returned semantically invalid output'
    );
  }

  const review = semanticValidation.value;
  const summary = buildProgramReviewDecisionSummary(review);

  return {
    enabled: true,
    review,
    reviewInput,
    provider: buildReviewProviderMetadata(result.reviewer),
    promptVersion: promptDescriptor.promptVersion,
    contractVersion: PROGRAM_REVIEW_CONTRACT_VERSION,
    outputSchemaVersion: PROGRAM_REVIEW_OUTPUT_SCHEMA_VERSION,
    ...summary,
    repairIssues: review.issues.filter(
      (issue) => issue.severity === 'HIGH' && issue.repairability === 'REPAIRABLE'
    ),
  };
}

module.exports = {
  AIProgramReviewError,
  MAX_PROGRAM_REVIEW_INPUT_CHARACTERS,
  PROGRAM_REVIEW_INPUT_SCHEMA_VERSION,
  buildProgramReviewDecisionSummary,
  buildProgramReviewInput,
  buildSelectedExerciseMetadata,
  collectSelectedExerciseIds,
  runAIProgramReview,
};
