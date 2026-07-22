const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
  ProgramGenerationPromptInputError,
  buildProgramGenerationPromptInput,
  buildProgramGenerationPromptInputDiagnostics,
} = require('../../src/domain/programGeneration/programGenerationPromptInputBuilder');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');
const {
  buildProgramGenerationPrompt,
  serializeEligibleExercisePool,
  serializeEligibleExercisePoolPretty,
  stableStringify,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');

const MOCK_DOCTRINE = {
  id: 'bodybuilding_runtime_classic',
  version: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
  derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
  content: 'Mock classic doctrine.',
};

function createContext(overrides = {}) {
  return {
    schemaVersion: 4,
    generationMode: 'weekly_plan_draft',
    coachInputs: {
      doctrineId: 'private_doctrine_id',
      doctrineVersion: 'private_doctrine_version',
      promptVersion: 'private_prompt_version',
    },
    userId: 'private_user_id',
    createdAt: '2026-07-21T12:00:00.000Z',
    profileSchemaVersion: 2,
    primaryGoal: 'HYPERTROPHY',
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 2,
      durationPerSession: 30,
    },
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
    musclePriorityProfile: {
      primaryFocus: 'upper_chest',
      secondaryFocuses: ['rear_delts', 'back'],
      deprioritizedArea: 'quadriceps',
      weights: { primary: 1, secondary: 0.65, deprioritized: 0.35 },
      perAreaWeights: { upper_chest: 1, rear_delts: 0.65, back: 0.65 },
      parentAreas: {
        primaryFocus: 'chest',
        secondaryFocuses: [
          { area: 'rear_delts', parentArea: 'shoulders' },
          { area: 'back', parentArea: 'upper_body' },
        ],
      },
    },
    equipmentContext: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'cable_machine'],
      equipmentBias: 'machines',
      hardConstraints: [{ type: 'available_equipment', values: ['dumbbells'] }],
      softBiases: [{ type: 'equipment_bias', value: 'machines' }],
    },
    movementConstraints: {
      painDescription: 'private pain detail',
      cautionMovementPatterns: ['horizontal_push'],
      cautionJointStressTags: ['shoulder_load'],
      blockedExerciseIds: ['ex_blocked'],
      blockedMovementPatterns: ['vertical_push'],
      blockedJointStressTags: ['spinal_loading'],
    },
    cardioProfile: {
      cardioRole: 'warm_up_and_cardio',
      preferredModalities: ['stationary_bike'],
    },
    physicalNotes: 'Keep setup changes simple.',
    poolSummary: { availableExercises: 4 },
    poolSnapshot: {
      allowedExerciseIds: ['ex_press', 'ex_row', 'ex_squat', 'ex_bike'],
      hardConstraints: { blockedExerciseIds: ['ex_blocked'] },
    },
    exercisePoolItems: [
      {
        exerciseId: 'ex_press',
        name: 'Machine Chest Press',
        trainingType: 'strength',
        equipmentCategory: 'selectorized_machine',
        equipmentNeeded: ['chest_press_machine'],
        difficulty: 'intermediate',
        fatigueScore: 3,
        isSupersetFriendly: true,
        mechanicType: 'compound',
        movementPattern: 'horizontal_push',
        jointStressTags: ['shoulder_load'],
        bodyParts: ['chest'],
        muscleFocus: ['upper_chest'],
        targetMuscles: [
          ' PECTORALIS_MAJOR ',
          'pectoralis_major',
          'shared_muscle',
        ],
        secondaryMuscles: ['triceps_long_head', 'SHARED_MUSCLE'],
        muscleActivation: {
          pectoralis_major: 1,
          triceps_long_head: 0.5,
          shared_muscle: 0.75,
          unclassified_muscle: 0.25,
          anterior_deltoid: '0.75',
          '': 0.25,
        },
        unilateralType: 'bilateral',
        cardioModality: null,
        cardioImpactLevel: null,
        softSignals: {
          musclePriority: { weightHint: 1, primaryFocusMatch: true },
          equipmentBias: { value: 'machines', preferred: true },
          movementContext: {
            matchedCautionPatterns: ['horizontal_push'],
            matchedCautionJointStressTags: ['shoulder_load', 'horizontal_push'],
          },
          painContext: { painDescription: 'private repeated pain detail' },
        },
      },
      {
        exerciseId: 'ex_row',
        name: 'Cable Row',
        trainingType: 'strength',
        equipmentCategory: 'cable',
        difficulty: 'beginner',
        fatigueScore: 2,
        isSupersetFriendly: true,
        mechanicType: 'compound',
        movementPattern: 'horizontal_pull',
        bodyParts: ['back'],
        muscleFocus: ['lats'],
        targetMuscles: ['latissimus_dorsi', 'rhomboids'],
        secondaryMuscles: ['biceps_brachii', 'brachialis'],
        muscleActivation: {
          latissimus_dorsi: 1,
          rhomboids: Number.NaN,
          biceps_brachii: 0.5,
          brachialis: Number.POSITIVE_INFINITY,
        },
        unilateralType: 'bilateral',
        softSignals: {},
      },
      {
        exerciseId: 'ex_squat',
        name: 'Hack Squat',
        trainingType: 'strength',
        equipmentCategory: 'plate_loaded_machine',
        difficulty: 'intermediate',
        fatigueScore: 4,
        isSupersetFriendly: false,
        mechanicType: 'compound',
        movementPattern: 'squat',
        bodyParts: ['quadriceps'],
        muscleFocus: [],
        targetMuscles: ['quadriceps'],
        secondaryMuscles: ['gluteus_maximus'],
        muscleActivation: null,
        unilateralType: 'bilateral',
        softSignals: {},
      },
      {
        exerciseId: 'ex_bike',
        name: 'Stationary Bike',
        trainingType: 'cardio',
        equipmentCategory: 'cardio_machine',
        equipmentNeeded: ['stationary_bike'],
        difficulty: 'beginner',
        mechanicType: 'cyclical',
        movementPattern: 'cycling',
        bodyParts: ['quadriceps'],
        muscleFocus: ['quadriceps'],
        targetMuscles: ['quadriceps'],
        secondaryMuscles: [],
        muscleActivation: { quadriceps: 1 },
        isSupersetFriendly: false,
        cardioModality: 'stationary_bike',
        cardioImpactLevel: 'low',
        softSignals: {
          fatigue: {
            cardioFatigueScore: 2,
            lowerBodyFatigueBias: 'moderate',
          },
          cardioPreference: { preferredModalityMatch: true },
        },
      },
    ],
    ...overrides,
  };
}

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys));
    return keys;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      keys.push(key);
      collectKeys(child, keys);
    });
  }

  return keys;
}

test('buildProgramGenerationPromptInput projects a compact V2 athlete brief, Training Metrics Guidance, and canonical 30-minute ranges', () => {
  const input = buildProgramGenerationPromptInput(createContext());

  assert.equal(
    PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
    2
  );
  assert.equal(input.schemaVersion, 2);
  assert.equal(input.athleteBrief.primaryGoal, 'HYPERTROPHY');
  assert.equal(input.athleteBrief.experience, 'intermediate');
  assert.deepEqual(input.athleteBrief.trainingSchedule, {
    sessionsPerWeek: 2,
    approximateDurationMinutes: 30,
    acceptableDurationMinutes: { minimum: 26, maximum: 31 },
    preferredDurationMinutes: { minimum: 27, maximum: 30 },
  });
  assert.deepEqual(input.athleteBrief.musclePriorities, {
    primary: 'upper_chest',
    secondary: ['rear_delts', 'back'],
    deprioritized: 'quadriceps',
    microFocuses: [
      { area: 'upper_chest', parentArea: 'chest', priority: 'primary' },
      { area: 'rear_delts', parentArea: 'shoulders', priority: 'secondary' },
    ],
  });
  assert.deepEqual(input.athleteBrief.exercisePreference, {
    preference: 'machines',
    isSoftPreference: true,
  });
  assert.deepEqual(input.athleteBrief.cardio, {
    role: 'warm_up_and_cardio',
    preferredModalities: ['stationary_bike'],
  });
  assert.deepEqual(input.athleteBrief.movementConsiderations, {
    cautionMovementPatterns: ['horizontal_push'],
    cautionJointStressTags: ['shoulder_load'],
  });
  assert.equal(input.athleteBrief.physicalNotes, 'Keep setup changes simple.');
  assert.equal(input.trainingMetricsGuidance.schemaVersion, 1);
  assert.equal(
    input.trainingMetricsGuidance.duration.methodId,
    'historical_weekly_plan_metrics_v1'
  );
  assert.deepEqual(input.trainingMetricsGuidance.duration.ranges, {
    requestedMinutes: 30,
    acceptableMinutes: { minimum: 26, maximum: 31 },
    preferredMinutes: { minimum: 27, maximum: 30 },
  });
  assert.equal(
    input.trainingMetricsGuidance.duration.declaredDuration
      .contributesToBackendDuration,
    false
  );
});

test('muscle contributions use canonical activation weights, primary precedence, null fallback, and exact diagnostics', () => {
  const context = createContext();
  const input = buildProgramGenerationPromptInput(context);
  const diagnostics = buildProgramGenerationPromptInputDiagnostics(context);

  assert.deepEqual(input.eligibleExercisePool[0].muscleContributions, [
    { muscle: 'pectoralis_major', role: 'primary', activationWeight: 1 },
    { muscle: 'shared_muscle', role: 'primary', activationWeight: 0.75 },
    { muscle: 'triceps_long_head', role: 'secondary', activationWeight: 0.5 },
  ]);
  assert.deepEqual(input.eligibleExercisePool[1].muscleContributions, [
    { muscle: 'latissimus_dorsi', role: 'primary', activationWeight: 1 },
    { muscle: 'rhomboids', role: 'primary', activationWeight: null },
    { muscle: 'biceps_brachii', role: 'secondary', activationWeight: 0.5 },
    { muscle: 'brachialis', role: 'secondary', activationWeight: null },
  ]);
  assert.deepEqual(input.eligibleExercisePool[2].muscleContributions, [
    { muscle: 'quadriceps', role: 'primary', activationWeight: null },
    { muscle: 'gluteus_maximus', role: 'secondary', activationWeight: null },
  ]);
  assert.equal('muscleContributions' in input.eligibleExercisePool[3], false);
  input.eligibleExercisePool
    .flatMap((item) => item.muscleContributions || [])
    .forEach((contribution) => {
      assert.deepEqual(Object.keys(contribution), [
        'muscle',
        'role',
        'activationWeight',
      ]);
    });
  assert.deepEqual(diagnostics, {
    activationMusclesNotClassifiedCount: 1,
    primaryMusclesMissingActivationCount: 2,
    secondaryMusclesMissingActivationCount: 2,
    invalidActivationEntryCount: 4,
  });
  assert.equal('muscleContributionDiagnostics' in input, false);
});

test('strength and cardio projections use closed allowlists and preserve every exerciseId in order', () => {
  const context = createContext();
  const input = buildProgramGenerationPromptInput(context);
  const sourceIds = context.exercisePoolItems.map((item) => item.exerciseId);
  const projectedIds = input.eligibleExercisePool.map((item) => item.exerciseId);

  assert.deepEqual(projectedIds, sourceIds);
  input.eligibleExercisePool
    .filter((item) => item.trainingType === 'strength')
    .forEach((item) => {
      assert.deepEqual(Object.keys(item).slice(0, 3), [
        'name',
        'exerciseId',
        'trainingType',
      ]);
    });
  assert.deepEqual(Object.keys(input.eligibleExercisePool[0]), [
    'name',
    'exerciseId',
    'trainingType',
    'equipmentCategory',
    'difficulty',
    'fatigueScore',
    'isSupersetFriendly',
    'mechanicType',
    'movementPattern',
    'bodyParts',
    'muscleFocus',
    'muscleContributions',
    'unilateralType',
    'cautionMatches',
  ]);
  assert.deepEqual(input.eligibleExercisePool[0].cautionMatches, [
    'horizontal_push',
    'shoulder_load',
  ]);
  assert.equal('cautionMatches' in input.eligibleExercisePool[1], false);
  assert.deepEqual(input.eligibleExercisePool[3], {
    name: 'Stationary Bike',
    exerciseId: 'ex_bike',
    trainingType: 'cardio',
    cardioModality: 'stationary_bike',
    cardioFatigueScore: 2,
    lowerBodyFatigueBias: 'moderate',
    cardioImpactLevel: 'low',
  });
  assert.deepEqual(Object.keys(input.eligibleExercisePool[3]), [
    'name',
    'exerciseId',
    'trainingType',
    'cardioModality',
    'cardioFatigueScore',
    'lowerBodyFatigueBias',
    'cardioImpactLevel',
  ]);
});

test('projection removes internal context, raw muscle, equipment, blocked, and soft-signal fields', () => {
  const input = buildProgramGenerationPromptInput(createContext());
  const keys = new Set(collectKeys(input));
  const forbiddenKeys = [
    'generationMode',
    'coachInputs',
    'userId',
    'createdAt',
    'profileSchemaVersion',
    'evaluationPolicy',
    'poolSummary',
    'poolSnapshot',
    'allowedExerciseIds',
    'equipmentPreset',
    'availableEquipment',
    'hardConstraints',
    'blockedExerciseIds',
    'blockedMovementPatterns',
    'blockedJointStressTags',
    'equipmentNeeded',
    'softSignals',
    'painContext',
    'weightHint',
    'targetMuscles',
    'secondaryMuscles',
    'muscleActivation',
    'jointStressTags',
  ];

  forbiddenKeys.forEach((key) => assert.equal(keys.has(key), false, key));
});

test('neutral exercise preference and absent cautions or notes are omitted', () => {
  const context = createContext({
    equipmentContext: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells'],
      equipmentBias: 'no_preference',
      hardConstraints: [],
    },
    movementConstraints: {
      cautionMovementPatterns: [],
      cautionJointStressTags: [],
      blockedExerciseIds: ['ex_blocked'],
    },
    physicalNotes: '   ',
  });
  const input = buildProgramGenerationPromptInput(context);

  assert.equal('exercisePreference' in input.athleteBrief, false);
  assert.equal('movementConsiderations' in input.athleteBrief, false);
  assert.equal('physicalNotes' in input.athleteBrief, false);
});

test('machine and free-weight preferences stay soft and canonical', () => {
  const machines = buildProgramGenerationPromptInput(createContext());
  const freeWeights = buildProgramGenerationPromptInput(
    createContext({
      equipmentContext: {
        equipmentBias: 'free_weights',
        equipmentPreset: 'full_gym',
        availableEquipment: ['barbell'],
        hardConstraints: [],
      },
    })
  );

  assert.deepEqual(machines.athleteBrief.exercisePreference, {
    preference: 'machines',
    isSoftPreference: true,
  });
  assert.deepEqual(freeWeights.athleteBrief.exercisePreference, {
    preference: 'free_weights',
    isSoftPreference: true,
  });
});

test('canonical cardio roles project their intended guidance inputs without leaking modalities for none', () => {
  const cases = [
    ['none', false],
    ['warm_up_only', true],
    ['cardio_sessions', true],
    ['warm_up_and_cardio', true],
  ];

  cases.forEach(([role, hasModalities]) => {
    const input = buildProgramGenerationPromptInput(
      createContext({
        cardioProfile: {
          cardioRole: role,
          preferredModalities: ['stationary_bike'],
        },
      })
    );

    assert.equal(input.athleteBrief.cardio.role, role);
    assert.equal('preferredModalities' in input.athleteBrief.cardio, hasModalities);
  });
});

test('absent cardio roles are omitted and unknown non-empty roles fail closed', () => {
  [null, undefined, ''].forEach((cardioRole) => {
    const input = buildProgramGenerationPromptInput(
      createContext({
        cardioProfile: {
          cardioRole,
          preferredModalities: ['stationary_bike'],
        },
      })
    );

    assert.equal('cardio' in input.athleteBrief, false);
  });

  const privateUnknownRole = 'future_private_cardio_role';
  assert.throws(
    () =>
      buildProgramGenerationPromptInput(
        createContext({
          cardioProfile: {
            cardioRole: privateUnknownRole,
            preferredModalities: ['stationary_bike'],
          },
        })
      ),
    (error) => {
      assert.equal(error instanceof ProgramGenerationPromptInputError, true);
      assert.equal(error.code, 'INVALID_PROGRAM_GENERATION_CONTEXT');
      assert.equal(error.message.includes(privateUnknownRole), false);
      return true;
    }
  );
});

test('projection is deterministic, owns its arrays and objects, and never mutates or freezes the source', () => {
  const firstContext = createContext();
  const secondContext = Object.fromEntries(Object.entries(firstContext).reverse());
  const before = structuredClone(firstContext);
  const first = buildProgramGenerationPromptInput(firstContext);
  const second = buildProgramGenerationPromptInput(secondContext);

  assert.deepEqual(first, second);
  assert.deepEqual(firstContext, before);
  assert.equal(Object.isFrozen(firstContext), false);
  assert.equal(Object.isFrozen(firstContext.exercisePoolItems), false);
  assert.notStrictEqual(
    first.eligibleExercisePool,
    firstContext.exercisePoolItems
  );
  assert.notStrictEqual(
    first.eligibleExercisePool[0].bodyParts,
    firstContext.exercisePoolItems[0].bodyParts
  );

  first.eligibleExercisePool[0].bodyParts.push('projection_only');
  assert.deepEqual(firstContext.exercisePoolItems[0].bodyParts, ['chest']);
  first.trainingMetricsGuidance.duration.repetitions.valuePrecedence.push(
    'projection_only'
  );
  assert.deepEqual(
    firstContext.evaluationPolicy.duration.calculation.repetitions.valuePrecedence,
    ['targetReps', 'maxReps', 'minReps', 'zero']
  );
});

test('builder requires ProgramGenerationContext V4, canonical policy, availability, and pool items', () => {
  const cases = [
    null,
    createContext({ schemaVersion: 3 }),
    createContext({ evaluationPolicy: undefined }),
    createContext({
      evaluationPolicy: { ...WEEKLY_PLAN_EVALUATION_POLICY, version: 2 },
    }),
    createContext({ availability: { sessionsPerWeek: 2, durationPerSession: null } }),
    createContext({ exercisePoolItems: null }),
  ];

  cases.forEach((context) => {
    assert.throws(
      () => buildProgramGenerationPromptInput(context),
      (error) => {
        assert.equal(error instanceof ProgramGenerationPromptInputError, true);
        assert.equal(error.code, 'INVALID_PROGRAM_GENERATION_CONTEXT');
        return true;
      }
    );
  });
});

test('representative fixture reports prompt reduction, ID preservation, contribution coverage, and count-only diagnostics', (t) => {
  const context = createContext();
  const legacyUserMessage = [
    'Structured generation task:',
    'Design the best complete and editable static weekly plan for this athlete using your coaching judgment and the supplied runtime doctrine.',
    'Treat the requested session duration as approximate. Any evaluationPolicy duration band whose requiresCorrection value is false is acceptable.',
    'Respect the athlete\'s availability, experience, priorities, preferences, confirmed constraints and exact eligible exercise pool.',
    'Return only the required structured JSON.',
    '',
    'ProgramGenerationContext (untrusted structured athlete data):',
    stableStringify(context),
  ].join('\n');
  const prompt = buildProgramGenerationPrompt({ doctrine: MOCK_DOCTRINE, context });
  const input = buildProgramGenerationPromptInput(context);
  const diagnostics = buildProgramGenerationPromptInputDiagnostics(context);
  const sourceIds = context.exercisePoolItems.map((item) => item.exerciseId);
  const projectedIds = input.eligibleExercisePool.map((item) => item.exerciseId);
  const contributions = input.eligibleExercisePool.flatMap(
    (item) => item.muscleContributions || []
  );
  const compactPool = serializeEligibleExercisePool(input.eligibleExercisePool);
  const prettyPool = serializeEligibleExercisePoolPretty(input.eligibleExercisePool);
  const metrics = {
    legacyUserMessageCharacters: legacyUserMessage.length,
    projectedUserMessageCharacters: prompt.userMessage.length,
    reductionPercentage: Number(
      ((1 - prompt.userMessage.length / legacyUserMessage.length) * 100).toFixed(2)
    ),
    exercisesBefore: sourceIds.length,
    exercisesAfter: projectedIds.length,
    allExerciseIdsPreserved: JSON.stringify(sourceIds) === JSON.stringify(projectedIds),
    muscleContributions: contributions.length,
    contributionsWithActivationWeight: contributions.filter(
      (entry) => entry.activationWeight != null
    ).length,
    contributionsWithNullActivationWeight: contributions.filter(
      (entry) => entry.activationWeight == null
    ).length,
    compactPoolCharacters: compactPool.length,
    prettyPoolCharacters: prettyPool.length,
    compactPoolReductionCharacters: prettyPool.length - compactPool.length,
    compactPoolReductionPercentage: Number(
      ((1 - compactPool.length / prettyPool.length) * 100).toFixed(2)
    ),
    diagnostics,
  };

  assert.ok(metrics.projectedUserMessageCharacters < metrics.legacyUserMessageCharacters);
  assert.ok(metrics.compactPoolCharacters < metrics.prettyPoolCharacters);
  assert.deepEqual(JSON.parse(compactPool), JSON.parse(prettyPool));
  assert.equal(metrics.exercisesBefore, metrics.exercisesAfter);
  assert.equal(metrics.allExerciseIdsPreserved, true);
  assert.deepEqual(metrics.diagnostics, {
    activationMusclesNotClassifiedCount: 1,
    primaryMusclesMissingActivationCount: 2,
    secondaryMusclesMissingActivationCount: 2,
    invalidActivationEntryCount: 4,
  });
  t.diagnostic(`fixture metrics: ${JSON.stringify(metrics)}`);
});
