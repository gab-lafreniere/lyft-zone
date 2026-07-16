const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExercisePool,
} = require('../../src/domain/exercises/exercisePoolBuilder');

function createPoolContext(overrides = {}) {
  return {
    userId: 'user_123',
    profileSchemaVersion: 1,
    primaryGoal: 'HYPERTROPHY',
    experience: 'advanced',
    musclePriorityProfile: {
      primaryFocus: 'chest',
      secondaryFocuses: ['back'],
      deprioritizedArea: 'quadriceps',
      weights: {
        primary: 1,
        secondary: 0.65,
        deprioritized: 0.35,
      },
      perAreaWeights: {
        chest: 1,
        back: 0.65,
        quadriceps: 0.35,
      },
    },
    equipmentContext: {
      availableEquipment: ['dumbbells', 'treadmill'],
      equipmentBias: 'machines',
    },
    movementConstraints: {
      painDescription: 'Bench press hurts my shoulder',
      affectedArea: 'shoulders',
      painSeverity: 'moderate',
      trainingRule: 'modify',
      cautionMovementPatterns: ['hip_hinge'],
      blockedMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['overhead_shoulder_position'],
      blockedJointStressTags: ['spinal_loading'],
      blockedExerciseIds: ['ex_blocked_id'],
    },
    cardioProfile: {
      cardioRole: 'finisher',
      preferredModalities: ['treadmill_walk'],
    },
    ...overrides,
  };
}

test('buildExercisePool applies explicit hard filters, preserves soft signals, and groups eligible items', () => {
  const exercises = [
    {
      exerciseId: 'ex_approved_strength',
      name: 'Dumbbell Bench Press',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_push',
      bodyParts: ['chest'],
      muscleFocus: ['upper_chest'],
      targetMuscles: ['pectoralis_major'],
      secondaryMuscles: ['triceps_long_head'],
      fatigueScore: 4,
      overview: 'Press variation',
    },
    {
      exerciseId: 'ex_draft_strength',
      name: 'Draft Press',
      status: 'draft',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_push',
      bodyParts: ['chest'],
      muscleFocus: ['upper_chest'],
    },
    {
      exerciseId: 'ex_archived',
      name: 'Archived Exercise',
      status: 'archived',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_push',
      bodyParts: ['chest'],
      muscleFocus: ['upper_chest'],
    },
    {
      exerciseId: 'ex_warmup',
      name: 'Warmup Drill',
      status: 'approved',
      trainingType: 'warmup',
      difficulty: 'beginner',
      equipmentCategory: 'bodyweight',
      equipmentNeeded: ['bodyweight'],
      movementPattern: 'horizontal_push',
      bodyParts: ['chest'],
      muscleFocus: ['upper_chest'],
    },
    {
      exerciseId: 'ex_missing_equipment',
      name: 'Barbell Bench Press',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'barbell',
      equipmentNeeded: ['olympic_barbell'],
      movementPattern: 'horizontal_push',
      bodyParts: ['chest'],
      muscleFocus: ['upper_chest'],
    },
    {
      exerciseId: 'ex_blocked_pattern',
      name: 'Overhead Press',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'vertical_push',
      bodyParts: ['shoulders'],
      muscleFocus: ['front_delts'],
    },
    {
      exerciseId: 'ex_caution_pattern',
      name: 'Romanian Deadlift',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'hip_hinge',
      bodyParts: ['hamstrings'],
      muscleFocus: ['glute_max'],
      fatigueScore: 6,
    },
    {
      exerciseId: 'ex_caution_joint',
      name: 'Dumbbell Lateral Raise',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'beginner',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'shoulder_abduction',
      bodyParts: ['shoulders'],
      muscleFocus: ['side_delts'],
      jointStressTags: ['overhead_shoulder_position'],
    },
    {
      exerciseId: 'ex_blocked_joint',
      name: 'Good Morning',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'hip_hinge',
      bodyParts: ['hamstrings'],
      muscleFocus: ['glute_max'],
      jointStressTags: ['spinal_loading'],
    },
    {
      exerciseId: 'ex_blocked_id',
      name: 'Explicitly Blocked Exercise',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'advanced',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'vertical_push',
      bodyParts: ['shoulders'],
      muscleFocus: ['front_delts'],
      jointStressTags: ['spinal_loading'],
    },
    {
      exerciseId: 'ex_cardio',
      name: 'Treadmill Walk',
      status: 'approved',
      trainingType: 'cardio',
      difficulty: 'beginner',
      equipmentCategory: 'cardio_machine',
      equipmentNeeded: ['treadmill'],
      movementPattern: 'gait',
      bodyParts: ['quadriceps'],
      muscleFocus: [],
      cardioModality: 'treadmill_walk',
      cardioFatigueScore: 2,
      lowerBodyFatigueBias: 'low',
    },
  ];

  const result = buildExercisePool(exercises, createPoolContext(), {
    generatedAt: '2026-05-12T10:00:00.000Z',
  });

  assert.deepEqual(
    result.pool.grouped.byEquipmentCategory.dumbbell,
    ['ex_approved_strength', 'ex_caution_pattern', 'ex_caution_joint']
  );
  assert.deepEqual(
    result.pool.excluded.map((item) => item.exerciseId),
    [
      'ex_draft_strength',
      'ex_archived',
      'ex_warmup',
      'ex_missing_equipment',
      'ex_blocked_pattern',
      'ex_blocked_joint',
      'ex_blocked_id',
    ]
  );
  assert.deepEqual(result.pool.excluded[0].reasons, ['status_not_allowed']);
  assert.deepEqual(result.pool.excluded[2].reasons, ['training_type_not_allowed']);
  assert.deepEqual(result.pool.excluded[3].reasons, ['missing_equipment']);
  assert.deepEqual(result.pool.excluded[4].reasons, ['blocked_movement_pattern']);
  assert.deepEqual(result.pool.excluded[5].reasons, ['blocked_joint_stress_tag']);
  assert.deepEqual(result.pool.excluded[6].reasons, ['blocked_exercise_id']);
  assert.equal(result.meta.statusPolicy.allowDraftFallback, false);
  assert.equal(result.meta.statusPolicy.draftFallbackApplied, false);
  assert.deepEqual(result.meta.trainingTypePolicy.allowedTrainingTypes, ['strength', 'cardio']);
  assert.deepEqual(result.meta.difficultyPolicy.allowedDifficulties, [
    'beginner',
    'intermediate',
    'advanced',
  ]);
  assert.deepEqual(result.pool.grouped.byMovementPattern.horizontal_push, ['ex_approved_strength']);
  assert.deepEqual(result.pool.grouped.byBodyPart.chest, ['ex_approved_strength']);
  assert.deepEqual(result.pool.grouped.byMuscleFocus.upper_chest, ['ex_approved_strength']);
  assert.deepEqual(
    result.pool.grouped.byEquipmentCategory.dumbbell,
    ['ex_approved_strength', 'ex_caution_pattern', 'ex_caution_joint']
  );
  assert.deepEqual(result.pool.grouped.byTrainingType.cardio, ['ex_cardio']);
  assert.equal(result.pool.stats.fetchedCount, 11);
  assert.equal(result.pool.stats.eligibleCount, 4);
  assert.equal(result.pool.stats.excludedCount, 7);
  assert.equal(result.pool.stats.excludedByReason.status_not_allowed, 2);
  assert.equal(result.pool.stats.excludedByReason.training_type_not_allowed, 1);
  assert.equal(result.pool.stats.excludedByReason.difficulty_not_allowed, 0);
  assert.equal(result.pool.stats.excludedByReason.missing_equipment, 1);
  assert.equal(result.pool.stats.excludedByReason.blocked_exercise_id, 1);
  assert.equal(result.pool.stats.excludedByReason.blocked_joint_stress_tag, 1);
  assert.equal(result.pool.stats.excludedByReason.blocked_movement_pattern, 1);
  assert.equal(result.pool.items[0].softSignals.musclePriority.primaryFocusMatch, true);
  assert.equal(result.pool.items[0].softSignals.musclePriority.weightHint, 1);
  assert.equal(result.pool.items[0].softSignals.equipmentBias.preferred, false);
  assert.equal(result.pool.items[1].softSignals.movementContext.cautionPatternMatch, true);
  assert.equal(result.pool.items[2].softSignals.movementContext.cautionJointStressTagMatch, true);
  assert.deepEqual(
    result.pool.items[2].softSignals.movementContext.matchedCautionJointStressTags,
    ['overhead_shoulder_position']
  );
  assert.deepEqual(
    result.pool.items[3].softSignals.cardioPreference.matchedPreferredModalities,
    ['treadmill_walk']
  );
  assert.deepEqual(result.context.movementConstraints.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.context.movementConstraints.cautionMovementPatterns, ['hip_hinge']);
  assert.deepEqual(result.context.movementConstraints.blockedJointStressTags, ['spinal_loading']);
  assert.deepEqual(result.context.movementConstraints.cautionJointStressTags, ['overhead_shoulder_position']);
  assert.deepEqual(result.context.movementConstraints.blockedExerciseIds, ['ex_blocked_id']);
  assert.deepEqual(result.hardConstraints.blockedExerciseIds, ['ex_blocked_id']);
  assert.deepEqual(result.hardConstraints.allowedDifficulties, [
    'beginner',
    'intermediate',
    'advanced',
  ]);
  assert.equal('score' in result.pool.items[0], false);
  assert.equal('score' in result.pool.items[0].softSignals, false);
});

test('buildExercisePool includes draft exercises only when allowDraftFallback is enabled', () => {
  const exercises = [
    {
      exerciseId: 'ex_draft_only',
      name: 'Draft Only Exercise',
      status: 'draft',
      trainingType: 'strength',
      difficulty: 'beginner',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
  ];

  const result = buildExercisePool(exercises, createPoolContext(), {
    allowDraftFallback: true,
    generatedAt: '2026-05-12T10:00:00.000Z',
  });

  assert.deepEqual(
    result.meta.statusPolicy.effectiveAllowedStatuses,
    ['approved', 'draft']
  );
  assert.equal(result.meta.statusPolicy.draftFallbackApplied, true);
  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), ['ex_draft_only']);
  assert.deepEqual(result.pool.excluded, []);
});

test('buildExercisePool excludes cardio exercises when the profile does not allow cardio', () => {
  const exercises = [
    {
      exerciseId: 'ex_cardio',
      name: 'Treadmill Walk',
      status: 'approved',
      trainingType: 'cardio',
      difficulty: 'beginner',
      equipmentCategory: 'cardio_machine',
      equipmentNeeded: ['treadmill'],
      movementPattern: 'gait',
      bodyParts: ['quadriceps'],
      muscleFocus: [],
      cardioModality: 'treadmill_walk',
    },
  ];

  const result = buildExercisePool(
    exercises,
    createPoolContext({
      cardioProfile: {
        cardioRole: 'none',
        preferredModalities: ['treadmill_walk'],
      },
    }),
    {
      generatedAt: '2026-05-12T10:00:00.000Z',
    }
  );

  assert.deepEqual(result.meta.trainingTypePolicy.allowedTrainingTypes, ['strength']);
  assert.deepEqual(result.pool.items, []);
  assert.equal(result.pool.excluded.length, 1);
  assert.deepEqual(result.pool.excluded[0].reasons, ['training_type_not_allowed']);
});

test('buildExercisePool excludes cardio exercises when cardio role is null', () => {
  const exercises = [
    {
      exerciseId: 'ex_cardio',
      name: 'Treadmill Walk',
      status: 'approved',
      trainingType: 'cardio',
      difficulty: 'beginner',
      equipmentCategory: 'cardio_machine',
      equipmentNeeded: ['treadmill'],
      movementPattern: 'gait',
      bodyParts: ['quadriceps'],
      muscleFocus: [],
    },
  ];

  const result = buildExercisePool(
    exercises,
    createPoolContext({
      cardioProfile: {
        cardioRole: null,
        preferredModalities: [],
      },
    }),
    {
      generatedAt: '2026-05-12T10:00:00.000Z',
    }
  );

  assert.deepEqual(result.meta.trainingTypePolicy.allowedTrainingTypes, ['strength']);
  assert.deepEqual(result.pool.items, []);
  assert.deepEqual(result.pool.excluded[0].reasons, ['training_type_not_allowed']);
});

test('buildExercisePool applies strict difficulty policy from experience', () => {
  const exercises = [
    {
      exerciseId: 'ex_beginner',
      name: 'Beginner Row',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'beginner',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
    {
      exerciseId: 'ex_intermediate',
      name: 'Intermediate Row',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'intermediate',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
    {
      exerciseId: 'ex_advanced',
      name: 'Advanced Row',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'advanced',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
    {
      exerciseId: 'ex_missing_difficulty',
      name: 'Missing Difficulty',
      status: 'approved',
      trainingType: 'strength',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
    {
      exerciseId: 'ex_unknown_difficulty',
      name: 'Unknown Difficulty',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'elite',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
  ];

  const beginnerResult = buildExercisePool(
    exercises,
    createPoolContext({ experience: 'beginner' }),
    { generatedAt: '2026-05-12T10:00:00.000Z' }
  );
  const intermediateResult = buildExercisePool(
    exercises,
    createPoolContext({ experience: 'intermediate' }),
    { generatedAt: '2026-05-12T10:00:00.000Z' }
  );
  const advancedResult = buildExercisePool(
    exercises,
    createPoolContext({ experience: 'advanced' }),
    { generatedAt: '2026-05-12T10:00:00.000Z' }
  );

  assert.deepEqual(
    beginnerResult.pool.items.map((item) => item.exerciseId),
    ['ex_beginner']
  );
  assert.deepEqual(
    intermediateResult.pool.items.map((item) => item.exerciseId),
    ['ex_beginner', 'ex_intermediate']
  );
  assert.deepEqual(
    advancedResult.pool.items.map((item) => item.exerciseId),
    ['ex_beginner', 'ex_intermediate', 'ex_advanced']
  );
  assert.deepEqual(beginnerResult.meta.difficultyPolicy.allowedDifficulties, ['beginner']);
  assert.equal(advancedResult.pool.stats.excludedByReason.difficulty_not_allowed, 2);
  assert.deepEqual(
    advancedResult.pool.excluded
      .filter((item) => item.reasons.includes('difficulty_not_allowed'))
      .map((item) => item.exerciseId),
    ['ex_missing_difficulty', 'ex_unknown_difficulty']
  );
});

test('buildExercisePool keeps monitored signals non-blocking', () => {
  const exercises = [
    {
      exerciseId: 'ex_monitored_pattern',
      name: 'Monitored Row',
      status: 'approved',
      trainingType: 'strength',
      difficulty: 'beginner',
      equipmentCategory: 'dumbbell',
      equipmentNeeded: ['dumbbells'],
      movementPattern: 'horizontal_pull',
      bodyParts: ['back'],
      muscleFocus: ['lats'],
    },
  ];

  const result = buildExercisePool(
    exercises,
    createPoolContext({
      movementConstraints: {
        monitoredSignals: [{ type: 'movementPattern', value: 'horizontal_pull' }],
        cautionMovementPatterns: [],
        blockedMovementPatterns: [],
        cautionJointStressTags: [],
        blockedJointStressTags: [],
        blockedExerciseIds: [],
      },
    }),
    {
      generatedAt: '2026-05-12T10:00:00.000Z',
    }
  );

  assert.deepEqual(result.pool.items.map((item) => item.exerciseId), [
    'ex_monitored_pattern',
  ]);
  assert.deepEqual(result.pool.excluded, []);
});
