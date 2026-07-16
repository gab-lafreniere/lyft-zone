const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createExercisePoolItems,
  createPoolSnapshot,
  createPoolSummary,
} = require('../../src/domain/programGeneration/poolSnapshot');

function createPoolResult() {
  return {
    meta: {
      profileSchemaVersion: 2,
      generatedAt: '2026-06-01T12:00:00.000Z',
      userId: 'user_123',
    },
    hardConstraints: {
      blockedExerciseIds: ['ex_blocked'],
      allowedDifficulties: ['beginner', 'intermediate'],
    },
    pool: {
      items: [
        {
          exerciseId: 'ex_row',
          name: 'Dumbbell Row',
          trainingType: 'strength',
          attributes: {
            movementPattern: 'horizontal_pull',
            bodyParts: ['back'],
            muscleFocus: ['lats'],
            targetMuscles: ['latissimus_dorsi'],
            secondaryMuscles: ['biceps'],
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells'],
            difficulty: 'beginner',
            mechanicType: 'compound',
            unilateralType: 'unilateral',
            isSupersetFriendly: true,
            fatigueScore: 2,
          },
          softSignals: {
            musclePriority: {
              weightHint: 0.65,
            },
          },
        },
        {
          exerciseId: 'ex_bench',
          name: 'Dumbbell Bench Press',
          trainingType: 'strength',
          attributes: {
            movementPattern: 'horizontal_push',
            bodyParts: ['chest'],
            muscleFocus: ['upper_chest'],
            targetMuscles: ['pectoralis_major'],
            secondaryMuscles: ['triceps'],
            equipmentCategory: 'dumbbell',
            equipmentNeeded: ['dumbbells', 'bench'],
            difficulty: 'intermediate',
          },
          softSignals: {},
        },
      ],
      stats: {
        fetchedCount: 3,
        eligibleCount: 2,
        excludedCount: 1,
        excludedByReason: {
          blocked_exercise_id: 1,
        },
      },
    },
  };
}

test('createPoolSnapshot stores allowedExerciseIds, counts, constraints, and stable checksum', () => {
  const poolResult = createPoolResult();
  const snapshot = createPoolSnapshot(poolResult);
  const secondSnapshot = createPoolSnapshot(poolResult);

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.source, 'user_exercise_pool');
  assert.equal(snapshot.profileSchemaVersion, 2);
  assert.equal(snapshot.generatedAt, '2026-06-01T12:00:00.000Z');
  assert.equal(snapshot.userId, 'user_123');
  assert.deepEqual(snapshot.allowedExerciseIds, ['ex_bench', 'ex_row']);
  assert.equal(snapshot.availableExerciseCount, 2);
  assert.equal(snapshot.excludedExerciseCount, 1);
  assert.deepEqual(snapshot.hardConstraints, poolResult.hardConstraints);
  assert.deepEqual(snapshot.poolSummary, {
    totalExercises: 3,
    availableExercises: 2,
    excludedExercises: 1,
    excludedByReason: {
      blocked_exercise_id: 1,
    },
  });
  assert.equal(snapshot.checksum, secondSnapshot.checksum);
  assert.match(snapshot.checksum, /^[a-f0-9]{64}$/);
});

test('createPoolSummary and createExercisePoolItems keep generation payload compact', () => {
  const poolResult = createPoolResult();

  assert.deepEqual(createPoolSummary(poolResult), {
    totalExercises: 3,
    availableExercises: 2,
    excludedExercises: 1,
    excludedByReason: {
      blocked_exercise_id: 1,
    },
  });

  assert.deepEqual(createExercisePoolItems(poolResult)[0], {
    exerciseId: 'ex_row',
    name: 'Dumbbell Row',
    trainingType: 'strength',
    movementPattern: 'horizontal_pull',
    bodyParts: ['back'],
    muscleFocus: ['lats'],
    targetMuscles: ['latissimus_dorsi'],
    secondaryMuscles: ['biceps'],
    equipmentCategory: 'dumbbell',
    equipmentNeeded: ['dumbbells'],
    difficulty: 'beginner',
    mechanicType: 'compound',
    unilateralType: 'unilateral',
    isSupersetFriendly: true,
    cardioModality: null,
    cardioImpactLevel: null,
    fatigueScore: 2,
    softSignals: {
      musclePriority: {
        weightHint: 0.65,
      },
    },
  });
});
