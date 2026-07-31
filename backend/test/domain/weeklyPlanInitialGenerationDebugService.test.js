const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  AI_WEEKLY_PLAN_DEBUG_ARTIFACT_TYPE,
  AI_WEEKLY_PLAN_GENERATION_DEBUG_ARTIFACT_TYPE,
  buildInitialGenerationDebugArtifact,
  buildWeeklyPlanGenerationDebugArtifact,
  isAIWeeklyPlanDebugArtifactsEnabled,
  renderInitialGenerationDebugText,
  renderWeeklyPlanGenerationDebugText,
  writeInitialGenerationDebugArtifacts,
  writeWeeklyPlanGenerationDebugArtifacts,
} = require('../../services/weeklyPlanInitialGenerationDebugService');

function debugEnabledEnv(overrides = {}) {
  return {
    ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'true',
    NODE_ENV: 'development',
    ...overrides,
  };
}

function createPayload() {
  const generatedExercise = {
    exerciseId: 'ex_bench',
    exerciseName: 'Dumbbell Bench Press',
    orderIndex: 1,
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    setTemplates: [
      {
        setIndex: 1,
        setType: 'WORKING',
        targetReps: 10,
        minReps: null,
        maxReps: null,
        targetSeconds: null,
        targetRir: 2,
        tempo: '3010',
        restSeconds: 120,
      },
    ],
    cardioPrescription: null,
    notes: 'Controlled execution.',
  };

  return {
    configuration: {
      reviewEnabled: true,
      repairEnabled: false,
    },
    versions: {
      promptVersion: 'ai-weekly-plan-builder-prompt-v2.4.0',
      doctrineVersion: null,
      outputContractVersion: 4,
      outputSchemaVersion: 4,
      reviewPromptVersion: 'ai-program-review-prompt-v1.3.0',
      reviewContractVersion: 3,
      reviewOutputSchemaVersion: 3,
    },
    context: {
      userId: 'PRIVATE_USER_ID',
      email: 'private@example.com',
      primaryGoal: 'HYPERTROPHY',
      experience: 'advanced',
      availability: {
        sessionsPerWeek: 1,
        durationPerSession: 60,
      },
      musclePriorityProfile: {
        primaryFocus: 'upper_chest',
        secondaryFocuses: ['triceps'],
        deprioritizedArea: null,
      },
      cardioProfile: {
        cardioRole: 'none',
      },
      poolSnapshot: {
        availableExerciseCount: 1,
        userId: 'PRIVATE_POOL_USER_ID',
        blockedExerciseIds: ['PRIVATE_BLOCKED_ID'],
      },
    },
    generatedAIOutput: {
      schemaVersion: 4,
      planName: 'Initial plan',
      sessionsPerWeek: 1,
      strategySummary:
        'Contact private@example.com DATABASE_URL=postgres://private',
      splitType: 'full_body',
      workouts: [
        {
          name: 'Upper',
          orderIndex: 1,
          focus: 'Upper body',
          blocks: [
            {
              orderIndex: 1,
              blockType: 'SINGLE',
              exercises: [generatedExercise],
            },
          ],
        },
      ],
      muscleDistributionDebug: {
        rationale: 'The plan emphasizes direct chest work for the selected priority.',
        omittedBodyParts: [
          {
            area: 'back',
            reasonCode: 'specialization_tradeoff',
            explanation: 'Back is omitted from this compact one-exercise fixture.',
          },
        ],
      },
      progressionModel: {
        type: 'double_progression',
        summary: 'Add repetitions before load.',
      },
      cautionHandling: {
        summary: 'Use conservative execution.',
      },
      notesPolicy: {
        summary: 'Use notes sparingly.',
      },
      authorization: 'Bearer PRIVATE_AUTHORIZATION',
      env: {
        OPENAI_API_KEY: 'PRIVATE_API_KEY',
      },
    },
    normalizedPlanDocument: {
      name: 'Initial plan',
      sessionsPerWeek: 1,
      workouts: [
        {
          name: 'Upper',
          orderIndex: 1,
          estimatedDurationMinutes: 60,
          notes: 'Upper body',
          blocks: [
            {
              orderIndex: 1,
              blockType: 'SINGLE',
              roundCount: null,
              restStrategy: 'AFTER_EXERCISE',
              restSeconds: 120,
              exercises: [generatedExercise],
            },
          ],
        },
      ],
      userId: 'PRIVATE_NORMALIZED_USER_ID',
      cookie: 'PRIVATE_COOKIE',
    },
    validations: {
      schema: {
        ok: true,
        issueCount: 0,
        issues: [],
        value: { raw: 'PRIVATE_SCHEMA_VALUE' },
      },
      semantic: { ok: true, issues: [] },
      pool: { ok: true, issues: [] },
      businessRules: { ok: true, issueCount: 0, issues: [] },
    },
    analytics: {
      schemaVersion: 3,
      status: 'complete',
      plan: {
        workoutCount: 1,
        calculatedDurationMinutesTotal: 58,
        durationAlignmentStatusCounts: {
          preferred: 1,
          unavailable: 0,
        },
      },
      workouts: [
        {
          workoutOrderIndex: 1,
          requestedDurationMinutes: 60,
          calculatedDurationMinutes: 58,
          durationAlignmentStatus: 'preferred',
          durationDifferenceMinutes: -2,
          durationCalculation: {
            methodId: 'historical_weekly_plan_metrics_v1',
            blocks: [
              {
                blockOrderIndex: 1,
                movementSeconds: 400,
                adjustedRestSeconds: 2930,
                fixedSeconds: 150,
                cardioSeconds: 0,
                totalSeconds: 3480,
              },
            ],
            workoutTotalSeconds: 3480,
            calculatedDurationMinutes: 58,
          },
        },
      ],
      muscleMetrics: [
        {
          taxonomy: 'body_part',
          key: 'chest',
          directWorkingSets: 10,
          directWorkoutCount: 1,
        },
      ],
      targetComparisons: {
        volume: {
          bodyParts: {
            items: [],
            summary: {
              targetCount: 0,
              belowTargetCount: 0,
              withinTargetCount: 0,
              aboveTargetCount: 0,
              unavailableCount: 0,
            },
          },
        },
      },
      muscleDistributionDebugAudit: {
        actualZeroDirectBodyParts: ['back'],
        declaredOmittedBodyParts: ['back'],
        missingOmissionExplanations: [],
        falselyDeclaredOmissions: [],
        unsupportedPoolLimitationClaims: [],
        omissionDeclarationMatchesActualCoverage: true,
        poolLimitationClaimsVerified: true,
      },
      DATABASE_URL: 'PRIVATE_DATABASE_URL',
      authorization: 'PRIVATE_ANALYTICS_AUTHORIZATION',
    },
    initialReview: {
      decision: 'REPAIR_REQUIRED',
      requiresRepair: true,
      promptVersion: 'ai-program-review-prompt-v1.3.0',
      contractVersion: 3,
      outputSchemaVersion: 3,
      issueCount: 1,
      severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
      categoryCounts: { SPLIT_DURATION_COHERENCE: 1 },
      review: {
        reviewSummary: 'One correction is required.',
        issues: [
          {
            issueIndex: 1,
            category: 'SPLIT_DURATION_COHERENCE',
            severity: 'HIGH',
            path: '/analytics/workouts/0/durationAlignmentStatus',
            message: 'The workout is shorter than requested.',
            repairability: 'REPAIRABLE',
            suggestedAction: 'Increase productive work.',
          },
        ],
      },
      provider: {
        type: 'openai',
        model: 'review-model',
        responseId: 'resp_review_123',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          reasoningTokens: 10,
        },
        rawResponse: 'PRIVATE_REVIEW_RAW_RESPONSE',
        authorization: 'PRIVATE_REVIEW_AUTHORIZATION',
      },
      reviewInput: {
        email: 'private@example.com',
      },
    },
    generationProvider: {
      type: 'openai',
      model: 'generation-model',
      responseId: 'resp_generation_123',
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
      rawResponse: 'PRIVATE_GENERATION_RAW_RESPONSE',
      apiKey: 'PRIVATE_API_KEY',
    },
    repairTrigger: 'DURATION',
    repairProvider: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair_123',
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        reasoningTokens: 20,
      },
      rawResponse: 'PRIVATE_REPAIR_RAW_RESPONSE',
    },
    repairAttempted: true,
    persistenceAttempted: true,
  };
}

test('isAIWeeklyPlanDebugArtifactsEnabled requires exact true outside production', () => {
  assert.equal(isAIWeeklyPlanDebugArtifactsEnabled({}), false);
  assert.equal(
    isAIWeeklyPlanDebugArtifactsEnabled({
      ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'false',
      NODE_ENV: 'development',
    }),
    false
  );
  assert.equal(
    isAIWeeklyPlanDebugArtifactsEnabled({
      ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'true',
      NODE_ENV: 'production',
    }),
    false
  );
  assert.equal(
    isAIWeeklyPlanDebugArtifactsEnabled(debugEnabledEnv()),
    true
  );
  assert.equal(
    isAIWeeklyPlanDebugArtifactsEnabled(
      debugEnabledEnv({
        ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'TrUe',
      })
    ),
    true
  );
});

test('debug artifact projection is allowlisted and retains the full initial review', () => {
  const artifact = buildInitialGenerationDebugArtifact(createPayload(), {
    now: () => new Date('2026-07-27T20:00:00.000Z'),
  });
  const serialized = JSON.stringify(artifact);

  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.artifactType, AI_WEEKLY_PLAN_DEBUG_ARTIFACT_TYPE);
  assert.equal(artifact.createdAt, '2026-07-27T20:00:00.000Z');
  assert.equal(artifact.stage, 'initial_review_complete');
  assert.equal(artifact.generatedAIOutput.workouts[0].blocks.length, 1);
  assert.equal(
    artifact.normalizedPlanDocument.workouts[0].blocks[0].exercises[0]
      .exerciseId,
    'ex_bench'
  );
  assert.deepEqual(artifact.validations.schema, {
    ok: true,
    issueCount: 0,
    issues: [],
  });
  assert.equal(
    artifact.analytics.workouts[0].calculatedDurationMinutes,
    58
  );
  assert.equal(
    artifact.analytics.workouts[0].durationCalculation
      .calculatedDurationMinutes,
    58
  );
  assert.equal(
    Object.hasOwn(
      artifact.generatedAIOutput.workouts[0],
      'durationCalculationDebug'
    ),
    false
  );
  assert.equal(
    artifact.generatedAIOutput.muscleDistributionDebug.omittedBodyParts[0].area,
    'back'
  );
  assert.equal(artifact.initialReview.issues.length, 1);
  assert.equal(
    artifact.initialReview.issues[0].suggestedAction,
    'Increase productive work.'
  );
  assert.deepEqual(Object.keys(artifact.generationProvider), [
    'type',
    'model',
    'responseId',
    'usage',
  ]);
  assert.equal(artifact.repairTrigger, 'DURATION');
  assert.equal(artifact.repairProvider.responseId, 'resp_repair_123');
  assert.equal(artifact.repairAttempted, true);
  assert.equal(artifact.persistenceAttempted, true);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_|DATABASE_URL|authorization|rawResponse|OPENAI_API_KEY|@example\.com|userId|stack/i
  );
});

test('TXT rendering contains workouts, prescriptions, analytics duration, and review issues', () => {
  const artifact = buildInitialGenerationDebugArtifact(createPayload(), {
    now: () => new Date('2026-07-27T20:00:00.000Z'),
  });
  const text = renderInitialGenerationDebugText(artifact);

  assert.match(text, /^AI WEEKLY PLAN INITIAL GENERATION DEBUG/);
  assert.match(text, /Workout 1: Upper/);
  assert.match(text, /Exercise 1: Dumbbell Bench Press/);
  assert.match(text, /exerciseId: ex_bench/);
  assert.match(text, /Set 1: reps 10; RIR 2; tempo 3010; rest 120 seconds/);
  assert.match(text, /Workout 1 duration:/);
  assert.match(text, /Requested: 60 minutes/);
  assert.match(text, /Calculated by backend: 58 minutes/);
  assert.match(text, /Difference: -2 minutes/);
  assert.doesNotMatch(text, /Estimated by AI|Calculated by AI debug/);
  assert.match(text, /Backend status: preferred/);
  assert.match(text, /Muscle distribution rationale:/);
  assert.match(text, /Muscle omission audit:/);
  assert.match(text, /Issue 1:/);
  assert.match(text, /Increase productive work/);
  assert.match(text, /Generation provider:/);
  assert.match(text, /Repair provider:/);
  assert.match(text, /Review provider:/);
});

test('semantic failure artifact preserves mismatch scalars and derives both superset lane counts', () => {
  const payload = createPayload();
  const laneA = payload.generatedAIOutput.workouts[0].blocks[0].exercises[0];
  laneA.setTemplates = [
    laneA.setTemplates[0],
    { ...laneA.setTemplates[0], setIndex: 2 },
    { ...laneA.setTemplates[0], setIndex: 3 },
  ];
  const laneB = {
    ...laneA,
    exerciseId: 'ex_row',
    exerciseName: 'Chest Supported Row',
    orderIndex: 2,
    setTemplates: laneA.setTemplates.slice(0, 2),
  };
  payload.generatedAIOutput.workouts[0].blocks[0] = {
    orderIndex: 1,
    blockType: 'SUPERSET',
    exercises: [laneA, laneB],
  };
  payload.stage = 'semantic_validation_failed';
  payload.normalizedPlanDocument = null;
  payload.validations = {
    schema: { ok: true, issueCount: 0, issues: [] },
    semantic: {
      ok: false,
      issueCount: 1,
      issues: [
        {
          code: 'SUPERSET_SET_COUNT_MISMATCH',
          path: 'workouts[0].blocks[0].exercises[1].setTemplates',
          message: 'SUPERSET exercises must use the same number of setTemplates',
          expected: 3,
          actual: 2,
        },
      ],
    },
    pool: null,
    businessRules: null,
  };
  payload.analytics = null;
  payload.initialReview = null;

  const artifact = buildWeeklyPlanGenerationDebugArtifact(payload, {
    now: () => new Date('2026-07-27T20:00:00.000Z'),
  });
  const text = renderWeeklyPlanGenerationDebugText(artifact);

  assert.equal(
    artifact.artifactType,
    AI_WEEKLY_PLAN_GENERATION_DEBUG_ARTIFACT_TYPE
  );
  assert.equal(artifact.stage, 'semantic_validation_failed');
  assert.equal(artifact.normalizedPlanDocument, null);
  assert.equal(artifact.analytics, null);
  assert.equal(artifact.initialReview, null);
  assert.equal(artifact.validations.schema.ok, true);
  assert.deepEqual(artifact.validations.semantic.issues[0], {
    code: 'SUPERSET_SET_COUNT_MISMATCH',
    path: 'workouts[0].blocks[0].exercises[1].setTemplates',
    message: 'SUPERSET exercises must use the same number of setTemplates',
    expected: 3,
    actual: 2,
  });
  assert.match(text, /^AI WEEKLY PLAN GENERATION DEBUG/);
  assert.match(text, /Stage:\n- semantic_validation_failed/);
  assert.match(text, /Expected: 3/);
  assert.match(text, /Actual: 2/);
  assert.match(text, /Superset mismatch:/);
  assert.match(text, /Workout: 1/);
  assert.match(text, /Block: 1/);
  assert.match(text, /Lane A set count: 3/);
  assert.match(text, /Lane B set count: 2/);
});

test('duration_gate_passed renders coherent no-Repair metadata and backend gate', () => {
  const payload = createPayload();
  payload.stage = 'duration_gate_passed';
  payload.repairAttempted = false;
  payload.repairTrigger = null;
  payload.repairProvider = null;
  payload.durationGate = {
    ok: true,
    correctionRequired: false,
    workouts: [],
  };

  const artifact = buildWeeklyPlanGenerationDebugArtifact(payload, {
    now: () => new Date('2026-07-27T20:00:00.000Z'),
  });
  const text = renderWeeklyPlanGenerationDebugText(artifact);

  assert.equal(artifact.stage, 'duration_gate_passed');
  assert.equal(artifact.repairAttempted, false);
  assert.equal(artifact.repairTrigger, null);
  assert.equal(artifact.repairProvider, null);
  assert.deepEqual(artifact.durationGate, {
    ok: true,
    correctionRequired: false,
    workouts: [],
  });
  assert.match(text, /Stage:\n- duration_gate_passed/);
  assert.match(text, /Repair attempted: false/);
  assert.match(text, /"correctionRequired": false/);
});

test('duration repair stages reject misleading Repair metadata', () => {
  const payload = createPayload();
  payload.stage = 'duration_repair_complete';
  payload.repairAttempted = false;
  payload.repairTrigger = null;
  payload.repairProvider = null;

  assert.throws(
    () => buildWeeklyPlanGenerationDebugArtifact(payload),
    /requires a completed DURATION Repair/
  );
});

test('generic writer uses unique semantic-validation-failed filenames', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'weekly-plan-semantic-debug-')
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const payload = createPayload();
  payload.stage = 'semantic_validation_failed';
  payload.normalizedPlanDocument = null;
  payload.validations = {
    schema: { ok: true, issues: [] },
    semantic: {
      ok: false,
      issues: [
        {
          code: 'SUPERSET_SET_COUNT_MISMATCH',
          path: 'workouts[0].blocks[0].exercises[1].setTemplates',
          message: 'Mismatch.',
          expected: 3,
          actual: 2,
        },
      ],
    },
  };
  payload.analytics = null;
  payload.initialReview = null;
  const ids = ['semantic-run-one', 'semantic-run-two'];
  const options = {
    env: debugEnabledEnv(),
    outputDirectory: directory,
    randomUUID: () => ids.shift(),
    logger: {
      log() {},
      warn() {
        assert.fail('generic writer should not warn');
      },
    },
  };

  const first = await writeWeeklyPlanGenerationDebugArtifacts(payload, options);
  const second = await writeWeeklyPlanGenerationDebugArtifacts(payload, options);

  assert.match(
    first.jsonPath,
    /semantic-run-one-semantic-validation-failed\.json$/
  );
  assert.match(
    first.textPath,
    /semantic-run-one-semantic-validation-failed\.txt$/
  );
  assert.notEqual(first.jsonPath, second.jsonPath);
  assert.notEqual(first.textPath, second.textPath);
});

test('writer creates unique JSON and TXT files without overwriting', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'weekly-plan-initial-debug-')
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runIds = ['run-one', 'run-two'];
  const logs = [];
  const logger = {
    log(message) {
      logs.push(message);
    },
    warn() {
      assert.fail('writer should not warn');
    },
  };
  const options = {
    env: debugEnabledEnv(),
    outputDirectory: directory,
    randomUUID: () => runIds.shift(),
    now: () => new Date('2026-07-27T20:00:00.000Z'),
    logger,
  };

  const first = await writeInitialGenerationDebugArtifacts(
    createPayload(),
    options
  );
  const second = await writeInitialGenerationDebugArtifacts(
    createPayload(),
    options
  );
  const json = JSON.parse(await fs.readFile(first.jsonPath, 'utf8'));
  const text = await fs.readFile(first.textPath, 'utf8');

  assert.notEqual(first.jsonPath, second.jsonPath);
  assert.notEqual(first.textPath, second.textPath);
  assert.equal(json.artifactType, AI_WEEKLY_PLAN_DEBUG_ARTIFACT_TYPE);
  assert.match(text, /AI WEEKLY PLAN INITIAL GENERATION DEBUG/);
  assert.deepEqual(logs, [
    `[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact written\nJSON: ${first.jsonPath}\nTXT: ${first.textPath}`,
    `[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact written\nJSON: ${second.jsonPath}\nTXT: ${second.textPath}`,
  ]);
});

test('disabled writer performs no filesystem operation', async () => {
  let filesystemCalled = false;
  const fileSystem = {
    async mkdir() {
      filesystemCalled = true;
    },
    async writeFile() {
      filesystemCalled = true;
    },
  };

  const result = await writeInitialGenerationDebugArtifacts(createPayload(), {
    env: {
      ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'false',
      NODE_ENV: 'development',
    },
    fileSystem,
  });

  assert.equal(result, null);
  assert.equal(filesystemCalled, false);
});

test('writer failures are generic and return no artifact reference', async () => {
  const warnings = [];
  const result = await writeInitialGenerationDebugArtifacts(createPayload(), {
    env: debugEnabledEnv(),
    fileSystem: {
      async mkdir() {
        throw new Error('PRIVATE_FILESYSTEM_FAILURE');
      },
    },
    logger: {
      log() {
        assert.fail('writer should not log success');
      },
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.equal(result, null);
  assert.deepEqual(warnings, [
    '[AI_WEEKLY_PLAN_DEBUG_ARTIFACT] Initial generation artifact could not be written',
  ]);
  assert.doesNotMatch(warnings[0], /PRIVATE_FILESYSTEM_FAILURE/);
});
