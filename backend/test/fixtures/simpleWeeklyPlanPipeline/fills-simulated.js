function range(minReps, maxReps, notes = null) {
  return {
    mode: 'repRange',
    minReps,
    maxReps,
    targetRir: 2,
    notes,
  };
}

function addExercise(fills, prefix, {
  exerciseId,
  setCount,
  target,
  tempo,
  restSeconds,
  notes = null,
}) {
  fills[`${prefix}.id`] = exerciseId;
  fills[`${prefix}.defaults`] = {
    tempo,
    restSeconds,
    targetRir: 2,
    targetRpe: null,
  };
  fills[`${prefix}.notes`] = notes;
  for (let setIndex = 1; setIndex <= setCount; setIndex += 1) {
    fills[`${prefix}.s${setIndex}`] = { ...target };
  }
}

function buildSimulatedFills() {
  const fills = {};

  addExercise(fills, 'w1.b1.e1', {
    exerciseId: 'exr_incline_barbell_bench_press',
    setCount: 5,
    target: range(6, 8),
    tempo: '3110',
    restSeconds: 180,
    notes: 'Keep the upper back fixed to the bench.',
  });
  addExercise(fills, 'w1.b2.e1', {
    exerciseId: 'exr_chest_supported_cable_row',
    setCount: 4,
    target: range(8, 10),
    tempo: '3111',
    restSeconds: 150,
  });
  addExercise(fills, 'w1.b3.e1', {
    exerciseId: 'exr_incline_dumbbell_press',
    setCount: 4,
    target: range(8, 12),
    tempo: '3010',
    restSeconds: 150,
  });
  addExercise(fills, 'w1.b4.e1', {
    exerciseId: 'exr_cable_rear_delt_fly',
    setCount: 4,
    target: range(12, 15),
    tempo: '2111',
    restSeconds: null,
  });
  addExercise(fills, 'w1.b4.e2', {
    exerciseId: 'exr_neutral_grip_lat_pulldown',
    setCount: 4,
    target: range(8, 12),
    tempo: '3011',
    restSeconds: null,
  });
  fills['w1.b4.rest'] = 90;
  addExercise(fills, 'w1.b5.e1', {
    exerciseId: 'exr_cable_lateral_raise',
    setCount: 3,
    target: range(12, 15, 'per side'),
    tempo: '2111',
    restSeconds: null,
  });
  addExercise(fills, 'w1.b5.e2', {
    exerciseId: 'exr_incline_cable_fly',
    setCount: 3,
    target: range(10, 15),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w1.b5.rest'] = 75;
  addExercise(fills, 'w1.b6.e1', {
    exerciseId: 'exr_cable_overhead_triceps_extension',
    setCount: 3,
    target: range(10, 15),
    tempo: '2111',
    restSeconds: null,
  });
  addExercise(fills, 'w1.b6.e2', {
    exerciseId: 'exr_bayesian_cable_curl',
    setCount: 3,
    target: range(10, 15, 'per side'),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w1.b6.rest'] = 75;
  addExercise(fills, 'w1.b7.e1', {
    exerciseId: 'exr_barbell_standing_calf_raise',
    setCount: 4,
    target: range(8, 12),
    tempo: '2111',
    restSeconds: 90,
  });

  addExercise(fills, 'w2.b1.e1', {
    exerciseId: 'exr_romanian_deadlift',
    setCount: 4,
    target: range(6, 8),
    tempo: '3110',
    restSeconds: 180,
    notes: 'Maintain a controlled hinge.',
  });
  addExercise(fills, 'w2.b2.e1', {
    exerciseId: 'exr_barbell_hip_thrust',
    setCount: 4,
    target: range(8, 10),
    tempo: '2111',
    restSeconds: 150,
  });
  addExercise(fills, 'w2.b3.e1', {
    exerciseId: 'exr_incline_dumbbell_press',
    setCount: 4,
    target: range(10, 12),
    tempo: '3010',
    restSeconds: 150,
  });
  addExercise(fills, 'w2.b4.e1', {
    exerciseId: 'exr_close_neutral_grip_pulldown',
    setCount: 4,
    target: range(8, 12),
    tempo: '3011',
    restSeconds: null,
  });
  addExercise(fills, 'w2.b4.e2', {
    exerciseId: 'exr_single_arm_rear_delt_cable_fly',
    setCount: 4,
    target: range(12, 15, 'per side'),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w2.b4.rest'] = 90;
  addExercise(fills, 'w2.b5.e1', {
    exerciseId: 'exr_cable_glute_kickback',
    setCount: 3,
    target: range(12, 15, 'per side'),
    tempo: '2111',
    restSeconds: null,
  });
  addExercise(fills, 'w2.b5.e2', {
    exerciseId: 'exr_cable_hip_abduction',
    setCount: 3,
    target: range(15, 20, 'per side'),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w2.b5.rest'] = 75;
  addExercise(fills, 'w2.b6.e1', {
    exerciseId: 'exr_seated_dumbbell_calf_raise',
    setCount: 4,
    target: range(12, 15),
    tempo: '2111',
    restSeconds: 90,
  });
  addExercise(fills, 'w2.b7.e1', {
    exerciseId: 'exr_ab_wheel_rollout',
    setCount: 3,
    target: range(8, 12),
    tempo: '3111',
    restSeconds: 90,
    notes: 'Stop before lumbar extension.',
  });

  addExercise(fills, 'w3.b1.e1', {
    exerciseId: 'exr_incline_barbell_bench_press',
    setCount: 4,
    target: range(8, 10),
    tempo: '3110',
    restSeconds: 180,
  });
  addExercise(fills, 'w3.b2.e1', {
    exerciseId: 'exr_chin_up',
    setCount: 4,
    target: range(6, 10),
    tempo: '3011',
    restSeconds: 150,
  });
  addExercise(fills, 'w3.b3.e1', {
    exerciseId: 'exr_deficit_romanian_deadlift',
    setCount: 4,
    target: range(8, 10),
    tempo: '3110',
    restSeconds: 180,
  });
  addExercise(fills, 'w3.b4.e1', {
    exerciseId: 'exr_single_arm_landmine_press',
    setCount: 4,
    target: range(8, 12, 'per side'),
    tempo: '3010',
    restSeconds: 120,
  });
  addExercise(fills, 'w3.b5.e1', {
    exerciseId: 'exr_cable_high_row',
    setCount: 4,
    target: range(10, 12),
    tempo: '3011',
    restSeconds: null,
  });
  addExercise(fills, 'w3.b5.e2', {
    exerciseId: 'exr_chest_supported_rear_delt_fly',
    setCount: 4,
    target: range(12, 15),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w3.b5.rest'] = 90;
  addExercise(fills, 'w3.b6.e1', {
    exerciseId: 'exr_rope_triceps_pushdown',
    setCount: 3,
    target: range(10, 15),
    tempo: '2111',
    restSeconds: null,
  });
  addExercise(fills, 'w3.b6.e2', {
    exerciseId: 'exr_incline_dumbbell_curl',
    setCount: 3,
    target: range(10, 12),
    tempo: '2111',
    restSeconds: null,
  });
  fills['w3.b6.rest'] = 75;
  addExercise(fills, 'w3.b7.e1', {
    exerciseId: 'exr_single_leg_standing_calf_raise',
    setCount: 4,
    target: range(12, 15, 'per side'),
    tempo: '2111',
    restSeconds: 90,
  });

  return {
    schemaVersion: 1,
    geometryHash: '$SKELETON_GEOMETRY_HASH',
    fills,
  };
}

module.exports = {
  buildSimulatedFills,
};
