const test = require('node:test');
const assert = require('node:assert/strict');

let prisma;

const prismaPath = require.resolve('../../lib/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    getPrisma: () => prisma,
  },
};

const cycleDateUtilsPath = require.resolve('../../services/cycleDateUtils');
const cycleDateUtils = require(cycleDateUtilsPath);
require.cache[cycleDateUtilsPath] = {
  id: cycleDateUtilsPath,
  filename: cycleDateUtilsPath,
  loaded: true,
  exports: {
    ...cycleDateUtils,
    getTodayDateKey: () => '2026-07-21',
  },
};

const {
  stableStringify,
  updateCycleDraft,
} = require('../../services/cyclesService');

const USER_ID = 'user_active_cycle';
const CYCLE_ID = 'cycle_active_2026';
const PLAN_ID = 'draft_active_2026';
const TIMEZONE = 'America/Toronto';
const PAST_WORKOUT_MESSAGE = 'Past workouts cannot be modified on an active cycle';

function createSetTemplate(id, setIndex, targetReps = 8) {
  return {
    id,
    setIndex,
    setType: 'WORKING',
    targetReps,
    minReps: targetReps,
    maxReps: targetReps,
    targetSeconds: null,
    targetRir: 2,
    targetRpe: null,
    tempo: '3010',
    restSeconds: 120,
    notes: null,
  };
}

function createPersistedStrengthExercise(id, exerciseId = 'ex_strength_a', orderIndex = 1) {
  return {
    id,
    exerciseId,
    orderIndex,
    executionNotes: null,
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: null,
    notes: null,
    setTemplates: [
      createSetTemplate(`${id}_set_1`, 1),
      createSetTemplate(`${id}_set_2`, 2),
    ],
    exercise: {
      exerciseId,
      name: exerciseId === 'ex_strength_b' ? 'Strength B' : 'Strength A',
      equipmentCategory: 'free_weight',
      bodyParts: ['chest'],
      targetMuscles: ['pectoralis_major'],
      trainingType: 'strength',
      cardioModality: null,
    },
  };
}

function createPersistedCardioPrescription() {
  return {
    notes: null,
    durationMinutes: 20,
    machineSettings: [
      { value: '5', key: 'incline' },
      { value: '3', key: 'speed' },
    ],
    heartRateTargetMode: 'zone',
    heartRateTargetValue: 2,
  };
}

function createPersistedCardioExercise(id) {
  return {
    id,
    exerciseId: 'ex_cardio',
    orderIndex: 1,
    executionNotes: null,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: createPersistedCardioPrescription(),
    notes: null,
    setTemplates: [],
    exercise: {
      exerciseId: 'ex_cardio',
      name: 'Incline Treadmill',
      equipmentCategory: 'machine',
      bodyParts: [],
      targetMuscles: [],
      trainingType: 'cardio',
      cardioModality: 'treadmill_walk',
    },
  };
}

function createPersistedWorkout(weekNumber, orderIndex) {
  const workoutId = `workout_w${weekNumber}_o${orderIndex}`;
  const blocks = [
    {
      id: `${workoutId}_block_1`,
      orderIndex: 1,
      blockType: 'SINGLE',
      label: null,
      roundCount: null,
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 120,
      notes: null,
      blockExercises: [createPersistedStrengthExercise(`${workoutId}_exercise_1`)],
    },
  ];

  if (weekNumber === 1 && orderIndex === 1) {
    blocks.push({
      id: `${workoutId}_block_2`,
      orderIndex: 2,
      blockType: 'CARDIO',
      label: null,
      roundCount: null,
      restStrategy: 'NONE',
      restSeconds: null,
      notes: null,
      blockExercises: [createPersistedCardioExercise(`${workoutId}_cardio_1`)],
    });
  }

  return {
    id: workoutId,
    name: `Workout W${weekNumber} O${orderIndex}`,
    orderIndex,
    scheduledDay: orderIndex === 1 ? 'MONDAY' : 'WEDNESDAY',
    estimatedDurationMinutes: 60,
    notes: null,
    blocks,
  };
}

function createPersistedDraft() {
  return {
    id: PLAN_ID,
    trainingCycleId: CYCLE_ID,
    parentPlanId: 'published_active_2026',
    name: 'Active Six Week Draft',
    versionNumber: 4,
    sourceType: 'USER',
    status: 'DRAFT',
    startDate: new Date('2026-07-13T00:00:00.000Z'),
    endDate: new Date('2026-08-23T00:00:00.000Z'),
    durationWeeks: 6,
    createdAt: new Date('2026-07-21T12:00:00.000Z'),
    updatedAt: new Date('2026-07-21T12:00:00.000Z'),
    publishedAt: null,
    weeks: Array.from({ length: 6 }, (_, index) => {
      const weekNumber = index + 1;
      return {
        id: `week_${weekNumber}`,
        weekNumber,
        orderIndex: weekNumber,
        label: `Week ${weekNumber}`,
        notes: null,
        workouts: [
          createPersistedWorkout(weekNumber, 1),
          createPersistedWorkout(weekNumber, 2),
        ],
      };
    }),
  };
}

function mapPersistedCardioPrescriptionToIncoming(value) {
  return {
    durationMinutes: value.durationMinutes,
    heartRateTargetMode: value.heartRateTargetMode,
    heartRateTargetValue: value.heartRateTargetValue,
    machineSettings: value.machineSettings.map((setting) => ({
      key: setting.key,
      value: setting.value,
    })),
    notes: value.notes,
  };
}

function mapPersistedExerciseToIncoming(exercise) {
  return {
    id: exercise.id,
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exercise.name,
    bodyParts: exercise.exercise.bodyParts,
    muscleFocus: exercise.exercise.targetMuscles,
    orderIndex: exercise.orderIndex,
    executionNotes: exercise.executionNotes,
    defaultTempo: exercise.defaultTempo,
    defaultRestSeconds: exercise.defaultRestSeconds,
    defaultTargetRir: exercise.defaultTargetRir,
    defaultTargetRpe: exercise.defaultTargetRpe,
    intensificationMethod: exercise.intensificationMethod,
    cardioPrescription: exercise.cardioPrescription
      ? mapPersistedCardioPrescriptionToIncoming(exercise.cardioPrescription)
      : null,
    notes: exercise.notes,
    setTemplates: exercise.setTemplates.map((setTemplate) => ({ ...setTemplate })),
  };
}

function mapPersistedDraftToPayload(draft) {
  return {
    userId: USER_ID,
    timezone: TIMEZONE,
    allowCrossDayDraft: true,
    name: draft.name,
    weeks: draft.weeks.map((week) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      orderIndex: week.orderIndex,
      label: week.label,
      notes: week.notes,
      workouts: week.workouts.map((workout) => ({
        id: workout.id,
        name: workout.name,
        orderIndex: workout.orderIndex,
        scheduledDay: workout.scheduledDay,
        estimatedDurationMinutes: workout.estimatedDurationMinutes,
        notes: workout.notes,
        blocks: workout.blocks.map((block) => ({
          id: block.id,
          orderIndex: block.orderIndex,
          blockType: block.blockType,
          label: block.label,
          roundCount: block.roundCount,
          restStrategy: block.restStrategy,
          restSeconds: block.restSeconds,
          notes: block.notes,
          exercises: block.blockExercises.map(mapPersistedExerciseToIncoming),
        })),
      })),
    })),
  };
}

function createIncomingStrengthExercise(exerciseId = 'ex_strength_b') {
  return {
    exerciseId,
    exerciseName: exerciseId === 'ex_strength_b' ? 'Strength B' : 'Strength A',
    bodyParts: ['chest'],
    muscleFocus: ['pectoralis_major'],
    orderIndex: 1,
    executionNotes: null,
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: null,
    notes: null,
    setTemplates: [
      { ...createSetTemplate(undefined, 1), id: undefined },
      { ...createSetTemplate(undefined, 2), id: undefined },
    ],
  };
}

function createIncomingStrengthBlock(orderIndex) {
  return {
    orderIndex,
    blockType: 'SINGLE',
    label: null,
    roundCount: null,
    restStrategy: 'AFTER_EXERCISE',
    restSeconds: 120,
    notes: null,
    exercises: [createIncomingStrengthExercise()],
  };
}

function findWorkout(payload, weekNumber, workoutOrderIndex) {
  return payload.weeks
    .find((week) => week.weekNumber === weekNumber)
    .workouts.find((workout) => workout.orderIndex === workoutOrderIndex);
}

function createPrismaMock(draft) {
  const calls = {
    transactionCount: 0,
    writeOperations: [],
  };
  const cycle = {
    id: CYCLE_ID,
    name: 'Active Cycle',
    startDate: new Date('2026-07-13T00:00:00.000Z'),
    endDate: new Date('2026-08-23T00:00:00.000Z'),
    durationWeeks: 6,
    timezone: TIMEZONE,
  };
  const recordWrite = (operation) => async (args) => {
    calls.writeOperations.push({ operation, args });
    return {};
  };
  const tx = {
    trainingCycle: {
      findFirst: async () => cycle,
    },
    plan: {
      findMany: async () => [draft],
      findUnique: async () => draft,
      update: recordWrite('plan.update'),
      delete: recordWrite('plan.delete'),
      deleteMany: recordWrite('plan.deleteMany'),
    },
    planWeek: {
      create: recordWrite('planWeek.create'),
      update: recordWrite('planWeek.update'),
      delete: recordWrite('planWeek.delete'),
    },
    workout: {
      create: recordWrite('workout.create'),
      update: recordWrite('workout.update'),
      deleteMany: recordWrite('workout.deleteMany'),
    },
    workoutBlock: {
      deleteMany: recordWrite('workoutBlock.deleteMany'),
    },
    scheduledSession: {
      findFirst: async () => null,
    },
  };

  return {
    calls,
    prisma: {
      user: {
        findUnique: async () => ({
          id: USER_ID,
          profile: { trainingMode: 'FIXED' },
        }),
      },
      exercise: {
        findMany: async ({ where }) => where.exerciseId.in.map((exerciseId) => ({
          exerciseId,
          trainingType: exerciseId === 'ex_cardio' ? 'cardio' : 'strength',
          cardioModality: exerciseId === 'ex_cardio' ? 'treadmill_walk' : null,
        })),
      },
      $transaction: async (callback) => {
        calls.transactionCount += 1;
        return callback(tx);
      },
    },
  };
}

function createScenario() {
  const draft = createPersistedDraft();
  const payload = mapPersistedDraftToPayload(draft);
  const mock = createPrismaMock(draft);
  prisma = mock.prisma;
  return { draft, payload, mock };
}

async function assertPastMutationRejected(mutatePayload) {
  const scenario = createScenario();
  mutatePayload(scenario.payload);

  await assert.rejects(
    () => updateCycleDraft(CYCLE_ID, PLAN_ID, scenario.payload),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.message, PAST_WORKOUT_MESSAGE);
      return true;
    }
  );

  assert.equal(scenario.mock.calls.transactionCount, 1);
  assert.deepEqual(scenario.mock.calls.writeOperations, []);
}

test('stableStringify ignores plain-object key order recursively without normalizing values', () => {
  assert.equal(
    stableStringify({ zeta: 1, alpha: 2 }),
    stableStringify({ alpha: 2, zeta: 1 })
  );
  assert.equal(
    stableStringify({ outer: { zeta: 1, alpha: { second: 2, first: 1 } } }),
    stableStringify({ outer: { alpha: { first: 1, second: 2 }, zeta: 1 } })
  );
  assert.notEqual(stableStringify({ value: null }), stableStringify({ value: '' }));
  assert.notEqual(stableStringify({}), stableStringify({ value: null }));
  assert.notEqual(stableStringify({ value: 2 }), stableStringify({ value: '2' }));
});

test('stableStringify preserves array order while ignoring key order inside array entries', () => {
  const cardioA = {
    notes: null,
    durationMinutes: 20,
    machineSettings: [{ value: '5', key: 'incline' }],
    heartRateTargetMode: 'zone',
    heartRateTargetValue: 2,
  };
  const cardioB = {
    durationMinutes: 20,
    heartRateTargetMode: 'zone',
    heartRateTargetValue: 2,
    machineSettings: [{ key: 'incline', value: '5' }],
    notes: null,
  };
  assert.equal(stableStringify(cardioA), stableStringify(cardioB));

  const settings = [
    { key: 'incline', value: '5' },
    { key: 'speed', value: '3' },
  ];
  assert.equal(
    stableStringify(settings),
    stableStringify([
      { value: '5', key: 'incline' },
      { value: '3', key: 'speed' },
    ])
  );
  assert.notEqual(stableStringify(settings), stableStringify(settings.slice().reverse()));

  const blocks = [{ blockType: 'SINGLE' }, { blockType: 'CARDIO' }];
  const exercises = [{ exerciseId: 'ex_strength_a' }, { exerciseId: 'ex_strength_b' }];
  const sets = [{ setIndex: 1, targetReps: 8 }, { setIndex: 2, targetReps: 10 }];
  assert.notEqual(stableStringify(blocks), stableStringify(blocks.slice().reverse()));
  assert.notEqual(stableStringify(exercises), stableStringify(exercises.slice().reverse()));
  assert.notEqual(stableStringify(sets), stableStringify(sets.slice().reverse()));
});

test('active six-week draft accepts a future-only W3/O1 addition when past cardio key order differs', async () => {
  const { payload, mock } = createScenario();
  const futureWorkout = findWorkout(payload, 3, 1);
  futureWorkout.blocks.push(createIncomingStrengthBlock(2));

  const result = await updateCycleDraft(CYCLE_ID, PLAN_ID, payload);

  assert.equal(cycleDateUtils.addDays('2026-07-13', (3 - 1) * 7), '2026-07-27');
  assert.equal(result.planId, PLAN_ID);
  assert.equal(result.temporalStatus, 'active');
  assert.equal(mock.calls.transactionCount, 1);
  assert.ok(mock.calls.writeOperations.length > 0);
  assert.ok(
    mock.calls.writeOperations.some(
      (call) =>
        call.operation === 'workoutBlock.deleteMany' &&
        call.args.where.workoutId === 'workout_w3_o1'
    )
  );
});

test('active six-week draft accepts future W3/O1 rep changes', async () => {
  const { payload, mock } = createScenario();
  findWorkout(payload, 3, 1).blocks[0].exercises[0].setTemplates[0].targetReps = 10;

  const result = await updateCycleDraft(CYCLE_ID, PLAN_ID, payload);

  assert.equal(result.planId, PLAN_ID);
  assert.ok(mock.calls.writeOperations.length > 0);
});

test('active draft still rejects past rep changes with the existing message', async () => {
  await assertPastMutationRejected((payload) => {
    findWorkout(payload, 1, 1).blocks[0].exercises[0].setTemplates[0].targetReps = 10;
  });
});

test('active draft still rejects replacing an exercise in a past workout', async () => {
  await assertPastMutationRejected((payload) => {
    const exercise = findWorkout(payload, 1, 1).blocks[0].exercises[0];
    exercise.exerciseId = 'ex_strength_b';
    exercise.exerciseName = 'Strength B';
  });
});

test('active draft still rejects adding a block to a past workout', async () => {
  await assertPastMutationRejected((payload) => {
    findWorkout(payload, 1, 1).blocks.push(createIncomingStrengthBlock(3));
  });
});

test('active draft still rejects removing a block from a past workout', async () => {
  await assertPastMutationRejected((payload) => {
    findWorkout(payload, 1, 1).blocks.pop();
  });
});

test('active draft still rejects a real past cardio duration change', async () => {
  await assertPastMutationRejected((payload) => {
    findWorkout(payload, 1, 1).blocks[1].exercises[0].cardioPrescription.durationMinutes = 25;
  });
});

test('active draft still rejects a real past heart-rate target change', async () => {
  await assertPastMutationRejected((payload) => {
    findWorkout(payload, 1, 1).blocks[1].exercises[0].cardioPrescription.heartRateTargetValue = 3;
  });
});

test('active draft treats machineSettings order as significant', async () => {
  await assertPastMutationRejected((payload) => {
    const prescription = findWorkout(payload, 1, 1).blocks[1].exercises[0].cardioPrescription;
    prescription.machineSettings.reverse();
  });
});
