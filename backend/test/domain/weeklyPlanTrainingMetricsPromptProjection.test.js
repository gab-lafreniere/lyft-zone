const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
  computeWeeklyPlanWorkoutMetrics,
} = require('../../src/domain/weeklyPlans/weeklyPlanMetrics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
  calculateDurationAlignment,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');
const {
  deriveAIBlockRestSeconds,
  deriveAIBlockRestStrategy,
  deriveAIBlockRoundCount,
} = require('../../src/domain/programGeneration/weeklyPlanAiNormalizer');
const {
  MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
  TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
  WeeklyPlanTrainingMetricsPromptProjectionError,
  buildWeeklyPlanTrainingMetricsPromptProjection,
} = require('../../src/domain/programGeneration/weeklyPlanTrainingMetricsPromptProjection');

function buildProductionExercise({
  exerciseId,
  repsPerSet,
  setCount = 3,
  tempo = '3010',
  restSeconds,
}) {
  return {
    exerciseId,
    exerciseName: exerciseId,
    defaultTempo: tempo,
    defaultRestSeconds: restSeconds,
    setTemplates: Array.from({ length: setCount }, (_, index) => ({
      setIndex: index + 1,
      setType: 'WORKING',
      targetReps: repsPerSet,
      minReps: null,
      maxReps: null,
      tempo,
      restSeconds,
    })),
  };
}

function buildProductionSingleFixture() {
  return {
    blocks: [
      {
        blockType: 'SINGLE',
        restSeconds: 150,
        exercises: [
          buildProductionExercise({
            exerciseId: 'single_example',
            repsPerSet: 8,
            restSeconds: 150,
          }),
        ],
      },
    ],
  };
}

function buildProductionSupersetBlock() {
  return {
    blockType: 'SUPERSET',
    roundCount: 4,
    restStrategy: 'AFTER_ROUND',
    restSeconds: 150,
    exercises: [
      {
        orderIndex: 1,
        ...buildProductionExercise({
          exerciseId: 'superset_lane_a',
          repsPerSet: 8,
          setCount: 4,
          restSeconds: 150,
        }),
      },
      {
        orderIndex: 2,
        ...buildProductionExercise({
          exerciseId: 'superset_lane_b',
          repsPerSet: 10,
          setCount: 4,
          restSeconds: 150,
        }),
      },
    ],
  };
}

const DYNAMIC_DURATION_CASES = [
  {
    requestedMinutes: 30,
    moduleCount: 2,
    workoutTotalSeconds: 1791,
    unroundedMinutes: 29.85,
    roundedMinutes: 30,
    acceptableMinutes: { minimum: 26, maximum: 31 },
    preferredMinutes: { minimum: 27, maximum: 30 },
  },
  {
    requestedMinutes: 45,
    moduleCount: 3,
    workoutTotalSeconds: 2686.5,
    unroundedMinutes: 44.775,
    roundedMinutes: 45,
    acceptableMinutes: { minimum: 39, maximum: 47 },
    preferredMinutes: { minimum: 41, maximum: 45 },
  },
  {
    requestedMinutes: 60,
    moduleCount: 4,
    workoutTotalSeconds: 3582,
    unroundedMinutes: 59.7,
    roundedMinutes: 60,
    acceptableMinutes: { minimum: 51, maximum: 63 },
    preferredMinutes: { minimum: 54, maximum: 60 },
  },
  {
    requestedMinutes: 75,
    moduleCount: 5,
    workoutTotalSeconds: 4477.5,
    unroundedMinutes: 74.625,
    roundedMinutes: 75,
    acceptableMinutes: { minimum: 64, maximum: 78 },
    preferredMinutes: { minimum: 68, maximum: 75 },
  },
  {
    requestedMinutes: 90,
    moduleCount: 6,
    workoutTotalSeconds: 5373,
    unroundedMinutes: 89.55,
    roundedMinutes: 90,
    acceptableMinutes: { minimum: 77, maximum: 94 },
    preferredMinutes: { minimum: 81, maximum: 90 },
  },
];

test('Training Metrics Guidance V2 is deterministic, JSON-safe, compact, private-free, and immutable toward its sources', () => {
  const policyBefore = JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY);
  const descriptorBefore = JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
  const first = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const second = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const serialized = JSON.stringify(first);

  assert.equal(TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION, 2);
  assert.equal(first.schemaVersion, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(serialized), first);
  assert.ok(serialized.length <= MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS);
  assert.equal(JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY), policyBefore);
  assert.equal(JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR), descriptorBefore);
  [
    'evaluationPolicy',
    'eligibleExercisePool',
    'analytics',
    'userId',
    'physicalNotes',
  ].forEach((field) => assert.equal(field in first, false));
});

test('duration guidance projects canonical method, repetition, tempo, block, and workout rules', () => {
  const duration = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration;
  const descriptor = WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR;

  assert.equal(duration.methodId, descriptor.id);
  assert.deepEqual(
    duration.repetitions.valuePrecedence,
    descriptor.repetitions.valuePrecedence
  );
  assert.deepEqual(duration.tempo, descriptor.tempo);
  assert.equal(
    duration.blocks.SINGLE.restIntervalMultiplier,
    descriptor.blocks.SINGLE.restIntervalMultiplier
  );
  assert.equal(
    duration.blocks.SINGLE.fixedBlockSeconds,
    descriptor.blocks.SINGLE.fixedBlockSeconds
  );
  assert.deepEqual(
    duration.blocks.SINGLE.restSourcePrecedence,
    descriptor.blocks.SINGLE.restSourcePrecedence
  );
  assert.equal(
    duration.blocks.SUPERSET.betweenLaneRest,
    descriptor.blocks.SUPERSET.betweenLaneRest
  );
  assert.equal(
    duration.blocks.CARDIO.secondsPerMinute,
    descriptor.blocks.CARDIO.secondsPerMinute
  );
  assert.deepEqual(duration.workoutTotal, {
    sumBlocksBeforeConversion: true,
    secondsPerMinute: 60,
    roundOnceAfterWorkoutTotal: true,
    rounding: descriptor.output.rounding,
  });
});

test('Output V2 normalization mapping is materialized by the canonical normalizer helpers with lane A authority', () => {
  const normalization = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration.outputV2Normalization;
  const probe = {
    blockType: 'SUPERSET',
    exercises: [
      {
        orderIndex: 1,
        defaultRestSeconds: 120,
        setTemplates: [{}, {}, {}],
      },
      {
        orderIndex: 2,
        defaultRestSeconds: 60,
        setTemplates: [{}, {}, {}],
      },
    ],
  };

  assert.deepEqual(normalization.derivedBlockFields, [
    'block.roundCount',
    'block.restSeconds',
    'block.restStrategy',
  ]);
  assert.equal(normalization.laneAOrderIndex, 1);
  assert.equal(
    normalization.SUPERSET.sample.roundCount,
    deriveAIBlockRoundCount(probe)
  );
  assert.equal(
    normalization.SUPERSET.sample.blockRestSeconds,
    deriveAIBlockRestSeconds(probe)
  );
  assert.equal(normalization.SUPERSET.sample.blockRestSeconds, 120);
  assert.equal(normalization.SUPERSET.laneBControlsRest, false);
  assert.equal(
    normalization.SUPERSET.restStrategy,
    deriveAIBlockRestStrategy('SUPERSET')
  );
  assert.equal(normalization.SINGLE.restStrategy, 'AFTER_EXERCISE');
  assert.deepEqual(normalization.CARDIO, {
    roundCount: null,
    restSeconds: null,
    restStrategy: 'NONE',
  });
});

test('canonical SINGLE example derives every value and agrees with production', () => {
  const example = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration.examples.single;
  const production = computeWeeklyPlanWorkoutMetrics(
    buildProductionSingleFixture()
  );

  assert.deepEqual(example.inputs, {
    setCount: 3,
    repsPerSet: 8,
    tempo: '3010',
    restSeconds: 150,
  });
  assert.equal(example.secondsPerRepetition, 4);
  assert.equal(example.setMovementSeconds, 32);
  assert.equal(example.exerciseMovementSeconds, 96);
  assert.equal(example.restIntervals, 2);
  assert.equal(example.rawRestSeconds, 300);
  assert.equal(example.adjustedRestSeconds, 345);
  assert.equal(example.fixedBlockSeconds, 90);
  assert.equal(example.blockTotalSeconds, 531);
  assert.equal(example.unroundedMinutes, 8.85);
  assert.equal(example.roundedMinutes, 9);
  assert.equal(production.estimatedDurationMinutes, example.roundedMinutes);
});

test('canonical SUPERSET example derives lane movement and one block rest sequence and agrees with production', () => {
  const example = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration.examples.superset;
  const production = computeWeeklyPlanWorkoutMetrics({
    blocks: [buildProductionSupersetBlock()],
  });

  assert.deepEqual(example.inputs, {
    setCountPerLane: 4,
    laneAOrderIndex: 1,
    laneAReps: 8,
    laneBOrderIndex: 2,
    laneBReps: 10,
    tempo: '3010',
    laneADefaultRestSeconds: 150,
    laneBDefaultRestSeconds: 150,
  });
  assert.equal(example.arithmeticOnly, true);
  assert.equal(example.copyPrescriptions, false);
  assert.equal(example.secondsPerRepetition, 4);
  assert.equal(example.laneAMovementSeconds, 128);
  assert.equal(example.laneBMovementSeconds, 160);
  assert.equal(example.rounds, 4);
  assert.equal(example.restIntervals, 3);
  assert.equal(example.rawRestSeconds, 450);
  assert.equal(example.adjustedRestSeconds, 517.5);
  assert.equal(example.fixedBlockSeconds, 90);
  assert.equal(example.betweenLaneRestSeconds, 0);
  assert.equal(example.blockTotalSeconds, 895.5);
  assert.equal(example.unroundedMinutes, 14.925);
  assert.equal(example.roundedMinutes, 15);
  assert.equal(production.setCount, 8);
  assert.equal(production.totalTUTSeconds, 288);
  assert.equal(production.estimatedDurationMinutes, example.roundedMinutes);
});

test('30-minute workout example repeats independent reference modules before one final production rounding and policy classification', () => {
  const example = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration.examples.workout;
  const production = computeWeeklyPlanWorkoutMetrics({
    blocks: [buildProductionSupersetBlock(), buildProductionSupersetBlock()],
  });

  assert.deepEqual(example, {
    arithmeticOnly: true,
    copyPrescriptions: false,
    requestedMinutes: 30,
    referenceExample: 'superset',
    referenceModuleMinutes: 15,
    moduleCount: 2,
    workoutTotalSeconds: 1791,
    unroundedMinutes: 29.85,
    roundedMinutes: 30,
    alignmentStatus: 'preferred',
    requiresCorrection: false,
  });
  assert.equal(production.estimatedDurationMinutes, example.roundedMinutes);
});

test('30-minute ranges and second budgets are derived from policy and canonical seconds per minute', () => {
  const duration = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).duration;

  assert.deepEqual(duration.ranges, {
    requestedMinutes: 30,
    acceptableMinutes: { minimum: 26, maximum: 31 },
    preferredMinutes: { minimum: 27, maximum: 30 },
  });
  assert.deepEqual(duration.budgets, {
    planningOnly: true,
    acceptableSeconds: { minimum: 1560, maximum: 1860 },
    preferredSeconds: { minimum: 1620, maximum: 1800 },
  });
});

test('canonical dynamic examples remain deterministic, production-verified, compact, and duration-specific', () => {
  for (const expected of DYNAMIC_DURATION_CASES) {
    const beforePolicy = JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY);
    const beforeDescriptor = JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
    const first = buildWeeklyPlanTrainingMetricsPromptProjection({
      requestedDurationMinutes: expected.requestedMinutes,
    });
    const second = buildWeeklyPlanTrainingMetricsPromptProjection({
      requestedDurationMinutes: expected.requestedMinutes,
    });
    const { duration } = first;
    const production = computeWeeklyPlanWorkoutMetrics({
      blocks: Array.from(
        { length: expected.moduleCount },
        () => structuredClone(buildProductionSupersetBlock())
      ),
    });

    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY), beforePolicy);
    assert.equal(
      JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR),
      beforeDescriptor
    );
    assert.deepEqual(duration.examples.workout, {
      arithmeticOnly: true,
      copyPrescriptions: false,
      requestedMinutes: expected.requestedMinutes,
      referenceExample: 'superset',
      referenceModuleMinutes: 15,
      moduleCount: expected.moduleCount,
      workoutTotalSeconds: expected.workoutTotalSeconds,
      unroundedMinutes: expected.unroundedMinutes,
      roundedMinutes: expected.roundedMinutes,
      alignmentStatus: 'preferred',
      requiresCorrection: false,
    });
    assert.deepEqual(duration.ranges, {
      requestedMinutes: expected.requestedMinutes,
      acceptableMinutes: expected.acceptableMinutes,
      preferredMinutes: expected.preferredMinutes,
    });
    assert.deepEqual(duration.budgets, {
      planningOnly: true,
      acceptableSeconds: {
        minimum: expected.acceptableMinutes.minimum * 60,
        maximum: expected.acceptableMinutes.maximum * 60,
      },
      preferredSeconds: {
        minimum: expected.preferredMinutes.minimum * 60,
        maximum: expected.preferredMinutes.maximum * 60,
      },
    });
    assert.equal(
      production.estimatedDurationMinutes,
      expected.roundedMinutes
    );
    assert.ok(
      JSON.stringify(first).length <=
        MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS
    );
  }
});

test('15 and 120 minutes use the same reference module while non-divisible and resource-guarded durations fail safe', () => {
  const fifteen = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 15,
  }).duration;
  const oneTwenty = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 120,
  }).duration;

  assert.deepEqual(fifteen.examples.workout, {
    arithmeticOnly: true,
    copyPrescriptions: false,
    requestedMinutes: 15,
    referenceExample: 'superset',
    referenceModuleMinutes: 15,
    moduleCount: 1,
    workoutTotalSeconds: 895.5,
    unroundedMinutes: 14.925,
    roundedMinutes: 15,
    alignmentStatus: 'preferred',
    requiresCorrection: false,
  });
  assert.deepEqual(oneTwenty.examples.workout, {
    arithmeticOnly: true,
    copyPrescriptions: false,
    requestedMinutes: 120,
    referenceExample: 'superset',
    referenceModuleMinutes: 15,
    moduleCount: 8,
    workoutTotalSeconds: 7164,
    unroundedMinutes: 119.4,
    roundedMinutes: 119,
    alignmentStatus: 'preferred',
    requiresCorrection: false,
  });

  for (const requestedDurationMinutes of [35, 50, 15 * 33]) {
    const duration = buildWeeklyPlanTrainingMetricsPromptProjection({
      requestedDurationMinutes,
    }).duration;

    assert.equal(duration.examples.workout, null);
    assert.equal(duration.ranges.requestedMinutes, requestedDurationMinutes);
    assert.equal(
      duration.budgets.preferredSeconds.minimum,
      duration.ranges.preferredMinutes.minimum * 60
    );
    assert.equal(
      duration.budgets.acceptableSeconds.maximum,
      duration.ranges.acceptableMinutes.maximum * 60
    );
  }
});

test('invalid requested durations preserve controlled validation errors', () => {
  [null, 0, -15, 30.5].forEach((requestedDurationMinutes) => {
    assert.throws(
      () =>
        buildWeeklyPlanTrainingMetricsPromptProjection({
          requestedDurationMinutes,
        }),
      (error) => {
        assert.equal(
          error instanceof WeeklyPlanTrainingMetricsPromptProjectionError,
          true
        );
        assert.match(error.message, /positive integer requested duration/);
        return true;
      }
    );
  });
});

test('target guidance separates coaching from deterministic reporting and derives the Face Pull example from Analytics V2', () => {
  const targets = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).targets;
  const reporting = targets.reportingVolume;

  assert.deepEqual(targets.coachingVolume, {
    authority: 'runtime_doctrine',
    useDirectAndIndirectContributions: true,
    purpose: 'exercise_selection_recoverability_and_program_appropriateness',
  });
  assert.deepEqual(reporting.methods, {
    volume: 'full_direct_sets_separate_indirect_v1',
    frequency: 'deduplicated_workout_exposure_v1',
    comparison: 'exact_match_no_tolerance_v1',
  });
  assert.equal(reporting.countedSetType, 'WORKING');
  assert.equal(reporting.fullWorkingSetCreditPerBodyPart, true);
  assert.equal(reporting.fullWorkingSetCreditPerMuscleFocus, true);
  assert.equal(reporting.divideCreditAcrossKeys, false);
  assert.equal(reporting.sameSetAcrossTaxonomiesRequired, true);
  assert.equal(reporting.frequencyUnit, 'distinct_workouts');
  assert.equal(reporting.deduplicateWithinWorkout, true);
  assert.deepEqual(
    reporting.groups.map((group) => group.targetGroup),
    [
      'volumeTargets.bodyParts',
      'volumeTargets.muscleFocuses',
      'frequencyTargets.bodyParts',
      'frequencyTargets.muscleFocuses',
    ]
  );
  assert.deepEqual(reporting.forbiddenAuthorities, [
    'targetMuscles',
    'secondaryMuscles',
    'muscleActivation',
    'normalizedShare',
  ]);
  assert.deepEqual(targets.strategicAreas, {
    onlySignificantAreas: true,
    arraysMayBeEmpty: true,
    enumerateZeroValueAreas: false,
    declaredTargetsEqualProducedPlanReporting: true,
    exactNormalizedKeyMatch: 'exact_normalized_key',
    comparisonTolerance: null,
    generatedValueSource: 'direct_only',
  });
  assert.deepEqual(targets.example, {
    exercise: 'Face Pull',
    workingSets: 2,
    bodyParts: { shoulders: 2, back: 2 },
    muscleFocus: { rear_delts: 2, upper_back: 2 },
    directFrequency: {
      shoulders: 1,
      back: 1,
      rear_delts: 1,
      upper_back: 1,
    },
  });
});

test('injecting a changed SINGLE descriptor changes that example without contaminating the SUPERSET reference module', () => {
  const fakeDescriptor = structuredClone(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
  fakeDescriptor.blocks.SINGLE.restIntervalMultiplier = 2;
  fakeDescriptor.blocks.SINGLE.fixedBlockSeconds = 120;

  const canonical = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const changed = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 30 },
    { durationDescriptor: fakeDescriptor }
  );

  assert.equal(changed.duration.blocks.SINGLE.restIntervalMultiplier, 2);
  assert.equal(changed.duration.blocks.SINGLE.fixedBlockSeconds, 120);
  assert.equal(changed.duration.examples.single.adjustedRestSeconds, 600);
  assert.equal(changed.duration.examples.single.blockTotalSeconds, 816);
  assert.notEqual(
    changed.duration.examples.single.roundedMinutes,
    canonical.duration.examples.single.roundedMinutes
  );
  assert.equal(
    changed.duration.examples.workout.workoutTotalSeconds,
    canonical.duration.examples.workout.workoutTotalSeconds
  );
});

test('changed SUPERSET multipliers and fixed seconds are derived, and a non-15-minute reference fails safe', () => {
  const changedMultiplier = structuredClone(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR
  );
  changedMultiplier.blocks.SUPERSET.restIntervalMultiplier = 2;
  const multiplierProjection =
    buildWeeklyPlanTrainingMetricsPromptProjection(
      { requestedDurationMinutes: 30 },
      { durationDescriptor: changedMultiplier }
    ).duration;

  assert.equal(
    multiplierProjection.examples.superset.adjustedRestSeconds,
    900
  );
  assert.equal(
    multiplierProjection.examples.superset.blockTotalSeconds,
    1278
  );
  assert.equal(multiplierProjection.examples.superset.roundedMinutes, 21);
  assert.equal(multiplierProjection.examples.workout, null);

  const changedFixedSeconds = structuredClone(
    WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR
  );
  changedFixedSeconds.blocks.SUPERSET.fixedBlockSeconds = 120;
  const fixedProjection = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 30 },
    { durationDescriptor: changedFixedSeconds }
  ).duration;

  assert.equal(fixedProjection.examples.superset.blockTotalSeconds, 925.5);
  assert.equal(fixedProjection.examples.superset.roundedMinutes, 15);
  assert.equal(fixedProjection.examples.workout.workoutTotalSeconds, 1851);
  assert.equal(fixedProjection.examples.workout.unroundedMinutes, 30.85);
  assert.equal(fixedProjection.examples.workout.roundedMinutes, 31);
  assert.equal(
    fixedProjection.examples.workout.alignmentStatus,
    'acceptable_over_target'
  );
  assert.equal(fixedProjection.examples.workout.requiresCorrection, false);
});

test('pedagogical numbers remove binary floating-point artifacts while remaining JSON numbers', () => {
  const fakeDescriptor = structuredClone(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
  fakeDescriptor.blocks.SUPERSET.restIntervalMultiplier =
    1.1500000000000001;
  fakeDescriptor.blocks.CARDIO.secondsPerMinute = 59.99999999999999;

  const projection = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 45 },
    { durationDescriptor: fakeDescriptor }
  );
  const { duration } = projection;
  const serialized = JSON.stringify(projection);

  assert.equal(duration.examples.superset.adjustedRestSeconds, 517.5);
  assert.equal(duration.examples.superset.blockTotalSeconds, 895.5);
  assert.equal(duration.examples.superset.unroundedMinutes, 14.925);
  assert.equal(duration.examples.workout.workoutTotalSeconds, 2686.5);
  assert.equal(duration.examples.workout.unroundedMinutes, 44.775);
  assert.equal(duration.blocks.CARDIO.secondsPerMinute, 60);
  assert.equal(duration.workoutTotal.secondsPerMinute, 60);
  assert.deepEqual(duration.budgets.preferredSeconds, {
    minimum: 2460,
    maximum: 2700,
  });
  assert.doesNotMatch(serialized, /\d{7,}\d/);
  assert.equal(
    typeof duration.examples.workout.unroundedMinutes,
    'number'
  );
});

test('dynamic workout alignment is projected from the injected policy function and correction-required examples fail safe', () => {
  const fakeAlignment = (input) => {
    const canonical = calculateDurationAlignment(input);
    if (
      input.requestedDurationMinutes === 30 &&
      input.calculatedDurationMinutes === 30
    ) {
      return {
        ...canonical,
        durationAlignmentStatus: 'acceptable_under_target',
        requiresCorrection: false,
      };
    }
    return canonical;
  };
  const changed = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 30 },
    { calculateDurationAlignment: fakeAlignment }
  ).duration;

  assert.equal(
    changed.examples.workout.alignmentStatus,
    'acceptable_under_target'
  );
  assert.equal(changed.examples.workout.requiresCorrection, false);

  const correctionRequired = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 30 },
    {
      calculateDurationAlignment(input) {
        const canonical = calculateDurationAlignment(input);
        return input.calculatedDurationMinutes === 30
          ? { ...canonical, requiresCorrection: true }
          : canonical;
      },
    }
  ).duration;
  assert.equal(correctionRequired.examples.workout, null);
  assert.deepEqual(correctionRequired.ranges.requestedMinutes, 30);
  assert.deepEqual(correctionRequired.budgets.preferredSeconds, {
    minimum: 1620,
    maximum: 1800,
  });
});

test('structurally invalid alignment and manual-versus-production disagreement raise controlled errors', () => {
  assert.throws(
    () =>
      buildWeeklyPlanTrainingMetricsPromptProjection(
        { requestedDurationMinutes: 30 },
        { calculateDurationAlignment: () => null }
      ),
    (error) => {
      assert.equal(
        error instanceof WeeklyPlanTrainingMetricsPromptProjectionError,
        true
      );
      assert.match(error.message, /alignment result is invalid/);
      return true;
    }
  );

  assert.throws(
    () =>
      buildWeeklyPlanTrainingMetricsPromptProjection(
        { requestedDurationMinutes: 30 },
        {
          computeWeeklyPlanWorkoutMetrics(workout) {
            const production = computeWeeklyPlanWorkoutMetrics(workout);
            return workout.blocks[0]?.blockType === 'SUPERSET'
              ? {
                  ...production,
                  estimatedDurationMinutes:
                    production.estimatedDurationMinutes + 1,
                }
              : production;
          },
        }
      ),
    (error) => {
      assert.equal(
        error instanceof WeeklyPlanTrainingMetricsPromptProjectionError,
        true
      );
      assert.match(error.message, /SUPERSET example disagrees with production/);
      return true;
    }
  );
});

test('production cross-check receives independent module copies and cannot mutate the reference fixture', () => {
  let repeatedFixtureChecked = false;
  const projection = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 45 },
    {
      computeWeeklyPlanWorkoutMetrics(workout) {
        const production = computeWeeklyPlanWorkoutMetrics(workout);
        if (workout.blocks.length > 1) {
          repeatedFixtureChecked = true;
          assert.notEqual(workout.blocks[0], workout.blocks[1]);
          assert.notEqual(
            workout.blocks[0].exercises,
            workout.blocks[1].exercises
          );
          assert.notEqual(
            workout.blocks[0].exercises[0].setTemplates,
            workout.blocks[1].exercises[0].setTemplates
          );
          workout.blocks[0].restSeconds = 1;
        }
        return production;
      },
    }
  );
  const canonicalAfterMutationProbe =
    buildWeeklyPlanTrainingMetricsPromptProjection({
      requestedDurationMinutes: 45,
    });

  assert.equal(repeatedFixtureChecked, true);
  assert.equal(
    projection.duration.examples.workout.workoutTotalSeconds,
    2686.5
  );
  assert.deepEqual(projection, canonicalAfterMutationProbe);
});

test('injecting a changed policy changes projected ranges and second budgets', () => {
  const fakePolicy = structuredClone(WEEKLY_PLAN_EVALUATION_POLICY);
  const acceptableUnder = fakePolicy.duration.alignment.bands.find(
    (band) => band.status === 'acceptable_under_target'
  );
  acceptableUnder.requiresCorrection = true;

  const changed = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
    evaluationPolicy: fakePolicy,
  });

  assert.deepEqual(changed.duration.ranges.acceptableMinutes, {
    minimum: 27,
    maximum: 31,
  });
  assert.deepEqual(changed.duration.budgets.acceptableSeconds, {
    minimum: 1620,
    maximum: 1860,
  });
});
