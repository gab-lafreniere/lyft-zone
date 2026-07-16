const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXERCISE_POOL_ORDER_BY,
  EXERCISE_POOL_SELECT,
  ExercisePoolServiceError,
  buildExercisePoolSearchResponse,
  buildExercisePoolForUser,
} = require('../../services/exercisePoolService');

function createProfile(overrides = {}) {
  return {
    primaryGoal: 'HYPERTROPHY',
    musclePriorities: {
      primaryFocus: 'chest',
      secondaryFocuses: ['back'],
      deprioritizedArea: 'quadriceps',
    },
    experience: 'intermediate',
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 75,
    },
    environment: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'treadmill'],
    },
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation',
          affectedArea: 'shoulder',
          painSeverity: 'moderate',
          trainingRule: 'modify',
          analysisStatus: 'analyzed',
          detectedSignals: [{ type: 'movementPattern', value: 'vertical_push' }],
          confirmedSignals: [
            { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
          ],
        },
      ],
      manualBlockedExerciseIds: [],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
    cardioProfile: {
      cardioRole: 'finisher',
      preferredModalities: ['treadmill_walk'],
    },
    physicalNotes: null,
    ...overrides,
  };
}

test('buildExercisePoolForUser builds a pool from onboardingSnapshot and reconstructs derived context when needed', async () => {
  const calls = {
    profileQuery: null,
    exerciseQuery: null,
  };
  const prisma = {
    userProfile: {
      findUnique: async (args) => {
        calls.profileQuery = args;
        return {
          onboardingSnapshot: {
            schemaVersion: 2,
            profile: createProfile(),
          },
        };
      },
    },
    exercise: {
      findMany: async (args) => {
        calls.exerciseQuery = args;
        return [
          {
            exerciseId: 'ex_draft_strength',
            name: 'Draft Incline Press',
            status: 'draft',
            trainingType: 'strength',
            difficulty: 'beginner',
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells'],
            movementPattern: 'incline_push',
            bodyParts: ['chest'],
            muscleFocus: ['upper_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps_long_head'],
            overview: 'draft example',
          },
        ];
      },
    },
  };

  const result = await buildExercisePoolForUser(
    'user_123',
    {
      allowDraftFallback: true,
    },
    {
      prisma,
      now: new Date('2026-05-12T10:00:00.000Z'),
    }
  );

  assert.deepEqual(calls.profileQuery, {
    where: { userId: 'user_123' },
    select: { onboardingSnapshot: true },
  });
  assert.deepEqual(calls.exerciseQuery, {
    select: EXERCISE_POOL_SELECT,
    orderBy: EXERCISE_POOL_ORDER_BY,
  });
  assert.equal(result.meta.generatedAt, '2026-05-12T10:00:00.000Z');
  assert.equal(result.meta.statusPolicy.allowDraftFallback, true);
  assert.equal(result.meta.statusPolicy.draftFallbackApplied, true);
  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), ['ex_draft_strength']);
  assert.equal(result.context.musclePriorityProfile.primaryFocus, 'chest');
  assert.equal(result.context.experience, 'intermediate');
  assert.deepEqual(result.hardConstraints.allowedDifficulties, ['beginner', 'intermediate']);
  assert.equal(result.context.equipmentContext.equipmentBias, 'machines');
  assert.deepEqual(result.context.equipmentContext.availableEquipment, [
    'dumbbells',
    'treadmill',
  ]);
  assert.deepEqual(result.context.movementConstraints.blockedMovementPatterns, []);
  assert.deepEqual(result.context.movementConstraints.cautionMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.context.movementConstraints.blockedJointStressTags, []);
  assert.deepEqual(result.context.movementConstraints.cautionJointStressTags, []);
  assert.deepEqual(result.context.movementConstraints.blockedExerciseIds, []);
});

test('buildExercisePoolForUser rebuilds equipment context instead of trusting stale derived snapshots', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 2,
          profile: createProfile({
            environment: {
              equipmentSetup: 'limited_gym',
              equipmentList: ['selectorized_shoulder_press'],
            },
          }),
          derived: {
            equipmentContext: {
              equipmentSetup: 'limited_gym',
              equipmentList: ['selectorized_shoulder_press'],
              availableEquipment: [],
            },
          },
        },
      }),
    },
    exercise: {
      findMany: async () => [
        {
          exerciseId: 'ex_machine_shoulder_press',
          name: 'Machine Shoulder Press',
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'intermediate',
          equipmentCategory: 'selectorized_machine',
          equipmentNeeded: ['selectorized_shoulder_press'],
          movementPattern: 'vertical_push',
          jointStressTags: [],
          bodyParts: ['shoulders'],
          muscleFocus: ['front_delts'],
          targetMuscles: ['front_delts'],
          secondaryMuscles: [],
          overview: 'legacy equipment alias example',
        },
      ],
    },
  };

  const result = await buildExercisePoolForUser('user_123', {}, { prisma });

  assert.deepEqual(result.context.equipmentContext.availableEquipment, [
    'shoulder_press_machine',
  ]);
  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), [
    'ex_machine_shoulder_press',
  ]);
});

test('buildExercisePoolForUser preserves legacy blockedPatterns fallback from derived snapshots', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 2,
          profile: createProfile(),
          derived: {
            movementConstraints: {
              affectedArea: 'shoulders',
              painSeverity: 'moderate',
              trainingRule: 'modify',
              blockedPatterns: ['vertical_push'],
            },
          },
        },
      }),
    },
    exercise: {
      findMany: async () => [
        {
          exerciseId: 'ex_overhead_press',
          name: 'Overhead Press',
          status: 'approved',
          trainingType: 'strength',
          difficulty: 'intermediate',
          equipmentCategory: 'dumbbell',
          equipmentNeeded: ['dumbbells'],
          movementPattern: 'vertical_push',
          jointStressTags: [],
          bodyParts: ['shoulders'],
          muscleFocus: ['front_delts'],
          targetMuscles: ['front_delts'],
          secondaryMuscles: [],
          overview: 'legacy fallback example',
        },
      ],
    },
  };

  const result = await buildExercisePoolForUser('user_123', {}, { prisma });

  assert.deepEqual(result.pool.items, []);
  assert.deepEqual(result.pool.excluded[0].reasons, ['blocked_movement_pattern']);
  assert.deepEqual(result.context.movementConstraints.blockedMovementPatterns, ['vertical_push']);
});

test('buildExercisePoolForUser throws PROFILE_NOT_READY when onboardingSnapshot is missing', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({ onboardingSnapshot: null }),
    },
    exercise: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => buildExercisePoolForUser('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'PROFILE_NOT_READY');
      return true;
    }
  );
});

test('buildExercisePoolForUser throws UNSUPPORTED_PROFILE_SCHEMA_VERSION for unknown profile versions', async () => {
  const prisma = {
    userProfile: {
      findUnique: async () => ({
        onboardingSnapshot: {
          schemaVersion: 99,
          profile: createProfile(),
        },
      }),
    },
    exercise: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => buildExercisePoolForUser('user_123', {}, { prisma }),
    (error) => {
      assert.equal(error instanceof ExercisePoolServiceError, true);
      assert.equal(error.code, 'UNSUPPORTED_PROFILE_SCHEMA_VERSION');
      return true;
    }
  );
});

test('buildExercisePoolSearchResponse filters and paginates after hard pool eligibility', () => {
  const poolResult = {
    meta: {
      difficultyPolicy: {
        experience: 'advanced',
        allowedDifficulties: ['beginner', 'intermediate', 'advanced'],
      },
    },
    hardConstraints: {
      allowedDifficulties: ['beginner', 'intermediate', 'advanced'],
    },
    pool: {
      items: [
        {
          exerciseId: 'ex_push_1',
          name: 'Dumbbell Bench Press',
          aliases: ['DB Press'],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['chest'],
            muscleFocus: ['upper_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps'],
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells', 'bench'],
            difficulty: 'beginner',
            movementPattern: 'horizontal_push',
          },
        },
        {
          exerciseId: 'ex_push_2',
          name: 'Incline Dumbbell Press',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['chest'],
            muscleFocus: ['upper_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps'],
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells', 'bench'],
            difficulty: 'intermediate',
            movementPattern: 'incline_push',
          },
        },
        {
          exerciseId: 'ex_pull_1',
          name: 'Lat Pulldown',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['back'],
            muscleFocus: ['lats'],
            targetMuscles: ['latissimus_dorsi'],
            secondaryMuscles: ['biceps'],
            equipmentCategory: 'selectorized_machine',
            equipmentNeeded: ['lat_pulldown_machine'],
            difficulty: 'beginner',
            movementPattern: 'vertical_pull',
          },
        },
      ],
      excluded: [{ exerciseId: 'ex_archived', name: 'Archived', reasons: ['status_not_allowed'] }],
      stats: {
        fetchedCount: 4,
        eligibleCount: 3,
        excludedCount: 1,
        excludedByReason: {
          status_not_allowed: 1,
          missing_equipment: 0,
        },
      },
    },
  };

  const response = buildExercisePoolSearchResponse(poolResult, {
    q: 'press',
    bodyParts: 'chest',
    muscleFocus: 'upper_chest',
    equipmentCategory: 'dumbbell',
    trainingType: 'strength',
    difficulty: 'beginner,intermediate',
    limit: '1',
    cursor: '1',
    includeExcluded: 'true',
  });

  assert.deepEqual(
    response.items.map((item) => item.exerciseId),
    ['ex_push_2']
  );
  assert.equal(response.nextCursor, null);
  assert.equal(response.total, 2);
  assert.deepEqual(response.poolSummary, {
    totalExercises: 4,
    availableExercises: 3,
    excludedExercises: 1,
  });
  assert.deepEqual(response.meta, poolResult.meta);
  assert.deepEqual(response.hardConstraints, poolResult.hardConstraints);
  assert.deepEqual(response.excluded, poolResult.pool.excluded);
  assert.deepEqual(response.excludedByReason, poolResult.pool.stats.excludedByReason);
});

test('buildExercisePoolSearchResponse keeps q focused on identity and taxonomy fields', () => {
  const poolResult = {
    meta: {},
    hardConstraints: {},
    pool: {
      items: [
        {
          exerciseId: 'ex_identity_match',
          name: 'Identity Match',
          aliases: ['Taxonomy Alias'],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['upper_body'],
            muscleFocus: ['rear_delts'],
            targetMuscles: ['posterior_deltoid'],
            secondaryMuscles: ['middle_traps'],
            equipmentCategory: 'cable',
            equipmentNeeded: ['cable_stack'],
            difficulty: 'intermediate',
            movementPattern: 'horizontal_pull',
            mechanicType: 'compound',
            unilateralType: 'bilateral',
            cardioModality: 'bike',
            cardioImpactLevel: 'low',
          },
        },
        {
          exerciseId: 'ex_removed_equipment_1',
          name: 'Rack Requirement Only',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['legs'],
            muscleFocus: ['quadriceps'],
            targetMuscles: ['vastus_lateralis'],
            secondaryMuscles: ['glutes'],
            equipmentCategory: 'barbell',
            equipmentNeeded: ['squat_rack'],
            difficulty: 'beginner',
            movementPattern: 'knee_dominant',
          },
        },
        {
          exerciseId: 'ex_removed_equipment_2',
          name: 'Press Setup Only',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['chest'],
            muscleFocus: ['mid_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps'],
            equipmentCategory: 'barbell',
            equipmentNeeded: ['flat_bench', 'adjustable_bench'],
            difficulty: 'beginner',
            movementPattern: 'horizontal_push',
          },
        },
        {
          exerciseId: 'ex_removed_equipment_3',
          name: 'Load Requirement Only',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['arms'],
            muscleFocus: ['biceps'],
            targetMuscles: ['biceps_brachii'],
            secondaryMuscles: ['forearms'],
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells'],
            difficulty: 'beginner',
            movementPattern: 'elbow_flexion',
          },
        },
        {
          exerciseId: 'ex_removed_difficulty_1',
          name: 'Difficulty Only',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['back'],
            muscleFocus: ['lats'],
            targetMuscles: ['latissimus_dorsi'],
            secondaryMuscles: ['biceps'],
            equipmentCategory: 'machine',
            equipmentNeeded: ['lat_pulldown_machine'],
            difficulty: 'advanced',
            movementPattern: 'vertical_pull',
          },
        },
        {
          exerciseId: 'ex_removed_training_type_1',
          name: 'Training Type Only',
          aliases: [],
          trainingType: 'strength',
          attributes: {
            bodyParts: ['calves'],
            muscleFocus: ['gastrocnemius'],
            targetMuscles: ['gastrocnemius'],
            secondaryMuscles: [],
            equipmentCategory: 'machine',
            equipmentNeeded: ['calf_raise_machine'],
            difficulty: 'beginner',
            movementPattern: 'ankle_extension',
          },
        },
        {
          exerciseId: 'ex_removed_cardio_impact_1',
          name: 'Impact Only',
          aliases: [],
          trainingType: 'cardio',
          attributes: {
            bodyParts: ['legs'],
            muscleFocus: ['quadriceps'],
            targetMuscles: ['quadriceps'],
            secondaryMuscles: [],
            equipmentCategory: 'cardio_machine',
            equipmentNeeded: ['treadmill'],
            difficulty: 'beginner',
            movementPattern: 'gait',
            cardioModality: 'walk',
            cardioImpactLevel: 'advanced',
          },
        },
      ],
      excluded: [],
      stats: {
        fetchedCount: 7,
        eligibleCount: 7,
        excludedCount: 0,
        excludedByReason: {},
      },
    },
  };
  const idsForQ = (q) =>
    buildExercisePoolSearchResponse(poolResult, { q, limit: '20' }).items.map(
      (item) => item.exerciseId
    );

  assert.deepEqual(idsForQ('squat'), []);
  assert.deepEqual(idsForQ('bench'), []);
  assert.deepEqual(idsForQ('dumbbell'), []);
  assert.deepEqual(idsForQ('advanced'), []);
  assert.deepEqual(idsForQ('strength'), []);
  assert.deepEqual(idsForQ('ex_identity_match'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('identity'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('taxonomy alias'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('horizontal_pull'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('upper_body'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('rear_delts'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('posterior_deltoid'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('middle_traps'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('compound'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('bilateral'), ['ex_identity_match']);
  assert.deepEqual(idsForQ('bike'), ['ex_identity_match']);
  assert.deepEqual(
    buildExercisePoolSearchResponse(poolResult, {
      equipmentCategory: 'barbell',
      limit: '20',
    }).items.map((item) => item.exerciseId),
    ['ex_removed_equipment_1', 'ex_removed_equipment_2']
  );
  assert.deepEqual(
    buildExercisePoolSearchResponse(poolResult, {
      difficulty: 'beginner',
      limit: '20',
    }).items.map((item) => item.exerciseId),
    [
      'ex_removed_equipment_1',
      'ex_removed_equipment_2',
      'ex_removed_equipment_3',
      'ex_removed_training_type_1',
      'ex_removed_cardio_impact_1',
    ]
  );
  assert.deepEqual(
    buildExercisePoolSearchResponse(poolResult, {
      trainingType: 'strength',
      limit: '20',
    }).items.map((item) => item.exerciseId),
    [
      'ex_identity_match',
      'ex_removed_equipment_1',
      'ex_removed_equipment_2',
      'ex_removed_equipment_3',
      'ex_removed_difficulty_1',
      'ex_removed_training_type_1',
    ]
  );
});
