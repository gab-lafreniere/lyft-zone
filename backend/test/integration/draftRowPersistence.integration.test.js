const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let prisma;
let createUser;
let createCycle;
let createPlanForCycle;
let updateCycleDraft;
let createWeeklyPlan;
let updateWeeklyPlanDraft;

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping row-persistence integration tests.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;

  ({ createUser } = require('../../services/usersService'));
  ({ createCycle, createPlanForCycle, updateCycleDraft } = require('../../services/cyclesService'));
  ({ createWeeklyPlan, updateWeeklyPlanDraft } = require('../../services/weeklyPlansService'));
  prisma = require('../../lib/prisma').getPrisma();
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

const cyclePlanInclude = {
  weeks: {
    orderBy: { orderIndex: 'asc' },
    include: {
      workouts: {
        orderBy: { orderIndex: 'asc' },
        include: {
          blocks: {
            orderBy: { orderIndex: 'asc' },
            include: {
              blockExercises: {
                orderBy: { orderIndex: 'asc' },
                include: { setTemplates: { orderBy: { setIndex: 'asc' } } },
              },
            },
          },
        },
      },
    },
  },
};

const weeklyVersionInclude = {
  workouts: {
    orderBy: { orderIndex: 'asc' },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          exercises: {
            orderBy: { orderIndex: 'asc' },
            include: { setTemplates: { orderBy: { setIndex: 'asc' } } },
          },
        },
      },
    },
  },
};

function mapSet(setTemplate) {
  return {
    id: setTemplate.id,
    setIndex: setTemplate.setIndex,
    setType: setTemplate.setType,
    targetReps: setTemplate.targetReps,
    minReps: setTemplate.minReps,
    maxReps: setTemplate.maxReps,
    targetSeconds: setTemplate.targetSeconds,
    targetRir: setTemplate.targetRir,
    targetRpe: setTemplate.targetRpe,
    tempo: setTemplate.tempo,
    restSeconds: setTemplate.restSeconds,
    notes: setTemplate.notes,
  };
}

function mapBlock(block, exerciseKey) {
  return {
    id: block.id,
    orderIndex: block.orderIndex,
    blockType: block.blockType,
    label: block.label,
    roundCount: block.roundCount,
    restStrategy: block.restStrategy,
    restSeconds: block.restSeconds,
    notes: block.notes,
    exercises: block[exerciseKey].map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName || 'Bench Press',
      bodyParts: exercise.bodyParts || [],
      muscleFocus: exercise.muscleFocus || [],
      orderIndex: exercise.orderIndex,
      executionNotes: exercise.executionNotes,
      defaultTempo: exercise.defaultTempo,
      defaultRestSeconds: exercise.defaultRestSeconds,
      defaultTargetRir: exercise.defaultTargetRir,
      defaultTargetRpe: exercise.defaultTargetRpe,
      intensificationMethod: exercise.intensificationMethod,
      cardioPrescription: exercise.cardioPrescription,
      notes: exercise.notes,
      setTemplates: exercise.setTemplates.map(mapSet),
    })),
  };
}

function cyclePayload(plan, userId) {
  return {
    userId,
    name: plan.name,
    weeks: plan.weeks.map((week) => ({
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
        blocks: workout.blocks.map((block) => mapBlock(block, 'blockExercises')),
      })),
    })),
  };
}

function weeklyPayload(version, userId) {
  return {
    userId,
    name: version.name,
    sessionsPerWeek: version.sessionsPerWeek,
    workouts: version.workouts.map((workout) => ({
      id: workout.id,
      name: workout.name,
      orderIndex: workout.orderIndex,
      estimatedDurationMinutes: workout.estimatedDurationMinutes,
      notes: workout.notes,
      blocks: workout.blocks.map((block) => mapBlock(block, 'exercises')),
    })),
  };
}

function subtreeIdentity(workout, exerciseKey) {
  return {
    blocks: workout.blocks.map((block) => block.id),
    exercises: workout.blocks.flatMap((block) => block[exerciseKey].map((exercise) => exercise.id)),
    sets: workout.blocks.flatMap((block) =>
      block[exerciseKey].flatMap((exercise) => exercise.setTemplates.map((setTemplate) => setTemplate.id))
    ),
  };
}

test('Cycle no-op/scalar/add/remove operations preserve every unaffected persisted id', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  await seedExercise(prisma, 'ex_cycle_a');
  await seedExercise(prisma, 'ex_cycle_b');
  const user = await createUser({ email: 'row-persistence-cycle@example.com' });
  const cycle = await createCycle({
    userId: user.id,
    name: 'Row persistence Cycle',
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'America/Toronto',
  });
  const created = await createPlanForCycle(cycle.id, {
    name: 'Row persistence plan',
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      workouts: [{
        name: 'Workout A',
        orderIndex: 1,
        blocks: [{
          orderIndex: 1,
          blockType: 'SUPERSET',
          restStrategy: 'AFTER_ROUND',
          exercises: [
            {
              exerciseId: 'ex_cycle_a',
              exerciseName: 'Bench Press A',
              orderIndex: 1,
              setTemplates: [
                { setIndex: 1, setType: 'TOP_SET', targetReps: 8 },
                { setIndex: 2, setType: 'BACKOFF', targetReps: 10 },
              ],
            },
            {
              exerciseId: 'ex_cycle_b',
              exerciseName: 'Bench Press B',
              orderIndex: 2,
              setTemplates: [{ setIndex: 1, setType: 'WORKING', targetReps: 12 }],
            },
          ],
        }],
      }],
    }],
  });

  const load = () => prisma.plan.findUnique({ where: { id: created.id }, include: cyclePlanInclude });
  const original = await load();
  const originalWorkout = original.weeks[0].workouts[0];
  const originalIdentity = subtreeIdentity(originalWorkout, 'blockExercises');
  const originalUpdatedAt = {
    block: originalWorkout.blocks[0].updatedAt.toISOString(),
    exercise: originalWorkout.blocks[0].blockExercises[0].updatedAt.toISOString(),
    set: originalWorkout.blocks[0].blockExercises[0].setTemplates[0].updatedAt.toISOString(),
  };

  const noOpResponse = await updateCycleDraft(
    cycle.id,
    created.id,
    cyclePayload(original, user.id)
  );
  const noOpBuilderExercise =
    noOpResponse.builderPayload.weeks[0].workouts[0].blocks[0].exercises[0];
  assert.equal(noOpBuilderExercise.id, originalIdentity.exercises[0]);
  assert.equal(noOpBuilderExercise.persistence.id, originalIdentity.exercises[0]);
  assert.equal(noOpBuilderExercise.sets[0].id, originalIdentity.sets[0]);
  assert.equal(noOpBuilderExercise.sets[0].persistence.id, originalIdentity.sets[0]);
  const afterNoOp = await load();
  assert.deepEqual(subtreeIdentity(afterNoOp.weeks[0].workouts[0], 'blockExercises'), originalIdentity);
  assert.deepEqual(
    {
      block: afterNoOp.weeks[0].workouts[0].blocks[0].updatedAt.toISOString(),
      exercise: afterNoOp.weeks[0].workouts[0].blocks[0].blockExercises[0].updatedAt.toISOString(),
      set: afterNoOp.weeks[0].workouts[0].blocks[0].blockExercises[0].setTemplates[0].updatedAt.toISOString(),
    },
    originalUpdatedAt,
    'a no-op must not update any content row'
  );

  const scalarPayload = cyclePayload(afterNoOp, user.id);
  scalarPayload.weeks[0].workouts[0].blocks[0].exercises[0].setTemplates[0].targetReps = 9;
  await updateCycleDraft(cycle.id, created.id, scalarPayload);
  const afterScalar = await load();
  assert.deepEqual(subtreeIdentity(afterScalar.weeks[0].workouts[0], 'blockExercises'), originalIdentity);
  assert.equal(afterScalar.weeks[0].workouts[0].blocks[0].blockExercises[0].setTemplates[0].targetReps, 9);

  const addPayload = cyclePayload(afterScalar, user.id);
  addPayload.weeks[0].workouts[0].blocks[0].exercises[0].setTemplates.push(
    { setIndex: 3, setType: 'WORKING', targetReps: 11 },
    { setIndex: 4, setType: 'WORKING', targetReps: 12 }
  );
  await updateCycleDraft(cycle.id, created.id, addPayload);
  const afterAdd = await load();
  const afterAddSetIds = subtreeIdentity(
    afterAdd.weeks[0].workouts[0],
    'blockExercises'
  ).sets;
  originalIdentity.sets.forEach((id) => assert.ok(afterAddSetIds.includes(id)));
  assert.equal(afterAdd.weeks[0].workouts[0].blocks[0].blockExercises[0].setTemplates.length, 4);

  const removePayload = cyclePayload(afterAdd, user.id);
  removePayload.weeks[0].workouts[0].blocks[0].exercises.splice(1, 1);
  await updateCycleDraft(cycle.id, created.id, removePayload);
  const afterRemove = await load();
  const finalWorkout = afterRemove.weeks[0].workouts[0];
  assert.equal(finalWorkout.blocks[0].blockExercises.length, 1);
  assert.equal(finalWorkout.blocks[0].id, originalIdentity.blocks[0]);
  assert.equal(finalWorkout.blocks[0].blockExercises[0].id, originalIdentity.exercises[0]);
  assert.deepEqual(
    finalWorkout.blocks[0].blockExercises[0].setTemplates.slice(0, 2).map((setTemplate) => setTemplate.id),
    originalIdentity.sets.slice(0, 2)
  );
});

test('Weekly Plan scalar updates and additions preserve all pre-existing subtree ids', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  await seedExercise(prisma, 'ex_weekly_a');
  const user = await createUser({ email: 'row-persistence-weekly@example.com' });
  const created = await createWeeklyPlan(
    {
      userId: user.id,
      name: 'Row persistence Weekly Plan',
      sessionsPerWeek: 1,
      source: 'MANUAL',
      workouts: [{
        name: 'Workout A',
        orderIndex: 1,
        blocks: [{
          orderIndex: 1,
          blockType: 'SINGLE',
          restStrategy: 'AFTER_EXERCISE',
          exercises: [{
            exerciseId: 'ex_weekly_a',
            exerciseName: 'Bench Press',
            orderIndex: 1,
            setTemplates: [
              { setIndex: 1, setType: 'TOP_SET', targetReps: 8 },
              { setIndex: 2, setType: 'BACKOFF', targetReps: 10 },
            ],
          }],
        }],
      }],
    },
    { initialStatus: 'DRAFT' }
  );

  const load = () => prisma.weeklyPlanVersion.findUnique({
    where: { id: created.weeklyPlanVersionId },
    include: weeklyVersionInclude,
  });
  const original = await load();
  const originalIdentity = subtreeIdentity(original.workouts[0], 'exercises');
  const payload = weeklyPayload(original, user.id);
  payload.workouts[0].blocks[0].exercises[0].setTemplates[0].targetReps = 9;
  payload.workouts[0].blocks[0].exercises[0].setTemplates.push(
    { setIndex: 3, setType: 'WORKING', targetReps: 12 },
    { setIndex: 4, setType: 'WORKING', targetReps: 15 }
  );

  const response = await updateWeeklyPlanDraft(
    created.weeklyPlanParentId,
    created.weeklyPlanVersionId,
    payload
  );
  const builderBlock = response.builderPayload.workouts[0].blocks[0];
  assert.equal(builderBlock.exerciseRowId, originalIdentity.exercises[0]);
  assert.equal(builderBlock.exercisePersistence.id, originalIdentity.exercises[0]);
  assert.equal(builderBlock.sets[0].id, originalIdentity.sets[0]);
  assert.equal(builderBlock.sets[0].persistence.id, originalIdentity.sets[0]);
  const updated = await load();
  const updatedWorkout = updated.workouts[0];

  assert.equal(updatedWorkout.blocks[0].exercises[0].setTemplates[0].targetReps, 9);
  assert.equal(updatedWorkout.blocks[0].exercises[0].setTemplates.length, 4);
  assert.equal(updatedWorkout.blocks[0].id, originalIdentity.blocks[0]);
  assert.equal(updatedWorkout.blocks[0].exercises[0].id, originalIdentity.exercises[0]);
  assert.deepEqual(
    updatedWorkout.blocks[0].exercises[0].setTemplates.slice(0, 2).map((setTemplate) => setTemplate.id),
    originalIdentity.sets
  );
});
