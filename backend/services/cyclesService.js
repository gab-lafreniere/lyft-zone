const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');

const CYCLE_STATUSES = new Set(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
const TRAINING_MODES = new Set(['FIXED', 'AI_COACH']);
const PLAN_SOURCE_TYPES = new Set(['SYSTEM', 'USER', 'AI']);
const PLAN_STATUSES = new Set(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED']);
const DAY_OF_WEEK = new Set([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
const BLOCK_TYPES = new Set(['SINGLE', 'SUPERSET', 'GIANT_SET', 'CIRCUIT']);
const BLOCK_REST_STRATEGIES = new Set(['NONE', 'AFTER_EXERCISE', 'AFTER_ROUND']);
const SET_TYPES = new Set([
  'WARMUP',
  'WORKING',
  'TOP_SET',
  'BACKOFF',
  'DROP_SET',
  'AMRAP',
]);
const INTENSIFICATION_METHODS = new Set([
  'NONE',
  'DROP_SET',
  'REST_PAUSE',
  'MYO_REPS',
  'TEMPO_EMPHASIS',
  'PAUSE_REPS',
  'PARTIALS',
]);

function isValidDate(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function assertEnumValue(value, allowedValues, fieldName) {
  if (value == null) {
    return;
  }

  if (!allowedValues.has(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} is invalid`);
  }
}

function assertUniqueIndexes(items, key, messagePrefix, path) {
  const seen = new Set();

  for (const item of items) {
    const value = item[key];
    if (value == null) {
      continue;
    }

    if (seen.has(value)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Duplicate ${messagePrefix} ${value} in ${path}`);
    }

    seen.add(value);
  }
}

function validatePlanPayload(payload) {
  if (!String(payload.name || '').trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
  }

  if (!Array.isArray(payload.weeks) || payload.weeks.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'weeks must be a non-empty array');
  }

  assertEnumValue(payload.sourceType ?? 'SYSTEM', PLAN_SOURCE_TYPES, 'sourceType');
  assertEnumValue(payload.status ?? 'ACTIVE', PLAN_STATUSES, 'status');

  if (payload.publishedAt != null && !isValidDate(payload.publishedAt)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'publishedAt must be a valid ISO date');
  }

  assertUniqueIndexes(payload.weeks, 'orderIndex', 'week orderIndex', 'weeks');
  assertUniqueIndexes(payload.weeks, 'weekNumber', 'weekNumber', 'weeks');

  for (let weekIndex = 0; weekIndex < payload.weeks.length; weekIndex += 1) {
    const week = payload.weeks[weekIndex];

    if (week.weekNumber == null) {
      throw new ApiError(400, 'VALIDATION_ERROR', `weekNumber is required for weeks[${weekIndex}]`);
    }

    if (week.orderIndex == null) {
      throw new ApiError(400, 'VALIDATION_ERROR', `orderIndex is required for weeks[${weekIndex}]`);
    }

    if (!Array.isArray(week.workouts) || week.workouts.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', `workouts must be a non-empty array for weeks[${weekIndex}]`);
    }

    assertUniqueIndexes(
      week.workouts,
      'orderIndex',
      'workout orderIndex',
      `weeks[${weekIndex}].workouts`
    );

    for (let workoutIndex = 0; workoutIndex < week.workouts.length; workoutIndex += 1) {
      const workout = week.workouts[workoutIndex];

      if (!String(workout.name || '').trim()) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `name is required for weeks[${weekIndex}].workouts[${workoutIndex}]`
        );
      }

      if (workout.orderIndex == null) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `orderIndex is required for weeks[${weekIndex}].workouts[${workoutIndex}]`
        );
      }

      assertEnumValue(workout.scheduledDay, DAY_OF_WEEK, 'scheduledDay');

      if (!Array.isArray(workout.blocks) || workout.blocks.length === 0) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `blocks must be a non-empty array for weeks[${weekIndex}].workouts[${workoutIndex}]`
        );
      }

      assertUniqueIndexes(
        workout.blocks,
        'orderIndex',
        'block orderIndex',
        `weeks[${weekIndex}].workouts[${workoutIndex}].blocks`
      );

      for (let blockIndex = 0; blockIndex < workout.blocks.length; blockIndex += 1) {
        const block = workout.blocks[blockIndex];

        if (block.orderIndex == null) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `orderIndex is required for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}]`
          );
        }

        if (!block.blockType) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `blockType is required for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}]`
          );
        }

        assertEnumValue(block.blockType, BLOCK_TYPES, 'blockType');
        assertEnumValue(block.restStrategy, BLOCK_REST_STRATEGIES, 'restStrategy');

        if (!Array.isArray(block.exercises) || block.exercises.length === 0) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `exercises must be a non-empty array for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}]`
          );
        }

        assertUniqueIndexes(
          block.exercises,
          'orderIndex',
          'exercise orderIndex',
          `weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises`
        );

        for (let exerciseIndex = 0; exerciseIndex < block.exercises.length; exerciseIndex += 1) {
          const exercise = block.exercises[exerciseIndex];

          if (!String(exercise.exerciseId || '').trim()) {
            throw new ApiError(
              400,
              'VALIDATION_ERROR',
              `exerciseId is required for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}]`
            );
          }

          if (exercise.orderIndex == null) {
            throw new ApiError(
              400,
              'VALIDATION_ERROR',
              `orderIndex is required for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}]`
            );
          }

          assertEnumValue(
            exercise.intensificationMethod,
            INTENSIFICATION_METHODS,
            'intensificationMethod'
          );

          if (!Array.isArray(exercise.setTemplates) || exercise.setTemplates.length === 0) {
            throw new ApiError(
              400,
              'VALIDATION_ERROR',
              `setTemplates must be a non-empty array for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}]`
            );
          }

          assertUniqueIndexes(
            exercise.setTemplates,
            'setIndex',
            'setIndex',
            `weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}].setTemplates`
          );

          for (let setIndex = 0; setIndex < exercise.setTemplates.length; setIndex += 1) {
            const setTemplate = exercise.setTemplates[setIndex];

            if (setTemplate.setIndex == null) {
              throw new ApiError(
                400,
                'VALIDATION_ERROR',
                `setIndex is required for weeks[${weekIndex}].workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}].setTemplates[${setIndex}]`
              );
            }

            assertEnumValue(setTemplate.setType ?? 'WORKING', SET_TYPES, 'setType');
          }
        }
      }
    }
  }
}

function mapPlanInput(payload) {
  return {
    name: String(payload.name).trim(),
    sourceType: payload.sourceType ?? 'SYSTEM',
    status: payload.status ?? 'ACTIVE',
    isReference: payload.isReference ?? true,
    changeSummary: payload.changeSummary ?? undefined,
    generationContext: payload.generationContext ?? undefined,
    publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : undefined,
    weeks: {
      create: payload.weeks.map((week) => ({
        weekNumber: week.weekNumber,
        orderIndex: week.orderIndex,
        label: week.label ?? undefined,
        notes: week.notes ?? undefined,
        workouts: {
          create: week.workouts.map((workout) => ({
            name: workout.name,
            orderIndex: workout.orderIndex,
            scheduledDay: workout.scheduledDay ?? undefined,
            estimatedDurationMinutes: workout.estimatedDurationMinutes ?? undefined,
            notes: workout.notes ?? undefined,
            blocks: {
              create: workout.blocks.map((block) => ({
                orderIndex: block.orderIndex,
                blockType: block.blockType,
                label: block.label ?? undefined,
                roundCount: block.roundCount ?? undefined,
                restStrategy: block.restStrategy ?? undefined,
                restSeconds: block.restSeconds ?? undefined,
                notes: block.notes ?? undefined,
                blockExercises: {
                  create: block.exercises.map((exercise) => ({
                    exerciseId: exercise.exerciseId,
                    orderIndex: exercise.orderIndex,
                    executionNotes: exercise.executionNotes ?? undefined,
                    defaultTempo: exercise.defaultTempo ?? undefined,
                    defaultRestSeconds: exercise.defaultRestSeconds ?? undefined,
                    defaultTargetRir: exercise.defaultTargetRir ?? undefined,
                    defaultTargetRpe: exercise.defaultTargetRpe ?? undefined,
                    intensificationMethod: exercise.intensificationMethod ?? undefined,
                    notes: exercise.notes ?? undefined,
                    setTemplates: {
                      create: exercise.setTemplates.map((setTemplate) => ({
                        setIndex: setTemplate.setIndex,
                        setType: setTemplate.setType ?? 'WORKING',
                        targetReps: setTemplate.targetReps ?? undefined,
                        minReps: setTemplate.minReps ?? undefined,
                        maxReps: setTemplate.maxReps ?? undefined,
                        targetSeconds: setTemplate.targetSeconds ?? undefined,
                        targetRir: setTemplate.targetRir ?? undefined,
                        targetRpe: setTemplate.targetRpe ?? undefined,
                        tempo: setTemplate.tempo ?? undefined,
                        restSeconds: setTemplate.restSeconds ?? undefined,
                        notes: setTemplate.notes ?? undefined,
                      })),
                    },
                  })),
                },
              })),
            },
          })),
        },
      })),
    },
  };
}

const fullPlanInclude = {
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
                include: {
                  exercise: {
                    select: {
                      exerciseId: true,
                      name: true,
                      equipmentCategory: true,
                      bodyParts: true,
                      targetMuscles: true,
                    },
                  },
                  setTemplates: {
                    orderBy: { setIndex: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

function serializePlan(plan) {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((workout) => ({
        ...workout,
        blocks: workout.blocks.map((block) => {
          const { blockExercises, ...blockFields } = block;

          return {
            ...blockFields,
            exercises: blockExercises.map((blockExercise) => ({
              id: blockExercise.id,
              workoutBlockId: blockExercise.workoutBlockId,
              exerciseId: blockExercise.exerciseId,
              orderIndex: blockExercise.orderIndex,
              executionNotes: blockExercise.executionNotes,
              defaultTempo: blockExercise.defaultTempo,
              defaultRestSeconds: blockExercise.defaultRestSeconds,
              defaultTargetRir: blockExercise.defaultTargetRir,
              defaultTargetRpe: blockExercise.defaultTargetRpe,
              intensificationMethod: blockExercise.intensificationMethod,
              notes: blockExercise.notes,
              createdAt: blockExercise.createdAt,
              updatedAt: blockExercise.updatedAt,
              exercise: blockExercise.exercise,
              setTemplates: blockExercise.setTemplates,
            })),
          };
        }),
      })),
    })),
  };
}

async function createCycle(payload) {
  const prisma = getPrisma();
  const {
    userId,
    name,
    startDate,
    endDate,
    durationWeeks,
    mode,
    status = 'PLANNED',
    goalSnapshot,
    profileSnapshot,
    notes,
  } = payload;

  if (!userId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
  }

  if (!String(name || '').trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
  }

  if (!startDate || !isValidDate(startDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'startDate must be a valid date');
  }

  if (!endDate || !isValidDate(endDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must be a valid date');
  }

  if (durationWeeks == null || Number.isNaN(Number(durationWeeks))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'durationWeeks is required');
  }

  if (!mode) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'mode is required');
  }

  assertEnumValue(mode, TRAINING_MODES, 'mode');
  assertEnumValue(status, CYCLE_STATUSES, 'status');

  if (new Date(endDate) < new Date(startDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must be on or after startDate');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  return prisma.trainingCycle.create({
    data: {
      userId,
      name: String(name).trim(),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      durationWeeks: Number(durationWeeks),
      mode,
      status,
      goalSnapshot: goalSnapshot ?? undefined,
      profileSnapshot: profileSnapshot ?? undefined,
      notes: notes ?? undefined,
    },
  });
}

async function createPlanForCycle(cycleId, payload) {
  const prisma = getPrisma();

  if (!cycleId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'cycleId is required');
  }

  validatePlanPayload(payload);

  const cycle = await prisma.trainingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  const exerciseIds = new Set();
  for (const week of payload.weeks) {
    for (const workout of week.workouts) {
      for (const block of workout.blocks) {
        for (const exercise of block.exercises) {
          exerciseIds.add(exercise.exerciseId);
        }
      }
    }
  }

  const exercises = await prisma.exercise.findMany({
    where: {
      exerciseId: {
        in: Array.from(exerciseIds),
      },
    },
    select: { exerciseId: true },
  });

  const existingIds = new Set(exercises.map((exercise) => exercise.exerciseId));
  for (const exerciseId of exerciseIds) {
    if (!existingIds.has(exerciseId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Unknown exerciseId: ${exerciseId}`);
    }
  }

  const plan = await prisma.$transaction(async (tx) => {
    const latestPlan = await tx.plan.findFirst({
      where: { trainingCycleId: cycleId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const createdPlan = await tx.plan.create({
      data: {
        trainingCycleId: cycleId,
        versionNumber: (latestPlan?.versionNumber ?? 0) + 1,
        ...mapPlanInput(payload),
      },
      include: fullPlanInclude,
    });

    return createdPlan;
  });

  return serializePlan(plan);
}

async function getCycleFull(cycleId) {
  const prisma = getPrisma();

  if (!cycleId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'cycleId is required');
  }

  const cycle = await prisma.trainingCycle.findUnique({
    where: { id: cycleId },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  let currentPlan = await prisma.plan.findFirst({
    where: {
      trainingCycleId: cycleId,
      status: 'ACTIVE',
    },
    orderBy: { versionNumber: 'desc' },
    include: fullPlanInclude,
  });

  if (!currentPlan) {
    currentPlan = await prisma.plan.findFirst({
      where: {
        trainingCycleId: cycleId,
        isReference: true,
      },
      orderBy: { versionNumber: 'desc' },
      include: fullPlanInclude,
    });
  }

  return {
    cycle,
    currentPlan: serializePlan(currentPlan),
  };
}

module.exports = {
  createCycle,
  createPlanForCycle,
  getCycleFull,
};
