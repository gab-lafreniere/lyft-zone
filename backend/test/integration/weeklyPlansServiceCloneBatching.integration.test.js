'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');
const { seedExercise } = require('./support/seedExercise');

let pgHandle = null;
let skipReason = null;
let createUser;
let createWeeklyPlan;
let openOrCreateEditDraft;
let publishWeeklyPlanDraft;
let getPrisma;

const treeInclude = {
  workouts: {
    orderBy: { orderIndex: 'asc' },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          exercises: {
            orderBy: { orderIndex: 'asc' },
            include: {
              setTemplates: { orderBy: { setIndex: 'asc' } },
            },
          },
        },
      },
    },
  },
};

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping the disposable-PG clone proof.';
    return;
  }

  await applyMigrations(pgHandle.url);
  process.env.DATABASE_URL = pgHandle.url;
  ({ createUser } = require('../../services/usersService'));
  ({
    createWeeklyPlan,
    openOrCreateEditDraft,
    publishWeeklyPlanDraft,
  } = require('../../services/weeklyPlansService'));
  ({ getPrisma } = require('../../lib/prisma'));
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

function strengthExercise(orderIndex, label, workoutIndex) {
  return {
    exerciseId: 'ex_bench_press_test',
    exerciseName: label,
    bodyParts: ['chest', 'triceps'],
    muscleFocus: ['upper_chest'],
    orderIndex,
    executionNotes: `Execution ${workoutIndex}-${orderIndex}`,
    defaultTempo: orderIndex === 1 ? '3010' : '2111',
    defaultRestSeconds: 75 + orderIndex,
    defaultTargetRir: 2,
    defaultTargetRpe: 8,
    intensificationMethod: orderIndex === 1 ? 'NONE' : 'TEMPO_EMPHASIS',
    notes: `Exercise notes ${workoutIndex}-${orderIndex}`,
    setTemplates: [
      {
        setIndex: 1,
        setType: 'WARMUP',
        targetReps: 12,
        minReps: 10,
        maxReps: 12,
        targetRir: 3,
        targetRpe: 7,
        tempo: '3010',
        restSeconds: 60,
        notes: 'Warm-up prescription',
      },
      {
        setIndex: 2,
        setType: orderIndex === 1 ? 'TOP_SET' : 'BACKOFF',
        targetReps: null,
        minReps: 8,
        maxReps: 10,
        targetSeconds: null,
        targetRir: 2,
        targetRpe: 8,
        tempo: '2111',
        restSeconds: 120,
        notes: 'Working prescription',
      },
    ],
  };
}

function buildLargePublishedPlan(userId) {
  return {
    userId,
    source: 'MANUAL',
    name: 'Six Workout Clone Fixture',
    sessionsPerWeek: 6,
    workouts: Array.from({ length: 6 }, (_, index) => {
      const workoutNumber = index + 1;
      return {
        name: `Workout ${workoutNumber}`,
        orderIndex: workoutNumber,
        estimatedDurationMinutes: 55 + workoutNumber,
        notes: `Workout notes ${workoutNumber}`,
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            label: `Primary ${workoutNumber}`,
            roundCount: 3,
            restStrategy: 'AFTER_EXERCISE',
            restSeconds: 120,
            notes: 'Single block notes',
            exercises: [strengthExercise(1, 'Bench Press', workoutNumber)],
          },
          {
            orderIndex: 2,
            blockType: 'SUPERSET',
            label: `Superset ${workoutNumber}`,
            roundCount: 2,
            restStrategy: 'AFTER_ROUND',
            restSeconds: 90,
            notes: 'Superset block notes',
            exercises: [
              strengthExercise(1, 'Incline Bench Press', workoutNumber),
              strengthExercise(2, 'Close Grip Bench Press', workoutNumber),
            ],
          },
          {
            orderIndex: 3,
            blockType: 'CARDIO',
            label: `Conditioning ${workoutNumber}`,
            roundCount: 1,
            restStrategy: 'NONE',
            restSeconds: 0,
            notes: 'Cardio block notes',
            exercises: [{
              exerciseId: 'ex_treadmill_test',
              exerciseName: 'Treadmill Walk',
              bodyParts: ['full_body'],
              muscleFocus: ['cardiovascular'],
              orderIndex: 1,
              executionNotes: 'Keep a steady pace',
              defaultTempo: null,
              defaultRestSeconds: null,
              defaultTargetRir: null,
              defaultTargetRpe: null,
              intensificationMethod: 'NONE',
              cardioPrescription: {
                durationMinutes: 20 + workoutNumber,
                heartRateTargetMode: 'zone',
                heartRateTargetValue: 2,
                machineSettings: [{ key: 'speed', value: '3.2' }],
                notes: `Cardio notes ${workoutNumber}`,
              },
              notes: 'Cardio exercise notes',
              setTemplates: [],
            }],
          },
        ],
      };
    }),
  };
}

function collectIds(version) {
  const ids = {
    workouts: [],
    blocks: [],
    exercises: [],
    sets: [],
  };
  version.workouts.forEach((workout) => {
    ids.workouts.push(workout.id);
    workout.blocks.forEach((block) => {
      ids.blocks.push(block.id);
      block.exercises.forEach((exercise) => {
        ids.exercises.push(exercise.id);
        exercise.setTemplates.forEach((setTemplate) => ids.sets.push(setTemplate.id));
      });
    });
  });
  return ids;
}

function decimalValue(value) {
  return value == null ? null : Number(value);
}

function businessProjection(version) {
  return {
    name: version.name,
    sessionsPerWeek: version.sessionsPerWeek,
    workouts: version.workouts.map((workout) => ({
      name: workout.name,
      orderIndex: workout.orderIndex,
      estimatedDurationMinutes: workout.estimatedDurationMinutes,
      notes: workout.notes,
      blocks: workout.blocks.map((block) => ({
        orderIndex: block.orderIndex,
        blockType: block.blockType,
        label: block.label,
        roundCount: block.roundCount,
        restStrategy: block.restStrategy,
        restSeconds: block.restSeconds,
        notes: block.notes,
        exercises: block.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          bodyParts: exercise.bodyParts,
          muscleFocus: exercise.muscleFocus,
          orderIndex: exercise.orderIndex,
          executionNotes: exercise.executionNotes,
          defaultTempo: exercise.defaultTempo,
          defaultRestSeconds: exercise.defaultRestSeconds,
          defaultTargetRir: decimalValue(exercise.defaultTargetRir),
          defaultTargetRpe: decimalValue(exercise.defaultTargetRpe),
          intensificationMethod: exercise.intensificationMethod,
          cardioPrescription: exercise.cardioPrescription,
          notes: exercise.notes,
          setTemplates: exercise.setTemplates.map((setTemplate) => ({
            setIndex: setTemplate.setIndex,
            setType: setTemplate.setType,
            targetReps: setTemplate.targetReps,
            minReps: setTemplate.minReps,
            maxReps: setTemplate.maxReps,
            targetSeconds: setTemplate.targetSeconds,
            targetRir: decimalValue(setTemplate.targetRir),
            targetRpe: decimalValue(setTemplate.targetRpe),
            tempo: setTemplate.tempo,
            restSeconds: setTemplate.restSeconds,
            notes: setTemplate.notes,
          })),
        })),
      })),
    })),
  };
}

function assertFreshClone(source, clone) {
  const sourceIds = collectIds(source);
  const cloneIds = collectIds(clone);
  assert.notEqual(clone.id, source.id);

  for (const level of Object.keys(sourceIds)) {
    const sourceSet = new Set(sourceIds[level]);
    assert.equal(cloneIds[level].some((id) => sourceSet.has(id)), false, `${level} PK overlap`);
  }

  const workoutIds = new Set(cloneIds.workouts);
  const blockIds = new Set(cloneIds.blocks);
  const exerciseIds = new Set(cloneIds.exercises);
  clone.workouts.forEach((workout) => {
    assert.equal(workout.weeklyPlanVersionId, clone.id);
    assert.equal(workout.contentRevision, 1);
    workout.blocks.forEach((block) => {
      assert.ok(workoutIds.has(block.weeklyPlanWorkoutId));
      assert.equal(block.weeklyPlanWorkoutId, workout.id);
      block.exercises.forEach((exercise) => {
        assert.ok(blockIds.has(exercise.weeklyPlanWorkoutBlockId));
        assert.equal(exercise.weeklyPlanWorkoutBlockId, block.id);
        exercise.setTemplates.forEach((setTemplate) => {
          assert.ok(exerciseIds.has(setTemplate.weeklyPlanBlockExerciseId));
          assert.equal(setTemplate.weeklyPlanBlockExerciseId, exercise.id);
        });
      });
    });
  });
  assert.deepEqual(businessProjection(clone), businessProjection(source));
}

test('published Weekly trees clone through fresh, lossless, reusable batched draft generations', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const prisma = getPrisma();
  await seedExercise(prisma);
  await seedExercise(prisma, 'ex_treadmill_test');
  await prisma.exercise.update({
    where: { exerciseId: 'ex_treadmill_test' },
    data: {
      name: 'Treadmill Walk',
      trainingType: 'cardio',
      cardioModality: 'treadmill_walk',
    },
  });
  const user = await createUser({ email: 'weekly-clone-batching@example.com' });
  const created = await createWeeklyPlan(buildLargePublishedPlan(user.id), {
    initialStatus: 'PUBLISHED',
  });
  const sourceId = created.weeklyPlanVersionId;
  const sourceBefore = await prisma.weeklyPlanVersion.findUnique({
    where: { id: sourceId },
    include: treeInclude,
  });

  const firstDraftResponse = await openOrCreateEditDraft(
    created.weeklyPlanParentId,
    user.id
  );
  const firstDraft = await prisma.weeklyPlanVersion.findUnique({
    where: { id: firstDraftResponse.weeklyPlanVersionId },
    include: treeInclude,
  });
  assert.equal(firstDraft.status, 'DRAFT');
  assert.equal(firstDraft.originVersionId, sourceId);
  assertFreshClone(sourceBefore, firstDraft);

  const sourceAfterClone = await prisma.weeklyPlanVersion.findUnique({
    where: { id: sourceId },
    include: treeInclude,
  });
  assert.deepEqual(sourceAfterClone, sourceBefore);

  const reusedDraft = await openOrCreateEditDraft(created.weeklyPlanParentId, user.id);
  assert.equal(reusedDraft.weeklyPlanVersionId, firstDraft.id);

  await prisma.weeklyPlanWorkout.update({
    where: { id: firstDraft.workouts[0].id },
    data: { contentRevision: 9 },
  });
  await publishWeeklyPlanDraft(created.weeklyPlanParentId, { userId: user.id });
  const publishedFirstDraft = await prisma.weeklyPlanVersion.findUnique({
    where: { id: firstDraft.id },
    include: treeInclude,
  });
  const secondDraftResponse = await openOrCreateEditDraft(
    created.weeklyPlanParentId,
    user.id
  );
  const secondDraft = await prisma.weeklyPlanVersion.findUnique({
    where: { id: secondDraftResponse.weeklyPlanVersionId },
    include: treeInclude,
  });

  assert.equal(publishedFirstDraft.status, 'PUBLISHED');
  assert.equal(secondDraft.status, 'DRAFT');
  assert.notEqual(secondDraft.id, firstDraft.id);
  assert.equal(secondDraft.originVersionId, firstDraft.id);
  assertFreshClone(publishedFirstDraft, secondDraft);
  assert.deepEqual(secondDraft.workouts.map((workout) => workout.contentRevision), [
    1, 1, 1, 1, 1, 1,
  ]);
});
