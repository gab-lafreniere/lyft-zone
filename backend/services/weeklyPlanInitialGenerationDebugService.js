const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const AI_WEEKLY_PLAN_DEBUG_ARTIFACT_SCHEMA_VERSION = 2;
const AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_TYPE =
  'ai_weekly_plan_initial_generation_debug';
const AI_WEEKLY_PLAN_GENERATION_DEBUG_ARTIFACT_TYPE =
  'ai_weekly_plan_generation_debug';
const AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE =
  'initial_review_complete';
const DEFAULT_DEBUG_ARTIFACT_DIRECTORY =
  '/tmp/lyft-zone-ai-weekly-plan-debug';
const SUPPORTED_DEBUG_ARTIFACT_STAGES = new Set([
  'provider_output_received',
  'schema_validation_failed',
  'semantic_validation_failed',
  'normalization_failed',
  'pool_validation_failed',
  'business_rules_failed',
  'analytics_failed',
  'backend_duration_application_failed',
  'debug_contract_validation_failed',
  'duration_correction_required',
  'duration_gate_passed',
  'duration_repair_failed',
  'duration_repair_complete',
  'review_repair_required',
  'final_review_complete',
  AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE,
]);
const TOKEN_USAGE_KEYS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
]);
const ANALYTICS_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'status',
  'evaluationPolicy',
  'id',
  'version',
  'methods',
  'duration',
  'muscleVolume',
  'frequency',
  'targetComparison',
  'plan',
  'workoutCount',
  'blockCount',
  'exerciseCount',
  'strengthExerciseCount',
  'cardioExerciseCount',
  'uniqueExerciseCount',
  'workingSetCount',
  'totalSetTemplateCount',
  'requestedDurationMinutesPerWorkout',
  'requestedDurationMinutesTotal',
  'calculatedDurationMinutesTotal',
  'calculatedDurationMinutesAverage',
  'durationDifferenceMinutesTotal',
  'durationAlignmentStatusCounts',
  'correctionRequiredWorkoutCount',
  'minWorkoutDurationMinutes',
  'maxWorkoutDurationMinutes',
  'declaredSessionsPerWeek',
  'sessionsMatchWorkoutCount',
  'splitType',
  'singleBlockCount',
  'supersetBlockCount',
  'cardioBlockCount',
  'cardioDurationMinutes',
  'bodyPartDistribution',
  'workouts',
  'workoutOrderIndex',
  'requestedDurationMinutes',
  'calculatedDurationMinutes',
  'durationDifferenceMinutes',
  'durationUtilizationRatio',
  'durationAlignmentStatus',
  'durationRequiresCorrection',
  'supersetCount',
  'muscleProjections',
  'muscleExposure',
  'direct',
  'indirect',
  'taxonomy',
  'key',
  'directWorkingSets',
  'indirectWorkingSets',
  'directWorkoutCount',
  'indirectWorkoutCount',
  'muscleMetrics',
  'metadataCoverage',
  'totalStrengthWorkingSets',
  'attributedStrengthWorkingSets',
  'coverageRatio',
  'unresolvedExerciseIds',
  'targetComparisons',
  'volume',
  'bodyParts',
  'muscleFocuses',
  'items',
  'summary',
  'overallSummary',
  'targetIndex',
  'area',
  'resolvedTaxonomy',
  'targetValue',
  'generatedDirectValue',
  'difference',
  'absoluteDifference',
  'relativeDifference',
  'targetCount',
  'belowTargetCount',
  'withinTargetCount',
  'aboveTargetCount',
  'unavailableCount',
  'blockCount',
  'cardioDurationMinutes',
  'durationCalculation',
  'methodId',
  'workoutTotalSeconds',
  'calculatedDurationMinutes',
  'blocks',
  'blockOrderIndex',
  'movementSeconds',
  'adjustedRestSeconds',
  'fixedSeconds',
  'cardioSeconds',
  'totalSeconds',
  'muscleDistributionDebugAudit',
  'actualZeroDirectBodyParts',
  'declaredOmittedBodyParts',
  'missingOmissionExplanations',
  'falselyDeclaredOmissions',
  'unsupportedPoolLimitationClaims',
  'omissionDeclarationMatchesActualCoverage',
  'poolLimitationClaimsVerified',
]);
const ANALYTICS_SCALAR_MAP_KEYS = new Set([
  'bodyPartDistribution',
  'durationAlignmentStatusCounts',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAIWeeklyPlanDebugArtifactsEnabled(env = process.env) {
  return (
    String(env.ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS).toLowerCase() ===
      'true' && env.NODE_ENV !== 'production'
  );
}

function sanitizeString(value) {
  return String(value)
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      '[REDACTED]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(API[_-]?KEY|DATABASE_URL|AUTHORIZATION|COOKIE|PASSWORD|SECRET|TOKEN)\s*[:=]\s*[^\s,;]+/gi,
      '[REDACTED]'
    );
}

function copyScalar(value) {
  if (value == null || typeof value === 'boolean') {
    return value ?? null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  return null;
}

function copyStringArray(value) {
  return toArray(value)
    .filter((entry) => typeof entry === 'string')
    .map(sanitizeString);
}

function copyCountMap(value) {
  if (!isObject(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, count]) => {
    if (/^[A-Z0-9_]+$/.test(key) && Number.isSafeInteger(count) && count >= 0) {
      result[key] = count;
    }
    return result;
  }, {});
}

function copyScalarMap(value) {
  if (!isObject(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, entry]) => {
    if (
      /^[A-Za-z0-9_-]+$/.test(key) &&
      ['string', 'number', 'boolean'].includes(typeof entry)
    ) {
      result[key] = copyScalar(entry);
    }
    return result;
  }, {});
}

function copyUsage(usage) {
  return TOKEN_USAGE_KEYS.reduce((result, key) => {
    const value = usage?.[key];
    result[key] =
      Number.isSafeInteger(value) && value >= 0 ? value : null;
    return result;
  }, {});
}

function copyProvider(provider) {
  if (!isObject(provider)) {
    return null;
  }

  return {
    type: copyScalar(provider.type),
    model: copyScalar(provider.model),
    responseId: copyScalar(provider.responseId),
    usage: copyUsage(provider.usage),
  };
}

function copyMachineSettings(value) {
  return toArray(value).map((setting) => ({
    key: copyScalar(setting?.key),
    value: copyScalar(setting?.value),
  }));
}

function copyCardioPrescription(value) {
  if (!isObject(value)) {
    return null;
  }

  return {
    durationMinutes: copyScalar(value.durationMinutes),
    heartRateTargetMode: copyScalar(value.heartRateTargetMode),
    heartRateTargetValue: copyScalar(value.heartRateTargetValue),
    machineSettings: copyMachineSettings(value.machineSettings),
    notes: copyScalar(value.notes),
  };
}

function copySetTemplate(setTemplate) {
  return {
    setIndex: copyScalar(setTemplate?.setIndex),
    setType: copyScalar(setTemplate?.setType),
    targetReps: copyScalar(setTemplate?.targetReps),
    minReps: copyScalar(setTemplate?.minReps),
    maxReps: copyScalar(setTemplate?.maxReps),
    targetSeconds: copyScalar(setTemplate?.targetSeconds),
    targetRir: copyScalar(setTemplate?.targetRir),
    targetRpe: copyScalar(setTemplate?.targetRpe),
    tempo: copyScalar(setTemplate?.tempo),
    restSeconds: copyScalar(setTemplate?.restSeconds),
    notes: copyScalar(setTemplate?.notes),
  };
}

function copyExercise(exercise) {
  return {
    exerciseId: copyScalar(exercise?.exerciseId),
    exerciseName: copyScalar(exercise?.exerciseName),
    orderIndex: copyScalar(exercise?.orderIndex),
    bodyParts: copyStringArray(exercise?.bodyParts),
    muscleFocus: copyStringArray(exercise?.muscleFocus),
    executionNotes: copyScalar(exercise?.executionNotes),
    defaultTempo: copyScalar(exercise?.defaultTempo),
    defaultRestSeconds: copyScalar(exercise?.defaultRestSeconds),
    defaultTargetRir: copyScalar(exercise?.defaultTargetRir),
    defaultTargetRpe: copyScalar(exercise?.defaultTargetRpe),
    intensificationMethod: copyScalar(exercise?.intensificationMethod),
    setTemplates: toArray(exercise?.setTemplates).map(copySetTemplate),
    cardioPrescription: copyCardioPrescription(exercise?.cardioPrescription),
    notes: copyScalar(exercise?.notes),
  };
}

function copyBlock(block) {
  return {
    orderIndex: copyScalar(block?.orderIndex),
    blockType: copyScalar(block?.blockType),
    label: copyScalar(block?.label),
    roundCount: copyScalar(block?.roundCount),
    restStrategy: copyScalar(block?.restStrategy),
    restSeconds: copyScalar(block?.restSeconds),
    notes: copyScalar(block?.notes),
    exercises: toArray(block?.exercises).map(copyExercise),
  };
}

function copyMuscleDistributionDebug(value) {
  if (!isObject(value)) {
    return null;
  }

  return {
    rationale: copyScalar(value.rationale),
    omittedBodyParts: toArray(value.omittedBodyParts).map((omission) => ({
      area: copyScalar(omission?.area),
      reasonCode: copyScalar(omission?.reasonCode),
      explanation: copyScalar(omission?.explanation),
    })),
  };
}

function copyGeneratedWorkout(workout) {
  return {
    name: copyScalar(workout?.name),
    orderIndex: copyScalar(workout?.orderIndex),
    focus: copyScalar(workout?.focus),
    blocks: toArray(workout?.blocks).map(copyBlock),
  };
}

function copyNormalizedWorkout(workout) {
  return {
    name: copyScalar(workout?.name),
    orderIndex: copyScalar(workout?.orderIndex),
    estimatedDurationMinutes: copyScalar(workout?.estimatedDurationMinutes),
    notes: copyScalar(workout?.notes),
    blocks: toArray(workout?.blocks).map(copyBlock),
  };
}

function copyGeneratedAIOutput(value) {
  if (!isObject(value)) {
    return null;
  }

  return {
    schemaVersion: copyScalar(value.schemaVersion),
    planName: copyScalar(value.planName),
    sessionsPerWeek: copyScalar(value.sessionsPerWeek),
    strategySummary: copyScalar(value.strategySummary),
    splitType: copyScalar(value.splitType),
    workouts: toArray(value.workouts).map(copyGeneratedWorkout),
    muscleDistributionDebug: copyMuscleDistributionDebug(
      value.muscleDistributionDebug
    ),
    progressionModel: {
      type: copyScalar(value.progressionModel?.type),
      summary: copyScalar(value.progressionModel?.summary),
    },
    cautionHandling: {
      summary: copyScalar(value.cautionHandling?.summary),
    },
    notesPolicy: {
      summary: copyScalar(value.notesPolicy?.summary),
    },
  };
}

function copyNormalizedPlanDocument(value) {
  if (!isObject(value)) {
    return null;
  }

  return {
    name: copyScalar(value.name),
    sessionsPerWeek: copyScalar(value.sessionsPerWeek),
    strategySummary: copyScalar(value.strategySummary),
    workouts: toArray(value.workouts).map(copyNormalizedWorkout),
  };
}

function copyValidation(value) {
  if (!isObject(value)) {
    return null;
  }

  const issues = toArray(value?.issues).map((issue) => ({
    code: copyScalar(issue?.code),
    path: copyScalar(issue?.path),
    message: copyScalar(issue?.message),
    expected: copyScalar(issue?.expected),
    actual: copyScalar(issue?.actual),
  }));

  return {
    ok: value.ok === true,
    issueCount: Number.isSafeInteger(value?.issueCount)
      ? value.issueCount
      : issues.length,
    issues,
  };
}

function copyAnalyticsValue(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => copyAnalyticsValue(entry, parentKey));
  }
  if (!isObject(value)) {
    return copyScalar(value);
  }
  if (ANALYTICS_SCALAR_MAP_KEYS.has(parentKey)) {
    return copyScalarMap(value);
  }

  return Object.entries(value).reduce((result, [key, entry]) => {
    if (ANALYTICS_ALLOWED_KEYS.has(key)) {
      result[key] = copyAnalyticsValue(entry, key);
    }
    return result;
  }, {});
}

function copyDurationGate(value) {
  if (!isObject(value)) {
    return null;
  }

  return {
    ok: value.ok === true,
    correctionRequired: value.correctionRequired === true,
    workouts: toArray(value.workouts).map((workout) => ({
      workoutOrderIndex: copyScalar(workout?.workoutOrderIndex),
      requestedDurationMinutes: copyScalar(
        workout?.requestedDurationMinutes
      ),
      calculatedDurationMinutes: copyScalar(
        workout?.calculatedDurationMinutes
      ),
      durationDifferenceMinutes: copyScalar(
        workout?.durationDifferenceMinutes
      ),
      durationUtilizationRatio: copyScalar(
        workout?.durationUtilizationRatio
      ),
      durationAlignmentStatus: copyScalar(
        workout?.durationAlignmentStatus
      ),
      acceptableDurationMinutes: isObject(
        workout?.acceptableDurationMinutes
      )
        ? {
            minimum: copyScalar(
              workout.acceptableDurationMinutes.minimum
            ),
            maximum: copyScalar(
              workout.acceptableDurationMinutes.maximum
            ),
          }
        : null,
      preferredDurationMinutes: isObject(
        workout?.preferredDurationMinutes
      )
        ? {
            minimum: copyScalar(
              workout.preferredDurationMinutes.minimum
            ),
            maximum: copyScalar(
              workout.preferredDurationMinutes.maximum
            ),
          }
        : null,
      direction: copyScalar(workout?.direction),
      minimumMinutesToAcceptableRange: copyScalar(
        workout?.minimumMinutesToAcceptableRange
      ),
    })),
  };
}

function copyReviewIssues(value) {
  return toArray(value).map((issue) => ({
    issueIndex: copyScalar(issue?.issueIndex),
    category: copyScalar(issue?.category),
    severity: copyScalar(issue?.severity),
    path: copyScalar(issue?.path),
    message: copyScalar(issue?.message),
    repairability: copyScalar(issue?.repairability),
    suggestedAction: copyScalar(issue?.suggestedAction),
  }));
}

function copyInitialReview(initialReview) {
  if (!isObject(initialReview)) {
    return null;
  }

  const review = initialReview?.review || {};
  const issues = copyReviewIssues(review.issues);

  return {
    decision: copyScalar(initialReview?.decision),
    requiresRepair: initialReview?.requiresRepair === true,
    reviewSummary: copyScalar(review.reviewSummary),
    issueCount: Number.isSafeInteger(initialReview?.issueCount)
      ? initialReview.issueCount
      : issues.length,
    severityCounts: copyCountMap(initialReview?.severityCounts),
    categoryCounts: copyCountMap(initialReview?.categoryCounts),
    issues,
  };
}

function copyProfileSummary(context) {
  const priorities = context?.musclePriorityProfile || {};

  return {
    primaryGoal: copyScalar(context?.primaryGoal),
    experience: copyScalar(context?.experience),
    sessionsPerWeek: copyScalar(context?.availability?.sessionsPerWeek),
    durationPerSession: copyScalar(context?.availability?.durationPerSession),
    primaryPriority: copyScalar(priorities.primaryFocus),
    secondaryPriorities: copyStringArray(priorities.secondaryFocuses),
    deprioritizedArea: copyScalar(priorities.deprioritizedArea),
    cardioRole: copyScalar(context?.cardioProfile?.cardioRole),
    eligibleExerciseCount: copyScalar(
      context?.poolSnapshot?.availableExerciseCount
    ),
  };
}

function resolveCreatedAt(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid debug artifact timestamp');
  }
  return date.toISOString();
}

function resolveArtifactStage(stage) {
  if (!SUPPORTED_DEBUG_ARTIFACT_STAGES.has(stage)) {
    throw new Error('Unsupported weekly plan generation debug stage');
  }
  return stage;
}

function assertRepairStageConsistency(payload, stage) {
  if (
    stage === 'duration_gate_passed' &&
    (payload.repairAttempted === true ||
      payload.repairTrigger != null ||
      payload.repairProvider != null)
  ) {
    throw new Error(
      'duration_gate_passed cannot contain Repair metadata'
    );
  }

  if (
    stage === 'duration_repair_complete' &&
    (payload.repairAttempted !== true ||
      payload.repairTrigger !== 'DURATION' ||
      !isObject(payload.repairProvider))
  ) {
    throw new Error(
      'duration_repair_complete requires a completed DURATION Repair'
    );
  }

  if (
    stage === 'duration_repair_failed' &&
    (payload.repairAttempted !== true ||
      !['DURATION', 'REVIEW'].includes(payload.repairTrigger) ||
      !isObject(payload.repairProvider))
  ) {
    throw new Error(
      'duration_repair_failed requires attempted Repair metadata'
    );
  }
}

function buildWeeklyPlanGenerationDebugArtifact(payload = {}, options = {}) {
  const stage = resolveArtifactStage(
    payload.stage || AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE
  );
  assertRepairStageConsistency(payload, stage);

  return {
    schemaVersion: AI_WEEKLY_PLAN_DEBUG_ARTIFACT_SCHEMA_VERSION,
    artifactType:
      options.artifactType || AI_WEEKLY_PLAN_GENERATION_DEBUG_ARTIFACT_TYPE,
    createdAt: resolveCreatedAt(options.now),
    stage,
    configuration: {
      reviewEnabled: payload.configuration?.reviewEnabled === true,
      repairEnabled: payload.configuration?.repairEnabled === true,
    },
    versions: {
      promptVersion: copyScalar(payload.versions?.promptVersion),
      doctrineVersion: copyScalar(payload.versions?.doctrineVersion),
      outputContractVersion: copyScalar(
        payload.versions?.outputContractVersion
      ),
      outputSchemaVersion: copyScalar(payload.versions?.outputSchemaVersion),
      reviewPromptVersion: copyScalar(
        payload.versions?.reviewPromptVersion
      ),
      reviewContractVersion: copyScalar(
        payload.versions?.reviewContractVersion
      ),
      reviewOutputSchemaVersion: copyScalar(
        payload.versions?.reviewOutputSchemaVersion
      ),
    },
    profileSummary: copyProfileSummary(payload.context),
    generatedAIOutput: copyGeneratedAIOutput(payload.generatedAIOutput),
    normalizedPlanDocument: copyNormalizedPlanDocument(
      payload.normalizedPlanDocument
    ),
    validations: {
      schema: copyValidation(payload.validations?.schema),
      semantic: copyValidation(payload.validations?.semantic),
      pool: copyValidation(payload.validations?.pool),
      businessRules: copyValidation(payload.validations?.businessRules),
      debugContract: copyValidation(payload.validations?.debugContract),
    },
    analytics: copyAnalyticsValue(payload.analytics),
    durationGate: copyDurationGate(payload.durationGate),
    initialReview: copyInitialReview(payload.initialReview),
    generationProvider: copyProvider(payload.generationProvider),
    reviewProvider: copyProvider(payload.initialReview?.provider),
    repairTrigger: ['DURATION', 'REVIEW'].includes(payload.repairTrigger)
      ? payload.repairTrigger
      : null,
    repairProvider: copyProvider(payload.repairProvider),
    repairAttempted: payload.repairAttempted === true,
    persistenceAttempted: payload.persistenceAttempted === true,
  };
}

function buildInitialGenerationDebugArtifact(payload = {}, options = {}) {
  return buildWeeklyPlanGenerationDebugArtifact(
    {
      ...payload,
      stage: AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE,
    },
    {
      ...options,
      artifactType: AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_TYPE,
    }
  );
}

function formatValue(value) {
  if (value == null || value === '') {
    return 'not available';
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : 'none';
  }
  return String(value);
}

function formatJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function formatRepetitions(setTemplate) {
  if (setTemplate.targetReps != null) {
    return String(setTemplate.targetReps);
  }
  if (setTemplate.minReps != null || setTemplate.maxReps != null) {
    return `${formatValue(setTemplate.minReps)}-${formatValue(
      setTemplate.maxReps
    )}`;
  }
  if (setTemplate.targetSeconds != null) {
    return `${setTemplate.targetSeconds} seconds`;
  }
  return 'not available';
}

function buildWorkoutTextLines(artifact) {
  const analyticsByOrderIndex = new Map(
    toArray(artifact.analytics?.workouts).map((workout, index) => [
      workout?.workoutOrderIndex ?? index + 1,
      workout,
    ])
  );
  const lines = [];

  toArray(artifact.generatedAIOutput?.workouts).forEach((workout, index) => {
    const orderIndex = workout.orderIndex ?? index + 1;
    const analyticsWorkout = analyticsByOrderIndex.get(orderIndex) || {};
    const durationCalculation =
      analyticsWorkout.durationCalculation || {};
    lines.push(
      '',
      `Workout ${orderIndex}: ${formatValue(workout.name)}`,
      `- Focus: ${formatValue(workout.focus)}`,
      `Workout ${orderIndex} duration:`,
      `- Requested: ${formatValue(
        analyticsWorkout.requestedDurationMinutes
      )} minutes`,
      `- Calculated by backend: ${formatValue(
        analyticsWorkout.calculatedDurationMinutes
      )} minutes`,
      `- Difference: ${formatValue(
        analyticsWorkout.durationDifferenceMinutes
      )} minutes`,
      `- Backend status: ${formatValue(
        analyticsWorkout.durationAlignmentStatus
      )}`,
      `- Backend calculation: ${formatJson(durationCalculation)}`
    );

    toArray(workout.blocks).forEach((block, blockIndex) => {
      lines.push(
        `  Block ${block.orderIndex ?? blockIndex + 1}: ${formatValue(
          block.blockType
        )}`
      );
      toArray(block.exercises).forEach((exercise, exerciseIndex) => {
        lines.push(
          `    Exercise ${exercise.orderIndex ?? exerciseIndex + 1}: ${formatValue(
            exercise.exerciseName
          )}`,
          `    - exerciseId: ${formatValue(exercise.exerciseId)}`,
          `    - notes: ${formatValue(exercise.notes)}`
        );
        toArray(exercise.setTemplates).forEach((setTemplate, setIndex) => {
          lines.push(
            `      Set ${setTemplate.setIndex ?? setIndex + 1}: reps ${formatRepetitions(
              setTemplate
            )}; RIR ${formatValue(setTemplate.targetRir)}; tempo ${formatValue(
              setTemplate.tempo
            )}; rest ${formatValue(setTemplate.restSeconds)} seconds`
          );
        });
        if (exercise.cardioPrescription) {
          lines.push(
            `    - cardio duration: ${formatValue(
              exercise.cardioPrescription.durationMinutes
            )} minutes`
          );
        }
      });

      const blockOrderIndex = block.orderIndex ?? blockIndex + 1;
      const backendBlock = toArray(durationCalculation.blocks).find(
        (entry) => entry?.blockOrderIndex === blockOrderIndex
      );
      if (backendBlock) {
        lines.push(
          `    Backend duration block ${blockOrderIndex}:`,
          `    - ${formatJson(backendBlock)}`
        );
      }
    });
  });

  return lines;
}

function buildProviderTextLines(label, provider) {
  return [
    `${label}:`,
    `- Type: ${formatValue(provider?.type)}`,
    `- Model: ${formatValue(provider?.model)}`,
    `- Response ID: ${formatValue(provider?.responseId)}`,
    `- Usage: ${formatJson(provider?.usage)}`,
  ];
}

function findFailedValidation(artifact) {
  for (const validationName of [
    'schema',
    'semantic',
    'pool',
    'businessRules',
    'debugContract',
  ]) {
    const validation = artifact.validations?.[validationName];
    if (validation?.ok === false) {
      return {
        validationName,
        validation,
      };
    }
  }
  return null;
}

function buildValidationFailureTextLines(artifact) {
  const failed = findFailedValidation(artifact);
  if (!failed) {
    return [];
  }

  const lines = ['', 'Validation failure:'];
  failed.validation.issues.forEach((issue) => {
    lines.push(
      `- Code: ${formatValue(issue.code)}`,
      `- Path: ${formatValue(issue.path)}`,
      `- Message: ${formatValue(issue.message)}`,
      `- Expected: ${formatValue(issue.expected)}`,
      `- Actual: ${formatValue(issue.actual)}`
    );
  });

  return lines;
}

function buildSupersetMismatchTextLines(artifact) {
  const issue = toArray(artifact.validations?.semantic?.issues).find(
    (entry) =>
      entry?.code === 'SUPERSET_SET_COUNT_MISMATCH' &&
      typeof entry.path === 'string'
  );
  if (!issue) {
    return [];
  }

  const match = issue.path.match(
    /^workouts\[(\d+)\]\.blocks\[(\d+)\]\.exercises\[(\d+)\]\.setTemplates$/
  );
  if (!match) {
    return [];
  }

  const workoutIndex = Number(match[1]);
  const blockIndex = Number(match[2]);
  const block =
    artifact.generatedAIOutput?.workouts?.[workoutIndex]?.blocks?.[blockIndex];
  const laneASetCount = toArray(block?.exercises?.[0]?.setTemplates).length;
  const laneBSetCount = toArray(block?.exercises?.[1]?.setTemplates).length;

  return [
    '',
    'Superset mismatch:',
    `- Workout: ${workoutIndex + 1}`,
    `- Block: ${blockIndex + 1}`,
    `- Lane A set count: ${laneASetCount}`,
    `- Lane B set count: ${laneBSetCount}`,
  ];
}

function renderWeeklyPlanGenerationDebugText(artifact) {
  const generated = artifact.generatedAIOutput || {};
  const profile = artifact.profileSummary;
  const review = artifact.initialReview || {
    decision: null,
    requiresRepair: false,
    reviewSummary: null,
    severityCounts: {},
    categoryCounts: {},
    issues: [],
  };
  const isInitialReviewArtifact =
    artifact.artifactType === AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_TYPE;
  const lines = [
    isInitialReviewArtifact
      ? 'AI WEEKLY PLAN INITIAL GENERATION DEBUG'
      : 'AI WEEKLY PLAN GENERATION DEBUG',
    '',
    'Stage:',
    `- ${artifact.stage}`,
    '',
    'Configuration:',
    `- Review enabled: ${artifact.configuration.reviewEnabled}`,
    `- Repair enabled: ${artifact.configuration.repairEnabled}`,
    `- Repair attempted: ${artifact.repairAttempted}`,
    `- Repair trigger: ${formatValue(artifact.repairTrigger)}`,
    `- Persistence attempted: ${artifact.persistenceAttempted}`,
    '',
    'Profile:',
    `- Goal: ${formatValue(profile.primaryGoal)}`,
    `- Experience: ${formatValue(profile.experience)}`,
    `- Sessions: ${formatValue(profile.sessionsPerWeek)}`,
    `- Duration: ${formatValue(profile.durationPerSession)} minutes`,
    `- Primary priority: ${formatValue(profile.primaryPriority)}`,
    `- Secondary priorities: ${formatValue(profile.secondaryPriorities)}`,
    `- Deprioritized area: ${formatValue(profile.deprioritizedArea)}`,
    `- Cardio: ${formatValue(profile.cardioRole)}`,
    `- Eligible pool count: ${formatValue(profile.eligibleExerciseCount)}`,
    '',
    isInitialReviewArtifact ? 'Generated plan:' : 'Generated output:',
    `- Plan name: ${formatValue(generated.planName)}`,
    `- Split type: ${formatValue(generated.splitType)}`,
    `- Strategy summary: ${formatValue(generated.strategySummary)}`,
    `- Progression: ${formatValue(generated.progressionModel?.summary)}`,
    `- Caution handling: ${formatValue(generated.cautionHandling?.summary)}`,
    `- Muscle distribution rationale: ${formatValue(
      generated.muscleDistributionDebug?.rationale
    )}`,
    `- Declared omitted body parts: ${formatJson(
      generated.muscleDistributionDebug?.omittedBodyParts
    )}`,
    ...buildWorkoutTextLines(artifact),
    ...buildValidationFailureTextLines(artifact),
    ...buildSupersetMismatchTextLines(artifact),
    '',
    'Metrics:',
    '- Actual Analytics reporting:',
    formatJson(artifact.analytics?.muscleMetrics),
    '- Numeric target comparisons (not evaluated in this phase):',
    formatJson(artifact.analytics?.targetComparisons),
    '- Muscle omission audit:',
    formatJson(artifact.analytics?.muscleDistributionDebugAudit),
    '- Duration gate:',
    formatJson(artifact.durationGate),
    '',
    'Initial Review:',
    `- Decision: ${formatValue(review.decision)}`,
    `- Requires repair: ${review.requiresRepair}`,
    `- Summary: ${formatValue(review.reviewSummary)}`,
    `- Severity counts: ${formatJson(review.severityCounts)}`,
    `- Category counts: ${formatJson(review.categoryCounts)}`,
  ];

  review.issues.forEach((issue) => {
    lines.push(
      '',
      `Issue ${formatValue(issue.issueIndex)}:`,
      `- Category: ${formatValue(issue.category)}`,
      `- Severity: ${formatValue(issue.severity)}`,
      `- Path: ${formatValue(issue.path)}`,
      `- Message: ${formatValue(issue.message)}`,
      `- Repairability: ${formatValue(issue.repairability)}`,
      `- Suggested action: ${formatValue(issue.suggestedAction)}`
    );
  });

  lines.push(
    '',
    'Providers:',
    ...buildProviderTextLines('Generation provider', artifact.generationProvider),
    ...buildProviderTextLines('Repair provider', artifact.repairProvider),
    ...buildProviderTextLines('Review provider', artifact.reviewProvider),
    ''
  );

  return lines.join('\n');
}

function renderInitialGenerationDebugText(artifact) {
  return renderWeeklyPlanGenerationDebugText(artifact);
}

function resolveRunId(randomUUID) {
  const runId = String(
    typeof randomUUID === 'function' ? randomUUID() : crypto.randomUUID()
  );
  if (!/^[A-Za-z0-9-]+$/.test(runId)) {
    throw new Error('Invalid debug artifact run identifier');
  }
  return runId;
}

function resolveFileStageSuffix(stage) {
  if (stage === AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE) {
    return 'initial';
  }
  return stage.replace(/_/g, '-');
}

async function writeDebugArtifacts(payload, options, legacyInitialArtifact) {
  const env = options.env || process.env;
  if (!isAIWeeklyPlanDebugArtifactsEnabled(env)) {
    return null;
  }

  const logger = options.logger || console;

  try {
    const artifact = legacyInitialArtifact
      ? buildInitialGenerationDebugArtifact(payload, options)
      : buildWeeklyPlanGenerationDebugArtifact(payload, options);
    const text = renderWeeklyPlanGenerationDebugText(artifact);
    const directory =
      options.outputDirectory || DEFAULT_DEBUG_ARTIFACT_DIRECTORY;
    const runId = resolveRunId(options.randomUUID);
    const suffix = resolveFileStageSuffix(artifact.stage);
    const jsonPath = path.join(directory, `${runId}-${suffix}.json`);
    const textPath = path.join(directory, `${runId}-${suffix}.txt`);

    await (options.fileSystem || fs).mkdir(directory, { recursive: true });
    await (options.fileSystem || fs).writeFile(
      jsonPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    await (options.fileSystem || fs).writeFile(textPath, text, {
      encoding: 'utf8',
      flag: 'wx',
    });

    logger.log(
      `${
        legacyInitialArtifact
          ? '[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact written'
          : '[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Generation artifact written'
      }\nJSON: ${jsonPath}\nTXT: ${textPath}`
    );

    return Object.freeze({
      stage: artifact.stage,
      jsonPath,
      textPath,
    });
  } catch (_error) {
    logger.warn(
      '[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact could not be written'
    );
    return null;
  }
}

async function writeWeeklyPlanGenerationDebugArtifacts(
  payload = {},
  options = {}
) {
  return writeDebugArtifacts(payload, options, false);
}

async function writeInitialGenerationDebugArtifacts(payload = {}, options = {}) {
  return writeDebugArtifacts(
    {
      ...payload,
      stage: AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE,
    },
    options,
    true
  );
}

module.exports = {
  AI_WEEKLY_PLAN_DEBUG_ARTIFACT_SCHEMA_VERSION,
  AI_WEEKLY_PLAN_DEBUG_ARTIFACT_TYPE:
    AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_TYPE,
  AI_WEEKLY_PLAN_GENERATION_DEBUG_ARTIFACT_TYPE,
  AI_WEEKLY_PLAN_INITIAL_DEBUG_ARTIFACT_STAGE,
  DEFAULT_DEBUG_ARTIFACT_DIRECTORY,
  buildInitialGenerationDebugArtifact,
  buildWeeklyPlanGenerationDebugArtifact,
  isAIWeeklyPlanDebugArtifactsEnabled,
  renderInitialGenerationDebugText,
  renderWeeklyPlanGenerationDebugText,
  writeInitialGenerationDebugArtifacts,
  writeWeeklyPlanGenerationDebugArtifacts,
};
