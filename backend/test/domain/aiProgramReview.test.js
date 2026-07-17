const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIProgramReviewError,
  MAX_PROGRAM_REVIEW_INPUT_CHARACTERS,
  PROGRAM_REVIEW_INPUT_SCHEMA_VERSION,
  buildProgramReviewDecisionSummary,
  buildProgramReviewInput,
  buildSelectedExerciseMetadata,
  collectSelectedExerciseIds,
  runAIProgramReview,
} = require('../../src/domain/programGeneration/aiProgramReview');
const {
  validateProgramReviewSemantics,
} = require('../../src/domain/programGeneration/programReviewValidation');
const {
  stableStringify,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');

const MOCK_DOCTRINE = Object.freeze({
  id: 'bodybuilding_runtime_classic',
  version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
  derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
  content: 'MOCK_CLASSIC_DOCTRINE_CONTENT_SENTINEL',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext(overrides = {}) {
  return {
    primaryGoal: 'HYPERTROPHY',
    experience: 'intermediate',
    availability: { sessionsPerWeek: 2, durationPerSession: 60 },
    musclePriorityProfile: {
      primaryFocus: 'upper_chest',
      secondaryFocuses: ['lats'],
      deprioritizedArea: 'calves',
      perAreaWeights: { lats: 0.7, upper_chest: 1 },
    },
    cardioProfile: { cardioRole: 'supportive', preferredModalities: ['bike'] },
    movementConstraints: {
      blockedMovementPatterns: ['heavy_hip_hinge'],
      blockedJointStressTags: ['spinal_loading'],
      cautionMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['overhead_shoulder_position'],
    },
    physicalNotes: 'PRIVATE_PROFILE_NOTE_SENTINEL',
    poolSnapshot: { allowedExerciseIds: ['ex_bench', 'ex_row', 'ex_unused'] },
    exercisePoolItems: [
      {
        exerciseId: 'ex_bench',
        name: 'Dumbbell Bench Press',
        trainingType: 'strength',
        movementPattern: 'horizontal_push',
        jointStressTags: ['shoulder_extension', ' Shoulder_Extension '],
        equipmentCategory: 'dumbbell',
        bodyParts: ['chest'],
        muscleFocus: ['upper_chest'],
        targetMuscles: ['pectoralis_major'],
        secondaryMuscles: ['triceps'],
        equipmentNeeded: ['dumbbells', 'bench'],
        fatigueScore: 5,
        softSignals: { private: 'PRIVATE_POOL_SIGNAL_SENTINEL' },
      },
      {
        exerciseId: 'ex_row',
        name: 'Chest Supported Row',
        trainingType: 'strength',
        movementPattern: 'horizontal_pull',
        jointStressTags: [],
        equipmentCategory: 'machine',
        bodyParts: ['back'],
        muscleFocus: ['lats'],
        targetMuscles: ['latissimus_dorsi'],
        secondaryMuscles: ['biceps'],
      },
      {
        exerciseId: 'ex_unused',
        trainingType: 'strength',
        movementPattern: 'vertical_push',
        jointStressTags: ['PRIVATE_UNUSED_TAG_SENTINEL'],
        equipmentCategory: 'machine',
        bodyParts: ['shoulders'],
        muscleFocus: ['front_delts'],
        targetMuscles: ['deltoids'],
        secondaryMuscles: [],
      },
    ],
    ...overrides,
  };
}

function createGeneratedPlanDocument(overrides = {}) {
  return {
    name: 'AI Review Draft',
    sessionsPerWeek: 2,
    strategySummary: 'Target upper chest and back with manageable recovery.',
    workouts: [
      {
        name: 'Upper B',
        orderIndex: 2,
        estimatedDurationMinutes: 58,
        notes: 'PRIVATE_WORKOUT_NOTE_SENTINEL',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            restSeconds: 120,
            exercises: [
              {
                orderIndex: 1,
                exerciseId: 'ex_row',
                exerciseName: 'Chest Supported Row',
                bodyParts: ['back'],
                muscleFocus: ['lats'],
                defaultTempo: '3010',
                defaultRestSeconds: 120,
                defaultTargetRir: 2,
                notes: null,
                setTemplates: [
                  {
                    targetReps: null,
                    minReps: 8,
                    maxReps: 12,
                    targetRir: 2,
                    tempo: '3010',
                    restSeconds: 120,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'Upper A',
        orderIndex: 1,
        estimatedDurationMinutes: 60,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SUPERSET',
            restSeconds: 90,
            exercises: [
              {
                orderIndex: 2,
                exerciseId: 'ex_bench',
                exerciseName: 'Dumbbell Bench Press',
                bodyParts: ['chest'],
                muscleFocus: ['upper_chest'],
                defaultTempo: '3010',
                defaultRestSeconds: 90,
                defaultTargetRir: 1,
                notes: 'PRIVATE_EXERCISE_NOTE_SENTINEL',
                setTemplates: [
                  {
                    targetReps: 10,
                    minReps: null,
                    maxReps: null,
                    targetRir: 1,
                    tempo: '3010',
                    restSeconds: 90,
                  },
                ],
              },
              {
                orderIndex: 1,
                exerciseId: 'ex_bench',
                exerciseName: 'Dumbbell Bench Press',
                bodyParts: ['chest'],
                muscleFocus: ['upper_chest'],
                defaultTempo: '3010',
                defaultRestSeconds: 90,
                defaultTargetRir: 1,
                notes: null,
                setTemplates: [
                  {
                    targetReps: 8,
                    minReps: null,
                    maxReps: null,
                    targetRir: 1,
                    tempo: '3010',
                    restSeconds: 90,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createCardioContext() {
  const baseContext = createContext();

  return createContext({
    cardioProfile: {
      cardioRole: 'supportive',
      preferredModalities: ['stationary_bike', 'treadmill_walk'],
    },
    poolSnapshot: {
      allowedExerciseIds: [...baseContext.poolSnapshot.allowedExerciseIds, 'ex_bike'],
    },
    exercisePoolItems: [
      ...baseContext.exercisePoolItems,
      {
        exerciseId: 'ex_bike',
        name: 'Stationary Bike',
        trainingType: 'cardio',
        movementPattern: 'cyclical',
        jointStressTags: [],
        equipmentCategory: 'machine',
        bodyParts: ['cardio'],
        muscleFocus: [],
        targetMuscles: [],
        secondaryMuscles: [],
        cardioModality: ' Stationary_Bike ',
        machineSettings: {
          resistance: 'PRIVATE_CARDIO_MACHINE_SETTING_SENTINEL',
        },
      },
    ],
  });
}

function createCardioGeneratedPlanDocument() {
  return {
    name: 'Cardio Review Draft',
    sessionsPerWeek: 1,
    strategySummary: 'Use supportive cardio alongside strength training.',
    workouts: [
      {
        name: 'Cardio Session',
        orderIndex: 1,
        estimatedDurationMinutes: 35,
        notes: 'PRIVATE_CARDIO_WORKOUT_NOTE_SENTINEL',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'CARDIO',
            restSeconds: null,
            exercises: [
              {
                orderIndex: 1,
                exerciseId: 'ex_bike',
                exerciseName: 'Stationary Bike',
                bodyParts: ['cardio'],
                muscleFocus: [],
                defaultTempo: null,
                defaultRestSeconds: null,
                defaultTargetRir: null,
                notes: 'PRIVATE_CARDIO_EXERCISE_NOTE_SENTINEL',
                setTemplates: [],
                cardioPrescription: {
                  durationMinutes: 32,
                  heartRateTargetMode: 'ZONE',
                  heartRateTargetValue: 3,
                  machineSettings: [
                    {
                      key: 'resistance',
                      value: 'PRIVATE_CARDIO_MACHINE_SETTING_SENTINEL',
                    },
                  ],
                  notes: 'PRIVATE_CARDIO_PRESCRIPTION_NOTE_SENTINEL',
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function createGeneratedAIOutput(overrides = {}) {
  return {
    splitType: 'upper_lower',
    strategySummary: 'Provider strategy summary.',
    volumeTargets: {
      perMuscle: [
        {
          area: 'upper_chest',
          targetSetsPerWeek: 10,
          priority: 'primary',
          rationale: 'PRIVATE_TARGET_RATIONALE_SENTINEL',
        },
      ],
    },
    frequencyTargets: {
      perMuscle: [{ area: 'upper_chest', targetSessionsPerWeek: 2 }],
    },
    progressionModel: { type: 'double_progression' },
    ...overrides,
  };
}

function createAnalytics(overrides = {}) {
  return {
    status: 'complete',
    plan: {
      workoutCount: 2,
      blockCount: 2,
      exerciseCount: 3,
      strengthExerciseCount: 3,
      cardioExerciseCount: 0,
      uniqueExerciseCount: 2,
      workingSetCount: 3,
      totalSetTemplateCount: 3,
      estimatedDurationMinutesTotal: 118,
      estimatedDurationMinutesAverage: 59,
      declaredEstimatedDurationMinutesTotal: 118,
      durationDifferenceMinutesTotal: 0,
      minWorkoutDurationMinutes: 58,
      maxWorkoutDurationMinutes: 60,
      singleBlockCount: 1,
      supersetBlockCount: 1,
      cardioBlockCount: 0,
      cardioDurationMinutes: 0,
      bodyPartDistribution: [{ key: 'chest', rawSets: 2, normalizedShare: 2 }],
    },
    workouts: [
      {
        workoutOrderIndex: 1,
        blockCount: 1,
        strengthExerciseCount: 2,
        cardioExerciseCount: 0,
        workingSetCount: 2,
        totalSetTemplateCount: 2,
        estimatedDurationMinutes: 60,
        declaredEstimatedDurationMinutes: 60,
        durationDifferenceMinutes: 0,
        supersetCount: 1,
        cardioDurationMinutes: 0,
        muscleProjections: [
          { taxonomy: 'muscle_focus', key: 'upper_chest', directWorkingSets: 2 },
        ],
      },
    ],
    muscleMetrics: [
      {
        taxonomy: 'muscle_focus',
        key: 'upper_chest',
        directWorkingSets: 2,
        indirectWorkingSets: 0,
        directWorkoutCount: 1,
        indirectWorkoutCount: 0,
      },
    ],
    metadataCoverage: {
      totalStrengthWorkingSets: 3,
      attributedStrengthWorkingSets: 3,
      coverageRatio: 1,
      unresolvedExerciseIds: ['PRIVATE_UNRESOLVED_ID_SENTINEL'],
    },
    targetComparisons: {
      volume: {
        summary: { targetCount: 1, belowTargetCount: 1, withinTargetCount: 0, aboveTargetCount: 0, unavailableCount: 0 },
        items: [{ targetIndex: 0, area: 'upper_chest', resolvedTaxonomy: 'muscle_focus', targetValue: 10, generatedDirectValue: 2, difference: -8, absoluteDifference: 8, relativeDifference: -0.8, status: 'below_target' }],
      },
      frequency: {
        summary: { targetCount: 1, belowTargetCount: 1, withinTargetCount: 0, aboveTargetCount: 0, unavailableCount: 0 },
        items: [{ targetIndex: 0, area: 'upper_chest', resolvedTaxonomy: 'muscle_focus', targetValue: 2, generatedDirectValue: 1, difference: -1, absoluteDifference: 1, relativeDifference: -0.5, status: 'below_target' }],
      },
    },
    ...overrides,
  };
}

function createReview(overrides = {}) {
  return {
    schemaVersion: 1,
    decision: 'PASS',
    requiresRepair: false,
    reviewSummary: 'The plan is consistent with the supplied structured data.',
    issues: [],
    ...overrides,
  };
}

function createReviewOptions(overrides = {}) {
  return {
    doctrine: MOCK_DOCTRINE,
    context: createContext(),
    generatedAIOutput: createGeneratedAIOutput(),
    generatedPlanDocument: createGeneratedPlanDocument(),
    analytics: createAnalytics(),
    ...overrides,
  };
}

function createCardioReviewOptions(overrides = {}) {
  return createReviewOptions({
    context: createCardioContext(),
    generatedPlanDocument: createCardioGeneratedPlanDocument(),
    generatedAIOutput: createGeneratedAIOutput({ splitType: 'full_body' }),
    ...overrides,
  });
}

function createHeavySixSessionReviewOptions() {
  const strengthExerciseIds = Array.from(
    { length: 59 },
    (_value, index) => `ex_heavy_strength_${String(index + 1).padStart(2, '0')}`
  );
  const cardioExerciseId = 'ex_heavy_cardio';
  const allSelectedExerciseIds = [...strengthExerciseIds, cardioExerciseId];
  const exercisePoolItems = [
    ...strengthExerciseIds.map((exerciseId, index) => ({
      exerciseId,
      name: `Heavy Fixture Strength Exercise ${index + 1}`,
      trainingType: 'strength',
      movementPattern: index % 2 === 0 ? 'horizontal_push' : 'horizontal_pull',
      jointStressTags: index % 3 === 0 ? ['shoulder_load'] : ['elbow_load'],
      equipmentCategory: index % 2 === 0 ? 'dumbbell' : 'cable',
      bodyParts: index % 2 === 0 ? ['chest'] : ['back'],
      muscleFocus: index % 2 === 0 ? ['upper_chest'] : ['lats'],
      targetMuscles: index % 2 === 0 ? ['pectoralis_major'] : ['latissimus_dorsi'],
      secondaryMuscles: index % 2 === 0 ? ['triceps'] : ['biceps'],
    })),
    {
      exerciseId: cardioExerciseId,
      name: 'Heavy Fixture Stationary Bike',
      trainingType: 'cardio',
      movementPattern: 'cyclical',
      jointStressTags: [],
      equipmentCategory: 'cardio_machine',
      bodyParts: ['cardio'],
      muscleFocus: [],
      targetMuscles: [],
      secondaryMuscles: [],
      cardioModality: 'stationary_bike',
    },
    {
      exerciseId: 'ex_heavy_unused',
      name: 'PRIVATE_HEAVY_UNUSED_EXERCISE_SENTINEL',
      trainingType: 'strength',
      movementPattern: 'vertical_push',
      jointStressTags: ['PRIVATE_HEAVY_UNUSED_TAG_SENTINEL'],
      equipmentCategory: 'machine',
      bodyParts: ['shoulders'],
      muscleFocus: ['front_delts'],
      targetMuscles: ['deltoids'],
      secondaryMuscles: [],
    },
  ];
  let strengthExerciseCursor = 0;

  function createStrengthExercise(exerciseId, orderIndex) {
    const item = exercisePoolItems.find((candidate) => candidate.exerciseId === exerciseId);
    return {
      orderIndex,
      exerciseId,
      exerciseName: item.name,
      bodyParts: item.bodyParts,
      muscleFocus: item.muscleFocus,
      defaultTempo: '3010',
      defaultRestSeconds: 90,
      defaultTargetRir: 2,
      notes: 'PRIVATE_HEAVY_EXERCISE_NOTE_SENTINEL',
      setTemplates: [
        { targetReps: 8, minReps: null, maxReps: null, targetRir: 2, tempo: '3010', restSeconds: 90 },
        { targetReps: 10, minReps: null, maxReps: null, targetRir: 2, tempo: '3010', restSeconds: 90 },
        { targetReps: 12, minReps: null, maxReps: null, targetRir: 2, tempo: '3010', restSeconds: 90 },
      ],
    };
  }

  function takeStrengthExercises(count) {
    return Array.from({ length: count }, (_value, index) => {
      const exercise = createStrengthExercise(
        strengthExerciseIds[strengthExerciseCursor],
        index + 1
      );
      strengthExerciseCursor += 1;
      return exercise;
    });
  }

  const workouts = Array.from({ length: 6 }, (_value, workoutIndex) => {
    const hasCardio = workoutIndex === 5;
    const firstSuperset = takeStrengthExercises(2);
    const secondSuperset = takeStrengthExercises(2);
    const thirdSuperset = takeStrengthExercises(2);
    const fourthSuperset = takeStrengthExercises(2);
    const singleExercises = takeStrengthExercises(hasCardio ? 1 : 2);
    const blocks = [
      { orderIndex: 1, blockType: 'SUPERSET', restSeconds: 90, exercises: firstSuperset },
      { orderIndex: 2, blockType: 'SUPERSET', restSeconds: 90, exercises: secondSuperset },
      { orderIndex: 3, blockType: 'SUPERSET', restSeconds: 90, exercises: thirdSuperset },
      { orderIndex: 4, blockType: 'SUPERSET', restSeconds: 90, exercises: fourthSuperset },
      ...singleExercises.map((exercise, index) => ({
        orderIndex: index + 5,
        blockType: 'SINGLE',
        restSeconds: 90,
        exercises: [exercise],
      })),
    ];

    if (hasCardio) {
      blocks.push({
        orderIndex: 6,
        blockType: 'CARDIO',
        restSeconds: null,
        exercises: [
          {
            orderIndex: 1,
            exerciseId: cardioExerciseId,
            exerciseName: 'Heavy Fixture Stationary Bike',
            bodyParts: ['cardio'],
            muscleFocus: [],
            defaultTempo: null,
            defaultRestSeconds: null,
            defaultTargetRir: null,
            notes: 'PRIVATE_HEAVY_CARDIO_NOTE_SENTINEL',
            setTemplates: [],
            cardioPrescription: {
              durationMinutes: 20,
              heartRateTargetMode: 'zone',
              heartRateTargetValue: 2,
              machineSettings: [{ key: 'resistance', value: 'PRIVATE_HEAVY_MACHINE_SETTING' }],
              notes: 'PRIVATE_HEAVY_CARDIO_PRESCRIPTION_NOTE_SENTINEL',
            },
          },
        ],
      });
    }

    return {
      name: `Heavy Fixture Session ${workoutIndex + 1}`,
      orderIndex: workoutIndex + 1,
      estimatedDurationMinutes: 75,
      notes: 'PRIVATE_HEAVY_WORKOUT_NOTE_SENTINEL',
      blocks,
    };
  });

  const projectionEntries = Array.from({ length: 8 }, (_value, index) => ({
    taxonomy: index % 2 === 0 ? 'muscle_focus' : 'target_muscles',
    key: `heavy_metric_${String(index + 1).padStart(2, '0')}`,
    directWorkingSets: 6 + (index % 4),
    indirectWorkingSets: index % 3,
    directWorkoutCount: 2 + (index % 3),
    indirectWorkoutCount: index % 2,
  }));
  const targetItems = Array.from({ length: 6 }, (_value, index) => ({
    targetIndex: index,
    area: `heavy_target_${String(index + 1).padStart(2, '0')}`,
    resolvedTaxonomy: 'muscle_focus',
    targetValue: 10,
    generatedDirectValue: 8 + (index % 3),
    difference: -2 + (index % 3),
    absoluteDifference: Math.abs(-2 + (index % 3)),
    relativeDifference: (-2 + (index % 3)) / 10,
    status: index % 3 === 0 ? 'below_target' : 'within_target',
  }));

  return {
    context: createContext({
      availability: { sessionsPerWeek: 6, durationPerSession: 75 },
      cardioProfile: { cardioRole: 'supportive', preferredModalities: ['stationary_bike'] },
      poolSnapshot: { allowedExerciseIds: [...allSelectedExerciseIds, 'ex_heavy_unused'] },
      exercisePoolItems,
    }),
    generatedAIOutput: createGeneratedAIOutput({
      splitType: 'push_pull_legs',
      volumeTargets: {
        perMuscle: targetItems.map((item, index) => ({
          area: item.area,
          targetSetsPerWeek: item.targetValue,
          priority: index === 0 ? 'primary' : 'secondary',
          rationale: 'PRIVATE_HEAVY_TARGET_RATIONALE_SENTINEL',
        })),
      },
      frequencyTargets: {
        perMuscle: targetItems.map((item) => ({
          area: item.area,
          targetSessionsPerWeek: 2,
        })),
      },
    }),
    generatedPlanDocument: {
      name: 'Heavy Six Session Review Draft',
      sessionsPerWeek: 6,
      strategySummary: 'Six-session hypertrophy fixture for review-input capacity coverage.',
      workouts,
    },
    analytics: createAnalytics({
      plan: {
        workoutCount: 6,
        blockCount: workouts.reduce((count, workout) => count + workout.blocks.length, 0),
        exerciseCount: 60,
        strengthExerciseCount: 59,
        cardioExerciseCount: 1,
        uniqueExerciseCount: 60,
        workingSetCount: 177,
        totalSetTemplateCount: 177,
        estimatedDurationMinutesTotal: 450,
        estimatedDurationMinutesAverage: 75,
        declaredEstimatedDurationMinutesTotal: 450,
        durationDifferenceMinutesTotal: 0,
        minWorkoutDurationMinutes: 75,
        maxWorkoutDurationMinutes: 75,
        singleBlockCount: 11,
        supersetBlockCount: 24,
        cardioBlockCount: 1,
        cardioDurationMinutes: 20,
        bodyPartDistribution: projectionEntries.map((entry, index) => ({
          key: entry.key,
          rawSets: 6 + index,
          normalizedShare: 0.04,
          percentageOfWorkout: 4,
        })),
      },
      workouts: workouts.map((workout, index) => ({
        workoutOrderIndex: workout.orderIndex,
        blockCount: workout.blocks.length,
        strengthExerciseCount: index === 5 ? 9 : 10,
        cardioExerciseCount: index === 5 ? 1 : 0,
        workingSetCount: index === 5 ? 27 : 30,
        totalSetTemplateCount: index === 5 ? 27 : 30,
        estimatedDurationMinutes: 75,
        declaredEstimatedDurationMinutes: 75,
        durationDifferenceMinutes: 0,
        supersetCount: 4,
        cardioDurationMinutes: index === 5 ? 20 : 0,
        muscleProjections: projectionEntries.slice(index * 4, index * 4 + 4),
      })),
      muscleMetrics: projectionEntries,
      metadataCoverage: {
        totalStrengthWorkingSets: 177,
        attributedStrengthWorkingSets: 177,
        coverageRatio: 1,
        unresolvedExerciseIds: [],
      },
      targetComparisons: {
        volume: {
          summary: { targetCount: 6, belowTargetCount: 2, withinTargetCount: 4, aboveTargetCount: 0, unavailableCount: 0 },
          items: targetItems,
        },
        frequency: {
          summary: { targetCount: 6, belowTargetCount: 1, withinTargetCount: 5, aboveTargetCount: 0, unavailableCount: 0 },
          items: targetItems.map((item) => ({ ...item, targetValue: 2, generatedDirectValue: 2, difference: 0, absoluteDifference: 0, relativeDifference: 0, status: 'within_target' })),
        },
      },
    }),
  };
}

test('buildProgramReviewInput is deterministic, compact, and only projects selected metadata', () => {
  const options = createReviewOptions();
  const before = clone(options);
  const first = buildProgramReviewInput(options);
  const second = buildProgramReviewInput({
    ...options,
    generatedPlanDocument: {
      ...options.generatedPlanDocument,
      workouts: options.generatedPlanDocument.workouts.slice().reverse(),
    },
  });

  assert.equal(first.schemaVersion, PROGRAM_REVIEW_INPUT_SCHEMA_VERSION);
  assert.deepEqual(collectSelectedExerciseIds(options.generatedPlanDocument), ['ex_bench', 'ex_row']);
  assert.deepEqual(
    first.plan.selectedExerciseMetadata.items.map((item) => item.exerciseId),
    ['ex_bench', 'ex_row']
  );
  assert.equal(first.plan.selectedExerciseMetadata.coverage.selectedExerciseCount, 2);
  assert.deepEqual(first.plan.selectedExerciseMetadata.items[0].jointStressTags, [
    'shoulder_extension',
  ]);
  assert.deepEqual(first.plan.selectedExerciseMetadata.items[1].jointStressTags, []);
  assert.equal(
    first.plan.selectedExerciseMetadata.items[1].partialFields.includes('jointStressTags'),
    false
  );
  assert.equal(first.plan.workouts[0].orderIndex, 1);
  assert.equal(first.plan.workouts[0].blocks[0].exercises[0].orderIndex, 1);
  assert.equal(first.plan.workouts[0].blocks[0].exercises[0].hasNote, false);
  assert.equal(first.plan.workouts[0].blocks[0].exercises[1].hasNote, true);
  assert.deepEqual(first.plan.workouts[0].blocks[0].exercises[0].repTargets, ['8']);
  assert.equal(first.intent.volumeTargets[0].rationale, undefined);
  assert.equal(first.analytics.metadataCoverage.unresolvedExerciseCount, 1);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /PRIVATE_PROFILE_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_WORKOUT_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_EXERCISE_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_POOL_SIGNAL_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_UNUSED_TAG_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_TARGET_RATIONALE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_UNRESOLVED_ID_SENTINEL/);
  assert.deepEqual(options, before);
  assert.deepEqual(first, second);
});

test('buildProgramReviewInput projects compact cardio data from the prepared document and selected metadata', () => {
  const options = createCardioReviewOptions();
  const before = clone(options);
  const reviewInput = buildProgramReviewInput(options);
  const cardioExercise = reviewInput.plan.workouts[0].blocks[0].exercises[0];
  const cardioMetadata = reviewInput.plan.selectedExerciseMetadata.items[0];
  const strengthReviewInput = buildProgramReviewInput(createReviewOptions());

  assert.deepEqual(cardioExercise.cardioPrescription, {
    durationMinutes: 32,
    heartRateTargetMode: 'zone',
    heartRateTargetValue: 3,
  });
  assert.equal(cardioMetadata.exerciseId, 'ex_bike');
  assert.equal(cardioMetadata.cardioModality, 'stationary_bike');
  assert.equal(cardioMetadata.partialFields.includes('cardioModality'), false);
  assert.deepEqual(reviewInput.profile.cardioProfile.preferredModalities, [
    'stationary_bike',
    'treadmill_walk',
  ]);
  assert.equal(
    strengthReviewInput.plan.workouts[0].blocks[0].exercises[0].cardioPrescription,
    null
  );
  assert.equal(
    strengthReviewInput.plan.selectedExerciseMetadata.items[0].cardioModality,
    null
  );

  const missingModalityContext = createCardioContext();
  const partialMetadata = buildSelectedExerciseMetadata(createCardioGeneratedPlanDocument(), {
    ...missingModalityContext,
    exercisePoolItems: missingModalityContext.exercisePoolItems.map((item) =>
      item.exerciseId === 'ex_bike' ? { ...item, cardioModality: null } : item
    ),
  });
  assert.equal(
    partialMetadata.items[0].partialFields.includes('cardioModality'),
    true
  );

  const cardioIssueReview = createReview({
    issues: [
      {
        issueIndex: 1,
        category: 'CARDIO_INTEGRATION',
        severity: 'LOW',
        path: '/plan/workouts/0/blocks/0/exercises/0/cardioPrescription',
        message: 'The cardio prescription is available for structured review.',
        repairability: 'NOT_APPLICABLE',
        suggestedAction: null,
      },
    ],
  });
  assert.equal(validateProgramReviewSemantics(cardioIssueReview, reviewInput).ok, true);

  const serialized = JSON.stringify(reviewInput);
  assert.doesNotMatch(serialized, /PRIVATE_CARDIO_(?:WORKOUT|EXERCISE|PRESCRIPTION)_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_CARDIO_MACHINE_SETTING_SENTINEL/);
  assert.doesNotMatch(serialized, /machineSettings/);
  assert.doesNotMatch(serialized, /ex_unused|PRIVATE_UNUSED_TAG_SENTINEL/);
  assert.deepEqual(options, before);
});

test('buildProgramReviewInput uses lexical ordering independent of input ordering', () => {
  const options = createReviewOptions({
    generatedAIOutput: createGeneratedAIOutput({
      volumeTargets: {
        perMuscle: [
          { area: 'zeta', targetSetsPerWeek: 8, priority: 'secondary' },
          { area: 'Alpha', targetSetsPerWeek: 10, priority: 'primary' },
          { area: 'beta', targetSetsPerWeek: 9, priority: 'secondary' },
        ],
      },
    }),
    analytics: createAnalytics({
      muscleMetrics: [
        { taxonomy: 'zeta', key: 'beta' },
        { taxonomy: 'alpha', key: 'zeta' },
        { taxonomy: 'alpha', key: 'Alpha' },
      ],
    }),
  });
  const reordered = clone(options);
  reordered.generatedAIOutput.volumeTargets.perMuscle.reverse();
  reordered.analytics.muscleMetrics.reverse();

  const first = buildProgramReviewInput(options);
  const second = buildProgramReviewInput(reordered);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.intent.volumeTargets.map((target) => target.area),
    ['Alpha', 'beta', 'zeta']
  );
  assert.deepEqual(
    first.analytics.muscleMetrics.map((metric) => [metric.taxonomy, metric.key]),
    [
      ['alpha', 'Alpha'],
      ['alpha', 'zeta'],
      ['zeta', 'beta'],
    ]
  );
});

test('selected metadata marks partial fields and fails closed for missing selected IDs', () => {
  const partialContext = createContext({
    exercisePoolItems: [
      {
        exerciseId: 'ex_bench',
        trainingType: null,
        movementPattern: null,
        jointStressTags: [],
        equipmentCategory: null,
        bodyParts: [],
        muscleFocus: [],
        targetMuscles: [],
        secondaryMuscles: [],
      },
      createContext().exercisePoolItems[1],
    ],
  });
  const metadata = buildSelectedExerciseMetadata(createGeneratedPlanDocument(), partialContext);

  assert.deepEqual(metadata.items[0].partialFields, [
    'trainingType',
    'movementPattern',
    'equipmentCategory',
    'bodyParts',
    'muscleFocus',
    'targetMuscles',
    'secondaryMuscles',
  ]);
  assert.deepEqual(metadata.items[0].jointStressTags, []);

  const nullJointStressTagsContext = createContext({
    exercisePoolItems: [
      { ...createContext().exercisePoolItems[0], jointStressTags: null },
      createContext().exercisePoolItems[1],
    ],
  });
  assert.equal(
    buildSelectedExerciseMetadata(createGeneratedPlanDocument(), nullJointStressTagsContext)
      .items[0].partialFields.includes('jointStressTags'),
    true
  );

  assert.throws(
    () =>
      buildProgramReviewInput(
        createReviewOptions({
          context: createContext({ exercisePoolItems: [createContext().exercisePoolItems[0]] }),
        })
      ),
    (error) => {
      assert.equal(error instanceof AIProgramReviewError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE');
      return true;
    }
  );

  const documentWithMissingExerciseId = createGeneratedPlanDocument();
  documentWithMissingExerciseId.workouts[0].blocks[0].exercises[0].exerciseId = '   ';

  assert.throws(
    () => buildProgramReviewInput(createReviewOptions({ generatedPlanDocument: documentWithMissingExerciseId })),
    (error) => {
      assert.equal(error instanceof AIProgramReviewError, true);
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INPUT_INCOMPLETE');
      return true;
    }
  );
});

test('buildProgramReviewInput rejects oversized input without truncation', () => {
  const document = createGeneratedPlanDocument();
  document.workouts[0].blocks[0].exercises[0].exerciseName = 'x'.repeat(
    MAX_PROGRAM_REVIEW_INPUT_CHARACTERS + 1
  );

  assert.throws(
    () => buildProgramReviewInput(createReviewOptions({ generatedPlanDocument: document })),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INPUT_TOO_LARGE');
      return true;
    }
  );
});

test('buildProgramReviewInput accepts a heavy valid six-session fixture without truncation', () => {
  const options = createHeavySixSessionReviewOptions();
  const before = clone(options);
  const reviewInput = buildProgramReviewInput(options);
  const serialized = stableStringify(reviewInput);

  assert.equal(reviewInput.plan.workouts.length, 6);
  assert.equal(reviewInput.plan.selectedExerciseMetadata.coverage.selectedExerciseCount, 60);
  assert.equal(serialized.length > 40000, true);
  assert.equal(serialized.length <= MAX_PROGRAM_REVIEW_INPUT_CHARACTERS, true);
  assert.match(serialized, /ex_heavy_strength_59/);
  assert.match(serialized, /ex_heavy_cardio/);
  assert.doesNotMatch(serialized, /ex_heavy_unused|PRIVATE_HEAVY_UNUSED_EXERCISE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_HEAVY_(?:WORKOUT|EXERCISE|CARDIO|MACHINE|TARGET)_/);
  assert.equal(serialized.includes('machineSettings'), false);
  assert.deepEqual(options, before);
});

test('runAIProgramReview validates provider output and returns only compact domain metadata', async () => {
  let providerInput = null;
  const result = await runAIProgramReview(createReviewOptions(), {
    reviewWeeklyPlanAi: async (input) => {
      providerInput = input;
      return {
        programReview: createReview({
          issues: [
            {
              issueIndex: 1,
              category: 'NOTES_POLICY',
              severity: 'LOW',
              path: '/plan/notesSummary',
              message: 'One note can remain more concise.',
              repairability: 'REPAIRABLE',
              suggestedAction: 'Keep the note focused on execution.',
            },
          ],
        }),
        reviewer: {
          type: 'openai',
          model: 'review-model',
          responseId: 'resp_review_123',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, reasoningTokens: 10 },
          rawResponse: 'RAW_PROVIDER_RESPONSE_SENTINEL',
        },
      };
    },
  });

  assert.equal(providerInput.promptDescriptor.promptVersion, 'ai-program-review-prompt-v1.0.0');
  assert.equal(providerInput.schema.additionalProperties, false);
  assert.equal(result.decision, 'PASS');
  assert.equal(result.requiresRepair, false);
  assert.equal(result.issueCount, 1);
  assert.deepEqual(result.severityCounts, { INFO: 0, LOW: 1, MEDIUM: 0, HIGH: 0 });
  assert.deepEqual(result.categoryCounts, { NOTES_POLICY: 1 });
  assert.deepEqual(result.repairIssues, []);
  assert.deepEqual(result.provider, {
    type: 'openai',
    model: 'review-model',
    responseId: 'resp_review_123',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, reasoningTokens: 10 },
  });
  assert.doesNotMatch(JSON.stringify(result.provider), /RAW_PROVIDER_RESPONSE_SENTINEL/);
});

test('runAIProgramReview rejects invalid schema and semantic provider results', async (t) => {
  const cases = [
    {
      name: 'schema',
      review: { decision: 'PASS' },
      code: 'AI_WEEKLY_PLAN_REVIEW_SCHEMA_VALIDATION_FAILED',
    },
    {
      name: 'semantic',
      review: createReview({ decision: 'REPAIR_REQUIRED', requiresRepair: true }),
      code: 'AI_WEEKLY_PLAN_REVIEW_SEMANTIC_VALIDATION_FAILED',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await assert.rejects(
        () =>
          runAIProgramReview(createReviewOptions(), {
            reviewWeeklyPlanAi: async () => ({ programReview: entry.review, reviewer: {} }),
          }),
        (error) => {
          assert.equal(error.code, entry.code);
          return true;
        }
      );
    });
  }
});

test('runAIProgramReview requires reviewer metadata for an enabled review', async () => {
  await assert.rejects(
    () =>
      runAIProgramReview(createReviewOptions(), {
        reviewWeeklyPlanAi: async () => ({ programReview: createReview() }),
      }),
    (error) => {
      assert.equal(error.code, 'AI_WEEKLY_PLAN_REVIEW_INVALID_RESPONSE');
      return true;
    }
  );
});

test('buildProgramReviewDecisionSummary is deterministic and retains only counts', () => {
  assert.deepEqual(
    buildProgramReviewDecisionSummary(
      createReview({
        issues: [
          {
            issueIndex: 1,
            category: 'EXERCISE_REDUNDANCY',
            severity: 'HIGH',
            path: '/plan/workouts/0',
            message: 'Repeat.',
            repairability: 'REPAIRABLE',
            suggestedAction: 'Adjust.',
          },
        ],
      })
    ),
    {
      decision: 'PASS',
      requiresRepair: false,
      issueCount: 1,
      severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
      categoryCounts: { EXERCISE_REDUNDANCY: 1 },
    }
  );
});
