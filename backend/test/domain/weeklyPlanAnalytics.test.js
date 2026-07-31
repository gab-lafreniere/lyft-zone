const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION,
  WeeklyPlanAnalyticsError,
  buildWeeklyPlanAnalyticsAuditSummary,
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  clone,
  createAiOutput,
  createContext,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

test('Analytics V3 exposes backend-only duration calculation details', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
    }),
    context: createContext(),
  });

  assert.equal(WEEKLY_PLAN_ANALYTICS_SCHEMA_VERSION, 3);
  assert.equal(analytics.schemaVersion, 3);
  assert.deepEqual(analytics.workouts[0].durationCalculation, {
    methodId: 'historical_weekly_plan_metrics_v1',
    blocks: [
      {
        blockOrderIndex: 1,
        movementSeconds: 120,
        adjustedRestSeconds: 0,
        fixedSeconds: 120,
        cardioSeconds: 0,
        totalSeconds: 240,
      },
    ],
    workoutTotalSeconds: 840,
    calculatedDurationMinutes: 14,
  });
  assert.equal(analytics.workouts[0].durationAlignmentStatus, 'preferred');
  assert.equal(analytics.workouts[0].durationRequiresCorrection, false);
});

test('Analytics never reads legacy duration declarations from generatedAIOutput', () => {
  const generatedAIOutput = createAiOutput();
  generatedAIOutput.workouts[0].estimatedDurationMinutes = 240;
  generatedAIOutput.workouts[0].durationCalculationDebug = {
    calculatedDurationMinutes: 240,
  };

  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
      estimatedDurationMinutes: 240,
    }),
    context: createContext(),
  });
  const serialized = JSON.stringify(analytics);

  assert.equal(analytics.workouts[0].calculatedDurationMinutes, 14);
  assert.equal(serialized.includes('durationDebugComparison'), false);
  assert.equal(serialized.includes('aiCalculatedDurationMinutes'), false);
  assert.equal(serialized.includes('declaredEstimatedDurationMinutes'), false);
  assert.equal(serialized.includes('differenceAiVsBackendMinutes'), false);
  assert.equal(serialized.includes('matchesBackend'), false);
});

test('Analytics retains workout counts, muscle metrics, coverage, and omissions audit', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
    }),
    context: createContext(),
  });

  assert.equal(analytics.plan.workoutCount, 1);
  assert.equal(analytics.plan.blockCount, 1);
  assert.equal(analytics.plan.strengthExerciseCount, 1);
  assert.equal(analytics.plan.workingSetCount, 1);
  assert.equal(analytics.metadataCoverage.coverageRatio, 1);
  assert.equal(
    analytics.muscleMetrics.some(
      (entry) =>
        entry.taxonomy === 'body_part' &&
        entry.key === 'chest' &&
        entry.directWorkingSets === 1
    ),
    true
  );
  assert.equal(
    analytics.muscleDistributionDebugAudit
      .omissionDeclarationMatchesActualCoverage,
    true
  );
});

test('Analytics is deterministic and does not mutate inputs', () => {
  const input = {
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
    }),
    context: createContext(),
  };
  const before = clone(input);

  assert.deepEqual(
    calculateWeeklyPlanAnalytics(input),
    calculateWeeklyPlanAnalytics(input)
  );
  assert.deepEqual(input, before);
});

test('Analytics audit summary contains backend duration totals only', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
    }),
    context: createContext(),
  });
  const summary = buildWeeklyPlanAnalyticsAuditSummary(analytics);

  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.duration.calculatedDurationMinutesTotal, 14);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      summary.duration,
      'declaredEstimatedDurationMinutesTotal'
    ),
    false
  );
});

test('Analytics rejects a non-canonical Evaluation Policy identity', () => {
  assert.throws(
    () =>
      calculateWeeklyPlanAnalytics({
        generatedPlanDocument: createNormalizedDocument(),
        context: createContext({
          evaluationPolicy: {
            id: 'wrong',
            version: 1,
          },
        }),
      }),
    (error) =>
      error instanceof WeeklyPlanAnalyticsError &&
      error.code === 'INVALID_WEEKLY_PLAN_EVALUATION_POLICY'
  );
});

test('Analytics V3 retains complete plan and workout counters', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument({
      targetSeconds: 120,
    }),
    context: createContext(),
  });

  assert.deepEqual(
    {
      workoutCount: analytics.plan.workoutCount,
      blockCount: analytics.plan.blockCount,
      exerciseCount: analytics.plan.exerciseCount,
      strengthExerciseCount: analytics.plan.strengthExerciseCount,
      cardioExerciseCount: analytics.plan.cardioExerciseCount,
      workingSetCount: analytics.plan.workingSetCount,
    },
    {
      workoutCount: 1,
      blockCount: 1,
      exerciseCount: 1,
      strengthExerciseCount: 1,
      cardioExerciseCount: 0,
      workingSetCount: 1,
    }
  );
});

test('opposing duration failures remain separate and never cancel', () => {
  const generatedAIOutput = createAiOutput({ sessionsPerWeek: 2 });
  const generatedPlanDocument = createNormalizedDocument({
    targetSeconds: 1,
  });
  const secondOutputWorkout = clone(generatedAIOutput.workouts[0]);
  secondOutputWorkout.orderIndex = 2;
  secondOutputWorkout.name = 'Workout 2';
  secondOutputWorkout.blocks[0].exercises[0].setTemplates[0] = {
    ...secondOutputWorkout.blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    targetSeconds: 1200,
  };
  generatedAIOutput.workouts.push(secondOutputWorkout);
  const secondDocumentWorkout = clone(
    createNormalizedDocument({ targetSeconds: 1200 }).workouts[0]
  );
  secondDocumentWorkout.orderIndex = 2;
  secondDocumentWorkout.name = 'Workout 2';
  generatedPlanDocument.sessionsPerWeek = 2;
  generatedPlanDocument.workouts.push(secondDocumentWorkout);

  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context: createContext({
      availability: {
        sessionsPerWeek: 2,
        durationPerSession: 15,
      },
    }),
  });

  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 2);
  assert.deepEqual(
    analytics.workouts.map((workout) => workout.durationAlignmentStatus),
    [
      'correction_required_under_target',
      'correction_required_over_target',
    ]
  );
});

test('empty plans retain deterministic zero duration counters', () => {
  const generatedAIOutput = createAiOutput({
    sessionsPerWeek: 0,
    workouts: [],
  });
  const generatedPlanDocument = {
    name: 'Empty',
    sessionsPerWeek: 0,
    workouts: [],
  };
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context: createContext(),
  });

  assert.equal(analytics.plan.workoutCount, 0);
  assert.equal(analytics.plan.calculatedDurationMinutesTotal, 0);
  assert.equal(analytics.plan.calculatedDurationMinutesAverage, 0);
  assert.equal(analytics.plan.correctionRequiredWorkoutCount, 0);
});

test('missing pool metadata produces partial Analytics with deduplicated IDs', () => {
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput: createAiOutput(),
    generatedPlanDocument: createNormalizedDocument(),
    context: createContext({ exercisePoolItems: [] }),
  });

  assert.equal(analytics.status, 'partial');
  assert.deepEqual(analytics.metadataCoverage.unresolvedExerciseIds, [
    'ex_bench',
  ]);
  assert.equal(analytics.metadataCoverage.coverageRatio, 0);
});

test('invalid generated plan documents retain controlled Analytics errors', () => {
  assert.throws(
    () =>
      calculateWeeklyPlanAnalytics({
        generatedAIOutput: createAiOutput(),
        generatedPlanDocument: null,
        context: createContext(),
      }),
    WeeklyPlanAnalyticsError
  );
});
