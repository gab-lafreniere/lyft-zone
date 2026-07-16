const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isExerciseCompatible,
} = require('../../src/domain/exercises/exerciseCompatibilityRules');

test('isExerciseCompatible stays neutral when exercise metadata is incomplete', () => {
  const result = isExerciseCompatible({}, {});

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});

test('isExerciseCompatible rejects explicit blocked movement patterns', () => {
  const result = isExerciseCompatible(
    {
      movementPattern: 'overhead_press',
    },
    {
      movement: {
        blockedMovementPatterns: ['overhead_press'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['blocked_movement_pattern']);
});

test('isExerciseCompatible falls back to legacy blockedPatterns only when blockedMovementPatterns is absent', () => {
  const result = isExerciseCompatible(
    {
      movementPattern: 'overhead_press',
    },
    {
      movement: {
        blockedPatterns: ['overhead_press'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['blocked_movement_pattern']);
});

test('isExerciseCompatible ignores legacy blockedPatterns when blockedMovementPatterns exists even if empty', () => {
  const result = isExerciseCompatible(
    {
      movementPattern: 'overhead_press',
    },
    {
      movement: {
        blockedMovementPatterns: [],
        blockedPatterns: ['overhead_press'],
      },
    }
  );

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});

test('isExerciseCompatible rejects blocked joint stress tags', () => {
  const result = isExerciseCompatible(
    {
      jointStressTags: ['overhead_shoulder_position'],
    },
    {
      movement: {
        blockedJointStressTags: ['overhead_shoulder_position'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['blocked_joint_stress_tag']);
});

test('isExerciseCompatible prioritizes blocked exercise ids over other hard rules', () => {
  const result = isExerciseCompatible(
    {
      exerciseId: 'ex_overhead_press',
      movementPattern: 'overhead_press',
      jointStressTags: ['overhead_shoulder_position'],
      equipmentNeeded: ['barbell'],
    },
    {
      equipment: {
        availableEquipment: ['dumbbells'],
      },
      movement: {
        blockedExerciseIds: ['ex_overhead_press'],
        blockedMovementPatterns: ['overhead_press'],
        blockedJointStressTags: ['overhead_shoulder_position'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['blocked_exercise_id']);
});

test('isExerciseCompatible rejects exercises when no required equipment is available', () => {
  const result = isExerciseCompatible(
    {
      equipmentNeeded: ['barbell'],
    },
    {
      equipment: {
        availableEquipment: ['dumbbells'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['missing_equipment']);
});

test('isExerciseCompatible rejects exercises when only some required equipment is available', () => {
  const result = isExerciseCompatible(
    {
      equipmentNeeded: ['dumbbells', 'bench'],
    },
    {
      equipment: {
        availableEquipment: ['dumbbells'],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['missing_equipment']);
});

test('isExerciseCompatible treats empty available equipment as bodyweight only', () => {
  const result = isExerciseCompatible(
    {
      equipmentNeeded: ['dumbbells'],
    },
    {
      equipment: {
        availableEquipment: [],
      },
    }
  );

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, ['missing_equipment']);
});

test('isExerciseCompatible normalizes legacy equipment aliases on both sides', () => {
  const result = isExerciseCompatible(
    {
      equipmentNeeded: ['selectorized_shoulder_press'],
    },
    {
      equipment: {
        availableEquipment: ['shoulder_press_machine'],
      },
    }
  );

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});

test('isExerciseCompatible treats bodyweight requirements as always available', () => {
  const result = isExerciseCompatible(
    {
      equipmentNeeded: ['bodyweight'],
    },
    {
      equipment: {
        availableEquipment: [],
      },
    }
  );

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});
