const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let prisma;
let createUser;
let createCycle;
let createPlanForCycle;
let openOrCreateCycleEditDraft;
let updateCycleWorkoutContent;

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping Cycle workout-content integration tests.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;

  ({ createUser } = require('../../services/usersService'));
  ({
    createCycle,
    createPlanForCycle,
    openOrCreateCycleEditDraft,
    updateCycleWorkoutContent,
  } = require('../../services/cyclesService'));
  prisma = require('../../lib/prisma').getPrisma();
  await seedExercise(prisma);
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

function mapWorkoutToRequest(workout, overrides = {}) {
  return {
    id: workout.id,
    planWeekId: workout.planWeekId,
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
      exercises: (block.exercises || block.blockExercises).map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName || exercise.exercise?.name || 'Bench Press',
        bodyParts: exercise.bodyParts || exercise.exercise?.bodyParts || [],
        muscleFocus: exercise.muscleFocus || exercise.exercise?.targetMuscles || [],
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes,
        defaultTempo: exercise.defaultTempo,
        defaultRestSeconds: exercise.defaultRestSeconds,
        defaultTargetRir: exercise.defaultTargetRir,
        defaultTargetRpe: exercise.defaultTargetRpe,
        intensificationMethod: exercise.intensificationMethod,
        cardioPrescription: exercise.cardioPrescription,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((setTemplate) => ({
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
        })),
      })),
    })),
    ...overrides,
  };
}

async function createFixture(tag, workoutCount = 2, planName = `${tag} Plan`) {
  const user = await createUser({ email: `${tag}@example.com` });
  const cycle = await createCycle({
    userId: user.id,
    name: `${tag} Cycle`,
    startDate: '2035-09-03',
    endDate: '2035-09-09',
    durationWeeks: 1,
    mode: 'FIXED',
    timezone: 'UTC',
  });
  const plan = await createPlanForCycle(cycle.id, {
    name: planName,
    sourceType: 'USER',
    status: 'DRAFT',
    weeks: [{
      weekNumber: 1,
      orderIndex: 1,
      label: 'Week 1',
      workouts: Array.from({ length: workoutCount }, (_, index) => ({
        name: `Workout ${index + 1}`,
        orderIndex: index + 1,
        estimatedDurationMinutes: 60,
        blocks: [{
          orderIndex: 1,
          blockType: 'SINGLE',
          restStrategy: 'AFTER_EXERCISE',
          restSeconds: 90,
          exercises: [{
            exerciseId: 'ex_bench_press_test',
            exerciseName: 'Bench Press',
            orderIndex: 1,
            defaultTempo: '3010',
            defaultRestSeconds: 90,
            defaultTargetRir: 2,
            intensificationMethod: 'NONE',
            setTemplates: [{
              setIndex: 1,
              setType: 'WORKING',
              targetReps: 8,
              targetRir: 2,
              tempo: '3010',
              restSeconds: 90,
            }],
          }],
        }],
      })),
    }],
  });

  return { user, cycle, plan, workouts: plan.weeks[0].workouts };
}

function buildRequest(userId, workout, { name, targetReps } = {}) {
  const requestWorkout = mapWorkoutToRequest(workout, {
    name: name ?? workout.name,
  });
  if (targetReps != null) {
    requestWorkout.blocks[0].exercises[0].setTemplates[0].targetReps = targetReps;
  }

  return {
    userId,
    timezone: 'UTC',
    contentRevision: workout.contentRevision,
    workout: requestWorkout,
  };
}

async function loadWorkout(workoutId) {
  return prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          blockExercises: {
            orderBy: { orderIndex: 'asc' },
            include: {
              exercise: true,
              setTemplates: { orderBy: { setIndex: 'asc' } },
            },
          },
        },
      },
    },
  });
}

test('same-workout concurrent saves produce one winner, one typed conflict, and one Plan revision advance', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createFixture('workout-cas-same');
  const workout = fixture.workouts[0];
  const otherWorkout = fixture.workouts[1];
  const startingPlanRevision = fixture.plan.revision;
  const startingWorkoutRevision = workout.contentRevision;

  const results = await Promise.allSettled([
    updateCycleWorkoutContent(
      fixture.cycle.id,
      fixture.plan.id,
      workout.id,
      buildRequest(fixture.user.id, workout, { name: 'Writer A', targetReps: 9 })
    ),
    updateCycleWorkoutContent(
      fixture.cycle.id,
      fixture.plan.id,
      workout.id,
      buildRequest(fixture.user.id, workout, { name: 'Writer B', targetReps: 12 })
    ),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, 'WORKOUT_REVISION_CONFLICT');

  const finalWorkout = await loadWorkout(workout.id);
  const finalOtherWorkout = await prisma.workout.findUnique({ where: { id: otherWorkout.id } });
  const finalPlan = await prisma.plan.findUnique({ where: { id: fixture.plan.id } });
  const winnerName = fulfilled[0].value.workout.name;
  const winnerReps = winnerName === 'Writer A' ? 9 : 12;

  assert.equal(finalWorkout.name, winnerName);
  assert.equal(
    finalWorkout.blocks[0].blockExercises[0].setTemplates[0].targetReps,
    winnerReps
  );
  assert.equal(finalWorkout.contentRevision, startingWorkoutRevision + 1);
  assert.equal(finalPlan.revision, startingPlanRevision + 1);
  assert.equal(fulfilled[0].value.planRevision, startingPlanRevision + 1);
  assert.equal(finalOtherWorkout.contentRevision, otherWorkout.contentRevision);
  assert.equal(finalOtherWorkout.name, otherWorkout.name);
  assert.equal(finalWorkout.blocks.length, 1);
  assert.equal(finalWorkout.blocks[0].blockExercises.length, 1);
  assert.equal(finalWorkout.blocks[0].blockExercises[0].setTemplates.length, 1);
});

test('different-workout concurrent saves both succeed and briefly serialize only on the late Plan touch', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createFixture('workout-cas-different');
  const [workoutA, workoutB] = fixture.workouts;
  const startingPlanRevision = fixture.plan.revision;

  const results = await Promise.all([
    updateCycleWorkoutContent(
      fixture.cycle.id,
      fixture.plan.id,
      workoutA.id,
      buildRequest(fixture.user.id, workoutA, { name: 'Scoped A', targetReps: 10 })
    ),
    updateCycleWorkoutContent(
      fixture.cycle.id,
      fixture.plan.id,
      workoutB.id,
      buildRequest(fixture.user.id, workoutB, { name: 'Scoped B', targetReps: 14 })
    ),
  ]);

  const finalA = await loadWorkout(workoutA.id);
  const finalB = await loadWorkout(workoutB.id);
  const finalPlan = await prisma.plan.findUnique({ where: { id: fixture.plan.id } });

  assert.equal(finalA.name, 'Scoped A');
  assert.equal(finalB.name, 'Scoped B');
  assert.equal(finalA.blocks[0].blockExercises[0].setTemplates[0].targetReps, 10);
  assert.equal(finalB.blocks[0].blockExercises[0].setTemplates[0].targetReps, 14);
  assert.equal(finalA.contentRevision, workoutA.contentRevision + 1);
  assert.equal(finalB.contentRevision, workoutB.contentRevision + 1);
  assert.equal(finalPlan.revision, startingPlanRevision + 2);
  assert.deepEqual(
    results.map((response) => response.planRevision).sort((a, b) => a - b),
    [startingPlanRevision + 1, startingPlanRevision + 2]
  );
});

test('Cycle draft hydration exposes each persisted workout contentRevision without a hardcoded value', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createFixture('workout-hydration');
  const [workoutA, workoutB] = fixture.workouts;
  await prisma.workout.update({ where: { id: workoutA.id }, data: { contentRevision: 7 } });
  await prisma.workout.update({ where: { id: workoutB.id }, data: { contentRevision: 13 } });

  const response = await openOrCreateCycleEditDraft(fixture.cycle.id, {
    userId: fixture.user.id,
    timezone: 'UTC',
  });
  const hydrated = response.builderPayload.weeks[0].workouts;

  assert.deepEqual(hydrated.map((workout) => workout.contentRevision), [7, 13]);
  assert.deepEqual(hydrated.map((workout) => workout.id), [workoutA.id, workoutB.id]);
  assert.equal(hydrated[0].blocks[0].sets[0].persistence.targetReps, 8);
});

test('a failed late Plan touch rolls back workout CAS and nested content', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createFixture(
    'workout-plan-touch-rollback',
    1,
    'Plan Touch Failure Fixture'
  );
  const workout = fixture.workouts[0];

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_scoped_plan_touch() RETURNS trigger AS $$
    BEGIN
      IF OLD.name = 'Plan Touch Failure Fixture' AND NEW.revision <> OLD.revision THEN
        RAISE EXCEPTION 'intentional scoped plan touch failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_scoped_plan_touch_trigger
    BEFORE UPDATE OF revision ON plans
    FOR EACH ROW EXECUTE FUNCTION fail_scoped_plan_touch()
  `);

  try {
    await assert.rejects(() => updateCycleWorkoutContent(
      fixture.cycle.id,
      fixture.plan.id,
      workout.id,
      buildRequest(fixture.user.id, workout, {
        name: 'Must Roll Back',
        targetReps: 20,
      })
    ));
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_scoped_plan_touch_trigger ON plans');
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_scoped_plan_touch()');
  }

  const finalWorkout = await loadWorkout(workout.id);
  const finalPlan = await prisma.plan.findUnique({ where: { id: fixture.plan.id } });
  assert.equal(finalWorkout.name, workout.name);
  assert.equal(finalWorkout.contentRevision, workout.contentRevision);
  assert.equal(finalWorkout.blocks[0].blockExercises[0].setTemplates[0].targetReps, 8);
  assert.equal(finalPlan.revision, fixture.plan.revision);
});

test('workout autosave leaves an existing ScheduledSession byte-for-byte unchanged', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createFixture('workout-scheduled-session', 1);
  const workout = fixture.workouts[0];
  const session = await prisma.scheduledSession.create({
    data: {
      workoutId: workout.id,
      status: 'PLANNED',
      scheduledStartAt: new Date('2035-09-03T14:00:00.000Z'),
      scheduledEndAt: new Date('2035-09-03T15:00:00.000Z'),
      notes: 'Must remain untouched',
    },
  });

  await updateCycleWorkoutContent(
    fixture.cycle.id,
    fixture.plan.id,
    workout.id,
    buildRequest(fixture.user.id, workout, { name: 'Session-safe edit' })
  );

  const reloaded = await prisma.scheduledSession.findUnique({ where: { id: session.id } });
  assert.deepEqual(reloaded, session);
});

async function createLargeFixture() {
  const user = await createUser({ email: 'workout-large-scope@example.com' });
  const cycle = await createCycle({
    userId: user.id,
    name: 'Large scoped Cycle',
    startDate: '2035-09-03',
    endDate: '2035-10-14',
    durationWeeks: 6,
    mode: 'FIXED',
    timezone: 'UTC',
  });
  const plan = await prisma.plan.create({
    data: {
      trainingCycleId: cycle.id,
      name: 'Large scoped Plan',
      versionNumber: 1,
      sourceType: 'USER',
      status: 'DRAFT',
      revision: 1,
    },
  });
  const weeks = await prisma.planWeek.createManyAndReturn({
    data: Array.from({ length: 6 }, (_, index) => ({
      planId: plan.id,
      weekNumber: index + 1,
      orderIndex: index + 1,
      label: `Week ${index + 1}`,
    })),
  });
  const workouts = await prisma.workout.createManyAndReturn({
    data: weeks.flatMap((week) => Array.from({ length: 6 }, (_, index) => ({
      planWeekId: week.id,
      name: `Week ${week.weekNumber} Workout ${index + 1}`,
      orderIndex: index + 1,
      estimatedDurationMinutes: 60,
    }))),
  });
  const blocks = await prisma.workoutBlock.createManyAndReturn({
    data: workouts.map((workout) => ({
      workoutId: workout.id,
      orderIndex: 1,
      blockType: 'SINGLE',
      restStrategy: 'AFTER_EXERCISE',
      restSeconds: 90,
    })),
  });
  const exercises = await prisma.blockExercise.createManyAndReturn({
    data: blocks.map((block) => ({
      workoutBlockId: block.id,
      exerciseId: 'ex_bench_press_test',
      orderIndex: 1,
      defaultTempo: '3010',
      defaultRestSeconds: 90,
      defaultTargetRir: 2,
      intensificationMethod: 'NONE',
    })),
  });
  await prisma.exerciseSetTemplate.createMany({
    data: exercises.flatMap((exercise) => Array.from({ length: 25 }, (_, index) => ({
      blockExerciseId: exercise.id,
      setIndex: index + 1,
      setType: 'WORKING',
      targetReps: 8 + (index % 5),
      targetRir: 2,
      tempo: '3010',
      restSeconds: 90,
    }))),
  });

  return { user, cycle, plan, workouts };
}

test('a 6-week/36-workout/900-set Cycle save loads and mutates only one workout scope', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const fixture = await createLargeFixture();
  const targetId = fixture.workouts[0].id;
  const unrelatedId = fixture.workouts.at(-1).id;
  const target = await loadWorkout(targetId);
  const unrelatedBefore = await loadWorkout(unrelatedId);
  const targetSet = target.blocks[0].blockExercises[0].setTemplates[0];
  const payload = {
    userId: fixture.user.id,
    timezone: 'UTC',
    contentRevision: target.contentRevision,
    workout: mapWorkoutToRequest(target),
  };
  payload.workout.blocks[0].exercises[0].setTemplates[0].targetReps = 17;

  const payloadJson = JSON.stringify(payload);
  assert.equal(payloadJson.includes(unrelatedId), false);
  assert.equal('weeks' in payload, false);
  assert.equal(payload.workout.blocks[0].exercises[0].setTemplates.length, 25);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const startedAt = performance.now();
  const response = await updateCycleWorkoutContent(
    fixture.cycle.id,
    fixture.plan.id,
    targetId,
    payload
  );
  const elapsedMs = performance.now() - startedAt;

  const targetAfter = await loadWorkout(targetId);
  const unrelatedAfter = await loadWorkout(unrelatedId);
  const setCount = await prisma.exerciseSetTemplate.count({
    where: {
      blockExercise: {
        workoutBlock: {
          workout: {
            planWeek: { planId: fixture.plan.id },
          },
        },
      },
    },
  });

  assert.equal(setCount, 900);
  assert.equal(response.workoutId, targetId);
  assert.equal(response.workout.blocks[0].sets[0].persistence.targetReps, 17);
  assert.equal(targetAfter.contentRevision, target.contentRevision + 1);
  assert.equal(
    targetAfter.blocks[0].blockExercises[0].setTemplates[0].id,
    targetSet.id,
    'the edited set row keeps its persisted identity'
  );
  assert.equal(targetAfter.blocks[0].blockExercises[0].setTemplates[0].targetReps, 17);
  assert.equal(
    targetAfter.blocks[0].blockExercises[0].setTemplates[0].updatedAt > targetSet.updatedAt,
    true
  );
  assert.equal(unrelatedAfter.contentRevision, unrelatedBefore.contentRevision);
  assert.equal(unrelatedAfter.updatedAt.getTime(), unrelatedBefore.updatedAt.getTime());
  assert.equal(
    unrelatedAfter.blocks[0].updatedAt.getTime(),
    unrelatedBefore.blocks[0].updatedAt.getTime()
  );
  assert.equal(
    unrelatedAfter.blocks[0].blockExercises[0].updatedAt.getTime(),
    unrelatedBefore.blocks[0].blockExercises[0].updatedAt.getTime()
  );
  assert.deepEqual(
    unrelatedAfter.blocks[0].blockExercises[0].setTemplates.map((setTemplate) => ({
      id: setTemplate.id,
      targetReps: setTemplate.targetReps,
      updatedAt: setTemplate.updatedAt.getTime(),
    })),
    unrelatedBefore.blocks[0].blockExercises[0].setTemplates.map((setTemplate) => ({
      id: setTemplate.id,
      targetReps: setTemplate.targetReps,
      updatedAt: setTemplate.updatedAt.getTime(),
    }))
  );

  t.diagnostic(
    `local-only timing ${elapsedMs.toFixed(1)}ms; request ${Buffer.byteLength(payloadJson)} bytes; ` +
      'content mutations: 1 Workout CAS/scalar row + 1 set row; SQL statement count unavailable'
  );
});
