const test = require('node:test');
const assert = require('node:assert/strict');

let prisma;

const prismaPath = require.resolve('../../lib/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { getPrisma: () => prisma },
};

const {
  updateWeeklyPlanWorkoutContent,
} = require('../../services/weeklyPlansService');

const USER_ID = 'weekly_workout_user';
const PARENT_ID = 'weekly_workout_parent';
const VERSION_ID = 'weekly_workout_version';
const WORKOUT_ID = 'weekly_workout_1';
const EXERCISE_ID = 'ex_bench_press_test';

function buildStoredWorkout(overrides = {}) {
  return {
    id: WORKOUT_ID,
    weeklyPlanVersionId: VERSION_ID,
    name: 'Workout One',
    orderIndex: 1,
    estimatedDurationMinutes: 55,
    notes: null,
    contentRevision: 4,
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
    blocks: [{
      id: 'weekly_block_1',
      weeklyPlanWorkoutId: WORKOUT_ID,
      orderIndex: 1,
      blockType: 'SINGLE',
      label: null,
      roundCount: null,
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 90,
      notes: null,
      exercises: [{
        id: 'weekly_exercise_1',
        weeklyPlanWorkoutBlockId: 'weekly_block_1',
        exerciseId: EXERCISE_ID,
        exerciseName: 'Bench Press',
        bodyParts: ['chest'],
        muscleFocus: ['pectorals'],
        orderIndex: 1,
        executionNotes: null,
        defaultTempo: '3010',
        defaultRestSeconds: 90,
        defaultTargetRir: 2,
        defaultTargetRpe: null,
        intensificationMethod: 'NONE',
        cardioPrescription: null,
        notes: null,
        exercise: {
          exerciseId: EXERCISE_ID,
          name: 'Bench Press',
          bodyParts: ['chest'],
          muscleFocus: ['pectorals'],
          trainingType: 'STRENGTH',
          cardioModality: null,
        },
        setTemplates: [{
          id: 'weekly_set_1',
          weeklyPlanBlockExerciseId: 'weekly_exercise_1',
          setIndex: 1,
          setType: 'WORKING',
          targetReps: 8,
          minReps: 8,
          maxReps: 8,
          targetSeconds: null,
          targetRir: 2,
          targetRpe: null,
          tempo: '3010',
          restSeconds: 90,
          notes: null,
        }],
      }],
    }],
    ...overrides,
  };
}

function toApiWorkout(workout, overrides = {}) {
  return {
    id: workout.id,
    name: workout.name,
    orderIndex: workout.orderIndex,
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
      exercises: block.exercises.map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        bodyParts: exercise.bodyParts,
        muscleFocus: exercise.muscleFocus,
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes,
        defaultTempo: exercise.defaultTempo,
        defaultRestSeconds: exercise.defaultRestSeconds,
        defaultTargetRir: exercise.defaultTargetRir,
        defaultTargetRpe: exercise.defaultTargetRpe,
        intensificationMethod: exercise.intensificationMethod,
        cardioPrescription: exercise.cardioPrescription,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((set) => ({ ...set })),
      })),
    })),
    ...overrides,
  };
}

function payload(workout, overrides = {}) {
  return {
    userId: USER_ID,
    contentRevision: workout.contentRevision,
    workout: toApiWorkout(workout),
    ...overrides,
  };
}

function createHarness(options = {}) {
  const calls = [];
  const storedWorkout = buildStoredWorkout(options.workoutOverrides);
  let versionRevision = options.versionRevision || 10;
  let targetLookupCount = 0;
  const record = (model, operation, args = {}) => {
    calls.push({ model, operation, ...args });
  };

  const tx = {
    weeklyPlanParent: {
      findFirst: async (args) => {
        record('weeklyPlanParent', 'findFirst', args);
        if (options.parentFound === false) return null;
        return {
          id: PARENT_ID,
          latestDraftVersionId:
            options.latestDraftVersionId || VERSION_ID,
        };
      },
    },
    weeklyPlanVersion: {
      findFirst: async (args) => {
        record('weeklyPlanVersion', 'findFirst', args);
        return options.versionFound === false
          ? null
          : { id: VERSION_ID, status: 'DRAFT' };
      },
      update: async ({ where, data, select }) => {
        record('weeklyPlanVersion', 'update', { where, data, select });
        versionRevision += 1;
        return {
          revision: versionRevision,
          updatedAt: new Date('2026-08-18T12:00:00.000Z'),
        };
      },
    },
    weeklyPlanWorkout: {
      findFirst: async (args) => {
        record('weeklyPlanWorkout', 'findFirst', args);
        targetLookupCount += 1;
        if (options.workoutFound === false) return null;
        return storedWorkout;
      },
      findMany: async (args) => {
        record('weeklyPlanWorkout', 'findMany', args);
        return options.siblings || [{ id: 'weekly_workout_2', orderIndex: 2, name: 'Workout Two' }];
      },
      updateMany: async ({ where, data }) => {
        record('weeklyPlanWorkout', 'updateMany', { where, data });
        if (options.staleRevision || where.contentRevision !== storedWorkout.contentRevision) {
          return { count: 0 };
        }
        storedWorkout.name = data.name;
        storedWorkout.estimatedDurationMinutes = data.estimatedDurationMinutes;
        storedWorkout.notes = data.notes;
        storedWorkout.contentRevision += 1;
        storedWorkout.updatedAt = new Date('2026-08-18T12:00:00.000Z');
        return { count: 1 };
      },
      update: async (args) => {
        record('weeklyPlanWorkout', 'update', args);
        return storedWorkout;
      },
    },
    exercise: {
      findMany: async ({ where }) => {
        record('exercise', 'findMany', { where });
        if (options.unknownExercise) return [];
        return (where.exerciseId.in || []).map((exerciseId) => ({
          exerciseId,
          trainingType: 'STRENGTH',
          cardioModality: null,
        }));
      },
    },
    weeklyPlanWorkoutBlock: {
      deleteMany: async (args) => { record('weeklyPlanWorkoutBlock', 'deleteMany', args); return { count: 0 }; },
      updateMany: async (args) => { record('weeklyPlanWorkoutBlock', 'updateMany', args); return { count: 0 }; },
      update: async (args) => { record('weeklyPlanWorkoutBlock', 'update', args); return {}; },
      createManyAndReturn: async (args) => { record('weeklyPlanWorkoutBlock', 'createManyAndReturn', args); return []; },
    },
    weeklyPlanBlockExercise: {
      deleteMany: async (args) => { record('weeklyPlanBlockExercise', 'deleteMany', args); return { count: 0 }; },
      updateMany: async (args) => { record('weeklyPlanBlockExercise', 'updateMany', args); return { count: 0 }; },
      update: async (args) => { record('weeklyPlanBlockExercise', 'update', args); return {}; },
      createManyAndReturn: async (args) => { record('weeklyPlanBlockExercise', 'createManyAndReturn', args); return []; },
    },
    weeklyPlanExerciseSetTemplate: {
      deleteMany: async (args) => { record('weeklyPlanExerciseSetTemplate', 'deleteMany', args); return { count: 0 }; },
      updateMany: async (args) => { record('weeklyPlanExerciseSetTemplate', 'updateMany', args); return { count: 0 }; },
      update: async (args) => { record('weeklyPlanExerciseSetTemplate', 'update', args); return {}; },
      createMany: async (args) => { record('weeklyPlanExerciseSetTemplate', 'createMany', args); return { count: 0 }; },
    },
  };

  prisma = {
    user: {
      findUnique: async () => options.userFound === false ? null : { id: USER_ID },
    },
    $transaction: async (operation) => operation(tx),
  };

  return {
    calls,
    storedWorkout,
    get targetLookupCount() { return targetLookupCount; },
    get versionRevision() { return versionRevision; },
  };
}

test('Weekly router registers the workout-scoped PATCH before the document PATCH', () => {
  const router = require('../../routes/weeklyPlans');
  const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
  const workoutPath = '/:weeklyPlanParentId/drafts/:versionId/workouts/:workoutId';
  assert.ok(paths.includes(workoutPath));
  assert.equal(
    router.stack.find((layer) => layer.route?.path === workoutPath).route.methods.patch,
    true
  );
  assert.ok(paths.indexOf(workoutPath) < paths.indexOf('/:weeklyPlanParentId/drafts/:versionId'));
});

test('successful save claims one workout, advances version late, and returns one compact workout', async () => {
  const harness = createHarness();
  const request = payload(harness.storedWorkout, {
    workout: toApiWorkout(harness.storedWorkout, { name: 'Updated Workout' }),
  });

  const response = await updateWeeklyPlanWorkoutContent(
    PARENT_ID,
    VERSION_ID,
    WORKOUT_ID,
    request
  );

  assert.deepEqual(Object.keys(response), [
    'weeklyPlanParentId',
    'versionId',
    'workoutId',
    'contentRevision',
    'versionRevision',
    'workout',
    'updatedAt',
  ]);
  assert.equal(response.contentRevision, 5);
  assert.equal(response.versionRevision, 11);
  assert.equal(response.workout.id, WORKOUT_ID);
  assert.equal(response.workout.name, 'Updated Workout');
  assert.equal(response.workout.contentRevision, 5);
  assert.equal('builderPayload' in response, false);
  assert.equal(harness.targetLookupCount, 2);

  const workoutClaimIndex = harness.calls.findIndex(
    (call) => call.model === 'weeklyPlanWorkout' && call.operation === 'updateMany'
  );
  const versionTouchIndex = harness.calls.findIndex(
    (call) => call.model === 'weeklyPlanVersion' && call.operation === 'update'
  );
  assert.ok(workoutClaimIndex >= 0 && versionTouchIndex > workoutClaimIndex);
  assert.deepEqual(harness.calls[workoutClaimIndex].where, {
    id: WORKOUT_ID,
    weeklyPlanVersionId: VERSION_ID,
    contentRevision: 4,
  });
  assert.equal(
    harness.calls.some((call) => call.model === 'scheduledSession'),
    false
  );
});

test('contentRevision is required and must be a positive database integer', async () => {
  for (const value of [undefined, null, 0, -1, 1.5, '4', Number.NaN, 2147483648]) {
    const harness = createHarness();
    await assert.rejects(
      () => updateWeeklyPlanWorkoutContent(
        PARENT_ID,
        VERSION_ID,
        WORKOUT_ID,
        payload(harness.storedWorkout, { contentRevision: value })
      ),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(harness.calls.length, 0);
  }
});

test('malformed workout trees are rejected before the workout CAS', async () => {
  const malformedWorkouts = [
    null,
    [],
    'not-an-object',
    { id: WORKOUT_ID, name: 'Malformed', orderIndex: 1, blocks: 'not-an-array' },
    {
      id: WORKOUT_ID,
      name: 'Malformed',
      orderIndex: 1,
      blocks: [{ orderIndex: 1, blockType: 'UNKNOWN', exercises: [] }],
    },
  ];

  for (const workout of malformedWorkouts) {
    const harness = createHarness();
    await assert.rejects(
      () => updateWeeklyPlanWorkoutContent(
        PARENT_ID,
        VERSION_ID,
        WORKOUT_ID,
        payload(harness.storedWorkout, { workout })
      ),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(
      harness.calls.some((call) => call.model === 'weeklyPlanWorkout' && call.operation === 'updateMany'),
      false
    );
  }
});

test('route workoutId is authoritative and Weekly structural fields cannot change', async () => {
  const invalidPayloads = [
    { workout: { id: 'other_workout' } },
    { workout: { orderIndex: 2 } },
    { workout: { weeklyPlanVersionId: 'other_version' } },
    { workout: { scheduledDay: 'MONDAY' } },
    { workout: { planWeekId: 'cycle_week' } },
    { topLevel: { revision: 10 } },
    { topLevel: { timezone: 'UTC' } },
    { topLevel: { allowCrossDayDraft: true } },
    { topLevel: { planRevision: 10 } },
  ];

  for (const invalid of invalidPayloads) {
    const harness = createHarness();
    const request = payload(harness.storedWorkout, invalid.topLevel || {});
    request.workout = {
      ...request.workout,
      ...(invalid.workout || {}),
    };
    await assert.rejects(
      () => updateWeeklyPlanWorkoutContent(PARENT_ID, VERSION_ID, WORKOUT_ID, request),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(
      harness.calls.some((call) => call.model === 'weeklyPlanWorkout' && call.operation === 'updateMany'),
      false
    );
  }
});

test('ownership, current draft, draft status, workout scope, and exercises are validated before CAS', async () => {
  const cases = [
    [{ parentFound: false }, PARENT_ID, VERSION_ID, WORKOUT_ID, 404],
    [{ latestDraftVersionId: 'other_version' }, PARENT_ID, VERSION_ID, WORKOUT_ID, 400],
    [{ versionFound: false }, PARENT_ID, VERSION_ID, WORKOUT_ID, 404],
    [{ workoutFound: false }, PARENT_ID, VERSION_ID, WORKOUT_ID, 404],
    [{ unknownExercise: true }, PARENT_ID, VERSION_ID, WORKOUT_ID, 400],
  ];

  for (const [options, parentId, versionId, workoutId, status] of cases) {
    const harness = createHarness(options);
    await assert.rejects(
      () => updateWeeklyPlanWorkoutContent(
        parentId,
        versionId,
        workoutId,
        payload(harness.storedWorkout)
      ),
      (error) => error.status === status
    );
    assert.equal(
      harness.calls.some((call) => call.model === 'weeklyPlanWorkout' && call.operation === 'updateMany'),
      false
    );
  }
});

test('duplicate sibling workout names are rejected before CAS', async () => {
  const harness = createHarness({
    siblings: [{ id: 'weekly_workout_2', orderIndex: 2, name: 'Duplicate' }],
  });
  await assert.rejects(
    () => updateWeeklyPlanWorkoutContent(
      PARENT_ID,
      VERSION_ID,
      WORKOUT_ID,
      payload(harness.storedWorkout, {
        workout: toApiWorkout(harness.storedWorkout, { name: ' duplicate ' }),
      })
    ),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
  );
  assert.equal(
    harness.calls.some((call) => call.model === 'weeklyPlanWorkout' && call.operation === 'updateMany'),
    false
  );
});

test('stale workout CAS returns typed 409 without version or tree mutation', async () => {
  const harness = createHarness({ staleRevision: true });

  await assert.rejects(
    () => updateWeeklyPlanWorkoutContent(
      PARENT_ID,
      VERSION_ID,
      WORKOUT_ID,
      payload(harness.storedWorkout)
    ),
    (error) => error.status === 409 && error.code === 'WORKOUT_REVISION_CONFLICT'
  );

  assert.equal(harness.versionRevision, 10);
  assert.equal(harness.storedWorkout.contentRevision, 4);
  assert.equal(
    harness.calls.some((call) => [
      'weeklyPlanWorkoutBlock',
      'weeklyPlanBlockExercise',
      'weeklyPlanExerciseSetTemplate',
    ].includes(call.model)),
    false
  );
});

test('an arbitrarily old Weekly draft still saves and has no expiry response or lifecycle', async () => {
  const harness = createHarness({
    workoutOverrides: { updatedAt: new Date('2020-01-01T00:00:00.000Z') },
  });
  const response = await updateWeeklyPlanWorkoutContent(
    PARENT_ID,
    VERSION_ID,
    WORKOUT_ID,
    payload(harness.storedWorkout)
  );

  assert.equal(response.contentRevision, 5);
  assert.equal('draftState' in response, false);
  assert.equal('timezone' in response, false);
  assert.equal(
    harness.calls.some((call) => call.operation === 'delete'),
    false
  );
});

test('a seven-workout fixture still loads only one nested tree and never rewrites siblings', async () => {
  const siblings = Array.from({ length: 6 }, (_, index) => ({
    id: `weekly_sibling_${index + 2}`,
    orderIndex: index + 2,
    name: `Workout ${index + 2}`,
  }));
  const harness = createHarness({ siblings });

  const response = await updateWeeklyPlanWorkoutContent(
    PARENT_ID,
    VERSION_ID,
    WORKOUT_ID,
    payload(harness.storedWorkout, {
      workout: toApiWorkout(harness.storedWorkout, { name: 'Scoped Target' }),
    })
  );

  assert.equal(response.workout.id, WORKOUT_ID);
  assert.equal(harness.targetLookupCount, 2);
  const siblingLookup = harness.calls.find(
    (call) => call.model === 'weeklyPlanWorkout' && call.operation === 'findMany'
  );
  assert.deepEqual(siblingLookup.select, { id: true, orderIndex: true, name: true });
  assert.equal(
    harness.calls.some((call) =>
      call.model === 'weeklyPlanWorkout' && ['create', 'deleteMany'].includes(call.operation)
    ),
    false
  );
  assert.equal('builderPayload' in response, false);
});
