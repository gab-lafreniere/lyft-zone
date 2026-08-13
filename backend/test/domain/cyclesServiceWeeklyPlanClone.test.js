const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../services/cyclesService');

function createSetTemplate(
  id,
  weeklyPlanBlockExerciseId,
  setIndex,
  targetReps,
  exerciseId
) {
  return {
    id,
    weeklyPlanBlockExerciseId,
    setIndex,
    setType: 'WORKING',
    targetReps,
    minReps: null,
    maxReps: null,
    targetSeconds: null,
    targetRir: 2,
    targetRpe: null,
    tempo: '3-1-1-0',
    restSeconds: 90,
    notes: `${exerciseId} set ${setIndex}`,
  };
}

function createStrengthExercise(id, weeklyPlanWorkoutBlockId, exerciseId, orderIndex) {
  return {
    id,
    weeklyPlanWorkoutBlockId,
    exerciseId,
    exerciseName: exerciseId,
    bodyParts: ['chest'],
    muscleFocus: ['chest'],
    orderIndex,
    executionNotes: `${exerciseId} execution`,
    defaultTempo: '3-1-1-0',
    defaultRestSeconds: 90,
    defaultTargetRir: 2,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: null,
    notes: `${exerciseId} notes`,
    setTemplates: [
      createSetTemplate(`${id}_set_1`, id, 1, 10, exerciseId),
      createSetTemplate(`${id}_set_2`, id, 2, 12, exerciseId),
    ],
  };
}

function createCardioExercise(id, weeklyPlanWorkoutBlockId, exerciseId) {
  return {
    id,
    weeklyPlanWorkoutBlockId,
    exerciseId,
    exerciseName: exerciseId,
    bodyParts: [],
    muscleFocus: [],
    orderIndex: 1,
    executionNotes: null,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: {
      durationMinutes: 5,
      intensityLabel: 'easy',
    },
    notes: null,
    setTemplates: [],
  };
}

function createSourceWorkout(workoutNumber) {
  const workoutId = `source_workout_${workoutNumber}`;
  const blockId = (suffix) => `${workoutId}_block_${suffix}`;
  const exerciseId = (suffix) => `${workoutId}_exercise_${suffix}`;
  const blocks = [
    {
      id: blockId('cardio_start'),
      weeklyPlanWorkoutId: workoutId,
      orderIndex: 1,
      blockType: 'CARDIO',
      label: 'Warm-up cardio',
      roundCount: null,
      restStrategy: 'NONE',
      restSeconds: null,
      notes: null,
      exercises: [
        createCardioExercise(
          exerciseId('cardio_start'),
          blockId('cardio_start'),
          `cardio_start_${workoutNumber}`
        ),
      ],
    },
    {
      id: blockId('single'),
      weeklyPlanWorkoutId: workoutId,
      orderIndex: 2,
      blockType: 'SINGLE',
      label: 'Single',
      roundCount: 2,
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 90,
      notes: null,
      exercises: [
        createStrengthExercise(
          exerciseId('single'),
          blockId('single'),
          `single_${workoutNumber}`,
          1
        ),
      ],
    },
    {
      id: blockId('superset'),
      weeklyPlanWorkoutId: workoutId,
      orderIndex: 3,
      blockType: 'SUPERSET',
      label: 'Superset',
      roundCount: 2,
      restStrategy: 'AFTER_ROUND',
      restSeconds: 90,
      notes: null,
      exercises: [
        createStrengthExercise(
          exerciseId('superset_a'),
          blockId('superset'),
          `superset_${workoutNumber}_a`,
          1
        ),
        createStrengthExercise(
          exerciseId('superset_b'),
          blockId('superset'),
          `superset_${workoutNumber}_b`,
          2
        ),
      ],
    },
    {
      id: blockId('cardio_end'),
      weeklyPlanWorkoutId: workoutId,
      orderIndex: 4,
      blockType: 'CARDIO',
      label: 'Post-workout cardio',
      roundCount: null,
      restStrategy: 'NONE',
      restSeconds: null,
      notes: null,
      exercises: [
        createCardioExercise(
          exerciseId('cardio_end'),
          blockId('cardio_end'),
          `cardio_end_${workoutNumber}`
        ),
      ],
    },
  ];

  return {
    id: workoutId,
    weeklyPlanVersionId: 'source_version',
    name: `Workout ${workoutNumber}`,
    orderIndex: workoutNumber,
    estimatedDurationMinutes: 90,
    notes: `Workout ${workoutNumber} notes`,
    blocks,
  };
}

function createSourceVersion() {
  return {
    id: 'source_version',
    weeklyPlanParentId: 'source_parent',
    name: 'Complex source plan',
    workouts: [createSourceWorkout(1), createSourceWorkout(2)],
  };
}

function collectSourceEntityIds(version) {
  const ids = new Set([version.id, version.weeklyPlanParentId]);
  version.workouts.forEach((workout) => {
    ids.add(workout.id);
    workout.blocks.forEach((block) => {
      ids.add(block.id);
      block.exercises.forEach((exercise) => {
        ids.add(exercise.id);
        exercise.setTemplates.forEach((setTemplate) => ids.add(setTemplate.id));
      });
    });
  });
  return ids;
}

function createCloneHarness(sourceEntityIds) {
  const state = {
    weeks: [],
    workouts: [],
    blocks: [],
    exercises: [],
    setTemplates: [],
    counters: {
      week: 0,
      workout: 0,
      block: 0,
      exercise: 0,
    },
  };

  function assertNoSourceIdentity(data) {
    Object.values(data).forEach((value) => {
      assert.equal(sourceEntityIds.has(value), false, `source identity leaked: ${value}`);
    });
  }

  function buildPlanGraph(planId) {
    return {
      id: planId,
      weeks: state.weeks
        .filter((week) => week.planId === planId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((week) => ({
          ...week,
          workouts: state.workouts
            .filter((workout) => workout.planWeekId === week.id)
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((workout) => ({
              ...workout,
              blocks: state.blocks
                .filter((block) => block.workoutId === workout.id)
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((block) => ({
                  ...block,
                  blockExercises: state.exercises
                    .filter((exercise) => exercise.workoutBlockId === block.id)
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((exercise) => ({
                      ...exercise,
                      setTemplates: state.setTemplates
                        .filter((setTemplate) =>
                          setTemplate.blockExerciseId === exercise.id
                        )
                        .sort((a, b) => a.setIndex - b.setIndex),
                    })),
                })),
            })),
        })),
    };
  }

  const tx = {
    planWeek: {
      create: async ({ data }) => {
        assert.equal('workouts' in data, false);
        assertNoSourceIdentity(data);
        const row = { id: `cloned_week_${++state.counters.week}`, ...data };
        state.weeks.push(row);
        return row;
      },
    },
    workout: {
      createManyAndReturn: async ({ data }) => data.map((entry) => {
        assert.equal(state.weeks.some((week) => week.id === entry.planWeekId), true);
        assertNoSourceIdentity(entry);
        const row = { id: `cloned_workout_${++state.counters.workout}`, ...entry };
        state.workouts.push(row);
        return row;
      }),
    },
    workoutBlock: {
      createManyAndReturn: async ({ data }) => data.map((entry) => {
        assert.equal(
          state.workouts.some((workout) => workout.id === entry.workoutId),
          true
        );
        assertNoSourceIdentity(entry);
        const row = { id: `cloned_block_${++state.counters.block}`, ...entry };
        state.blocks.push(row);
        return row;
      }),
    },
    blockExercise: {
      createManyAndReturn: async ({ data }) => data.map((entry) => {
        assert.equal(
          state.blocks.some((block) => block.id === entry.workoutBlockId),
          true
        );
        assertNoSourceIdentity(entry);
        const row = { id: `cloned_exercise_${++state.counters.exercise}`, ...entry };
        state.exercises.push(row);
        return row;
      }),
    },
    exerciseSetTemplate: {
      createMany: async ({ data }) => {
        data.forEach((entry) => {
          assert.equal(
            state.exercises.some((exercise) => exercise.id === entry.blockExerciseId),
            true
          );
          assertNoSourceIdentity(entry);
          state.setTemplates.push({ ...entry });
        });
        return { count: data.length };
      },
    },
    plan: {
      findUnique: async ({ where }) => buildPlanGraph(where.id),
    },
  };

  return { state, tx };
}

test('complex Weekly Plan clones into six isolated weeks with explicit new parent IDs', async () => {
  const sourceVersion = createSourceVersion();
  const sourceEntityIds = collectSourceEntityIds(sourceVersion);
  const document = _test.buildDocumentFromWeeklyVersion(
    sourceVersion,
    6,
    new Map([[1, 'MONDAY'], [2, 'TUESDAY']])
  );
  const { state, tx } = createCloneHarness(sourceEntityIds);

  const clonedPlan = await _test.appendPlanWeeks(
    tx,
    'cloned_plan',
    document.weeks
  );

  assert.equal(clonedPlan.weeks.length, 6);
  assert.equal(state.workouts.length, 12);
  assert.equal(state.blocks.length, 48);
  assert.equal(state.exercises.length, 60);
  assert.equal(state.setTemplates.length, 72);

  const allCloneIds = [
    ...state.weeks.map((row) => row.id),
    ...state.workouts.map((row) => row.id),
    ...state.blocks.map((row) => row.id),
    ...state.exercises.map((row) => row.id),
  ];
  allCloneIds.forEach((id) => assert.equal(sourceEntityIds.has(id), false));
  assert.equal(new Set(allCloneIds).size, allCloneIds.length);

  clonedPlan.weeks.forEach((week) => {
    assert.deepEqual(
      week.workouts.map((workout) => workout.orderIndex),
      [1, 2]
    );

    const weekWorkoutIds = new Set(week.workouts.map((workout) => workout.id));
    const weekBlockIds = new Set(
      week.workouts.flatMap((workout) => workout.blocks.map((block) => block.id))
    );
    const weekExerciseIds = new Set(
      week.workouts.flatMap((workout) =>
        workout.blocks.flatMap((block) =>
          block.blockExercises.map((exercise) => exercise.id)
        )
      )
    );

    week.workouts.forEach((workout) => {
      assert.equal(workout.planWeekId, week.id);
      assert.deepEqual(
        workout.blocks.map((block) => block.blockType),
        ['CARDIO', 'SINGLE', 'SUPERSET', 'CARDIO']
      );
      workout.blocks.forEach((block) => {
        assert.equal(weekWorkoutIds.has(block.workoutId), true);
        const expectedExerciseCount = block.blockType === 'SUPERSET' ? 2 : 1;
        assert.equal(block.blockExercises.length, expectedExerciseCount);
        block.blockExercises.forEach((exercise) => {
          assert.equal(exercise.workoutBlockId, block.id);
          assert.equal(weekBlockIds.has(exercise.workoutBlockId), true);
          assert.equal(weekExerciseIds.has(exercise.id), true);
          exercise.setTemplates.forEach((setTemplate) => {
            assert.equal(setTemplate.blockExerciseId, exercise.id);
          });
        });
      });
    });

    const supersets = week.workouts.flatMap((workout) =>
      workout.blocks.filter((block) => block.blockType === 'SUPERSET')
    );
    assert.equal(supersets.length, 2);
    supersets.forEach((superset) => {
      assert.deepEqual(
        superset.blockExercises.map((exercise) => exercise.orderIndex),
        [1, 2]
      );
      assert.equal(
        superset.blockExercises.every(
          (exercise) => exercise.workoutBlockId === superset.id
        ),
        true
      );
    });

    const strengthExercises = week.workouts.flatMap((workout) =>
      workout.blocks.flatMap((block) => block.blockExercises)
    ).filter((exercise) => exercise.setTemplates.length > 0);
    strengthExercises.forEach((exercise) => {
      assert.deepEqual(
        exercise.setTemplates.map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          targetReps: setTemplate.targetReps,
          tempo: setTemplate.tempo,
          restSeconds: setTemplate.restSeconds,
          notes: setTemplate.notes,
        })),
        [
          {
            setIndex: 1,
            targetReps: 10,
            tempo: '3-1-1-0',
            restSeconds: 90,
            notes: `${exercise.exerciseId} set 1`,
          },
          {
            setIndex: 2,
            targetReps: 12,
            tempo: '3-1-1-0',
            restSeconds: 90,
            notes: `${exercise.exerciseId} set 2`,
          },
        ]
      );
    });
  });

  for (let left = 0; left < clonedPlan.weeks.length; left += 1) {
    const leftIds = new Set(
      clonedPlan.weeks[left].workouts.flatMap((workout) => [
        workout.id,
        ...workout.blocks.flatMap((block) => [
          block.id,
          ...block.blockExercises.map((exercise) => exercise.id),
        ]),
      ])
    );
    for (let right = left + 1; right < clonedPlan.weeks.length; right += 1) {
      const rightIds = clonedPlan.weeks[right].workouts.flatMap((workout) => [
        workout.id,
        ...workout.blocks.flatMap((block) => [
          block.id,
          ...block.blockExercises.map((exercise) => exercise.id),
        ]),
      ]);
      assert.equal(rightIds.some((id) => leftIds.has(id)), false);
    }
  }
});
