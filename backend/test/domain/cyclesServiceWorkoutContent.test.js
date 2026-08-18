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

const { updateCycleWorkoutContent } = require('../../services/cyclesService');

const USER_ID = 'workout_scope_user';
const CYCLE_ID = 'workout_scope_cycle';
const PLAN_ID = 'workout_scope_plan';
const WEEK_ID = 'workout_scope_week';
const WORKOUT_ID = 'workout_scope_workout';
const EXERCISE_ID = 'ex_bench_press_test';
const NOW = new Date('2026-08-17T12:00:00.000Z');

function utcDate(dateKey, time = '12:00:00.000') {
  return new Date(`${dateKey}T${time}Z`);
}

function buildStoredWorkout(overrides = {}) {
  return {
    id: WORKOUT_ID,
    planWeekId: WEEK_ID,
    name: 'Original Workout',
    orderIndex: 1,
    scheduledDay: null,
    estimatedDurationMinutes: 55,
    notes: null,
    contentRevision: 4,
    createdAt: utcDate('2026-08-17'),
    updatedAt: utcDate('2026-08-17'),
    planWeek: {
      id: WEEK_ID,
      planId: PLAN_ID,
      weekNumber: 1,
    },
    blocks: [{
      id: 'block_1',
      workoutId: WORKOUT_ID,
      orderIndex: 1,
      blockType: 'SINGLE',
      label: null,
      roundCount: null,
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 90,
      notes: null,
      blockExercises: [{
        id: 'block_exercise_1',
        workoutBlockId: 'block_1',
        exerciseId: EXERCISE_ID,
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
          equipmentCategory: null,
          bodyParts: ['chest'],
          targetMuscles: ['pectorals'],
          trainingType: 'STRENGTH',
          cardioModality: null,
        },
        setTemplates: [{
          id: 'set_1',
          blockExerciseId: 'block_exercise_1',
          setIndex: 1,
          setType: 'WORKING',
          targetReps: 8,
          minReps: null,
          maxReps: null,
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

function toApiWorkout(storedWorkout, overrides = {}) {
  return {
    id: storedWorkout.id,
    planWeekId: storedWorkout.planWeekId,
    name: storedWorkout.name,
    orderIndex: storedWorkout.orderIndex,
    scheduledDay: storedWorkout.scheduledDay,
    estimatedDurationMinutes: storedWorkout.estimatedDurationMinutes,
    notes: storedWorkout.notes,
    blocks: storedWorkout.blocks.map((block) => ({
      id: block.id,
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label,
      roundCount: block.roundCount,
      restStrategy: block.restStrategy,
      restSeconds: block.restSeconds,
      notes: block.notes,
      exercises: block.blockExercises.map((exercise) => ({
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
        cardioPrescription: exercise.cardioPrescription,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((setTemplate) => ({ ...setTemplate })),
      })),
    })),
    ...overrides,
  };
}

function buildPayload(storedWorkout, overrides = {}) {
  return {
    userId: USER_ID,
    timezone: 'UTC',
    contentRevision: storedWorkout.contentRevision,
    workout: toApiWorkout(storedWorkout),
    ...overrides,
  };
}

function createHarness(options = {}) {
  const calls = [];
  const storedWorkout = buildStoredWorkout(options.workoutOverrides);
  const draftPlan = {
    id: PLAN_ID,
    trainingCycleId: CYCLE_ID,
    status: 'DRAFT',
    revision: options.planRevision ?? 10,
    updatedAt: options.draftUpdatedAt || utcDate('2026-08-17'),
  };
  const cycle = {
    id: CYCLE_ID,
    name: 'Scoped Cycle',
    startDate: options.cycleStartDate || utcDate('2026-08-17', '00:00:00.000'),
    endDate: options.cycleEndDate || utcDate('2026-08-23', '00:00:00.000'),
    durationWeeks: 1,
    timezone: 'UTC',
  };
  let planTouchCount = 0;
  let workoutLookupCount = 0;

  const record = (model, operation, args = {}) => {
    calls.push({ model, operation, ...args });
  };

  const tx = {
    user: {
      findUnique: async () => ({ id: USER_ID, profile: null }),
    },
    trainingCycle: {
      findFirst: async () => {
        record('trainingCycle', 'findFirst');
        return options.cycleFound === false ? null : cycle;
      },
    },
    plan: {
      findMany: async () => {
        record('plan', 'findMany');
        return options.noDraft ? [] : [draftPlan];
      },
      deleteMany: async () => {
        record('plan', 'deleteMany');
        return { count: 0 };
      },
      delete: async ({ where }) => {
        record('plan', 'delete', { where });
        return draftPlan;
      },
      update: async ({ data }) => {
        record('plan', 'update', { data });
        if (options.planTouchError) {
          throw options.planTouchError;
        }
        planTouchCount += 1;
        draftPlan.revision += 1;
        draftPlan.updatedAt = new Date();
        return {
          revision: draftPlan.revision,
          updatedAt: draftPlan.updatedAt,
        };
      },
    },
    workout: {
      findFirst: async () => {
        record('workout', 'findFirst');
        workoutLookupCount += 1;
        if (options.workoutFound === false) {
          return null;
        }
        return storedWorkout;
      },
      updateMany: async ({ where, data }) => {
        record('workout', 'updateMany', { where, data });
        if (options.staleRevision || where.contentRevision !== storedWorkout.contentRevision) {
          return { count: 0 };
        }
        storedWorkout.name = data.name;
        storedWorkout.estimatedDurationMinutes = data.estimatedDurationMinutes;
        storedWorkout.notes = data.notes;
        storedWorkout.contentRevision += 1;
        storedWorkout.updatedAt = new Date();
        return { count: 1 };
      },
    },
    exercise: {
      findMany: async ({ where }) => {
        record('exercise', 'findMany');
        if (options.unknownExercise) {
          return [];
        }
        return (where.exerciseId.in || []).map((exerciseId) => ({
          exerciseId,
          trainingType: 'STRENGTH',
          cardioModality: null,
        }));
      },
    },
    workoutBlock: {
      deleteMany: async (args) => { record('workoutBlock', 'deleteMany', { args }); return { count: 0 }; },
      updateMany: async (args) => { record('workoutBlock', 'updateMany', { args }); return { count: 0 }; },
      update: async (args) => { record('workoutBlock', 'update', { args }); return {}; },
      createManyAndReturn: async (args) => { record('workoutBlock', 'createManyAndReturn', { args }); return []; },
    },
    blockExercise: {
      deleteMany: async (args) => { record('blockExercise', 'deleteMany', { args }); return { count: 0 }; },
      updateMany: async (args) => { record('blockExercise', 'updateMany', { args }); return { count: 0 }; },
      update: async (args) => { record('blockExercise', 'update', { args }); return {}; },
      createManyAndReturn: async (args) => { record('blockExercise', 'createManyAndReturn', { args }); return []; },
    },
    exerciseSetTemplate: {
      deleteMany: async (args) => { record('exerciseSetTemplate', 'deleteMany', { args }); return { count: 0 }; },
      updateMany: async (args) => { record('exerciseSetTemplate', 'updateMany', { args }); return { count: 0 }; },
      update: async (args) => { record('exerciseSetTemplate', 'update', { args }); return {}; },
      createMany: async (args) => { record('exerciseSetTemplate', 'createMany', { args }); return { count: 0 }; },
    },
  };

  prisma = {
    user: tx.user,
    $transaction: async (operation) => operation(tx),
  };

  return {
    calls,
    cycle,
    draftPlan,
    storedWorkout,
    get planTouchCount() { return planTouchCount; },
    get workoutLookupCount() { return workoutLookupCount; },
  };
}

function enableDateMock(t, now = NOW) {
  t.mock.timers.enable({ apis: ['Date'], now });
}

test('Cycle router registers the workout-scoped PATCH route', () => {
  const router = require('../../routes/cycles');
  const route = router.stack
    .map((layer) => layer.route)
    .find((entry) => entry?.path === '/:cycleId/drafts/:planId/workouts/:workoutId');

  assert.ok(route);
  assert.equal(route.methods.patch, true);
});

test('successful save uses workout CAS, touches Plan late, and returns one compact canonical workout', async (t) => {
  enableDateMock(t);
  const harness = createHarness();
  const payload = buildPayload(harness.storedWorkout, {
    workout: toApiWorkout(harness.storedWorkout, { name: 'Updated Workout' }),
  });

  const response = await updateCycleWorkoutContent(CYCLE_ID, PLAN_ID, WORKOUT_ID, payload);

  assert.deepEqual(Object.keys(response), [
    'cycleId',
    'planId',
    'workoutId',
    'contentRevision',
    'planRevision',
    'workout',
    'draftState',
    'updatedAt',
  ]);
  assert.equal(response.contentRevision, 5);
  assert.equal(response.planRevision, 11);
  assert.equal(response.workout.id, WORKOUT_ID);
  assert.equal(response.workout.contentRevision, 5);
  assert.equal(response.workout.name, 'Updated Workout');
  assert.equal('builderPayload' in response, false);
  assert.equal('weeks' in response, false);
  assert.equal(harness.workoutLookupCount, 2, 'only target load and target reload');

  const workoutClaimIndex = harness.calls.findIndex(
    (call) => call.model === 'workout' && call.operation === 'updateMany'
  );
  const planTouchIndex = harness.calls.findIndex(
    (call) => call.model === 'plan' && call.operation === 'update'
  );
  assert.ok(workoutClaimIndex >= 0 && planTouchIndex > workoutClaimIndex);
  assert.deepEqual(harness.calls[workoutClaimIndex].where, {
    id: WORKOUT_ID,
    planWeekId: WEEK_ID,
    contentRevision: 4,
  });
  assert.equal(
    harness.calls.some((call) => call.model === 'scheduledSession'),
    false,
    'workout autosave must never access ScheduledSession'
  );
});

test('contentRevision is required and must be a positive database integer', async (t) => {
  enableDateMock(t);
  for (const invalid of [undefined, null, 0, -1, 1.5, '4', Number.NaN, 2147483648]) {
    const harness = createHarness();
    const payload = buildPayload(harness.storedWorkout, { contentRevision: invalid });
    await assert.rejects(
      () => updateCycleWorkoutContent(CYCLE_ID, PLAN_ID, WORKOUT_ID, payload),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(harness.calls.length, 0, `invalid revision ${String(invalid)} reached transaction`);
  }
});

test('route workoutId is authoritative and structural workout fields cannot change', async (t) => {
  enableDateMock(t);

  const mismatchHarness = createHarness();
  await assert.rejects(
    () => updateCycleWorkoutContent(
      CYCLE_ID,
      PLAN_ID,
      WORKOUT_ID,
      buildPayload(mismatchHarness.storedWorkout, {
        workout: toApiWorkout(mismatchHarness.storedWorkout, { id: 'other_workout' }),
      })
    ),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
  );

  for (const structuralOverride of [
    { planWeekId: 'other_week' },
    { orderIndex: 2 },
    { scheduledDay: 'TUESDAY' },
    { weekNumber: 2 },
  ]) {
    const harness = createHarness();
    await assert.rejects(
      () => updateCycleWorkoutContent(
        CYCLE_ID,
        PLAN_ID,
        WORKOUT_ID,
        buildPayload(harness.storedWorkout, {
          workout: toApiWorkout(harness.storedWorkout, structuralOverride),
        })
      ),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(
      harness.calls.some((call) => call.model === 'workout' && call.operation === 'updateMany'),
      false
    );
  }
});

test('ownership, current draft, workout scope, and exercise IDs are validated before CAS', async (t) => {
  enableDateMock(t);
  const cases = [
    { options: { cycleFound: false }, args: [CYCLE_ID, PLAN_ID, WORKOUT_ID], status: 404 },
    { options: {}, args: [CYCLE_ID, 'not_current_plan', WORKOUT_ID], status: 400 },
    { options: { workoutFound: false }, args: [CYCLE_ID, PLAN_ID, 'foreign_workout'], status: 404 },
    { options: { unknownExercise: true }, args: [CYCLE_ID, PLAN_ID, WORKOUT_ID], status: 400 },
  ];

  for (const scenario of cases) {
    const harness = createHarness(scenario.options);
    const payload = buildPayload(harness.storedWorkout);
    payload.workout.id = scenario.args[2];
    await assert.rejects(
      () => updateCycleWorkoutContent(
        ...scenario.args,
        payload
      ),
      (error) => error.status === scenario.status
    );
    assert.equal(
      harness.calls.some((call) => call.model === 'workout' && call.operation === 'updateMany'),
      false
    );
  }
});

test('stale workout CAS returns typed 409 without Plan or tree mutation', async (t) => {
  enableDateMock(t);
  const harness = createHarness({ staleRevision: true });

  await assert.rejects(
    () => updateCycleWorkoutContent(
      CYCLE_ID,
      PLAN_ID,
      WORKOUT_ID,
      buildPayload(harness.storedWorkout)
    ),
    (error) => error.status === 409 && error.code === 'WORKOUT_REVISION_CONFLICT'
  );

  assert.equal(harness.planTouchCount, 0);
  assert.equal(harness.storedWorkout.contentRevision, 4);
  assert.equal(
    harness.calls.some((call) => [
      'workoutBlock',
      'blockExercise',
      'exerciseSetTemplate',
    ].includes(call.model)),
    false
  );
});

test('active same-day and upcoming old drafts save, while an expired active draft is rejected', async (t) => {
  enableDateMock(t);

  const sameDay = createHarness();
  const sameDayResponse = await updateCycleWorkoutContent(
    CYCLE_ID,
    PLAN_ID,
    WORKOUT_ID,
    buildPayload(sameDay.storedWorkout)
  );
  assert.equal(sameDayResponse.contentRevision, 5);

  const expired = createHarness({ draftUpdatedAt: utcDate('2026-08-16', '12:00:00.000') });
  await assert.rejects(
    () => updateCycleWorkoutContent(
      CYCLE_ID,
      PLAN_ID,
      WORKOUT_ID,
      buildPayload(expired.storedWorkout)
    ),
    (error) => error.status === 409 && error.code === 'DRAFT_EXPIRED'
  );
  assert.equal(
    expired.calls.some((call) => call.model === 'plan' && call.operation === 'delete'),
    true
  );

  const upcoming = createHarness({
    cycleStartDate: utcDate('2026-09-07', '00:00:00.000'),
    cycleEndDate: utcDate('2026-09-13', '00:00:00.000'),
    draftUpdatedAt: utcDate('2026-07-01'),
  });
  const upcomingResponse = await updateCycleWorkoutContent(
    CYCLE_ID,
    PLAN_ID,
    WORKOUT_ID,
    buildPayload(upcoming.storedWorkout)
  );
  assert.equal(upcomingResponse.contentRevision, 5);
});

test('allowed grace continuation refreshes Plan.updatedAt into the current local day', async (t) => {
  enableDateMock(t, new Date('2026-08-18T00:10:00.000Z'));
  const harness = createHarness({
    cycleStartDate: utcDate('2026-08-17', '00:00:00.000'),
    cycleEndDate: utcDate('2026-08-23', '00:00:00.000'),
    draftUpdatedAt: utcDate('2026-08-17', '23:50:00.000'),
  });

  const response = await updateCycleWorkoutContent(
    CYCLE_ID,
    PLAN_ID,
    WORKOUT_ID,
    buildPayload(harness.storedWorkout, { allowCrossDayDraft: true })
  );

  assert.equal(response.draftState.localDate, '2026-08-18');
  assert.equal(response.draftState.isGraceWindow, true);
  assert.equal(response.updatedAt.toISOString().slice(0, 10), '2026-08-18');
});

test('active-cycle past workout protection rejects changed content before CAS', async (t) => {
  enableDateMock(t);
  const harness = createHarness({
    cycleStartDate: utcDate('2026-08-16', '00:00:00.000'),
    cycleEndDate: utcDate('2026-08-22', '00:00:00.000'),
    draftUpdatedAt: utcDate('2026-08-17'),
  });

  await assert.rejects(
    () => updateCycleWorkoutContent(
      CYCLE_ID,
      PLAN_ID,
      WORKOUT_ID,
      buildPayload(harness.storedWorkout, {
        workout: toApiWorkout(harness.storedWorkout, { name: 'Retroactive edit' }),
      })
    ),
    (error) =>
      error.status === 400 &&
      error.code === 'VALIDATION_ERROR' &&
      error.message === 'Past workouts cannot be modified on an active cycle'
  );
  assert.equal(
    harness.calls.some((call) => call.model === 'workout' && call.operation === 'updateMany'),
    false
  );
});
