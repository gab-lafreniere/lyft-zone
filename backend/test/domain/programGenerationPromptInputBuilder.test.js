const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
  ProgramGenerationPromptInputError,
  buildProgramGenerationExercisePoolPromptProjection,
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
  content: [
    '# Mock classic doctrine',
    '## 2. Authoritative Inputs',
    'Legacy authority.',
    '## 3. Initial-Generation Limits',
    'Initial only.',
    '### Cardio Profile Interpretation',
    'Legacy cardio.',
    '## 6. Muscle Priority Allocation',
    'Priorities.',
    '## 20. Final Generation Sequence',
    '2. use only the supplied eligible exercise pool',
    '## 21. Final Validation',
    '- every selected exercise exists in the supplied pool',
    '- no exercise identifier was invented',
    '## 22. Prohibited Behaviours',
    '- invent exercises or exercise identifiers',
    '- select exercises outside the supplied eligible pool',
  ].join('\n\n'),
};

function createContext(overrides = {}) {
  return {
    schemaVersion: 5,
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
    promptPhysicalConsiderations: [
      {
        aiSummary: '  Pressing needs measured handling.  ',
        confirmedSignals: [
          {
            type: 'jointStressTag',
            value: 'overhead_shoulder_position',
            decision: 'caution',
          },
          {
            type: 'movementPattern',
            value: 'horizontal_push',
            decision: 'monitor',
          },
          {
            type: 'movementPattern',
            value: 'vertical_push',
            decision: 'blocked',
          },
          {
            type: 'movementPattern',
            value: 'horizontal_push',
            decision: 'monitor',
          },
        ],
      },
      {
        aiSummary: 'Blocked only',
        confirmedSignals: [
          {
            type: 'jointStressTag',
            value: 'spinal_loading',
            decision: 'blocked',
          },
        ],
      },
    ],
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

function flattenEligibleExercisePool(pool) {
  return [...pool.strengthExercises, ...pool.cardioExercises];
}

function flattenMuscleWeights(pool) {
  return pool.strengthExercises.flatMap((item) =>
    Object.values(item.muscles || {}).flatMap((role) => Object.values(role))
  );
}

test('buildProgramGenerationPromptInput projects a compact athlete brief, safe constraints, pool coverage, and qualitative duration guidance', () => {
  const input = buildProgramGenerationPromptInput(createContext());

  assert.equal(
    PROGRAM_GENERATION_PROMPT_INPUT_SCHEMA_VERSION,
    6
  );
  assert.equal(input.schemaVersion, 6);
  assert.equal(input.athleteBrief.primaryGoal, 'HYPERTROPHY');
  assert.equal(input.athleteBrief.experience, 'intermediate');
  assert.deepEqual(input.athleteBrief.trainingSchedule, {
    sessionsPerWeek: 2,
    approximateDurationMinutes: 30,
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
  assert.deepEqual(input.athleteBrief.physicalConsiderations, [
    {
      aiSummary: 'Pressing needs measured handling.',
      confirmedSignals: [
        {
          type: 'jointStressTag',
          value: 'overhead_shoulder_position',
          decision: 'caution',
        },
        {
          type: 'movementPattern',
          value: 'horizontal_push',
          decision: 'monitor',
        },
      ],
    },
  ]);
  assert.equal(input.athleteBrief.physicalNotes, 'Keep setup changes simple.');
  assert.deepEqual(input.trainingMetricsGuidance, {
    requestedMinutes: 30,
    durationIntent:
      'Use the available session time productively without padding or unnecessary work.',
  });
  assert.deepEqual(input.appliedConstraints, {
    blockedMovementPatterns: ['vertical_push'],
    blockedJointStressTags: ['spinal_loading'],
    confirmedCautions: [
      {
        type: 'jointStressTag',
        value: 'overhead_shoulder_position',
      },
    ],
    equipmentPreset: 'full_gym',
    availableEquipment: ['dumbbells', 'cable_machine'],
    cardioRole: 'warm_up_and_cardio',
  });
  assert.deepEqual(input.poolCoverageNotes, [
    {
      taxonomy: 'muscleFocus',
      area: 'upper_chest',
      eligibleExerciseCount: 1,
      coverageLevel: 'severely_limited',
    },
    {
      taxonomy: 'muscleFocus',
      area: 'rear_delts',
      eligibleExerciseCount: 0,
      coverageLevel: 'unavailable',
    },
    {
      taxonomy: 'bodyPart',
      area: 'back',
      eligibleExerciseCount: 1,
      coverageLevel: 'severely_limited',
    },
  ]);
});

test('prompt input projects only prompt-safe demographics and omits missing data', () => {
  const withDemographics = buildProgramGenerationPromptInput(
    createContext({
      demographics: {
        sex: 'MALE',
        ageBand: 'in their early 30s',
      },
    })
  );
  assert.deepEqual(withDemographics.athleteBrief.demographics, {
    sex: 'MALE',
    ageBand: 'in their early 30s',
  });

  const withoutDemographics = buildProgramGenerationPromptInput(
    createContext({ demographics: null })
  );
  assert.equal(Object.hasOwn(withoutDemographics.athleteBrief, 'demographics'), false);

  assert.throws(() =>
    buildProgramGenerationPromptInput(
      createContext({ demographics: { sex: 'OTHER', ageBand: 'in their early 30s' } })
    )
  );
});

test('poolCoverageNotes is omitted when every analyzed area has at least three eligible exercises', () => {
  const exercisePoolItems = Array.from({ length: 3 }, (_, index) => ({
    exerciseId: `ex_full_${index}`,
    name: `Full Coverage ${index}`,
    trainingType: 'strength',
    bodyParts: [
      'chest',
      'back',
      'shoulders',
      'biceps',
      'triceps',
      'quadriceps',
      'hamstrings',
      'glutes',
      'calves',
      'abs',
    ],
    muscleFocus: ['upper_chest', 'rear_delts'],
    targetMuscles: [],
    secondaryMuscles: [],
  }));
  const input = buildProgramGenerationPromptInput(
    createContext({ exercisePoolItems })
  );

  assert.equal('poolCoverageNotes' in input, false);
  assert.deepEqual(
    input.eligibleExercisePool.strengthExercises.map(
      (exercise) => exercise.exerciseId
    ),
    ['ex_full_0', 'ex_full_1', 'ex_full_2']
  );
});

test('muscles use canonical activation weights, primary precedence, null fallback, and exact diagnostics', () => {
  const context = createContext();
  const input = buildProgramGenerationPromptInput(context);
  const diagnostics = buildProgramGenerationPromptInputDiagnostics(context);

  const strength = input.eligibleExercisePool.strengthExercises;
  assert.deepEqual(strength[0].muscles, {
    primary: {
      pectoralis_major: 1,
      shared_muscle: 0.75,
    },
    secondary: {
      triceps_long_head: 0.5,
    },
  });
  assert.deepEqual(strength[1].muscles, {
    primary: {
      latissimus_dorsi: 1,
      rhomboids: null,
    },
    secondary: {
      biceps_brachii: 0.5,
      brachialis: null,
    },
  });
  assert.deepEqual(strength[2].muscles, {
    primary: {
      quadriceps: null,
    },
    secondary: {
      gluteus_maximus: null,
    },
  });
  assert.equal('muscles' in input.eligibleExercisePool.cardioExercises[0], false);
  assert.deepEqual(diagnostics, {
    activationMusclesNotClassifiedCount: 1,
    primaryMusclesMissingActivationCount: 2,
    secondaryMusclesMissingActivationCount: 2,
    invalidActivationEntryCount: 4,
  });
  assert.equal('muscleContributionDiagnostics' in input, false);
});

test('strength and cardio projections use closed allowlists and preserve every exerciseId in deterministic stable partitions', () => {
  const context = createContext();
  const input = buildProgramGenerationPromptInput(context);
  const sourceIds = context.exercisePoolItems.map((item) => item.exerciseId);
  const projectedIds = flattenEligibleExercisePool(
    input.eligibleExercisePool
  ).map((item) => item.exerciseId);

  assert.deepEqual(projectedIds, sourceIds);
  assert.deepEqual(Object.keys(input.eligibleExercisePool), [
    'strengthExercises',
    'cardioExercises',
  ]);
  input.eligibleExercisePool.strengthExercises.forEach((item) => {
    assert.deepEqual(Object.keys(item).slice(0, 2), [
      'exerciseId',
      'name',
    ]);
  });
  assert.deepEqual(Object.keys(input.eligibleExercisePool.strengthExercises[0]), [
    'exerciseId',
    'name',
    'equipmentCategory',
    'fatigueScore',
    'isSupersetFriendly',
    'mechanicType',
    'movementPattern',
    'bodyParts',
    'muscleFocus',
    'muscles',
    'unilateralType',
    'cautionMatches',
  ]);
  assert.deepEqual(input.eligibleExercisePool.strengthExercises[0].cautionMatches, [
    'horizontal_push',
    'shoulder_load',
  ]);
  assert.equal(
    'cautionMatches' in input.eligibleExercisePool.strengthExercises[1],
    false
  );
  assert.deepEqual(input.eligibleExercisePool.cardioExercises[0], {
    exerciseId: 'ex_bike',
    name: 'Stationary Bike',
    cardioModality: 'stationary_bike',
    cardioFatigueScore: 2,
    lowerBodyFatigueBias: 'moderate',
    cardioImpactLevel: 'low',
  });
  assert.deepEqual(Object.keys(input.eligibleExercisePool.cardioExercises[0]), [
    'exerciseId',
    'name',
    'cardioModality',
    'cardioFatigueScore',
    'lowerBodyFatigueBias',
    'cardioImpactLevel',
  ]);
  flattenEligibleExercisePool(input.eligibleExercisePool).forEach((item) => {
    assert.equal('difficulty' in item, false);
    assert.equal('trainingType' in item, false);
  });
});

test('exercise pool projection fails closed for absent, empty, and unknown trainingType values', () => {
  const invalidTrainingTypes = [undefined, null, '', 'mobility', 'Strength'];

  invalidTrainingTypes.forEach((trainingType) => {
    assert.throws(
      () =>
        buildProgramGenerationExercisePoolPromptProjection([
          {
            exerciseId: 'private_exercise_id',
            name: 'Private exercise name',
            trainingType,
          },
        ]),
      (error) => {
        assert.equal(error instanceof ProgramGenerationPromptInputError, true);
        assert.equal(error.code, 'INVALID_PROGRAM_GENERATION_CONTEXT');
        assert.equal(
          error.message,
          'ProgramGenerationContext exercise trainingType is invalid'
        );
        assert.doesNotMatch(error.message, /private/i);
        return true;
      }
    );
  });
});

test('projection removes private internals while retaining the safe applied constraints allowlist', () => {
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
    'hardConstraints',
    'blockedExerciseIds',
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

test('neutral exercise preference remains explicit while absent physical considerations and notes are omitted', () => {
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
    promptPhysicalConsiderations: [],
    physicalNotes: '   ',
  });
  const input = buildProgramGenerationPromptInput(context);

  assert.deepEqual(input.athleteBrief.exercisePreference, {
    preference: 'no_preference',
    isSoftPreference: true,
  });
  assert.equal('physicalConsiderations' in input.athleteBrief, false);
  assert.equal('physicalNotes' in input.athleteBrief, false);
});

test('physical consideration projection includes monitor and caution while excluding detected, blocked, invalid, and duplicate signals', () => {
  const input = buildProgramGenerationPromptInput(
    createContext({
      promptPhysicalConsiderations: [
        {
          aiSummary: '   ',
          detectedSignals: [
            {
              type: 'movementPattern',
              value: 'vertical_push',
              recommendedDecision: 'caution',
            },
          ],
          confirmedSignals: [
            {
              type: 'movementPattern',
              value: 'horizontal_push',
              decision: 'monitor',
            },
            {
              type: 'movementPattern',
              value: 'horizontal_push',
              decision: 'monitor',
            },
            {
              type: 'jointStressTag',
              value: 'overhead_shoulder_position',
              decision: 'caution',
            },
            {
              type: 'jointStressTag',
              value: 'spinal_loading',
              decision: 'blocked',
            },
            {
              type: 'exerciseId',
              value: 'ex_private',
              decision: 'monitor',
            },
          ],
        },
      ],
    })
  );

  assert.deepEqual(input.athleteBrief.physicalConsiderations, [
    {
      aiSummary: null,
      confirmedSignals: [
        {
          type: 'movementPattern',
          value: 'horizontal_push',
          decision: 'monitor',
        },
        {
          type: 'jointStressTag',
          value: 'overhead_shoulder_position',
          decision: 'caution',
        },
      ],
    },
  ]);
  const serialized = JSON.stringify(input.athleteBrief.physicalConsiderations);
  assert.doesNotMatch(
    serialized,
    /detected|recommended|ignored|blocked|spinal_loading|ex_private/
  );
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

test('unknown exercise preferences fail closed without exposing the private value', () => {
  const privateUnknownPreference = 'future_private_preference';
  assert.throws(
    () =>
      buildProgramGenerationPromptInput(
        createContext({
          equipmentContext: {
            equipmentBias: privateUnknownPreference,
          },
        })
      ),
    (error) => {
      assert.equal(error instanceof ProgramGenerationPromptInputError, true);
      assert.equal(error.code, 'INVALID_PROGRAM_GENERATION_CONTEXT');
      assert.equal(error.message.includes(privateUnknownPreference), false);
      return true;
    }
  );
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
    first.eligibleExercisePool.strengthExercises[0].bodyParts,
    firstContext.exercisePoolItems[0].bodyParts
  );

  first.eligibleExercisePool.strengthExercises[0].bodyParts.push(
    'projection_only'
  );
  assert.deepEqual(firstContext.exercisePoolItems[0].bodyParts, ['chest']);
  first.appliedConstraints.availableEquipment.push('projection_only');
  assert.deepEqual(firstContext.equipmentContext.availableEquipment, [
    'dumbbells',
    'cable_machine',
  ]);
});

test('builder requires ProgramGenerationContext V5, availability, and pool items without an Evaluation Policy', () => {
  const cases = [
    null,
    createContext({ schemaVersion: 3 }),
    createContext({ availability: { sessionsPerWeek: 2, durationPerSession: null } }),
    createContext({ availability: { sessionsPerWeek: 2, durationPerSession: 121 } }),
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

  assert.doesNotThrow(() =>
    buildProgramGenerationPromptInput(
      createContext({ evaluationPolicy: undefined })
    )
  );
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
  const athleteProfileEnd = prompt.userMessage.indexOf(
    '\n\nNON-NEGOTIABLE TECHNICAL RULES'
  );
  const athleteProfile = prompt.userMessage.slice(0, athleteProfileEnd);
  const input = buildProgramGenerationPromptInput(context);
  const diagnostics = buildProgramGenerationPromptInputDiagnostics(context);
  const sourceIds = context.exercisePoolItems.map((item) => item.exerciseId);
  const projectedIds = flattenEligibleExercisePool(
    input.eligibleExercisePool
  ).map((item) => item.exerciseId);
  const activationWeights = flattenMuscleWeights(input.eligibleExercisePool);
  const compactPool = serializeEligibleExercisePool(input.eligibleExercisePool);
  const prettyPool = serializeEligibleExercisePoolPretty(input.eligibleExercisePool);
  const metrics = {
    legacyUserMessageCharacters: legacyUserMessage.length,
    projectedAthleteProfileCharacters: athleteProfile.length,
    reductionPercentage: Number(
      ((1 - athleteProfile.length / legacyUserMessage.length) * 100).toFixed(2)
    ),
    exercisesBefore: sourceIds.length,
    exercisesAfter: projectedIds.length,
    allExerciseIdsPreserved: JSON.stringify(sourceIds) === JSON.stringify(projectedIds),
    muscleContributions: activationWeights.length,
    contributionsWithActivationWeight: activationWeights.filter(
      (weight) => weight != null
    ).length,
    contributionsWithNullActivationWeight: activationWeights.filter(
      (weight) => weight == null
    ).length,
    compactPoolCharacters: compactPool.length,
    prettyPoolCharacters: prettyPool.length,
    compactPoolReductionCharacters: prettyPool.length - compactPool.length,
    compactPoolReductionPercentage: Number(
      ((1 - compactPool.length / prettyPool.length) * 100).toFixed(2)
    ),
    diagnostics,
  };

  assert.ok(
    metrics.projectedAthleteProfileCharacters <
      metrics.legacyUserMessageCharacters
  );
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
