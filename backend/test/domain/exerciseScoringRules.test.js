const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreExercise,
} = require('../../src/domain/exercises/exerciseScoringRules');

test('scoreExercise returns a deterministic positive score for a compatible focused exercise', () => {
  const exercise = {
    equipmentCategory: 'selectorized_machine',
    movementPattern: 'chest_press',
    targetMuscles: ['upper_chest'],
    equipmentNeeded: ['selectorized_machine'],
  };
  const context = {
    musclePriorityProfile: {
      perAreaWeights: {
        upper_chest: 1,
      },
    },
    equipment: {
      equipmentBias: 'machines',
      availableEquipment: ['selectorized_machine'],
    },
    movement: {
      cautionPatterns: [],
      blockedPatterns: [],
    },
  };

  const first = scoreExercise(exercise, context);
  const second = scoreExercise(exercise, context);

  assert.deepEqual(first, second);
  assert.equal(first.score, 1.2);
  assert.equal(first.breakdown.musclePriority, 1);
});

test('scoreExercise stays neutral for incompatible exercises', () => {
  const result = scoreExercise(
    {
      movementPattern: 'overhead_press',
      equipmentNeeded: ['barbell'],
    },
    {
      equipment: {
        availableEquipment: ['dumbbells'],
      },
      movement: {
        blockedPatterns: ['overhead_press'],
      },
    }
  );

  assert.equal(result.score, 0);
  assert.deepEqual(result.breakdown, {
    musclePriority: 0,
    equipmentBias: 0,
    movementFit: 0,
  });
});
