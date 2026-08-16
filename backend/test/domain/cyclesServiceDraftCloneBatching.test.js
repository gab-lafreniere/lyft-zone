// Regression coverage for the batched draft/publish clone.
//
// A deeply-nested `plan.create` emitted roughly one INSERT per row. On a six-day,
// six-week cycle (~1.7k rows) that overran the interactive transaction budget, and the
// rollback surfaced as a foreign-key violation on whichever child insert was still in
// flight. Both clone paths now build the plan shell and hand the weeks to
// appendPlanWeeks, which batches each level with createManyAndReturn.
//
// These tests assert the write *shape*, not just the resulting data: the defect was
// invisible to a structural assertion because the nested create produced correct data
// whenever it was given enough time.

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

const {
  openOrCreateCycleEditDraft,
  publishCycleDraft,
} = require('../../services/cyclesService');

const USER_ID = 'user_clone_batching';
const CYCLE_ID = 'cycle_clone_batching';
const PUBLISHED_PLAN_ID = 'plan_published_1';
const DRAFT_PLAN_ID = 'plan_draft_1';

const TIMEZONE = 'America/Toronto';
const START_DATE = new Date('2026-09-07T00:00:00.000Z');
const END_DATE = new Date('2026-10-18T00:00:00.000Z');
const DURATION_WEEKS = 6;

// ---------------------------------------------------------------- source graph

function buildSetTemplate(blockExerciseId, setIndex) {
  return {
    id: `${blockExerciseId}_set_${setIndex}`,
    blockExerciseId,
    setIndex,
    setType: 'WORKING',
    targetReps: 8 + setIndex,
    minReps: null,
    maxReps: null,
    targetSeconds: null,
    targetRir: 2,
    targetRpe: null,
    tempo: '3010',
    restSeconds: 90,
    notes: `set ${setIndex}`,
  };
}

function buildBlockExercise(blockId, orderIndex, { setCount = 3 } = {}) {
  const id = `${blockId}_ex_${orderIndex}`;
  return {
    id,
    workoutBlockId: blockId,
    exerciseId: `exr_movement_${orderIndex}`,
    exerciseName: `Movement ${orderIndex}`,
    // serializePlan resolves the display name from the joined relation.
    exercise: {
      name: `Movement ${orderIndex}`,
      bodyParts: ['chest'],
      muscleFocus: ['chest'],
    },
    bodyParts: ['chest'],
    muscleFocus: ['chest'],
    orderIndex,
    executionNotes: `execution ${orderIndex}`,
    defaultTempo: '3010',
    defaultRestSeconds: 90,
    defaultTargetRir: 2,
    defaultTargetRpe: null,
    intensificationMethod: 'NONE',
    cardioPrescription: null,
    notes: `notes ${orderIndex}`,
    setTemplates: Array.from(
      { length: setCount },
      (_, index) => buildSetTemplate(id, index + 1)
    ),
  };
}

function buildBlock(workoutId, orderIndex, options = {}) {
  const id = `${workoutId}_block_${orderIndex}`;
  const { exerciseCount = 2, setCount = 3 } = options;
  return {
    id,
    workoutId,
    orderIndex,
    blockType: exerciseCount > 1 ? 'SUPERSET' : 'SINGLE',
    label: `Block ${orderIndex}`,
    roundCount: exerciseCount > 1 ? 3 : null,
    restStrategy: exerciseCount > 1 ? 'AFTER_ROUND' : 'AFTER_SET',
    restSeconds: 90,
    notes: null,
    blockExercises: Array.from(
      { length: exerciseCount },
      (_, index) => buildBlockExercise(id, index + 1, { setCount })
    ),
  };
}

function buildWorkout(weekId, orderIndex, options = {}) {
  const id = `${weekId}_workout_${orderIndex}`;
  const { blockCount = 5 } = options;
  return {
    id,
    planWeekId: weekId,
    name: `Day ${orderIndex}`,
    orderIndex,
    scheduledDay: null,
    estimatedDurationMinutes: 120,
    notes: null,
    blocks: Array.from(
      { length: blockCount },
      (_, index) => buildBlock(id, index + 1, options)
    ),
  };
}

function buildWeek(planId, weekNumber, options = {}) {
  const id = `${planId}_week_${weekNumber}`;
  const { workoutCount = 6 } = options;
  return {
    id,
    planId,
    weekNumber,
    orderIndex: weekNumber,
    label: `Week ${weekNumber}`,
    notes: null,
    workouts: Array.from(
      { length: workoutCount },
      (_, index) => buildWorkout(id, index + 1, options)
    ),
  };
}

function buildPlan(planId, status, options = {}) {
  const { weekCount = 6 } = options;
  return {
    id: planId,
    trainingCycleId: CYCLE_ID,
    parentPlanId: null,
    name: 'Six day hypertrophy',
    versionNumber: status === 'PUBLISHED' ? 1 : 2,
    sourceType: 'USER',
    status,
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: DURATION_WEEKS,
    publishedAt: status === 'PUBLISHED' ? new Date('2026-08-14T00:00:00.000Z') : null,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    weeks: Array.from(
      { length: weekCount },
      (_, index) => buildWeek(planId, index + 1, options)
    ),
  };
}

function countRows(plan) {
  const weeks = plan.weeks;
  const workouts = weeks.flatMap((week) => week.workouts);
  const blocks = workouts.flatMap((workout) => workout.blocks);
  const exercises = blocks.flatMap((block) => block.blockExercises);
  const sets = exercises.flatMap((exercise) => exercise.setTemplates);
  return {
    weeks: weeks.length,
    workouts: workouts.length,
    blocks: blocks.length,
    exercises: exercises.length,
    sets: sets.length,
    total: weeks.length + workouts.length + blocks.length + exercises.length + sets.length,
  };
}

// ---------------------------------------------------------------- prisma harness

function createHarness({ plans, existingDraft = null, planCreateError = null }) {
  const calls = [];
  let idCounter = 0;
  const nextId = (prefix) => {
    idCounter += 1;
    return `${prefix}_${idCounter}`;
  };

  // Rows written during the transaction, so parent/child integrity can be verified.
  const written = {
    plans: [],
    weeks: [],
    workouts: [],
    blocks: [],
    exercises: [],
    sets: [],
  };

  const cycle = {
    id: CYCLE_ID,
    userId: USER_ID,
    name: 'Six day hypertrophy',
    startDate: START_DATE,
    endDate: END_DATE,
    durationWeeks: DURATION_WEEKS,
    timezone: TIMEZONE,
    status: 'PLANNED',
    plans,
  };

  function hydratePlan(planId) {
    const weeks = written.weeks
      .filter((week) => week.planId === planId)
      .map((week) => ({
        ...week,
        workouts: written.workouts
          .filter((workout) => workout.planWeekId === week.id)
          .map((workout) => ({
            ...workout,
            blocks: written.blocks
              .filter((block) => block.workoutId === workout.id)
              .map((block) => ({
                ...block,
                blockExercises: written.exercises
                  .filter((exercise) => exercise.workoutBlockId === block.id)
                  .map((exercise) => ({
                    ...exercise,
                    exercise: { name: exercise.exerciseId, bodyParts: [], muscleFocus: [] },
                    setTemplates: written.sets
                      .filter((set) => set.blockExerciseId === exercise.id),
                  })),
              })),
          })),
      }));
    const plan = written.plans.find((entry) => entry.id === planId);
    return plan ? { ...plan, weeks } : null;
  }

  const tx = {
    plan: {
      findFirst: async ({ where }) => {
        calls.push({ model: 'plan', op: 'findFirst' });
        if (where?.status === 'DRAFT') {
          return existingDraft;
        }
        return null;
      },
      findMany: async ({ where }) => {
        calls.push({ model: 'plan', op: 'findMany' });
        if (where?.status === 'DRAFT') {
          return existingDraft ? [existingDraft] : [];
        }
        return plans;
      },
      deleteMany: async () => {
        calls.push({ model: 'plan', op: 'deleteMany' });
        return { count: 0 };
      },
      findUnique: async ({ where }) => {
        calls.push({ model: 'plan', op: 'findUnique' });
        return hydratePlan(where.id);
      },
      create: async ({ data }) => {
        calls.push({ model: 'plan', op: 'create', data });
        if (planCreateError) {
          const error = planCreateError;
          planCreateError = null;
          throw error;
        }
        if (data.weeks) {
          throw new Error(
            'plan.create must not carry a nested weeks payload; weeks are appended in batches'
          );
        }
        const record = { ...data, id: nextId('plan'), weeks: [], updatedAt: new Date() };
        written.plans.push(record);
        return record;
      },
      update: async ({ where, data }) => {
        calls.push({ model: 'plan', op: 'update' });
        const record = written.plans.find((entry) => entry.id === where.id);
        if (record) Object.assign(record, data);
        return hydratePlan(where.id) || { ...where, ...data };
      },
      delete: async ({ where }) => {
        calls.push({ model: 'plan', op: 'delete', where });
        return { id: where.id };
      },
    },
    planWeek: {
      create: async ({ data }) => {
        calls.push({ model: 'planWeek', op: 'create' });
        const record = { ...data, id: nextId('week') };
        written.weeks.push(record);
        return record;
      },
    },
    workout: {
      createManyAndReturn: async ({ data }) => {
        calls.push({ model: 'workout', op: 'createManyAndReturn', count: data.length });
        const records = data.map((entry) => ({ ...entry, id: nextId('workout') }));
        written.workouts.push(...records);
        return records;
      },
    },
    workoutBlock: {
      createManyAndReturn: async ({ data }) => {
        calls.push({ model: 'workoutBlock', op: 'createManyAndReturn', count: data.length });
        const records = data.map((entry) => ({ ...entry, id: nextId('block') }));
        written.blocks.push(...records);
        return records;
      },
    },
    blockExercise: {
      createManyAndReturn: async ({ data }) => {
        calls.push({ model: 'blockExercise', op: 'createManyAndReturn', count: data.length });
        const records = data.map((entry) => ({ ...entry, id: nextId('exercise') }));
        written.exercises.push(...records);
        return records;
      },
    },
    exerciseSetTemplate: {
      createMany: async ({ data }) => {
        calls.push({ model: 'exerciseSetTemplate', op: 'createMany', count: data.length });
        const records = data.map((entry) => ({ ...entry, id: nextId('set') }));
        written.sets.push(...records);
        return { count: records.length };
      },
    },
    trainingCycle: {
      // Scheduled-session sync re-reads the cycle after publish, so freshly written
      // plans have to be visible alongside the fixture ones.
      findFirst: async () => ({
        ...cycle,
        plans: [
          ...written.plans
            .map((plan) => hydratePlan(plan.id))
            .filter(Boolean),
          ...plans,
        ],
      }),
      findUnique: async () => cycle,
      update: async ({ data }) => ({ ...cycle, ...data }),
    },
    scheduledSession: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    user: { findUnique: async () => ({ id: USER_ID }) },
  };

  // Publish revalidates the document, which resolves every exerciseId against the
  // library before writing.
  const knownExercises = {
    findMany: async ({ where }) => (where?.exerciseId?.in || []).map((exerciseId) => ({
      exerciseId,
      trainingType: 'strength',
      cardioModality: null,
    })),
  };

  prisma = {
    $transaction: async (operation) => operation(tx),
    user: { findUnique: async () => ({ id: USER_ID }) },
    trainingCycle: tx.trainingCycle,
    plan: tx.plan,
    exercise: knownExercises,
  };
  tx.exercise = knownExercises;

  return { calls, written, tx };
}

function writeShape(calls) {
  const perRowCreates = calls.filter(
    (call) => call.op === 'create'
      && ['workout', 'workoutBlock', 'blockExercise', 'exerciseSetTemplate'].includes(call.model)
  ).length;
  const batches = calls.filter(
    (call) => call.op === 'createManyAndReturn' || call.op === 'createMany'
  );
  return { perRowCreates, batches, batchCount: batches.length };
}

// ---------------------------------------------------------------- tests

test('edit draft clones a 6x6 plan with batched writes, not per-row creates', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED');
  const rows = countRows(published);
  const harness = createHarness({ plans: [published] });

  await openOrCreateCycleEditDraft(CYCLE_ID, { userId: USER_ID, timezone: TIMEZONE });

  const shape = writeShape(harness.calls);
  assert.ok(rows.total > 1500, `fixture must be large enough to matter (got ${rows.total})`);
  assert.equal(
    shape.perRowCreates,
    0,
    'no child row may be written with an individual create'
  );
  // One planWeek create plus four batches per week: workouts, blocks, exercises, sets.
  assert.ok(
    shape.batchCount <= rows.weeks * 4,
    `expected at most ${rows.weeks * 4} batched writes, got ${shape.batchCount}`
  );
  assert.ok(
    shape.batchCount < rows.total / 10,
    'batched write count must be an order of magnitude below the row count'
  );
});

test('cloned draft preserves counts, order and scalars exactly', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED');
  const expected = countRows(published);
  const harness = createHarness({ plans: [published] });

  await openOrCreateCycleEditDraft(CYCLE_ID, { userId: USER_ID, timezone: TIMEZONE });

  const { written } = harness;
  assert.equal(written.weeks.length, expected.weeks);
  assert.equal(written.workouts.length, expected.workouts);
  assert.equal(written.blocks.length, expected.blocks);
  assert.equal(written.exercises.length, expected.exercises);
  assert.equal(written.sets.length, expected.sets);

  const sourceWeek = published.weeks[0];
  const sourceWorkout = sourceWeek.workouts[0];
  const sourceBlock = sourceWorkout.blocks[0];
  const sourceExercise = sourceBlock.blockExercises[0];

  const clonedWorkout = written.workouts.find(
    (workout) => workout.name === sourceWorkout.name
  );
  assert.equal(clonedWorkout.orderIndex, sourceWorkout.orderIndex);
  assert.equal(
    clonedWorkout.estimatedDurationMinutes,
    sourceWorkout.estimatedDurationMinutes
  );

  const clonedBlock = written.blocks.find(
    (block) => block.workoutId === clonedWorkout.id
      && block.orderIndex === sourceBlock.orderIndex
  );
  assert.equal(clonedBlock.blockType, sourceBlock.blockType);
  assert.equal(clonedBlock.roundCount, sourceBlock.roundCount);
  assert.equal(clonedBlock.restStrategy, sourceBlock.restStrategy);
  assert.equal(clonedBlock.restSeconds, sourceBlock.restSeconds);

  const clonedExercise = written.exercises.find(
    (exercise) => exercise.workoutBlockId === clonedBlock.id
      && exercise.orderIndex === sourceExercise.orderIndex
  );
  assert.equal(clonedExercise.exerciseId, sourceExercise.exerciseId);
  assert.equal(clonedExercise.defaultTempo, sourceExercise.defaultTempo);
  assert.equal(clonedExercise.defaultRestSeconds, sourceExercise.defaultRestSeconds);
  assert.equal(clonedExercise.defaultTargetRir, sourceExercise.defaultTargetRir);

  const clonedSets = written.sets.filter(
    (set) => set.blockExerciseId === clonedExercise.id
  );
  assert.equal(clonedSets.length, sourceExercise.setTemplates.length);
  assert.deepEqual(
    clonedSets.map((set) => set.setIndex),
    sourceExercise.setTemplates.map((set) => set.setIndex)
  );
  assert.equal(clonedSets[0].tempo, sourceExercise.setTemplates[0].tempo);
  assert.equal(clonedSets[0].targetReps, sourceExercise.setTemplates[0].targetReps);
});

test('every cloned child points at a parent created in the same clone', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED');
  const harness = createHarness({ plans: [published] });

  await openOrCreateCycleEditDraft(CYCLE_ID, { userId: USER_ID, timezone: TIMEZONE });

  const { written } = harness;
  const planIds = new Set(written.plans.map((plan) => plan.id));
  const weekIds = new Set(written.weeks.map((week) => week.id));
  const workoutIds = new Set(written.workouts.map((workout) => workout.id));
  const blockIds = new Set(written.blocks.map((block) => block.id));
  const exerciseIds = new Set(written.exercises.map((exercise) => exercise.id));

  assert.ok(written.weeks.every((week) => planIds.has(week.planId)));
  assert.ok(written.workouts.every((workout) => weekIds.has(workout.planWeekId)));
  assert.ok(written.blocks.every((block) => workoutIds.has(block.workoutId)));
  assert.ok(
    written.exercises.every((exercise) => blockIds.has(exercise.workoutBlockId)),
    'this is the invariant the P2003 failure was reporting'
  );
  assert.ok(written.sets.every((set) => exerciseIds.has(set.blockExerciseId)));
});

test('empty child collections clone without emitting empty batches', async () => {
  // durationWeeks is asserted against week count, so the plan stays six weeks wide and
  // is thinned out inside instead.
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED', {
    workoutCount: 2,
    blockCount: 1,
    exerciseCount: 1,
    setCount: 0,
  });
  published.weeks[0].workouts[0].blocks = [];
  published.weeks[0].workouts[1].blocks[0].blockExercises = [];
  const expected = countRows(published);
  const harness = createHarness({ plans: [published] });

  await openOrCreateCycleEditDraft(CYCLE_ID, { userId: USER_ID, timezone: TIMEZONE });

  const { written, calls } = harness;
  assert.equal(written.workouts.length, expected.workouts);
  assert.equal(written.blocks.length, expected.blocks, 'a workout with no blocks writes none');
  assert.equal(written.exercises.length, expected.exercises);
  assert.equal(written.sets.length, 0, 'exercises with no set templates write none');
  assert.ok(
    calls.every((call) => !('count' in call) || call.count > 0),
    'no batch may be issued with an empty payload'
  );
});

test('draft shell keeps parentPlanId, versionNumber, sourceType, status and timeline', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED', {
    workoutCount: 1,
    blockCount: 1,
  });
  const harness = createHarness({ plans: [published] });

  await openOrCreateCycleEditDraft(CYCLE_ID, { userId: USER_ID, timezone: TIMEZONE });

  const shell = harness.calls.find(
    (call) => call.model === 'plan' && call.op === 'create'
  ).data;
  assert.equal(shell.parentPlanId, PUBLISHED_PLAN_ID);
  assert.equal(shell.versionNumber, published.versionNumber + 1);
  assert.equal(shell.sourceType, published.sourceType);
  assert.equal(shell.status, 'DRAFT');
  assert.equal(shell.trainingCycleId, CYCLE_ID);
  assert.equal(shell.durationWeeks, DURATION_WEEKS);
  assert.ok(shell.startDate instanceof Date);
  assert.ok(shell.endDate instanceof Date);
  assert.equal(shell.weeks, undefined, 'weeks must not ride along on the shell');
});

test('P2002 on the shell still recovers the concurrently created draft', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED', {
    workoutCount: 1,
    blockCount: 1,
  });
  const concurrent = buildPlan(DRAFT_PLAN_ID, 'DRAFT', {
    workoutCount: 1,
    blockCount: 1,
  });
  const conflict = Object.assign(new Error('unique constraint'), { code: 'P2002' });

  let findFirstCall = 0;
  const harness = createHarness({ plans: [published], planCreateError: conflict });
  harness.tx.plan.findFirst = async ({ where }) => {
    findFirstCall += 1;
    // First lookup (pre-create) finds nothing; the post-conflict lookup finds the winner.
    if (where?.status === 'DRAFT' && findFirstCall > 1) {
      return concurrent;
    }
    return null;
  };

  const result = await openOrCreateCycleEditDraft(CYCLE_ID, {
    userId: USER_ID,
    timezone: TIMEZONE,
  });

  assert.equal(result.planId, DRAFT_PLAN_ID);
  assert.equal(result.status, 'DRAFT');
});

test('publish draft also clones through the batched path', async () => {
  const published = buildPlan(PUBLISHED_PLAN_ID, 'PUBLISHED');
  const draft = buildPlan(DRAFT_PLAN_ID, 'DRAFT');
  const rows = countRows(draft);
  const harness = createHarness({ plans: [published, draft], existingDraft: draft });

  // publishCycleDraft commits the clone, then regenerates scheduled sessions outside the
  // transaction. That post-commit step must complete: it previously threw a
  // ReferenceError because regenerateScheduledSessionsForPublishedCycle was called
  // without being imported, surfacing as SCHEDULE_SYNC_FAILED after the publish had
  // already been written.
  await publishCycleDraft(CYCLE_ID, {
    userId: USER_ID,
    planId: DRAFT_PLAN_ID,
    timezone: TIMEZONE,
  });

  const shape = writeShape(harness.calls);
  assert.equal(shape.perRowCreates, 0, 'publish must not write child rows individually');
  assert.ok(shape.batchCount > 0, 'publish must use batched writes');
  assert.ok(
    shape.batchCount < rows.total / 10,
    'publish batched write count must be an order of magnitude below the row count'
  );

  const publishedShell = harness.calls
    .filter((call) => call.model === 'plan' && call.op === 'create')
    .map((call) => call.data)
    .pop();
  assert.equal(publishedShell.status, 'PUBLISHED');
  assert.equal(publishedShell.parentPlanId, DRAFT_PLAN_ID);
  assert.equal(publishedShell.versionNumber, 3);
  assert.ok(publishedShell.publishedAt instanceof Date);
  assert.equal(publishedShell.weeks, undefined);
});
