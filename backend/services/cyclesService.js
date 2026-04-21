const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');
const { regenerateScheduledSessionsForPublishedCycle } = require('./scheduledSessionsService');
const {
  normalizeNullableNumber,
  normalizeNullableInteger,
  normalizeNullableString,
} = require('../utils/normalizers');
const {
  DEFAULT_TIMEZONE,
  addDays,
  compareDateKeys,
  diffDateKeys,
  getEndOfMondayWeek,
  getLocalDateTimeParts,
  getStartOfMondayWeek,
  getStartOfSundayWeek,
  getTodayDateKey,
  isWithinGraceWindow,
  isDateWithinRange,
  parseDateInput,
  rangesOverlap,
  resolveEffectiveTimezone,
  toDateKey,
} = require('./cycleDateUtils');


const CYCLE_STATUSES = new Set(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
const TRAINING_MODES = new Set(['FIXED', 'AI_COACH']);
const PLAN_SOURCE_TYPES = new Set(['SYSTEM', 'USER', 'AI']);
const PLAN_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'SUPERSEDED']);
const MAX_CYCLE_DURATION_WEEKS = 8;
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

const draftMutationInclude = {
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

const weeklySourceVersionInclude = {
  workouts: {
    orderBy: { orderIndex: 'asc' },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          exercises: {
            orderBy: { orderIndex: 'asc' },
            include: {
              setTemplates: {
                orderBy: { setIndex: 'asc' },
              },
            },
          },
        },
      },
    },
  },
};

function isValidDate(value) {
  return Boolean(parseDateInput(value));
}

function ensureNotPastDate(dateKey, todayDateKey, fieldName) {
  if (compareDateKeys(dateKey, todayDateKey) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} cannot be in the past`);
  }
}

function normalizeCanonicalMultiWeekDateRange(
  startDateInput,
  durationWeeksInput,
  requestedEndDateInput = null,
  startFieldName = 'startDate',
  endFieldName = 'endDate'
) {
  const startDateKey = toDateKey(startDateInput);
  if (!startDateKey) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${startFieldName} must be a valid date`);
  }

  if (startDateKey !== getStartOfMondayWeek(startDateKey)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${startFieldName} must be a Monday`);
  }

  const durationWeeks = normalizeInt(durationWeeksInput, null);
  if (durationWeeks == null || durationWeeks < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'durationWeeks must be at least 1');
  }

  const endDateKey = addDays(startDateKey, durationWeeks * 7 - 1);
  const finalWeekStartDateKey = addDays(startDateKey, (durationWeeks - 1) * 7);
  if (endDateKey !== getEndOfMondayWeek(finalWeekStartDateKey)) {
    throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Unable to derive a canonical cycle endDate');
  }

  const requestedEndDateKey = toDateKey(requestedEndDateInput);
  if (requestedEndDateKey && requestedEndDateKey !== endDateKey) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${endFieldName} must match the derived cycle end date`
    );
  }

  return {
    startDateKey,
    endDateKey,
    durationWeeks,
  };
}

function trimDocumentWeeks(document, targetWeekCount) {
  const safeWeekCount = Math.max(1, normalizeInt(targetWeekCount, 1));

  return {
    ...document,
    weeks: (document.weeks || [])
      .slice(0, safeWeekCount)
      .map((week, index) => ({
        ...week,
        weekNumber: index + 1,
        orderIndex: index + 1,
        label: week.label || `Week ${index + 1}`,
      })),
  };
}

function stripTimelineIdentityFields(record = {}, fields = []) {
  const clone = { ...record };
  fields.forEach((field) => {
    delete clone[field];
  });
  return clone;
}

function cloneSetTemplateForTimelineExtension(setTemplate = {}) {
  const clone = stripTimelineIdentityFields(setTemplate, ['id', 'blockExerciseId']);
  return clone;
}

function cloneExerciseForTimelineExtension(exercise = {}) {
  const clone = stripTimelineIdentityFields(exercise, [
    'id',
    'workoutBlockId',
    'exercise',
    'setTemplates',
  ]);
  const setTemplates = Array.isArray(exercise.setTemplates) ? exercise.setTemplates : [];

  return {
    ...clone,
    bodyParts: Array.isArray(exercise.bodyParts) ? [...exercise.bodyParts] : [],
    muscleFocus: Array.isArray(exercise.muscleFocus) ? [...exercise.muscleFocus] : [],
    setTemplates: setTemplates.map(cloneSetTemplateForTimelineExtension),
  };
}

function cloneBlockForTimelineExtension(block = {}) {
  const clone = stripTimelineIdentityFields(block, [
    'id',
    'workoutId',
    'blockExercises',
    'exercises',
  ]);
  const exercises = Array.isArray(block.exercises) ? block.exercises : [];

  return {
    ...clone,
    exercises: exercises.map(cloneExerciseForTimelineExtension),
  };
}

function cloneWorkoutForTimelineExtension(workout = {}) {
  const clone = stripTimelineIdentityFields(workout, ['id', 'planWeekId', 'blocks']);
  const blocks = Array.isArray(workout.blocks) ? workout.blocks : [];

  return {
    ...clone,
    blocks: blocks.map(cloneBlockForTimelineExtension),
  };
}

function cloneWeekForTimelineExtension(sourceWeek = {}, targetWeekNumber) {
  return {
    weekNumber: targetWeekNumber,
    orderIndex: targetWeekNumber,
    label: `Week ${targetWeekNumber}`,
    notes: sourceWeek.notes,
    workouts: (Array.isArray(sourceWeek.workouts) ? sourceWeek.workouts : []).map(
      cloneWorkoutForTimelineExtension
    ),
  };
}

function validateTimelineExtensionSource(document, sourceWeekNumber) {
  const normalizedSourceWeekNumber = normalizeInt(sourceWeekNumber, null);
  if (normalizedSourceWeekNumber == null) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'sourceWeekNumber is required when extending a cycle'
    );
  }

  const sourceWeek = (document.weeks || []).find(
    (week) => Number(week.weekNumber) === normalizedSourceWeekNumber
  );

  if (!sourceWeek) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'sourceWeekNumber must reference an existing week'
    );
  }

  return sourceWeek;
}

function extendDocumentWeeks(document, targetWeekCount, sourceWeekNumber) {
  const safeWeekCount = Math.max(1, normalizeInt(targetWeekCount, 1));
  const sourceWeek = validateTimelineExtensionSource(document, sourceWeekNumber);
  const currentWeeks = (document.weeks || []).map((week, index) => ({
    ...week,
    weekNumber: index + 1,
    orderIndex: index + 1,
    label: week.label || `Week ${index + 1}`,
  }));

  const addedWeeks = [];
  for (let weekNumber = currentWeeks.length + 1; weekNumber <= safeWeekCount; weekNumber += 1) {
    addedWeeks.push(cloneWeekForTimelineExtension(sourceWeek, weekNumber));
  }

  return {
    ...document,
    weeks: [...currentWeeks, ...addedWeeks],
  };
}

function buildTimelineDocument(document, targetWeekCount, sourceWeekNumber = null) {
  const safeWeekCount = Math.max(1, normalizeInt(targetWeekCount, 1));
  const currentWeekCount = Array.isArray(document.weeks) ? document.weeks.length : 0;

  if (safeWeekCount < currentWeekCount) {
    return trimDocumentWeeks(document, safeWeekCount);
  }

  if (safeWeekCount > currentWeekCount) {
    return extendDocumentWeeks(document, safeWeekCount, sourceWeekNumber);
  }

  return trimDocumentWeeks(document, safeWeekCount);
}

function hasCompletePlanTimeline(plan) {
  return Boolean(plan?.startDate && plan?.endDate && plan?.durationWeeks != null);
}

function hasAnyPlanTimeline(plan) {
  return Boolean(plan?.startDate || plan?.endDate || plan?.durationWeeks != null);
}

function resolvePlanTimeline(cycle, plan) {
  const usePlanTimeline = hasCompletePlanTimeline(plan);

  if (hasAnyPlanTimeline(plan) && !usePlanTimeline) {
    throw new ApiError(
      500,
      'INTERNAL_SERVER_ERROR',
      'Plan timeline is incomplete'
    );
  }

  const source = usePlanTimeline ? plan : cycle;
  const startDateKey = toDateKey(source?.startDate);
  const endDateKey = toDateKey(source?.endDate);
  const durationWeeks = normalizeInt(source?.durationWeeks, null);

  if (!startDateKey || !endDateKey || durationWeeks == null) {
    throw new ApiError(
      500,
      'INTERNAL_SERVER_ERROR',
      'Unable to resolve plan timeline'
    );
  }

  return normalizeCanonicalMultiWeekDateRange(
    startDateKey,
    durationWeeks,
    endDateKey
  );
}

function buildPlanTimelineWrite(timeline) {
  return {
    startDate: parseDateInput(timeline.startDateKey),
    endDate: parseDateInput(timeline.endDateKey),
    durationWeeks: timeline.durationWeeks,
  };
}

function serializeTimeline(timeline) {
  return {
    startDate: timeline.startDateKey,
    endDate: timeline.endDateKey,
    durationWeeks: timeline.durationWeeks,
  };
}

function assertTimelineMatchesWeeks(timeline, weeks = [], context = 'Plan') {
  const weekCount = Array.isArray(weeks) ? weeks.length : 0;
  if (weekCount !== timeline.durationWeeks) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${context} week count must match durationWeeks`
    );
  }
}

function getCurrentCycleWeekNumber(cycle, timeZone, now = new Date()) {
  const todayDateKey = getTodayDateKey(timeZone, now);
  const startDateKey = toDateKey(cycle.startDate);
  const totalWeeks = Math.max(1, normalizeInt(cycle.durationWeeks, 1));

  return Math.min(
    totalWeeks,
    Math.max(1, Math.floor((diffDateKeys(startDateKey, todayDateKey) || 0) / 7) + 1)
  );
}

async function appendPlanWeeks(tx, planId, weeks = []) {
  for (const week of weeks) {
    await tx.planWeek.create({
      data: {
        planId,
        ...buildPlanCreateWeeksInput([week])[0],
      },
    });
  }

  return tx.plan.findUnique({
    where: { id: planId },
    include: fullPlanInclude,
  });
}

async function replacePlanWeeks(tx, planId, weeks) {
  await tx.exerciseSetTemplate.deleteMany({
    where: {
      blockExercise: {
        workoutBlock: {
          workout: {
            planWeek: {
              planId,
            },
          },
        },
      },
    },
  });

  await tx.blockExercise.deleteMany({
    where: {
      workoutBlock: {
        workout: {
          planWeek: {
            planId,
          },
        },
      },
    },
  });

  await tx.workoutBlock.deleteMany({
    where: {
      workout: {
        planWeek: {
          planId,
        },
      },
    },
  });

  await tx.workout.deleteMany({
    where: {
      planWeek: {
        planId,
      },
    },
  });

  await tx.planWeek.deleteMany({
    where: {
      planId,
    },
  });

  return tx.plan.update({
    where: { id: planId },
    data: {
      weeks: {
        create: buildPlanCreateWeeksInput(weeks),
      },
    },
    include: fullPlanInclude,
  });
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

function normalizeOptionalString(value) {
  return normalizeNullableString(value);
}

function normalizeInt(value, fallback = null) {
  const normalized = normalizeNullableInteger(value);
  return normalized == null ? fallback : normalized;
}

function normalizeNumeric(value) {
  return normalizeNullableNumber(value);
}

function normalizeWorkoutDayAssignments(assignments, sourceVersion) {
  const sourceWorkouts = Array.isArray(sourceVersion?.workouts) ? sourceVersion.workouts : [];

  if (sourceWorkouts.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No weekly workouts are available to convert');
  }

  if (sourceWorkouts.length > 7) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'This weekly template has more than 7 workouts and cannot use weekday assignment in V1.'
    );
  }

  if (!Array.isArray(assignments)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Each workout must be assigned exactly once.');
  }

  const validWorkoutOrderIndexes = new Set(sourceWorkouts.map((workout) => workout.orderIndex));
  const seenWorkoutOrderIndexes = new Set();
  const seenScheduledDays = new Set();
  const assignmentMap = new Map();

  for (const assignment of assignments) {
    const workoutOrderIndex = normalizeInt(assignment?.workoutOrderIndex, null);
    const scheduledDay = assignment?.scheduledDay ?? null;

    if (!validWorkoutOrderIndexes.has(workoutOrderIndex)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Each workout must be assigned exactly once.');
    }

    assertEnumValue(scheduledDay, DAY_OF_WEEK, 'scheduledDay');

    if (seenWorkoutOrderIndexes.has(workoutOrderIndex)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Each workout must be assigned exactly once.');
    }

    if (seenScheduledDays.has(scheduledDay)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Only one workout can be assigned to a given day.');
    }

    seenWorkoutOrderIndexes.add(workoutOrderIndex);
    seenScheduledDays.add(scheduledDay);
    assignmentMap.set(workoutOrderIndex, scheduledDay);
  }

  if (assignmentMap.size !== sourceWorkouts.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Each workout must be assigned exactly once.');
  }

  return assignmentMap;
}

function normalizeWorkoutsInput(workouts = []) {
  return Array.isArray(workouts)
    ? workouts.map((workout, workoutIndex) => ({
      id: workout.id,
      name: String(workout.name || '').trim(),
      orderIndex: normalizeInt(workout.orderIndex, workoutIndex + 1),
      scheduledDay: workout.scheduledDay ?? null,
      estimatedDurationMinutes: normalizeInt(workout.estimatedDurationMinutes, null),
      notes: normalizeOptionalString(workout.notes),
      blocks: Array.isArray(workout.blocks)
        ? workout.blocks.map((block, blockIndex) => ({
          id: block.id,
          orderIndex: normalizeInt(block.orderIndex, blockIndex + 1),
          blockType: block.blockType,
          label: normalizeOptionalString(block.label),
          roundCount: normalizeInt(block.roundCount, null),
          restStrategy: block.restStrategy ?? null,
          restSeconds: normalizeInt(block.restSeconds, null),
          notes: normalizeOptionalString(block.notes),
          exercises: Array.isArray(block.exercises)
            ? block.exercises.map((exercise, exerciseIndex) => ({
              id: exercise.id,
              exerciseId: normalizeOptionalString(exercise.exerciseId),
              exerciseName: String(exercise.exerciseName || '').trim(),
              bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
              muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
              orderIndex: normalizeInt(exercise.orderIndex, exerciseIndex + 1),
              executionNotes: normalizeOptionalString(exercise.executionNotes),
              defaultTempo: normalizeOptionalString(exercise.defaultTempo),
              defaultRestSeconds: normalizeInt(exercise.defaultRestSeconds, null),
              defaultTargetRir: normalizeNumeric(exercise.defaultTargetRir),
              defaultTargetRpe: normalizeNumeric(exercise.defaultTargetRpe),
              intensificationMethod: exercise.intensificationMethod ?? 'NONE',
              notes: normalizeOptionalString(exercise.notes),
              setTemplates: Array.isArray(exercise.setTemplates)
                ? exercise.setTemplates.map((setTemplate, setIndex) => ({
                  id: setTemplate.id,
                  setIndex: normalizeInt(setTemplate.setIndex, setIndex + 1),
                  setType: setTemplate.setType ?? 'WORKING',
                  targetReps: normalizeInt(setTemplate.targetReps, null),
                  minReps: normalizeInt(setTemplate.minReps, null),
                  maxReps: normalizeInt(setTemplate.maxReps, null),
                  targetSeconds: normalizeInt(setTemplate.targetSeconds, null),
                  targetRir: normalizeNumeric(setTemplate.targetRir),
                  targetRpe: normalizeNumeric(setTemplate.targetRpe),
                  tempo: normalizeOptionalString(setTemplate.tempo),
                  restSeconds: normalizeInt(setTemplate.restSeconds, null),
                  notes: normalizeOptionalString(setTemplate.notes),
                }))
                : [],
            }))
            : [],
        }))
        : [],
    }))
    : [];
}

function validateWorkoutsDocument(workouts = [], mode = 'draft', path = 'workouts') {
  assertUniqueIndexes(workouts, 'orderIndex', 'workout orderIndex', path);

  const normalizedNameCounts = new Map();
  workouts.forEach((workout, workoutIndex) => {
    const workoutPath = `${path}[${workoutIndex}]`;

    if (mode === 'publish' && !workout.name) {
      throw new ApiError(400, 'VALIDATION_ERROR', `name is required for ${workoutPath}`);
    }

    if (mode === 'publish' && workout.name) {
      const normalizedName = workout.name.toLowerCase();
      if (normalizedNameCounts.has(normalizedName)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Workout names must be unique inside a week');
      }
      normalizedNameCounts.set(normalizedName, true);
    }

    if (mode === 'publish' && (!Array.isArray(workout.blocks) || workout.blocks.length === 0)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `blocks must be a non-empty array for ${workoutPath}`);
    }

    assertUniqueIndexes(workout.blocks, 'orderIndex', 'block orderIndex', `${workoutPath}.blocks`);

    workout.blocks.forEach((block, blockIndex) => {
      const blockPath = `${workoutPath}.blocks[${blockIndex}]`;
      assertEnumValue(block.blockType, BLOCK_TYPES, 'blockType');
      assertEnumValue(block.restStrategy, BLOCK_REST_STRATEGIES, 'restStrategy');
      assertUniqueIndexes(block.exercises, 'orderIndex', 'exercise orderIndex', `${blockPath}.exercises`);

      if (mode === 'publish' && block.blockType === 'SINGLE' && block.exercises.length !== 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', `single blocks must contain exactly one exercise in ${blockPath}`);
      }

      block.exercises.forEach((exercise, exerciseIndex) => {
        const exercisePath = `${blockPath}.exercises[${exerciseIndex}]`;
        assertEnumValue(
          exercise.intensificationMethod,
          INTENSIFICATION_METHODS,
          'intensificationMethod'
        );
        assertUniqueIndexes(
          exercise.setTemplates,
          'setIndex',
          'setIndex',
          `${exercisePath}.setTemplates`
        );

        exercise.setTemplates.forEach((setTemplate) => {
          assertEnumValue(setTemplate.setType, SET_TYPES, 'setType');
        });

        if (
          mode === 'publish' &&
          (!exercise.exerciseId || !exercise.exerciseName)
        ) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `exerciseId and exerciseName are required for published blocks in ${exercisePath}`
          );
        }
      });

      if (
        mode === 'publish' &&
        block.blockType === 'SUPERSET' &&
        block.exercises.some((exercise) => !exercise.exerciseId || !exercise.exerciseName)
      ) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `Superset blocks cannot contain empty lanes in ${blockPath}`
        );
      }
    });
  });
}

function validateCycleDocument(payload, mode = 'draft') {
  if (!String(payload.name || '').trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
  }

  if (!Array.isArray(payload.weeks) || payload.weeks.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'weeks must be a non-empty array');
  }

  const weeks = payload.weeks.map((week, weekIndex) => ({
    id: week.id,
    weekNumber: normalizeInt(week.weekNumber, weekIndex + 1),
    orderIndex: normalizeInt(week.orderIndex, weekIndex + 1),
    label: normalizeOptionalString(week.label) || `Week ${weekIndex + 1}`,
    notes: normalizeOptionalString(week.notes),
    workouts: normalizeWorkoutsInput(week.workouts),
  }));

  assertUniqueIndexes(weeks, 'weekNumber', 'weekNumber', 'weeks');
  assertUniqueIndexes(weeks, 'orderIndex', 'week orderIndex', 'weeks');

  weeks.forEach((week, weekIndex) => {
    validateWorkoutsDocument(week.workouts, mode, `weeks[${weekIndex}].workouts`);
  });

  if (mode === 'publish') {
    const totalWorkoutCount = weeks.reduce(
      (sum, week) => sum + (Array.isArray(week.workouts) ? week.workouts.length : 0),
      0
    );

    const invalidWeek = weeks.find((week) => week.workouts.length > 7);
    if (invalidWeek) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Each week must contain between 0 and 7 workouts');
    }

    if (totalWorkoutCount < 1) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Cycle must contain at least 1 workout before publishing');
    }
  }

  return {
    name: String(payload.name).trim(),
    weeks,
  };
}

function collectExerciseIdsFromWeeks(weeks = []) {
  return weeks.flatMap((week) =>
    week.workouts.flatMap((workout) =>
      workout.blocks.flatMap((block) =>
        block.exercises.map((exercise) => exercise.exerciseId).filter(Boolean)
      )
    )
  );
}

async function assertUserExists(userId) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(userId);

  if (!normalizedUserId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
  }

  const user = await prisma.user.findUnique({
    where: { id: normalizedUserId },
    select: {
      id: true,
      profile: {
        select: {
          trainingMode: true,
        },
      },
    },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  return user;
}

async function resolveUserTimezone(userId, requestedTimezone) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      profile: {
        select: {
          onboardingSnapshot: true,
        },
      },
    },
  });

  return resolveEffectiveTimezone(
    user?.profile?.timezone,
    user?.profile?.onboardingSnapshot?.timezone,
    requestedTimezone,
    DEFAULT_TIMEZONE
  );
}

async function assertKnownExerciseIds(exerciseIds = []) {
  const prisma = getPrisma();
  const ids = Array.from(new Set(exerciseIds.filter(Boolean)));

  if (!ids.length) {
    return;
  }

  const exercises = await prisma.exercise.findMany({
    where: {
      exerciseId: {
        in: ids,
      },
    },
    select: { exerciseId: true },
  });

  const existingIds = new Set(exercises.map((exercise) => exercise.exerciseId));
  ids.forEach((exerciseId) => {
    if (!existingIds.has(exerciseId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Unknown exerciseId: ${exerciseId}`);
    }
  });
}

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
              exerciseName: blockExercise.exercise?.name || null,
              orderIndex: blockExercise.orderIndex,
              executionNotes: blockExercise.executionNotes,
              defaultTempo: blockExercise.defaultTempo,
              defaultRestSeconds: blockExercise.defaultRestSeconds,
              defaultTargetRir: blockExercise.defaultTargetRir,
              defaultTargetRpe: blockExercise.defaultTargetRpe,
              intensificationMethod: blockExercise.intensificationMethod,
              notes: blockExercise.notes,
              bodyParts: blockExercise.exercise?.bodyParts || [],
              muscleFocus: blockExercise.exercise?.targetMuscles || [],
              exercise: blockExercise.exercise,
              setTemplates: blockExercise.setTemplates,
            })),
          };
        }),
      })),
    })),
  };
}

function getWeekSessionsPerWeek(week) {
  return Array.isArray(week?.workouts) ? week.workouts.length : 0;
}

function toBuilderExercise(exercise, index) {
  const setTemplates = Array.isArray(exercise.setTemplates) ? exercise.setTemplates : [];

  return {
    id: exercise.id,
    label: `A${index + 1}`,
    name: exercise.exerciseName || exercise.exercise?.name || '',
    exerciseId: exercise.exerciseId,
    bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
    muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
    tempo: exercise.defaultTempo || setTemplates[0]?.tempo || '3010',
    sets: setTemplates.map((setTemplate) => ({
      id: setTemplate.id,
      reps:
        setTemplate.targetReps ??
        setTemplate.maxReps ??
        setTemplate.minReps ??
        8,
      rpe: Number(setTemplate.targetRir ?? 2),
    })),
    notes: exercise.notes || exercise.executionNotes || '',
  };
}

function toBuilderBlock(block) {
  if (block.blockType === 'SUPERSET') {
    const exercises = block.exercises.map(toBuilderExercise);

    return {
      id: block.id,
      type: 'superset',
      sets: Math.max(1, exercises[0]?.sets?.length || block.roundCount || 1),
      rest: `${block.restSeconds || 120}s`,
      exercises,
      notes: block.notes || '',
    };
  }

  const singleExercise = block.exercises[0];

  return {
    id: block.id,
    type: 'single',
    exercise: singleExercise?.exerciseName || singleExercise?.exercise?.name || '',
    exerciseId: singleExercise?.exerciseId || null,
    bodyParts: Array.isArray(singleExercise?.bodyParts) ? singleExercise.bodyParts : [],
    muscleFocus: Array.isArray(singleExercise?.muscleFocus) ? singleExercise.muscleFocus : [],
    tempo: singleExercise?.defaultTempo || singleExercise?.setTemplates?.[0]?.tempo || '3010',
    rest: `${block.restSeconds || singleExercise?.defaultRestSeconds || 120}s`,
    sets: Array.isArray(singleExercise?.setTemplates)
      ? singleExercise.setTemplates.map((setTemplate) => ({
        id: setTemplate.id,
        reps:
          setTemplate.targetReps ??
          setTemplate.maxReps ??
          setTemplate.minReps ??
          8,
        rpe: Number(setTemplate.targetRir ?? 2),
      }))
      : [],
    notes: block.notes || singleExercise?.notes || '',
  };
}

function toBuilderWorkout(workout) {
  return {
    id: workout.id,
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay,
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
    notes: workout.notes,
    blocks: workout.blocks.map(toBuilderBlock),
  };
}

function buildCycleBuilderPayload(cycle, plan) {
  const serializedPlan = serializePlan(plan);
  const timeline = resolvePlanTimeline(cycle, plan);

  return {
    programName: serializedPlan?.name || cycle.name,
    sessionsPerWeek: getWeekSessionsPerWeek(serializedPlan?.weeks?.[0]),
    programLength: timeline.durationWeeks,
    startDate: timeline.startDateKey,
    endDate: timeline.endDateKey,
    isMultiWeek: true,
    selectedWeek: 1,
    weeks: (serializedPlan?.weeks || []).map((week) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      orderIndex: week.orderIndex,
      label: week.label || `Week ${week.weekNumber}`,
      notes: week.notes || '',
      workouts: week.workouts.map(toBuilderWorkout),
    })),
  };
}

function getOccurrenceDateKey(startDateKey, weekNumber, workout) {
  const dayOffsets = {
    MONDAY: 0,
    TUESDAY: 1,
    WEDNESDAY: 2,
    THURSDAY: 3,
    FRIDAY: 4,
    SATURDAY: 5,
    SUNDAY: 6,
  };

  const scheduledOffset =
    workout?.scheduledDay && dayOffsets[workout.scheduledDay] != null
      ? dayOffsets[workout.scheduledDay]
      : Math.max(0, (workout.orderIndex || 1) - 1);

  return addDays(startDateKey, (weekNumber - 1) * 7 + scheduledOffset);
}

function logCycleServiceEvent(operation, phase, context = {}) {
  console.info('[cyclesService]', {
    operation,
    phase,
    ...context,
  });
}

function logCycleServiceError(operation, phase, context = {}, error) {
  console.error('[cyclesService]', {
    operation,
    phase,
    ...context,
    errorCode: error?.code || null,
    errorMessage: error?.message || null,
    errorType: error?.name || 'Error',
  });
}

function deriveTemporalStatus(cycle, timeZone, now = new Date()) {
  const todayDateKey = getTodayDateKey(timeZone, now);
  const startDateKey = toDateKey(cycle.startDate);
  const endDateKey = toDateKey(cycle.endDate);

  if (compareDateKeys(todayDateKey, startDateKey) < 0) {
    return 'upcoming';
  }

  if (compareDateKeys(todayDateKey, endDateKey) > 0) {
    return 'past';
  }

  return 'active';
}

function pickLatestDraft(plans = []) {
  return plans
    .filter((plan) => plan.status === 'DRAFT')
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0] || null;
}

function pickLatestPublished(plans = []) {
  return plans
    .filter((plan) => plan.status === 'PUBLISHED')
    .sort((left, right) => new Date(right.versionNumber) - new Date(left.versionNumber))[0] || null;
}

function pickVisiblePlan(plans = []) {
  return pickLatestPublished(plans) || pickLatestDraft(plans);
}

function createComparableWorkout(workout) {
  return JSON.stringify({
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: workout.notes || null,
    blocks: (workout.blocks || []).map((block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label || null,
      roundCount: normalizeNullableInteger(block.roundCount),
      restSeconds: normalizeNullableInteger(block.restSeconds),
      notes: block.notes || null,
      exercises: (block.exercises || []).map((exercise) => ({
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes || null,
        defaultTempo: exercise.defaultTempo || null,
        defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
        defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
        defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
        intensificationMethod: exercise.intensificationMethod || null,
        notes: exercise.notes || null,
        setTemplates: (exercise.setTemplates || []).map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          setType: setTemplate.setType || null,
          targetReps: normalizeNullableInteger(setTemplate.targetReps),
          minReps: normalizeNullableInteger(setTemplate.minReps),
          maxReps: normalizeNullableInteger(setTemplate.maxReps),
          targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
          targetRir: normalizeNullableNumber(setTemplate.targetRir),
          targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
          restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
          notes: setTemplate.notes || null,
        })),
      })),
    })),
  });
}

async function loadCycleForUser(tx, cycleId, userId) {
  const cycle = await tx.trainingCycle.findFirst({
    where: {
      id: cycleId,
      userId,
    },
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  return cycle;
}

async function loadCycleSummaryForUser(tx, cycleId, userId) {
  const cycle = await tx.trainingCycle.findFirst({
    where: {
      id: cycleId,
      userId,
    },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      durationWeeks: true,
      timezone: true,
    },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  return cycle;
}

async function normalizeSingleDraft(tx, cycleId, include = fullPlanInclude) {
  const drafts = await tx.plan.findMany({
    where: {
      trainingCycleId: cycleId,
      status: 'DRAFT',
    },
    orderBy: { updatedAt: 'desc' },
    include,
  });

  if (drafts.length <= 1) {
    return drafts[0] || null;
  }

  const [latestDraft, ...staleDrafts] = drafts;
  await tx.plan.deleteMany({
    where: {
      id: {
        in: staleDrafts.map((draft) => draft.id),
      },
    },
  });

  return latestDraft;
}

function compareByIndex(primaryKey, secondaryKey = null) {
  return (left, right) => {
    const primaryDelta = Number(left?.[primaryKey] || 0) - Number(right?.[primaryKey] || 0);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }

    if (!secondaryKey) {
      return 0;
    }

    return Number(left?.[secondaryKey] || 0) - Number(right?.[secondaryKey] || 0);
  };
}

function normalizeSetTemplateForPersistence(setTemplate = {}, setIndex, options = {}) {
  const normalized = {
    setIndex,
    setType: setTemplate.setType || 'WORKING',
    targetReps: normalizeNullableInteger(setTemplate.targetReps),
    minReps: normalizeNullableInteger(setTemplate.minReps),
    maxReps: normalizeNullableInteger(setTemplate.maxReps),
    targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
    targetRir: normalizeNullableNumber(setTemplate.targetRir),
    targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
    tempo: normalizeOptionalString(setTemplate.tempo),
    restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
    notes: normalizeOptionalString(setTemplate.notes),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(setTemplate.id);
  }

  return normalized;
}

function normalizeExerciseForPersistence(exercise = {}, orderIndex, options = {}) {
  const normalized = {
    orderIndex,
    exerciseId: normalizeOptionalString(exercise.exerciseId),
    executionNotes: normalizeOptionalString(exercise.executionNotes),
    defaultTempo: normalizeOptionalString(exercise.defaultTempo),
    defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
    defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
    defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
    intensificationMethod: exercise.intensificationMethod || 'NONE',
    notes: normalizeOptionalString(exercise.notes),
    setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : [])
      .slice()
      .sort(compareByIndex('setIndex'))
      .map((setTemplate, index) =>
        normalizeSetTemplateForPersistence(setTemplate, index + 1, options)
      ),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(exercise.id);
  }

  return normalized;
}

function normalizeBlockForPersistence(block = {}, orderIndex, options = {}) {
  const normalized = {
    orderIndex,
    blockType: block.blockType,
    label: normalizeOptionalString(block.label),
    roundCount: normalizeNullableInteger(block.roundCount),
    restStrategy: block.restStrategy || null,
    restSeconds: normalizeNullableInteger(block.restSeconds),
    notes: normalizeOptionalString(block.notes),
    exercises: (Array.isArray(block.exercises) ? block.exercises : [])
      .slice()
      .sort(compareByIndex('orderIndex'))
      .map((exercise, index) =>
        normalizeExerciseForPersistence(exercise, index + 1, options)
      ),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(block.id);
  }

  return normalized;
}

function normalizeWorkoutForPersistence(workout = {}, orderIndex, options = {}) {
  const normalized = {
    name: String(workout.name || '').trim(),
    orderIndex,
    scheduledDay: workout.scheduledDay || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: normalizeOptionalString(workout.notes),
    blocks: (Array.isArray(workout.blocks) ? workout.blocks : [])
      .slice()
      .sort(compareByIndex('orderIndex'))
      .map((block, index) => normalizeBlockForPersistence(block, index + 1, options)),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(workout.id);
  }

  return normalized;
}

function normalizeWeekForPersistence(week = {}, weekNumber, orderIndex, options = {}) {
  const normalized = {
    weekNumber,
    orderIndex,
    label: normalizeOptionalString(week.label) || `Week ${weekNumber}`,
    notes: normalizeOptionalString(week.notes),
    workouts: (Array.isArray(week.workouts) ? week.workouts : [])
      .slice()
      .sort(compareByIndex('orderIndex'))
      .map((workout, index) =>
        normalizeWorkoutForPersistence(workout, index + 1, options)
      ),
  };

  if (options.includeIds) {
    normalized.id = normalizeOptionalString(week.id);
  }

  return normalized;
}

function normalizeCycleDocumentForPersistence(document = {}, options = {}) {
  return {
    name: String(document.name || '').trim(),
    weeks: (Array.isArray(document.weeks) ? document.weeks : [])
      .slice()
      .sort(compareByIndex('weekNumber', 'orderIndex'))
      .map((week, index) => {
        const normalizedWeekNumber = normalizeInt(week.weekNumber, index + 1);
        return normalizeWeekForPersistence(week, normalizedWeekNumber, index + 1, options);
      }),
  };
}

function buildDraftMutationDocument(plan) {
  if (!plan) {
    return null;
  }

  return {
    id: plan.id,
    name: plan.name,
    weeks: (Array.isArray(plan.weeks) ? plan.weeks : []).map((week) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      orderIndex: week.orderIndex,
      label: week.label,
      notes: week.notes,
      workouts: (Array.isArray(week.workouts) ? week.workouts : []).map((workout) => ({
        id: workout.id,
        name: workout.name,
        orderIndex: workout.orderIndex,
        scheduledDay: workout.scheduledDay,
        estimatedDurationMinutes: workout.estimatedDurationMinutes,
        notes: workout.notes,
        blocks: (Array.isArray(workout.blocks) ? workout.blocks : []).map((block) => ({
          id: block.id,
          orderIndex: block.orderIndex,
          blockType: block.blockType,
          label: block.label,
          roundCount: block.roundCount,
          restStrategy: block.restStrategy,
          restSeconds: block.restSeconds,
          notes: block.notes,
          exercises: (Array.isArray(block.blockExercises) ? block.blockExercises : []).map((exercise) => ({
            id: exercise.id,
            exerciseId: exercise.exerciseId,
            orderIndex: exercise.orderIndex,
            executionNotes: exercise.executionNotes,
            defaultTempo: exercise.defaultTempo,
            defaultRestSeconds: exercise.defaultRestSeconds,
            defaultTargetRir: exercise.defaultTargetRir,
            defaultTargetRpe: exercise.defaultTargetRpe,
            intensificationMethod: exercise.intensificationMethod,
            notes: exercise.notes,
            setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : []).map((setTemplate) => ({
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
      })),
    })),
  };
}

function buildCanonicalCycleSignature(document) {
  return JSON.stringify(normalizeCycleDocumentForPersistence(document));
}

function isCycleDraftNoOp(currentDraftDocument, incomingDocument) {
  return buildCanonicalCycleSignature(currentDraftDocument) === buildCanonicalCycleSignature(incomingDocument);
}

function normalizeWeekScalarFields(week) {
  return JSON.stringify({
    weekNumber: week.weekNumber,
    orderIndex: week.orderIndex,
    label: week.label || null,
    notes: week.notes || null,
  });
}

function normalizeWorkoutScalarFields(workout) {
  return JSON.stringify({
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: workout.notes || null,
  });
}

function normalizeWorkoutBlockFields(workout) {
  return JSON.stringify(
    (Array.isArray(workout.blocks) ? workout.blocks : []).map((block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label || null,
      roundCount: normalizeNullableInteger(block.roundCount),
      restStrategy: block.restStrategy || null,
      restSeconds: normalizeNullableInteger(block.restSeconds),
      notes: block.notes || null,
      exercises: (Array.isArray(block.exercises) ? block.exercises : []).map((exercise) => ({
        orderIndex: exercise.orderIndex,
        exerciseId: exercise.exerciseId || null,
        executionNotes: exercise.executionNotes || null,
        defaultTempo: exercise.defaultTempo || null,
        defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
        defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
        defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
        intensificationMethod: exercise.intensificationMethod || 'NONE',
        notes: exercise.notes || null,
        setTemplates: (Array.isArray(exercise.setTemplates) ? exercise.setTemplates : []).map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          setType: setTemplate.setType || 'WORKING',
          targetReps: normalizeNullableInteger(setTemplate.targetReps),
          minReps: normalizeNullableInteger(setTemplate.minReps),
          maxReps: normalizeNullableInteger(setTemplate.maxReps),
          targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
          targetRir: normalizeNullableNumber(setTemplate.targetRir),
          targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
          tempo: setTemplate.tempo || null,
          restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
          notes: setTemplate.notes || null,
        })),
      })),
    }))
  );
}

function buildWorkoutBlocksCreateInput(blocks = []) {
  return blocks.map((block) => ({
    orderIndex: block.orderIndex,
    blockType: block.blockType,
    label: block.label || undefined,
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
            setType: setTemplate.setType,
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
  }));
}

function buildWorkoutCreateInput(workout) {
  return {
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workout.scheduledDay || undefined,
    estimatedDurationMinutes: workout.estimatedDurationMinutes ?? undefined,
    notes: workout.notes ?? undefined,
    blocks: {
      create: buildWorkoutBlocksCreateInput(workout.blocks),
    },
  };
}

function buildPlanCreateWeeksInput(weeks = []) {
  return weeks.map((week) => ({
    weekNumber: week.weekNumber,
    orderIndex: week.orderIndex,
    label: week.label || null,
    notes: week.notes || null,
    workouts: {
      create: week.workouts.map((workout) => buildWorkoutCreateInput(workout)),
    },
  }));
}

function clonePlanDocument(plan) {
  const serializedPlan = serializePlan(plan);
  return {
    name: serializedPlan.name,
    weeks: serializedPlan.weeks.map((week) => ({
      weekNumber: week.weekNumber,
      orderIndex: week.orderIndex,
      label: week.label,
      notes: week.notes,
      workouts: week.workouts.map((workout) => ({
        name: workout.name,
        orderIndex: workout.orderIndex,
        scheduledDay: workout.scheduledDay,
        estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
        notes: workout.notes,
        blocks: workout.blocks.map((block) => ({
          orderIndex: block.orderIndex,
          blockType: block.blockType,
          label: block.label,
          roundCount: normalizeNullableInteger(block.roundCount),
          restStrategy: block.restStrategy,
          restSeconds: normalizeNullableInteger(block.restSeconds),
          notes: block.notes,
          exercises: block.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exerciseName || exercise.exercise?.name || '',
            bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
            muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
            orderIndex: exercise.orderIndex,
            executionNotes: exercise.executionNotes,
            defaultTempo: exercise.defaultTempo,
            defaultRestSeconds: normalizeNullableInteger(exercise.defaultRestSeconds),
            defaultTargetRir: normalizeNullableNumber(exercise.defaultTargetRir),
            defaultTargetRpe: normalizeNullableNumber(exercise.defaultTargetRpe),
            intensificationMethod: exercise.intensificationMethod,
            notes: exercise.notes,
            setTemplates: exercise.setTemplates.map((setTemplate) => ({
              setIndex: setTemplate.setIndex,
              setType: setTemplate.setType,
              targetReps: normalizeNullableInteger(setTemplate.targetReps),
              minReps: normalizeNullableInteger(setTemplate.minReps),
              maxReps: normalizeNullableInteger(setTemplate.maxReps),
              targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
              targetRir: normalizeNullableNumber(setTemplate.targetRir),
              targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
              tempo: normalizeOptionalString(setTemplate.tempo),
              restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
              notes: setTemplate.notes,
            })),
          })),
        })),
      })),
    })),
  };
}

function buildIdentityConflictError(level, descriptor) {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    `Ambiguous ${level} identity in cycle draft payload for ${descriptor}`
  );
}

function matchIncomingWeeks(existingWeeks = [], incomingWeeks = []) {
  const existingById = new Map(existingWeeks.map((week) => [week.id, week]));
  const existingByWeekNumber = new Map(existingWeeks.map((week) => [week.weekNumber, week]));
  const matchedExistingIds = new Set();
  const pairs = [];
  const creates = [];
  const missingIdWeeks = [];

  incomingWeeks.forEach((week) => {
    if (week.id) {
      const matched = existingById.get(week.id) || null;
      const fallbackMatch = existingByWeekNumber.get(week.weekNumber) || null;

      if (matched) {
        matchedExistingIds.add(matched.id);
        pairs.push({ existingWeek: matched, incomingWeek: week });
      } else if (fallbackMatch && !matchedExistingIds.has(fallbackMatch.id)) {
        matchedExistingIds.add(fallbackMatch.id);
        pairs.push({ existingWeek: fallbackMatch, incomingWeek: week });
      } else {
        creates.push(week);
      }

      return;
    }

    missingIdWeeks.push(week);
  });

  missingIdWeeks.forEach((week) => {
    const fallbackMatch = existingByWeekNumber.get(week.weekNumber) || null;

    if (fallbackMatch && matchedExistingIds.has(fallbackMatch.id)) {
      throw buildIdentityConflictError('week', `weekNumber ${week.weekNumber}`);
    }

    if (fallbackMatch) {
      matchedExistingIds.add(fallbackMatch.id);
      pairs.push({ existingWeek: fallbackMatch, incomingWeek: week });
      return;
    }

    creates.push(week);
  });

  const deletes = existingWeeks.filter((week) => !matchedExistingIds.has(week.id));
  return { pairs, creates, deletes };
}

function matchIncomingWorkouts(existingWorkouts = [], incomingWorkouts = [], weekNumber) {
  const existingById = new Map(existingWorkouts.map((workout) => [workout.id, workout]));
  const existingByOrderIndex = new Map(
    existingWorkouts.map((workout) => [workout.orderIndex, workout])
  );
  const matchedExistingIds = new Set();
  const pairs = [];
  const creates = [];
  const missingIdWorkouts = [];

  incomingWorkouts.forEach((workout) => {
    if (workout.id) {
      const matched = existingById.get(workout.id) || null;
      const fallbackMatch = existingByOrderIndex.get(workout.orderIndex) || null;

      if (matched) {
        matchedExistingIds.add(matched.id);
        pairs.push({ existingWorkout: matched, incomingWorkout: workout });
      } else if (fallbackMatch && !matchedExistingIds.has(fallbackMatch.id)) {
        matchedExistingIds.add(fallbackMatch.id);
        pairs.push({ existingWorkout: fallbackMatch, incomingWorkout: workout });
      } else {
        creates.push(workout);
      }

      return;
    }

    missingIdWorkouts.push(workout);
  });

  missingIdWorkouts.forEach((workout) => {
    const fallbackMatch = existingByOrderIndex.get(workout.orderIndex) || null;

    if (fallbackMatch && matchedExistingIds.has(fallbackMatch.id)) {
      throw buildIdentityConflictError(
        'workout',
        `week ${weekNumber}, orderIndex ${workout.orderIndex}`
      );
    }

    if (fallbackMatch) {
      matchedExistingIds.add(fallbackMatch.id);
      pairs.push({ existingWorkout: fallbackMatch, incomingWorkout: workout });
      return;
    }

    creates.push(workout);
  });

  const deletes = existingWorkouts.filter((workout) => !matchedExistingIds.has(workout.id));
  return { pairs, creates, deletes };
}

function diffCycleDraft(currentDraftDocument, incomingDocument) {
  const normalizedCurrent = normalizeCycleDocumentForPersistence(currentDraftDocument, { includeIds: true });
  const normalizedIncoming = normalizeCycleDocumentForPersistence(incomingDocument, { includeIds: true });
  const weekMatches = matchIncomingWeeks(normalizedCurrent.weeks, normalizedIncoming.weeks);

  const weekUpdates = weekMatches.pairs.map(({ existingWeek, incomingWeek }) => {
    const workoutMatches = matchIncomingWorkouts(
      existingWeek.workouts,
      incomingWeek.workouts,
      incomingWeek.weekNumber
    );
    const matchedWorkoutIds = new Set(
      workoutMatches.pairs.map(({ existingWorkout }) => existingWorkout.id)
    );
    const finalWorkoutOrder = incomingWeek.workouts.map((workout) => {
      const matchedPair = workoutMatches.pairs.find(
        ({ incomingWorkout }) => incomingWorkout === workout
      );
      return {
        incomingWorkout: workout,
        existingWorkout: matchedPair?.existingWorkout || null,
        isNew: !matchedPair,
      };
    });
    const reorderedExistingWorkouts = finalWorkoutOrder
      .filter((entry) => entry.existingWorkout)
      .map((entry) => entry.existingWorkout.id);
    const originalExistingWorkouts = existingWeek.workouts
      .filter((workout) => matchedWorkoutIds.has(workout.id))
      .map((workout) => workout.id);

    return {
      existingWeek,
      incomingWeek,
      scalarChanged:
        normalizeWeekScalarFields(existingWeek) !== normalizeWeekScalarFields(incomingWeek),
      workoutCreates: workoutMatches.creates,
      workoutDeletes: workoutMatches.deletes,
      workoutUpdates: workoutMatches.pairs.map(({ existingWorkout, incomingWorkout }) => ({
        existingWorkout,
        incomingWorkout,
        scalarChanged:
          normalizeWorkoutScalarFields(existingWorkout) !==
          normalizeWorkoutScalarFields(incomingWorkout),
        blockChanged:
          normalizeWorkoutBlockFields(existingWorkout) !==
          normalizeWorkoutBlockFields(incomingWorkout),
      })),
      finalWorkoutOrder,
      reorderChanged:
        originalExistingWorkouts.length !== reorderedExistingWorkouts.length ||
        originalExistingWorkouts.some((workoutId, index) => workoutId !== reorderedExistingWorkouts[index]),
    };
  });

  return {
    normalizedCurrent,
    normalizedIncoming,
    nameChanged: normalizedCurrent.name !== normalizedIncoming.name,
    weekCreates: weekMatches.creates,
    weekDeletes: weekMatches.deletes,
    weekUpdates,
  };
}

async function replaceWorkoutBlocks(tx, workoutId, blocks) {
  await tx.workoutBlock.deleteMany({
    where: {
      workoutId,
    },
  });

  if (!blocks.length) {
    return;
  }

  await tx.workout.update({
    where: { id: workoutId },
    data: {
      blocks: {
        create: buildWorkoutBlocksCreateInput(blocks),
      },
    },
  });
}

async function assertNoScheduledSessionRefs(tx, workoutIds = []) {
  const ids = Array.from(new Set(workoutIds.filter(Boolean)));

  if (!ids.length) {
    return;
  }

  const referencedSession = await tx.scheduledSession.findFirst({
    where: {
      workoutId: {
        in: ids,
      },
    },
    select: {
      id: true,
      workoutId: true,
    },
  });

  if (referencedSession) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Cannot delete draft workouts that are referenced by scheduled sessions (workoutId: ${referencedSession.workoutId})`
    );
  }
}

async function updateWeekScalarFields(tx, existingWeek, incomingWeek) {
  return tx.planWeek.update({
    where: { id: existingWeek.id },
    data: {
      weekNumber: incomingWeek.weekNumber,
      orderIndex: incomingWeek.orderIndex,
      label: incomingWeek.label ?? null,
      notes: incomingWeek.notes ?? null,
    },
  });
}

async function moveExistingWorkoutsToSentinelOrder(tx, workouts = []) {
  const sentinelBase = 1000000;

  for (let index = 0; index < workouts.length; index += 1) {
    await tx.workout.update({
      where: { id: workouts[index].id },
      data: {
        orderIndex: sentinelBase + index,
      },
    });
  }
}

async function applyWorkoutFinalState(
  tx,
  planWeekId,
  finalWorkoutOrder = [],
  workoutUpdates = [],
  options = {}
) {
  const forceOrderReset = Boolean(options.forceOrderReset);
  const workoutUpdatesById = new Map(
    workoutUpdates.map((entry) => [entry.existingWorkout.id, entry])
  );

  for (let index = 0; index < finalWorkoutOrder.length; index += 1) {
    const entry = finalWorkoutOrder[index];
    const finalOrderIndex = index + 1;

    if (entry.isNew) {
      await tx.workout.create({
        data: {
          planWeekId,
          ...buildWorkoutCreateInput({
            ...entry.incomingWorkout,
            orderIndex: finalOrderIndex,
          }),
        },
      });
      continue;
    }

    const updateEntry = workoutUpdatesById.get(entry.existingWorkout.id);
    const incomingWorkout = {
      ...updateEntry.incomingWorkout,
      orderIndex: finalOrderIndex,
    };
    const shouldUpdateWorkoutScalars =
      forceOrderReset ||
      updateEntry.scalarChanged ||
      updateEntry.existingWorkout.orderIndex !== finalOrderIndex;

    if (shouldUpdateWorkoutScalars) {
      await tx.workout.update({
        where: { id: entry.existingWorkout.id },
        data: {
          name: incomingWorkout.name,
          orderIndex: incomingWorkout.orderIndex,
          scheduledDay: incomingWorkout.scheduledDay ?? null,
          estimatedDurationMinutes: incomingWorkout.estimatedDurationMinutes ?? null,
          notes: incomingWorkout.notes ?? null,
        },
      });
    }

    if (updateEntry.blockChanged) {
      await replaceWorkoutBlocks(tx, entry.existingWorkout.id, incomingWorkout.blocks);
    }
  }
}

function buildDocumentFromWeeklyVersion(version, durationWeeks, workoutDayAssignments = new Map()) {
  const workouts = version.workouts.map((workout) => ({
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workoutDayAssignments.get(workout.orderIndex) || null,
    estimatedDurationMinutes: normalizeNullableInteger(workout.estimatedDurationMinutes),
    notes: workout.notes,
    blocks: workout.blocks.map((block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label,
      roundCount: normalizeNullableInteger(block.roundCount),
      restStrategy: block.restStrategy,
      restSeconds: normalizeNullableInteger(block.restSeconds),
      notes: block.notes,
      exercises: block.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
        muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes,
        defaultTempo: exercise.defaultTempo,
        defaultRestSeconds: exercise.defaultRestSeconds,
        defaultTargetRir: exercise.defaultTargetRir,
        defaultTargetRpe: exercise.defaultTargetRpe,
        intensificationMethod: exercise.intensificationMethod,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          setType: setTemplate.setType,
          targetReps: normalizeNullableInteger(setTemplate.targetReps),
          minReps: normalizeNullableInteger(setTemplate.minReps),
          maxReps: normalizeNullableInteger(setTemplate.maxReps),
          targetSeconds: normalizeNullableInteger(setTemplate.targetSeconds),
          targetRir: normalizeNullableNumber(setTemplate.targetRir),
          targetRpe: normalizeNullableNumber(setTemplate.targetRpe),
          restSeconds: normalizeNullableInteger(setTemplate.restSeconds),
          notes: setTemplate.notes,
        })),
      })),
    })),
  }));

  return {
    name: version.name,
    weeks: Array.from({ length: durationWeeks }).map((_, index) => ({
      weekNumber: index + 1,
      orderIndex: index + 1,
      label: `Week ${index + 1}`,
      notes: null,
      workouts: workouts.map((workout) => ({
        ...workout,
        blocks: workout.blocks.map((block) => ({
          ...block,
          exercises: block.exercises.map((exercise) => ({
            ...exercise,
            setTemplates: exercise.setTemplates.map((setTemplate) => ({ ...setTemplate })),
          })),
        })),
      })),
    })),
  };
}

function validateNoOverlap(cycles, nextStartDateKey, nextEndDateKey, currentCycleId = null) {
  const overlappingCycle = cycles.find((cycle) => {
    if (currentCycleId && cycle.id === currentCycleId) {
      return false;
    }

    const existingStart = toDateKey(cycle.startDate);
    const existingEnd = toDateKey(cycle.endDate);
    return existingStart <= nextEndDateKey && existingEnd >= nextStartDateKey;
  });

  if (overlappingCycle) {
    throw new ApiError(409, 'DATE_OVERLAP', 'This date range overlaps an existing cycle');
  }
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
    timezone,
  } = payload;

  await assertUserExists(userId);

  if (!String(name || '').trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
  }

  if (!startDate || !isValidDate(startDate) || !endDate || !isValidDate(endDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'startDate and endDate must be valid dates');
  }

  if (durationWeeks == null || Number.isNaN(Number(durationWeeks))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'durationWeeks is required');
  }

  assertEnumValue(mode, TRAINING_MODES, 'mode');
  assertEnumValue(status, CYCLE_STATUSES, 'status');

  const startDateKey = toDateKey(startDate);
  const endDateKey = toDateKey(endDate);

  if (compareDateKeys(endDateKey, startDateKey) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must be on or after startDate');
  }

  const existingCycles = await prisma.trainingCycle.findMany({
    where: { userId },
    select: { id: true, startDate: true, endDate: true },
  });
  validateNoOverlap(existingCycles, startDateKey, endDateKey);

  return prisma.trainingCycle.create({
    data: {
      userId,
      name: String(name).trim(),
      startDate: parseDateInput(startDate),
      endDate: parseDateInput(endDate),
      durationWeeks: Number(durationWeeks),
      timezone: normalizeOptionalString(timezone),
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

  const document = validateCycleDocument(payload, payload.status === 'PUBLISHED' ? 'publish' : 'draft');
  await assertKnownExerciseIds(collectExerciseIdsFromWeeks(document.weeks));

  const cycle = await prisma.trainingCycle.findUnique({
    where: { id: cycleId },
    select: { id: true },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  const plan = await prisma.$transaction(async (tx) => {
    const latestPlan = await tx.plan.findFirst({
      where: { trainingCycleId: cycleId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    return tx.plan.create({
      data: {
        trainingCycleId: cycleId,
        name: document.name,
        versionNumber: (latestPlan?.versionNumber ?? 0) + 1,
        sourceType: payload.sourceType ?? 'SYSTEM',
        status: payload.status ?? 'DRAFT',
        publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : null,
        weeks: {
          create: buildPlanCreateWeeksInput(document.weeks),
        },
      },
      include: fullPlanInclude,
    });
  });

  return serializePlan(plan);
}

async function createCycleFromWeeklyPlan(payload) {
  const prisma = getPrisma();
  const user = await assertUserExists(payload.userId);

  const weeklyPlanParentId = normalizeOptionalString(payload.weeklyPlanParentId);
  if (!weeklyPlanParentId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'weeklyPlanParentId is required');
  }

  const { startDateKey, endDateKey, durationWeeks } = normalizeCanonicalMultiWeekDateRange(
    payload.startDate,
    payload.durationWeeks,
    payload.endDate
  );

  const effectiveTimezone = resolveEffectiveTimezone(
    payload.timezone,
    user?.profile?.timezone,
    DEFAULT_TIMEZONE
  );
  const todayDateKey = getTodayDateKey(effectiveTimezone);
  const currentWeekMondayDateKey = getStartOfMondayWeek(todayDateKey);

  if (
    compareDateKeys(startDateKey, todayDateKey) < 0 &&
    startDateKey !== currentWeekMondayDateKey
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'startDate cannot be before the current week'
    );
  }
  ensureNotPastDate(endDateKey, todayDateKey, 'endDate');

  const sourceParent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: payload.userId,
    },
    include: {
      latestPublishedVersion: {
        include: weeklySourceVersionInclude,
      },
      latestDraftVersion: {
        include: weeklySourceVersionInclude,
      },
    },
  });

  if (!sourceParent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  const sourceVersion = sourceParent.latestPublishedVersion;
  if (!sourceVersion) {
    throw new ApiError(
      400,
      'WEEKLY_PLAN_NOT_PUBLISHED',
      'This weekly plan must be published before it can be converted into a multi-week program.'
    );
  }

  const existingCycles = await prisma.trainingCycle.findMany({
    where: { userId: payload.userId },
    select: { id: true, startDate: true, endDate: true },
  });
  validateNoOverlap(existingCycles, startDateKey, endDateKey);

  const workoutDayAssignments = normalizeWorkoutDayAssignments(
    payload.workoutDayAssignments,
    sourceVersion
  );
  const document = buildDocumentFromWeeklyVersion(
    sourceVersion,
    durationWeeks,
    workoutDayAssignments
  );
  const created = await prisma.$transaction(async (tx) => {
    const cycle = await tx.trainingCycle.create({
      data: {
        userId: payload.userId,
        sourceWeeklyPlanParentId: sourceParent.id,
        name: String(payload.name || sourceVersion.name).trim(),
        startDate: parseDateInput(startDateKey),
        endDate: parseDateInput(endDateKey),
        durationWeeks,
        timezone: effectiveTimezone,
        status: 'PLANNED',
        mode: user.profile?.trainingMode || 'FIXED',
      },
    });

    const basePublishedPlan = await tx.plan.create({
      data: {
        trainingCycleId: cycle.id,
        name: document.name,
        versionNumber: 1,
        sourceType: 'USER',
        status: 'PUBLISHED',
        startDate: parseDateInput(startDateKey),
        endDate: parseDateInput(endDateKey),
        durationWeeks,
        publishedAt: new Date(),
      },
    });

    const publishedPlan = await appendPlanWeeks(tx, basePublishedPlan.id, document.weeks);

    return { cycle, publishedPlan };
  });

  try {
    await regenerateScheduledSessionsForPublishedCycle(created.cycle.id, {
      userId: payload.userId,
      timezone: effectiveTimezone,
      regenerateFromDateKey: startDateKey,
    });
  } catch (error) {
    logCycleServiceError(
      'create_cycle_from_weekly_plan',
      'sync_scheduled_sessions',
      {
        userId: payload.userId,
        cycleId: created.cycle.id,
        publishedPlanId: created.publishedPlan.id,
      },
      error
    );

    await prisma.trainingCycle.delete({
      where: { id: created.cycle.id },
    });

    throw new ApiError(
      500,
      'SCHEDULE_SYNC_FAILED',
      'Cycle creation failed while synchronizing scheduled sessions.'
    );
  }

  const temporalStatus = deriveTemporalStatus(created.cycle, effectiveTimezone);
  return {
    cycleId: created.cycle.id,
    planId: created.publishedPlan.id,
    publishedPlanId: created.publishedPlan.id,
    status: created.publishedPlan.status,
    temporalStatus,
    timezone: effectiveTimezone,
    cycle: created.cycle,
    builderPayload: buildCycleBuilderPayload(created.cycle, created.publishedPlan),
    draftState: {
      state: 'fresh',
      effectiveTimezone,
      localDate: getTodayDateKey(effectiveTimezone),
      isGraceWindow: false,
      canExtendDraft: false,
    },
    updatedAt: created.publishedPlan.updatedAt,
  };
}

function buildPlanSummary(plan, cycleStartDateKey = null) {
  const serializedPlan = serializePlan(plan);
  if (!serializedPlan) {
    return {
      totalWeeks: 0,
      sessionsPerWeek: 0,
      totalWorkouts: 0,
      totalSetsFirstWeek: 0,
      firstOccurrenceDate: null,
      lastOccurrenceDate: null,
    };
  }

  const sessionsPerWeek = getWeekSessionsPerWeek(serializedPlan.weeks[0]);
  const totalSetsFirstWeek = (serializedPlan.weeks[0]?.workouts || []).reduce(
    (sum, workout) =>
      sum +
      workout.blocks.reduce(
        (blockSum, block) =>
          blockSum +
          block.exercises.reduce(
            (exerciseSum, exercise) => exerciseSum + exercise.setTemplates.length,
            0
          ),
        0
      ),
    0
  );

  const totalWorkouts = serializedPlan.weeks.reduce(
    (sum, week) => sum + week.workouts.length,
    0
  );

  return {
    totalWeeks: serializedPlan.weeks.length,
    sessionsPerWeek,
    totalWorkouts,
    totalSetsFirstWeek,
    firstOccurrenceDate: cycleStartDateKey,
    lastOccurrenceDate:
      cycleStartDateKey && sessionsPerWeek > 0
        ? addDays(cycleStartDateKey, (serializedPlan.weeks.length - 1) * 7 + (sessionsPerWeek - 1))
        : null,
  };
}

function buildCycleCard(cycle, visiblePlan, timeZone, now = new Date()) {
  const temporalStatus = deriveTemporalStatus(cycle, timeZone, now);
  const startDateKey = toDateKey(cycle.startDate);

  return {
    cycleId: cycle.id,
    visiblePlanId: visiblePlan?.id || null,
    name: visiblePlan?.name || cycle.name,
    startDate: toDateKey(cycle.startDate),
    endDate: toDateKey(cycle.endDate),
    durationWeeks: cycle.durationWeeks,
    timezone: timeZone,
    temporalStatus,
    editorialStatus: visiblePlan ? String(visiblePlan.status).toLowerCase() : null,
    sourceWeeklyPlanParentId: cycle.sourceWeeklyPlanParentId,
    summary: buildPlanSummary(visiblePlan, startDateKey),
  };
}

function buildProgramPreviewCard(card) {
  if (!card) {
    return null;
  }

  return {
    cycleId: card.cycleId,
    visiblePlanId: card.visiblePlanId,
    name: card.name,
    startDate: card.startDate,
    endDate: card.endDate,
    durationWeeks: card.durationWeeks,
    editorialStatus: card.editorialStatus,
    temporalStatus: card.temporalStatus,
  };
}

function resolveReferenceSessionsPerWeek(card) {
  return Math.max(0, Number(card?.summary?.sessionsPerWeek) || 0);
}

function buildDayProgress(startDateKey, endDateKey, todayDateKey) {
  const totalDaysDiff = diffDateKeys(startDateKey, endDateKey);
  const elapsedDaysDiff = diffDateKeys(startDateKey, todayDateKey);
  const totalDays = Math.max(1, (totalDaysDiff ?? 0) + 1);
  const elapsedDays = Math.min(totalDays, Math.max(1, (elapsedDaysDiff ?? 0) + 1));

  return {
    elapsedDays,
    totalDays,
    currentDayInCycle: elapsedDays,
    dayProgressPercent: Math.max(0, Math.min(100, Math.floor((elapsedDays / totalDays) * 100))),
  };
}

function buildActiveProgramCard(card, todayDateKey) {
  if (!card) {
    return null;
  }

  const dayProgress = buildDayProgress(card.startDate, card.endDate, todayDateKey);

  return {
    cycleId: card.cycleId,
    visiblePlanId: card.visiblePlanId,
    name: card.name,
    editorialStatus: card.editorialStatus,
    temporalStatus: card.temporalStatus,
    startDate: card.startDate,
    endDate: card.endDate,
    cycleDurationWeeks: card.durationWeeks,
    referenceSessionsPerWeek: resolveReferenceSessionsPerWeek(card),
    dayProgressPercent: dayProgress.dayProgressPercent,
    dayProgress: {
      elapsedDays: dayProgress.elapsedDays,
      totalDays: dayProgress.totalDays,
      currentDayInCycle: dayProgress.currentDayInCycle,
    },
  };
}

function createTimelineSlot(slotIndex, startDate, endDate, status, weekNumber, isInActiveCycle) {
  return {
    slotIndex,
    label: `W${slotIndex}`,
    status,
    weekNumber,
    startDate,
    endDate,
    isCurrent: status === 'current',
    isCompleted: status === 'completed',
    isInActiveCycle: Boolean(isInActiveCycle),
    showNowLabel: status === 'current',
    showCheckmark: status === 'completed',
    showNextCycleHint: status === 'next_cycle',
  };
}

function buildNeutralCycleStructure(timezone, todayDateKey) {
  const anchorWeekStart = getStartOfMondayWeek(todayDateKey);

  return {
    cycleId: null,
    timezone,
    currentWeekNumber: null,
    totalWeeks: 0,
    progressWeekNumber: null,
    slots: Array.from({ length: 12 }).map((_, index) => {
      const slotStart = addDays(anchorWeekStart, index * 7);
      const slotEnd = getEndOfMondayWeek(slotStart);
      return createTimelineSlot(index + 1, slotStart, slotEnd, 'neutral', null, false);
    }),
  };
}

function buildCycleStructure(activeCard, nextUpcomingCard, timezone, todayDateKey) {
  const anchorCard = activeCard || nextUpcomingCard;
  if (!anchorCard) {
    return buildNeutralCycleStructure(timezone, todayDateKey);
  }

  const anchorWeekStart = getStartOfMondayWeek(anchorCard.startDate);
  const nextCycleStartDate = nextUpcomingCard?.startDate || null;
  const totalWeeks = Number(anchorCard.durationWeeks) || 0;
  const currentWeekNumber = activeCard
    ? Math.min(
      Math.max(1, Math.floor((diffDateKeys(anchorWeekStart, getStartOfMondayWeek(todayDateKey)) || 0) / 7) + 1),
      Math.max(1, totalWeeks)
    )
    : null;
  const progressWeekNumber = activeCard ? currentWeekNumber : null;
  const activeWeeksByNumber = new Map(
    (anchorCard?.planWeeks || []).map((week) => [week.weekNumber, week])
  );

  const slots = Array.from({ length: 12 }).map((_, index) => {
    const slotIndex = index + 1;
    const slotStart = addDays(anchorWeekStart, index * 7);
    const slotEnd = getEndOfMondayWeek(slotStart);
    const weekNumber = slotIndex <= totalWeeks ? slotIndex : null;

    if (activeCard) {
      if (slotIndex <= totalWeeks) {
        const activeWeek = activeWeeksByNumber.get(slotIndex);
        const workoutCount = Array.isArray(activeWeek?.workouts) ? activeWeek.workouts.length : 0;
        const status =
          slotIndex < currentWeekNumber
            ? 'completed'
            : slotIndex === currentWeekNumber
              ? 'current'
              : workoutCount === 0
                ? 'deload'
                : 'future_in_active_cycle';

        return createTimelineSlot(slotIndex, slotStart, slotEnd, status, slotIndex, true);
      }

      if (nextCycleStartDate && isDateWithinRange(nextCycleStartDate, slotStart, slotEnd)) {
        return createTimelineSlot(slotIndex, slotStart, slotEnd, 'next_cycle', null, false);
      }

      if (nextCycleStartDate && compareDateKeys(slotStart, nextCycleStartDate) < 0) {
        return createTimelineSlot(slotIndex, slotStart, slotEnd, 'deload', null, false);
      }

      return createTimelineSlot(slotIndex, slotStart, slotEnd, 'neutral', null, false);
    }

    if (nextCycleStartDate && isDateWithinRange(nextCycleStartDate, slotStart, slotEnd)) {
      return createTimelineSlot(slotIndex, slotStart, slotEnd, 'next_cycle', slotIndex <= totalWeeks ? slotIndex : null, false);
    }

    if (
      nextCycleStartDate &&
      compareDateKeys(slotStart, nextCycleStartDate) > 0 &&
      slotIndex <= totalWeeks
    ) {
      const upcomingWeek = activeWeeksByNumber.get(slotIndex);
      const workoutCount = Array.isArray(upcomingWeek?.workouts) ? upcomingWeek.workouts.length : 0;
      return createTimelineSlot(
        slotIndex,
        slotStart,
        slotEnd,
        workoutCount === 0 ? 'deload' : 'future_in_active_cycle',
        slotIndex,
        false
      );
    }

    return createTimelineSlot(slotIndex, slotStart, slotEnd, 'neutral', null, false);
  });

  return {
    cycleId: anchorCard.cycleId,
    timezone,
    currentWeekNumber,
    totalWeeks,
    progressWeekNumber,
    slots,
  };
}

function buildProgramOverviewCardSource(cycle, visiblePlan, requestedTimezone) {
  const timezone = resolveEffectiveTimezone(cycle.timezone, requestedTimezone, DEFAULT_TIMEZONE);
  const card = buildCycleCard(cycle, visiblePlan, timezone);
  const serializedPlan = serializePlan(visiblePlan);

  return {
    ...card,
    planWeeks: serializedPlan?.weeks || [],
  };
}

async function getProgramsOverview(userId, requestedTimezone) {
  const prisma = getPrisma();
  await assertUserExists(userId);

  const cycles = await prisma.trainingCycle.findMany({
    where: { userId },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
  });

  const cards = cycles
    .map((cycle) => {
      const publishedPlan = pickLatestPublished(cycle.plans);
      if (!publishedPlan) {
        return null;
      }

      return buildCycleCard(
        cycle,
        publishedPlan,
        resolveEffectiveTimezone(cycle.timezone, requestedTimezone, DEFAULT_TIMEZONE)
      );
    })
    .filter(Boolean);

  return {
    timezone: resolveEffectiveTimezone(requestedTimezone, DEFAULT_TIMEZONE),
    currentProgram:
      cards.find(
        (card) => card.temporalStatus === 'active' && card.editorialStatus === 'published'
      ) || null,
    upcomingPrograms: cards.filter((card) => card.temporalStatus === 'upcoming'),
    pastPrograms: cards.filter((card) => card.temporalStatus === 'past').reverse(),
  };
}

async function getProgramOverviewV2(userId, requestedTimezone) {
  const prisma = getPrisma();
  await assertUserExists(userId);

  const cycles = await prisma.trainingCycle.findMany({
    where: { userId },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
  });

  const timezone = resolveEffectiveTimezone(requestedTimezone, DEFAULT_TIMEZONE);
  const cards = cycles
    .map((cycle) => {
      const visiblePlan = pickLatestPublished(cycle.plans);
      if (!visiblePlan) {
        return null;
      }

      return buildProgramOverviewCardSource(cycle, visiblePlan, requestedTimezone);
    })
    .filter(Boolean);

  const activeCard = cards.find((card) => card.temporalStatus === 'active') || null;
  const todayDateKey = getTodayDateKey(activeCard?.timezone || timezone);
  const upcomingCards = cards.filter((card) => card.temporalStatus === 'upcoming');
  const nextUpcomingByTime =
    [...upcomingCards].sort((left, right) => compareDateKeys(left.startDate, right.startDate))[0] ||
    null;
  const prioritizedUpcoming = upcomingCards
    .sort((left, right) => compareDateKeys(left.startDate, right.startDate))
    .slice(0, 2);
  const nextUpcomingCard = prioritizedUpcoming[0] || null;
  const pastPrograms = cards
    .filter((card) => card.temporalStatus === 'past')
    .sort((left, right) => compareDateKeys(right.endDate, left.endDate))
    .slice(0, 2)
    .map(buildProgramPreviewCard);

  return {
    timezone,
    activeProgramCard: buildActiveProgramCard(activeCard, todayDateKey),
    cycleStructure: buildCycleStructure(activeCard, nextUpcomingByTime, timezone, todayDateKey),
    upcomingPrograms: prioritizedUpcoming.map(buildProgramPreviewCard),
    pastPrograms,
  };
}

async function getCycleFull(cycleId) {
  const prisma = getPrisma();

  if (!cycleId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'cycleId is required');
  }

  const cycle = await prisma.trainingCycle.findUnique({
    where: { id: cycleId },
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  const timeZone = resolveEffectiveTimezone(cycle.timezone, DEFAULT_TIMEZONE);
  const currentPlan = pickVisiblePlan(cycle.plans);

  return {
    cycle,
    currentPlan: serializePlan(currentPlan),
    temporalStatus: deriveTemporalStatus(cycle, timeZone),
    timezone: timeZone,
  };
}

async function getCycleDetails(cycleId, userId, requestedTimezone) {
  const prisma = getPrisma();
  await assertUserExists(userId);

  const cycle = await prisma.trainingCycle.findFirst({
    where: { id: cycleId, userId },
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, requestedTimezone, DEFAULT_TIMEZONE);
  const todayDateKey = getTodayDateKey(effectiveTimezone);
  const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);
  const visiblePlan = pickLatestPublished(cycle.plans);
  const draftPlan = pickLatestDraft(cycle.plans);

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: toDateKey(cycle.startDate),
      endDate: toDateKey(cycle.endDate),
      durationWeeks: cycle.durationWeeks,
      timezone: effectiveTimezone,
      temporalStatus,
    },
    visiblePlanId: visiblePlan?.id || null,
    draftPlanId: draftPlan?.id || null,
    builderPayload: visiblePlan ? buildCycleBuilderPayload(cycle, visiblePlan) : null,
    draftState: {
      effectiveTimezone,
      localDate: todayDateKey,
      isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
      canExtendDraft: Boolean(draftPlan && temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone)),
    },
  };
}

function isDraftStillUsable(cycle, draftPlan, timeZone, allowCrossDayDraft = false, now = new Date()) {
  const temporalStatus = deriveTemporalStatus(cycle, timeZone, now);
  if (!draftPlan) {
    return false;
  }

  if (temporalStatus !== 'active') {
    return true;
  }

  const todayDateKey = getTodayDateKey(timeZone, now);
  const draftDateKey = getLocalDateTimeParts(draftPlan.updatedAt, timeZone).dateKey;

  if (draftDateKey === todayDateKey) {
    return true;
  }

  if (allowCrossDayDraft && isWithinGraceWindow(timeZone, now)) {
    return compareDateKeys(draftDateKey, addDays(todayDateKey, -1)) === 0;
  }

  return false;
}

async function openOrCreateCycleEditDraft(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);
  let phase = 'start';

  try {
    return await prisma.$transaction(
      async (tx) => {
        phase = 'load_cycle';
        const cycle = await loadCycleForUser(tx, cycleId, userId);
        const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
        const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

        logCycleServiceEvent('open_cycle_edit_draft', phase, {
          cycleId,
          userId,
          temporalStatus,
          timezone: effectiveTimezone,
        });

        if (temporalStatus === 'past') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be edited');
        }

        phase = 'resolve_draft';
        let draftPlan = await normalizeSingleDraft(tx, cycleId);
        const publishedPlan = pickLatestPublished(cycle.plans);
        const canonicalTimeline = resolvePlanTimeline(cycle, null);
        let state = 'reused';

        if (draftPlan && !isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
          phase = 'discard_expired_draft';
          await tx.plan.delete({ where: { id: draftPlan.id } });
          draftPlan = null;
          state = 'recreated';
        }

        if (!draftPlan) {
          if (!publishedPlan) {
            const fallbackDraft = cycle.plans.find((plan) => plan.status === 'DRAFT') || null;
            if (!fallbackDraft) {
              throw new ApiError(400, 'VALIDATION_ERROR', 'No editable version found for this cycle');
            }

            draftPlan = fallbackDraft;
            state = 'reused';
          } else {
            phase = 'create_draft_from_published';
            const sourceDocument = clonePlanDocument(publishedPlan);
            const nextVersion = Math.max(...cycle.plans.map((plan) => plan.versionNumber)) + 1;

            const existingDraft = await tx.plan.findFirst({
              where: {
                trainingCycleId: cycle.id,
                status: 'DRAFT',
              },
              orderBy: { updatedAt: 'desc' },
              include: fullPlanInclude,
            });

            if (existingDraft) {
              draftPlan = existingDraft;
            } else {

              try {
                draftPlan = await tx.plan.create({
                  data: {
                    trainingCycleId: cycle.id,
                    parentPlanId: publishedPlan.id,
                    name: sourceDocument.name,
                    versionNumber: nextVersion,
                    sourceType: publishedPlan.sourceType || 'USER',
                    status: 'DRAFT',
                    ...buildPlanTimelineWrite(canonicalTimeline),
                    weeks: {
                      create: buildPlanCreateWeeksInput(sourceDocument.weeks),
                    },
                  },
                  include: fullPlanInclude,
                });
              } catch (error) {
                if (error.code === 'P2002') {
                  // quelqu’un a créé le draft juste avant nous → on le récupère
                  draftPlan = await tx.plan.findFirst({
                    where: {
                      trainingCycleId: cycle.id,
                      status: 'DRAFT',
                    },
                    orderBy: { updatedAt: 'desc' },
                    include: fullPlanInclude,
                  });
                } else {
                  throw error;
                }
              }
            }
            state = 'fresh';
          }
        }

        const draftTimeline = resolvePlanTimeline(cycle, draftPlan);
        if (!hasCompletePlanTimeline(draftPlan)) {
          phase = 'initialize_draft_timeline';
          draftPlan = await tx.plan.update({
            where: { id: draftPlan.id },
            data: buildPlanTimelineWrite(draftTimeline),
            include: fullPlanInclude,
          });
        }
        assertTimelineMatchesWeeks(
          resolvePlanTimeline(cycle, draftPlan),
          draftPlan.weeks,
          'Cycle draft'
        );

        phase = 'return_builder_payload';
        logCycleServiceEvent('open_cycle_edit_draft', phase, {
          cycleId,
          userId,
          draftPlanId: draftPlan.id,
          publishedPlanId: publishedPlan?.id || null,
          draftState: state,
        });

        return {
          cycleId: cycle.id,
          planId: draftPlan.id,
          status: draftPlan.status,
          temporalStatus,
          timezone: effectiveTimezone,
          cycle: {
            id: cycle.id,
            name: cycle.name,
            startDate: toDateKey(cycle.startDate),
            endDate: toDateKey(cycle.endDate),
            durationWeeks: cycle.durationWeeks,
          },
          builderPayload: buildCycleBuilderPayload(cycle, draftPlan),
          draftTimeline: serializeTimeline(resolvePlanTimeline(cycle, draftPlan)),
          draftState: {
            state,
            effectiveTimezone,
            localDate: getTodayDateKey(effectiveTimezone),
            isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
            canExtendDraft: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
          },
          updatedAt: draftPlan.updatedAt,
        };
      },
      {
        timeout: 15000,
      }
    );
  } catch (error) {
    logCycleServiceError('open_cycle_edit_draft', phase, { cycleId, userId }, error);
    throw error;
  }
}

async function updateCycleDraft(cycleId, planId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);
  let phase = 'validate_payload';

  try {
    const document = validateCycleDocument(payload, 'draft');
    const normalizedIncomingDocument = normalizeCycleDocumentForPersistence(document, {
      includeIds: true,
    });
    phase = 'validate_exercise_ids';
    await assertKnownExerciseIds(collectExerciseIdsFromWeeks(document.weeks));

    return await prisma.$transaction(async (tx) => {
      phase = 'load_cycle';
      const cycle = await loadCycleSummaryForUser(tx, cycleId, userId);
      const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
      const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

      logCycleServiceEvent('update_cycle_draft', phase, {
        cycleId,
        planId,
        userId,
        temporalStatus,
        timezone: effectiveTimezone,
      });

      if (temporalStatus === 'past') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be edited');
      }

      phase = 'resolve_current_draft';
      let draftPlan = await normalizeSingleDraft(tx, cycleId, draftMutationInclude);
      if (!draftPlan || draftPlan.id !== planId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'This draft is not the current editable version');
      }

      if (!isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
        phase = 'expire_stale_draft';
        await tx.plan.delete({ where: { id: draftPlan.id } });
        throw new ApiError(409, 'DRAFT_EXPIRED', 'This draft expired and must be reopened from the published version');
      }

      const draftTimeline = resolvePlanTimeline(cycle, draftPlan);
      assertTimelineMatchesWeeks(draftTimeline, document.weeks, 'Cycle draft');

      if (!hasCompletePlanTimeline(draftPlan)) {
        phase = 'initialize_draft_timeline';
        draftPlan = await tx.plan.update({
          where: { id: draftPlan.id },
          data: buildPlanTimelineWrite(draftTimeline),
          include: draftMutationInclude,
        });
      }

      if (temporalStatus === 'active') {
        phase = 'validate_past_workout_lock';
        const todayDateKey = getTodayDateKey(effectiveTimezone);
        const cycleStartDateKey = toDateKey(cycle.startDate);
        const existingDraftDocument = normalizeCycleDocumentForPersistence(
          buildDraftMutationDocument(draftPlan),
          {
            includeIds: true,
          }
        );
        const dayOffsets = {
          MONDAY: 0,
          TUESDAY: 1,
          WEDNESDAY: 2,
          THURSDAY: 3,
          FRIDAY: 4,
          SATURDAY: 5,
          SUNDAY: 6,
        };
        const getValidationOccurrenceDateKey = (weekNumber, workout) => {
          const scheduledDayOffset =
            workout?.scheduledDay && dayOffsets[workout.scheduledDay] != null
              ? dayOffsets[workout.scheduledDay]
              : null;
          const fallbackOrderOffset = Math.max(0, Number(workout?.orderIndex || 1) - 1);
          const dayOffset = scheduledDayOffset ?? fallbackOrderOffset;

          return addDays(cycleStartDateKey, (weekNumber - 1) * 7 + dayOffset);
        };
        const existingWorkoutsByOccurrenceDate = new Map();

        existingDraftDocument.weeks.forEach((week) => {
          week.workouts.forEach((workout) => {
            existingWorkoutsByOccurrenceDate.set(
              getValidationOccurrenceDateKey(week.weekNumber, workout),
              createComparableWorkout(workout)
            );
          });
        });

        normalizedIncomingDocument.weeks.forEach((week) => {
          week.workouts.forEach((workout) => {
            const occurrenceDateKey = getValidationOccurrenceDateKey(week.weekNumber, workout);

            if (compareDateKeys(occurrenceDateKey, todayDateKey) < 0) {
              const existingComparable = existingWorkoutsByOccurrenceDate.get(occurrenceDateKey);
              const nextComparable = createComparableWorkout(workout);

              if (existingComparable !== nextComparable) {
                throw new ApiError(
                  400,
                  'VALIDATION_ERROR',
                  'Past workouts cannot be modified on an active cycle'
                );
              }
            }
          });
        });
      }

      phase = 'diff_draft_plan';
      const currentDraftDocument = normalizeCycleDocumentForPersistence(
        buildDraftMutationDocument(draftPlan),
        {
          includeIds: true,
        }
      );
      const draftDiff = diffCycleDraft(currentDraftDocument, normalizedIncomingDocument);

      if (isCycleDraftNoOp(draftDiff.normalizedCurrent, draftDiff.normalizedIncoming)) {
        phase = 'return_current_draft';
      } else {
        phase = 'apply_draft_mutations';

        if (draftDiff.nameChanged) {
          await tx.plan.update({
            where: { id: draftPlan.id },
            data: {
              name: draftDiff.normalizedIncoming.name,
            },
          });
        }

        for (const week of draftDiff.weekDeletes) {
          await assertNoScheduledSessionRefs(
            tx,
            week.workouts.map((workout) => workout.id)
          );
          await tx.planWeek.delete({
            where: { id: week.id },
          });
        }

        for (const week of draftDiff.weekCreates) {
          await tx.planWeek.create({
            data: {
              planId: draftPlan.id,
              ...buildPlanCreateWeeksInput([week])[0],
            },
          });
        }

        for (const weekUpdate of draftDiff.weekUpdates) {
          const hasWorkoutMutations =
            weekUpdate.reorderChanged ||
            weekUpdate.workoutCreates.length > 0 ||
            weekUpdate.workoutDeletes.length > 0 ||
            weekUpdate.workoutUpdates.some(
              (entry) => entry.scalarChanged || entry.blockChanged
            );

          if (!weekUpdate.scalarChanged && !hasWorkoutMutations) {
            continue;
          }

          if (weekUpdate.scalarChanged) {
            await updateWeekScalarFields(tx, weekUpdate.existingWeek, weekUpdate.incomingWeek);
          }

          if (weekUpdate.workoutDeletes.length > 0) {
            await assertNoScheduledSessionRefs(
              tx,
              weekUpdate.workoutDeletes.map((workout) => workout.id)
            );

            await tx.workout.deleteMany({
              where: {
                id: {
                  in: weekUpdate.workoutDeletes.map((workout) => workout.id),
                },
              },
            });
          }

          const needsWorkoutRebuildPass =
            weekUpdate.reorderChanged ||
            weekUpdate.workoutCreates.length > 0 ||
            weekUpdate.workoutDeletes.length > 0;
          const existingWorkoutsToReorder = weekUpdate.workoutUpdates.map(
            ({ existingWorkout }) => existingWorkout
          );

          if (needsWorkoutRebuildPass && existingWorkoutsToReorder.length > 0) {
            await moveExistingWorkoutsToSentinelOrder(tx, existingWorkoutsToReorder);
          }

          await applyWorkoutFinalState(
            tx,
            weekUpdate.existingWeek.id,
            weekUpdate.finalWorkoutOrder,
            weekUpdate.workoutUpdates,
            {
              forceOrderReset: needsWorkoutRebuildPass,
            }
          );
        }
      }

      phase = 'load_updated_plan';
      const updatedPlan = await tx.plan.findUnique({
        where: { id: draftPlan.id },
        include: fullPlanInclude,
      });

      if (!updatedPlan) {
        throw new ApiError(
          500,
          'INTERNAL_SERVER_ERROR',
          'Updated draft plan could not be reloaded'
        );
      }

      logCycleServiceEvent('update_cycle_draft', 'updated_draft_plan', {
        cycleId,
        planId: updatedPlan?.id || draftPlan.id,
        userId,
      });

      return {
        cycleId,
        planId: updatedPlan.id,
        status: updatedPlan.status,
        temporalStatus,
        timezone: effectiveTimezone,
        builderPayload: buildCycleBuilderPayload(cycle, updatedPlan),
        draftTimeline: serializeTimeline(resolvePlanTimeline(cycle, updatedPlan)),
        draftState: {
          state: 'reused',
          effectiveTimezone,
          localDate: getTodayDateKey(effectiveTimezone),
          isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
          canExtendDraft: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
        },
        updatedAt: updatedPlan.updatedAt,
      };
    }, {
      maxWait: 5000,
      timeout: 30000,
    });
  } catch (error) {
    logCycleServiceError('update_cycle_draft', phase, { cycleId, planId, userId }, error);
    throw error;
  }
}

function mergePublishedAndDraftWorkouts(cycle, publishedPlan, draftPlan, timeZone, now = new Date()) {
  const cycleStartDateKey = toDateKey(cycle.startDate);
  const todayDateKey = getTodayDateKey(timeZone, now);
  const publishedDocument = clonePlanDocument(publishedPlan);
  const draftDocument = clonePlanDocument(draftPlan);

  return {
    name: draftDocument.name,
    weeks: draftDocument.weeks.map((week) => {
      const publishedWeek = publishedDocument.weeks.find(
        (entry) => entry.weekNumber === week.weekNumber
      );

      return {
        ...week,
        workouts: week.workouts.map((workout) => {
          const occurrenceDateKey = getOccurrenceDateKey(
            cycleStartDateKey,
            week.weekNumber,
            workout
          );

          if (compareDateKeys(occurrenceDateKey, todayDateKey) < 0) {
            const matched = publishedWeek?.workouts.find((entry) => {
              const publishedDate = getOccurrenceDateKey(
                cycleStartDateKey,
                week.weekNumber,
                entry
              );

              return publishedDate === occurrenceDateKey;
            });

            return matched || workout; // fallback IMPORTANT
          }

          return workout;
        }),
      };
    }),
  };
}

async function publishCycleDraft(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);
  let phase = 'start';

  try {
    const publishResult = await prisma.$transaction(
      async (tx) => {
        phase = 'load_cycle';
        const cycle = await loadCycleForUser(tx, cycleId, userId);
        const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
        const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

        logCycleServiceEvent('publish_cycle_draft', phase, {
          cycleId,
          userId,
          temporalStatus,
          timezone: effectiveTimezone,
        });

        if (temporalStatus === 'past') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be published');
        }

        phase = 'resolve_current_draft';
        const draftPlan = await normalizeSingleDraft(tx, cycleId);
        if (!draftPlan) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'No draft available to publish');
        }

        if (!isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
          phase = 'expire_stale_draft';
          await tx.plan.delete({ where: { id: draftPlan.id } });
          throw new ApiError(409, 'DRAFT_EXPIRED', 'This draft expired and must be reopened from the published version');
        }

        phase = 'build_publish_document';
        const publishedPlan = pickLatestPublished(cycle.plans);
        const draftTimeline = resolvePlanTimeline(cycle, draftPlan);
        assertTimelineMatchesWeeks(
          draftTimeline,
          clonePlanDocument(draftPlan).weeks,
          'Cycle draft'
        );
        const sourceDocument =
          temporalStatus === 'active' && publishedPlan
            ? mergePublishedAndDraftWorkouts(cycle, publishedPlan, draftPlan, effectiveTimezone)
            : clonePlanDocument(draftPlan);
        assertTimelineMatchesWeeks(draftTimeline, sourceDocument.weeks, 'Published cycle');

        phase = 'validate_publish_document';

        validateCycleDocument(sourceDocument, 'publish');
        await assertKnownExerciseIds(collectExerciseIdsFromWeeks(sourceDocument.weeks));

        if (publishedPlan) {
          phase = 'supersede_previous_published_plan';
          await tx.plan.update({
            where: { id: publishedPlan.id },
            data: {
              status: 'SUPERSEDED',
            },
          });
        }

        const nextVersion = Math.max(...cycle.plans.map((plan) => plan.versionNumber)) + 1;
        phase = 'create_published_plan';
        const newPublishedPlan = await tx.plan.create({
          data: {
            trainingCycleId: cycle.id,
            parentPlanId: draftPlan.id,
            name: sourceDocument.name,
            versionNumber: nextVersion,
            sourceType: draftPlan.sourceType || 'USER',
            status: 'PUBLISHED',
            ...buildPlanTimelineWrite(draftTimeline),
            publishedAt: new Date(),
            weeks: {
              create: buildPlanCreateWeeksInput(sourceDocument.weeks),
            },
          },
          include: fullPlanInclude,
        });

        phase = 'update_cycle_canonical_state';
        const updatedCycle = await tx.trainingCycle.update({
          where: { id: cycle.id },
          data: {
            name: sourceDocument.name,
            ...buildPlanTimelineWrite(draftTimeline),
          },
        });

        phase = 'delete_draft_plan';
        await tx.plan.delete({
          where: { id: draftPlan.id },
        });

        logCycleServiceEvent('publish_cycle_draft', 'published_cycle', {
          cycleId,
          userId,
          draftPlanId: draftPlan.id,
          publishedPlanId: newPublishedPlan.id,
        });

        return {
          cycleId: cycle.id,
          publishedPlanId: newPublishedPlan.id,
          status: 'PUBLISHED',
          temporalStatus: deriveTemporalStatus(updatedCycle, effectiveTimezone),
          timezone: effectiveTimezone,
          cycle: {
            id: updatedCycle.id,
            name: sourceDocument.name,
            startDate: toDateKey(updatedCycle.startDate),
            endDate: toDateKey(updatedCycle.endDate),
            durationWeeks: updatedCycle.durationWeeks,
          },
          builderPayload: buildCycleBuilderPayload(updatedCycle, newPublishedPlan),
          updatedAt: newPublishedPlan.updatedAt,
        };
      },
      {
        timeout: 15000,
      }
    );

    phase = 'sync_scheduled_sessions';
    try {
      await regenerateScheduledSessionsForPublishedCycle(cycleId, {
        userId,
        timezone: publishResult.timezone,
      });
    } catch (error) {
      logCycleServiceError(
        'publish_cycle_draft',
        phase,
        {
          cycleId,
          userId,
          publishedPlanId: publishResult.publishedPlanId,
        },
        error
      );

      throw new ApiError(
        500,
        'SCHEDULE_SYNC_FAILED',
        'Cycle was published, but scheduled sessions failed to synchronize.'
      );
    }

    return publishResult;
  } catch (error) {
    logCycleServiceError('publish_cycle_draft', phase, { cycleId, userId }, error);
    throw error;
  }
}

async function updateUpcomingDraftTimeline(cycleId, planId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);
    const todayDateKey = getTodayDateKey(effectiveTimezone);
    const currentStartDateKey = toDateKey(cycle.startDate);
    const currentEndDateKey = toDateKey(cycle.endDate);
    const currentWeekNumber =
      temporalStatus === 'active' ? getCurrentCycleWeekNumber(cycle, effectiveTimezone) : null;

    if (temporalStatus === 'past') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be edited');
    }

    if (!['upcoming', 'active'].includes(temporalStatus)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'This cycle timeline cannot be edited');
    }

    const {
      startDateKey: normalizedStartDateKey,
      endDateKey: nextEndDateKey,
      durationWeeks: nextDurationWeeks,
    } = normalizeCanonicalMultiWeekDateRange(
      payload.newStartDate,
      payload.durationWeeks,
      payload.newEndDate || payload.endDate,
      'newStartDate',
      'newEndDate'
    );

    if (nextDurationWeeks > MAX_CYCLE_DURATION_WEEKS) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `durationWeeks cannot exceed ${MAX_CYCLE_DURATION_WEEKS}`
      );
    }

    let draftPlan = await normalizeSingleDraft(tx, cycle.id);
    const publishedPlan = pickLatestPublished(cycle.plans);
    const canonicalTimeline = resolvePlanTimeline(cycle, null);

    if (!draftPlan && publishedPlan) {
      const sourceDocument = clonePlanDocument(publishedPlan);
      const latestPlan = cycle.plans[0];

      draftPlan = await tx.plan.create({
        data: {
          trainingCycleId: cycle.id,
          parentPlanId: publishedPlan.id,
          name: sourceDocument.name,
          versionNumber: (latestPlan?.versionNumber ?? 0) + 1,
          sourceType: publishedPlan.sourceType || 'USER',
          status: 'DRAFT',
          ...buildPlanTimelineWrite(canonicalTimeline),
          weeks: {
            create: buildPlanCreateWeeksInput(sourceDocument.weeks),
          },
        },
        include: fullPlanInclude,
      });
    }

    if (!draftPlan || draftPlan.id !== planId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'This draft is not the current editable version');
    }

    if (
      temporalStatus === 'active' &&
      !isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))
    ) {
      await tx.plan.delete({ where: { id: draftPlan.id } });
      throw new ApiError(409, 'DRAFT_EXPIRED', 'This draft expired and must be reopened from the published version');
    }

    let draftTimeline = resolvePlanTimeline(cycle, draftPlan);
    if (!hasCompletePlanTimeline(draftPlan)) {
      draftPlan = await tx.plan.update({
        where: { id: draftPlan.id },
        data: buildPlanTimelineWrite(draftTimeline),
        include: fullPlanInclude,
      });
    }

    const isExtension = nextDurationWeeks > draftTimeline.durationWeeks;
    const isTrim = nextDurationWeeks < draftTimeline.durationWeeks;

    if (temporalStatus === 'upcoming') {
      ensureNotPastDate(normalizedStartDateKey, todayDateKey, 'startDate');
      ensureNotPastDate(nextEndDateKey, todayDateKey, 'endDate');

      const existingCycles = await tx.trainingCycle.findMany({
        where: { userId },
        select: { id: true, startDate: true, endDate: true },
      });
      validateNoOverlap(existingCycles, normalizedStartDateKey, nextEndDateKey, cycle.id);
    } else {
      if (normalizedStartDateKey !== currentStartDateKey) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Active cycles cannot change their start date'
        );
      }

      if (isTrim && nextDurationWeeks < currentWeekNumber) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `durationWeeks cannot be shorter than the current week (${currentWeekNumber})`
        );
      }

      if (compareDateKeys(nextEndDateKey, currentEndDateKey) > 0) {
        const existingCycles = await tx.trainingCycle.findMany({
          where: { userId },
          select: { id: true, startDate: true, endDate: true },
        });
        validateNoOverlap(existingCycles, normalizedStartDateKey, nextEndDateKey, cycle.id);
      }
    }

    const currentDocument = validateCycleDocument(clonePlanDocument(draftPlan), 'draft');
    assertTimelineMatchesWeeks(draftTimeline, currentDocument.weeks, 'Cycle draft');

    if (isExtension) {
      validateTimelineExtensionSource(currentDocument, payload.sourceWeekNumber);
    }

    const nextDocument = buildTimelineDocument(
      currentDocument,
      nextDurationWeeks,
      isExtension ? payload.sourceWeekNumber : null
    );

    if (nextDocument.weeks.length !== nextDurationWeeks) {
      throw new ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'Timeline update produced an invalid week count'
      );
    }

    if (isExtension) {
      const weeksToAppend = nextDocument.weeks.filter(
        (week) => Number(week.weekNumber) > draftTimeline.durationWeeks
      );

      draftPlan = await appendPlanWeeks(tx, draftPlan.id, weeksToAppend);
    } else {
      draftPlan = await replacePlanWeeks(tx, draftPlan.id, nextDocument.weeks);
    }

    draftTimeline = {
      startDateKey: normalizedStartDateKey,
      endDateKey: nextEndDateKey,
      durationWeeks: nextDurationWeeks,
    };
    draftPlan = await tx.plan.update({
      where: { id: draftPlan.id },
      data: buildPlanTimelineWrite(draftTimeline),
      include: fullPlanInclude,
    });

    return {
      cycleId: cycle.id,
      planId: draftPlan.id,
      cycle: {
        id: cycle.id,
        startDate: toDateKey(cycle.startDate),
        endDate: toDateKey(cycle.endDate),
        durationWeeks: cycle.durationWeeks,
        timezone: effectiveTimezone,
        temporalStatus: deriveTemporalStatus(cycle, effectiveTimezone),
      },
      visiblePlanId: draftPlan.id,
      status: draftPlan.status,
      builderPayload: buildCycleBuilderPayload(cycle, draftPlan),
      draftTimeline: serializeTimeline(draftTimeline),
      temporalStatus: deriveTemporalStatus(cycle, effectiveTimezone),
      timezone: effectiveTimezone,
      draftState: {
        effectiveTimezone,
        localDate: todayDateKey,
        isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
        canExtendDraft: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
      },
      currentWeekNumber,
    };
  }, {
    maxWait: 5000,
    timeout: 30000,
  });
}

async function rescheduleUpcomingCycle(cycleId, payload = {}) {
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  throw new ApiError(
    400,
    'VALIDATION_ERROR',
    'Use the draft timeline endpoint to reschedule cycle drafts'
  );
}

async function deleteCycle(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);

    await tx.scheduledSession.deleteMany({
      where: {
        workout: {
          planWeek: {
            plan: {
              trainingCycleId: cycle.id,
            },
          },
        },
      },
    });

    await tx.trainingCycle.delete({
      where: { id: cycle.id },
    });

    return {
      deleted: true,
      cycleId: cycle.id,
    };
  });
}

async function extendCycleDraft(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

    if (temporalStatus !== 'active') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Draft extension is only available for active cycles');
    }

    if (!isWithinGraceWindow(effectiveTimezone)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Draft extension is only available between 00:00 and 00:20 local time'
      );
    }

    const draftPlan = await normalizeSingleDraft(tx, cycleId);
    if (!draftPlan) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No draft is available to extend');
    }

    const updatedDraft = await tx.plan.update({
      where: { id: draftPlan.id },
      data: {
        changeSummary: draftPlan.changeSummary || {},
      },
    });

    return {
      cycleId: cycle.id,
      planId: updatedDraft.id,
      extensionGranted: true,
      timezone: effectiveTimezone,
      localDate: getTodayDateKey(effectiveTimezone),
    };
  });
}

function createCalendarRowsForWeek(startDateKey, cycleCard, visiblePlan, weekStartDateKey, label) {
  const endDateKey = addDays(weekStartDateKey, 6);
  const workoutsByDate = new Map();
  const todayDateKey = getTodayDateKey(cycleCard?.timezone || DEFAULT_TIMEZONE);

  const serializedPlan = serializePlan(visiblePlan);
  (serializedPlan?.weeks || []).forEach((week) => {
    week.workouts.forEach((workout) => {
      const occurrenceDateKey = getOccurrenceDateKey(startDateKey, week.weekNumber, workout);
      workoutsByDate.set(occurrenceDateKey, {
        id: workout.id,
        name: workout.name,
        weekNumber: week.weekNumber,
        orderIndex: workout.orderIndex,
      });
    });
  });

  return {
    label,
    startDate: weekStartDateKey,
    endDate: endDateKey,
    days: Array.from({ length: 7 }).map((_, index) => {
      const dateKey = addDays(weekStartDateKey, index);
      const workout = workoutsByDate.get(dateKey) || null;
      const workouts = workout ? [workout] : [];
      const isPast = compareDateKeys(dateKey, todayDateKey) < 0;
      const isToday = compareDateKeys(dateKey, todayDateKey) === 0;

      return {
        date: dateKey,
        workouts,
        workout,
        state: isToday
          ? 'today'
          : isPast
            ? workout
              ? 'past_missed'
              : 'past_empty'
            : workout
              ? 'future_planned'
              : 'future_empty',
      };
    }),
  };
}

function normalizeSelectedDateKey(requestedSelectedDate, effectiveTimezone) {
  return toDateKey(requestedSelectedDate) || getTodayDateKey(effectiveTimezone);
}

function selectCanonicalHomeCycle(cycles, requestedTimezone) {
  const publishedCycles = cycles
    .map((cycle) => {
      const cycleTimeZone = resolveEffectiveTimezone(
        cycle.timezone,
        requestedTimezone,
        DEFAULT_TIMEZONE
      );
      const visiblePlan = pickLatestPublished(cycle.plans);

      if (!visiblePlan) {
        return null;
      }

      return {
        cycle,
        visiblePlan,
        cycleTimeZone,
        temporalStatus: deriveTemporalStatus(cycle, cycleTimeZone),
      };
    })
    .filter(Boolean);

  return (
    publishedCycles.find((entry) => entry.temporalStatus === 'active') ||
    publishedCycles.find((entry) => entry.temporalStatus === 'upcoming') ||
    null
  );
}

function buildCanonicalHomeStatus(card, todayDateKey) {
  if (!card) {
    return {
      state: 'none',
      label: 'No published cycle',
      cycleId: null,
    };
  }

  if (card.temporalStatus === 'upcoming') {
    return {
      state: 'upcoming',
      label: `Starts ${card.startDate} · ${card.name}`,
      cycleId: card.cycleId,
    };
  }

  const currentWeekNumber = Math.min(
    card.durationWeeks,
    Math.max(1, Math.floor((diffDateKeys(card.startDate, todayDateKey) || 0) / 7) + 1)
  );

  return {
    state: 'active',
    label: `Week ${currentWeekNumber} of ${card.durationWeeks} · ${card.name}`,
    cycleId: card.cycleId,
  };
}

function buildCanonicalCurrentProgram(card) {
  if (!card) {
    return null;
  }

  return {
    cycleId: card.cycleId,
    name: card.name,
    startDate: card.startDate,
    endDate: card.endDate,
    durationWeeks: card.durationWeeks,
    temporalStatus: card.temporalStatus,
    summary: card.summary,
  };
}

function buildCanonicalHomeCycleCard(cycle, visiblePlan, cycleTimeZone, temporalStatus) {
  return {
    cycleId: cycle.id,
    visiblePlanId: visiblePlan?.id || null,
    name: visiblePlan?.name || cycle.name,
    startDate: toDateKey(cycle.startDate),
    endDate: toDateKey(cycle.endDate),
    durationWeeks: cycle.durationWeeks,
    timezone: cycleTimeZone,
    temporalStatus,
    summary: buildPlanSummary(visiblePlan, toDateKey(cycle.startDate)),
  };
}

function mapScheduledSessionToHomeSession(session) {
  if (!session?.workout) {
    return null;
  }

  return {
    id: session.id,
    status: session.status,
    scheduledStartAt: session.scheduledStartAt,
    scheduledEndAt: session.scheduledEndAt,
    workoutId: session.workout.id,
    workoutName: session.workout.name,
    weekNumber: session.workout.planWeek.weekNumber,
    orderIndex: session.workout.orderIndex,
  };
}

function mapHomeSessionToDayState(session) {
  return session ? 'planned' : 'rest';
}

function buildRestFocus(selectedDateKey, currentProgram) {
  return {
    date: selectedDateKey,
    type: 'rest',
    title: 'Rest / Recovery',
    subtitle: currentProgram?.name || 'No session planned',
    showStartSession: false,
    session: null,
  };
}

function buildSelectedDayFocus(selectedDateKey, session, currentProgram) {
  if (!session) {
    return buildRestFocus(selectedDateKey, currentProgram);
  }

  return {
    date: selectedDateKey,
    type: 'session',
    title: session.workoutName,
    subtitle: `Workout ${session.orderIndex} · Week ${session.weekNumber}`,
    showStartSession: session.status === 'PLANNED' || session.status === 'RESCHEDULED',
    session,
  };
}

function countPlannedWorkoutSets(workout) {
  return (workout?.blocks || []).reduce(
    (blockSum, block) =>
      blockSum +
      (block?.blockExercises || []).reduce(
        (exerciseSum, exercise) => exerciseSum + (exercise?.setTemplates || []).length,
        0
      ),
    0
  );
}

function buildWeeklyPerformancePayload(weekStartDateKey, weekEndDateKey, plannedWorkouts, plannedSets) {
  return {
    weekStartDate: weekStartDateKey,
    weekEndDate: weekEndDateKey,
    workouts: {
      actual: 0,
      planned: plannedWorkouts,
    },
    sets: {
      actual: 0,
      planned: plannedSets,
    },
  };
}

async function loadHomeSessionsByDateForUser(
  userId,
  requestedTimezone,
  windowStartDateKey,
  windowEndDateKey
) {
  const prisma = getPrisma();
  const scheduledSessions = await prisma.scheduledSession.findMany({
    where: {
      scheduledStartAt: {
        gte: new Date(`${addDays(windowStartDateKey, -1)}T00:00:00.000Z`),
        lte: new Date(`${addDays(windowEndDateKey, 1)}T23:59:59.999Z`),
      },
      workout: {
        planWeek: {
          plan: {
            trainingCycle: {
              userId,
            },
          },
        },
      },
    },
    orderBy: { scheduledStartAt: 'asc' },
    select: {
      id: true,
      status: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      workout: {
        select: {
          id: true,
          name: true,
          orderIndex: true,
          planWeek: {
            select: {
              weekNumber: true,
              plan: {
                select: {
                  trainingCycle: {
                    select: {
                      id: true,
                      timezone: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const sessionsByDate = new Map();

  scheduledSessions.forEach((session) => {
    const sessionCycle = session.workout?.planWeek?.plan?.trainingCycle || null;
    const sessionTimeZone = resolveEffectiveTimezone(
      sessionCycle?.timezone,
      requestedTimezone,
      DEFAULT_TIMEZONE
    );
    const dateKey = getLocalDateTimeParts(session.scheduledStartAt, sessionTimeZone).dateKey;
    if (
      compareDateKeys(dateKey, windowStartDateKey) < 0 ||
      compareDateKeys(dateKey, windowEndDateKey) > 0
    ) {
      return;
    }

    const homeSession = mapScheduledSessionToHomeSession(session);
    if (sessionsByDate.has(dateKey)) {
      console.warn('[cyclesService][get_canonical_home_dashboard]', {
        userId,
        dateKey,
        incomingCycleId: sessionCycle?.id || null,
        message:
          'Multiple scheduled sessions found for the same day; keeping the earliest one.',
      });
      return;
    }

    sessionsByDate.set(dateKey, homeSession);
  });

  return sessionsByDate;
}

async function loadHomeWeeklyPerformanceForUser(
  userId,
  requestedTimezone,
  weekStartDateKey,
  weekEndDateKey
) {
  const prisma = getPrisma();
  const scheduledSessions = await prisma.scheduledSession.findMany({
    where: {
      scheduledStartAt: {
        gte: new Date(`${addDays(weekStartDateKey, -1)}T00:00:00.000Z`),
        lte: new Date(`${addDays(weekEndDateKey, 1)}T23:59:59.999Z`),
      },
      workout: {
        planWeek: {
          plan: {
            trainingCycle: {
              userId,
            },
          },
        },
      },
    },
    orderBy: { scheduledStartAt: 'asc' },
    select: {
      id: true,
      scheduledStartAt: true,
      workout: {
        select: {
          id: true,
          planWeek: {
            select: {
              plan: {
                select: {
                  trainingCycle: {
                    select: {
                      id: true,
                      timezone: true,
                    },
                  },
                },
              },
            },
          },
          blocks: {
            select: {
              blockExercises: {
                select: {
                  setTemplates: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const sessionsByDate = new Map();

  scheduledSessions.forEach((session) => {
    const sessionCycle = session.workout?.planWeek?.plan?.trainingCycle || null;
    const sessionTimeZone = resolveEffectiveTimezone(
      sessionCycle?.timezone,
      requestedTimezone,
      DEFAULT_TIMEZONE
    );
    const dateKey = getLocalDateTimeParts(session.scheduledStartAt, sessionTimeZone).dateKey;

    if (
      compareDateKeys(dateKey, weekStartDateKey) < 0 ||
      compareDateKeys(dateKey, weekEndDateKey) > 0
    ) {
      return;
    }

    if (sessionsByDate.has(dateKey)) {
      console.warn('[cyclesService][get_canonical_home_dashboard_weekly_performance]', {
        userId,
        dateKey,
        incomingCycleId: sessionCycle?.id || null,
        message:
          'Multiple scheduled sessions found for the same day in weekly performance; keeping the earliest one.',
      });
      return;
    }

    sessionsByDate.set(dateKey, session);
  });

  const plannedWorkouts = sessionsByDate.size;
  const plannedSets = Array.from(sessionsByDate.values()).reduce(
    (sum, session) => sum + countPlannedWorkoutSets(session.workout),
    0
  );

  return buildWeeklyPerformancePayload(
    weekStartDateKey,
    weekEndDateKey,
    plannedWorkouts,
    plannedSets
  );
}

async function getCanonicalHomeDashboard(userId, requestedTimezone, requestedSelectedDate) {
  const prisma = getPrisma();
  await assertUserExists(userId);

  const effectiveTimezone = resolveEffectiveTimezone(requestedTimezone, DEFAULT_TIMEZONE);
  const todayDateKey = getTodayDateKey(effectiveTimezone);
  const selectedDateKey = normalizeSelectedDateKey(requestedSelectedDate, effectiveTimezone);
  const currentWeekStartDateKey = getStartOfMondayWeek(todayDateKey);
  const currentWeekEndDateKey = addDays(currentWeekStartDateKey, 6);
  const scheduleStartDateKey = getStartOfMondayWeek(selectedDateKey);
  const scheduleEndDateKey = addDays(scheduleStartDateKey, 13);

  const cycles = await prisma.trainingCycle.findMany({
    where: { userId },
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  });

  const visibleCycleEntry = selectCanonicalHomeCycle(cycles, requestedTimezone);
  const weeklyPerformance = await loadHomeWeeklyPerformanceForUser(
    userId,
    requestedTimezone,
    currentWeekStartDateKey,
    currentWeekEndDateKey
  );

  if (!visibleCycleEntry) {
    const emptyDays = Array.from({ length: 14 }).map((_, index) => {
      const dateKey = addDays(scheduleStartDateKey, index);
      return {
        date: dateKey,
        isToday: dateKey === todayDateKey,
        isSelected: dateKey === selectedDateKey,
        state: 'rest',
        session: null,
      };
    });

    return {
      timezone: effectiveTimezone,
      selectedDate: selectedDateKey,
      status: buildCanonicalHomeStatus(null, todayDateKey),
      currentProgram: null,
      todayFocus: buildRestFocus(selectedDateKey, null),
      weeklyPerformance,
      schedule14Days: {
        startDate: scheduleStartDateKey,
        endDate: scheduleEndDateKey,
        days: emptyDays,
      },
    };
  }

  const { cycle: visibleCycle, visiblePlan, cycleTimeZone, temporalStatus } = visibleCycleEntry;
  const cycleCard = buildCanonicalHomeCycleCard(
    visibleCycle,
    visiblePlan,
    cycleTimeZone,
    temporalStatus
  );
  const currentProgram = buildCanonicalCurrentProgram(cycleCard);
  const sessionsByDate = await loadHomeSessionsByDateForUser(
    userId,
    requestedTimezone,
    scheduleStartDateKey,
    scheduleEndDateKey
  );

  const days = Array.from({ length: 14 }).map((_, index) => {
    const dateKey = addDays(scheduleStartDateKey, index);
    const session = sessionsByDate.get(dateKey) || null;

    return {
      date: dateKey,
      isToday: dateKey === todayDateKey,
      isSelected: dateKey === selectedDateKey,
      state: mapHomeSessionToDayState(session),
      session,
    };
  });

  return {
    timezone: effectiveTimezone,
    selectedDate: selectedDateKey,
    status: buildCanonicalHomeStatus(cycleCard, todayDateKey),
    currentProgram,
    todayFocus: buildSelectedDayFocus(
      selectedDateKey,
      sessionsByDate.get(selectedDateKey) || null,
      currentProgram
    ),
    weeklyPerformance,
    schedule14Days: {
      startDate: scheduleStartDateKey,
      endDate: scheduleEndDateKey,
      days,
    },
  };
}

async function getHomeDashboard(userId, requestedTimezone) {
  const prisma = getPrisma();
  await assertUserExists(userId);

  const cycles = await prisma.trainingCycle.findMany({
    where: { userId },
    include: {
      plans: {
        orderBy: { versionNumber: 'desc' },
        include: fullPlanInclude,
      },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  });

  const effectiveTimezone = resolveEffectiveTimezone(requestedTimezone, DEFAULT_TIMEZONE);
  const currentCycle = cycles.find((cycle) => {
    const temporalStatus = deriveTemporalStatus(
      cycle,
      resolveEffectiveTimezone(cycle.timezone, requestedTimezone, DEFAULT_TIMEZONE)
    );
    return temporalStatus === 'active' && Boolean(pickLatestPublished(cycle.plans));
  });

  const todayDateKey = getTodayDateKey(effectiveTimezone);
  const currentWeekStart = getStartOfSundayWeek(todayDateKey);

  if (!currentCycle) {
    return {
      timezone: effectiveTimezone,
      todayDate: todayDateKey,
      currentProgram: null,
      todayFocus: null,
      weeks: [
        createCalendarRowsForWeek(todayDateKey, null, null, currentWeekStart, 'current'),
        createCalendarRowsForWeek(todayDateKey, null, null, addDays(currentWeekStart, 7), 'next'),
      ],
    };
  }

  const visiblePlan = pickLatestPublished(currentCycle.plans);
  const cycleTimeZone = resolveEffectiveTimezone(currentCycle.timezone, requestedTimezone, DEFAULT_TIMEZONE);
  const cycleCard = buildCycleCard(currentCycle, visiblePlan, cycleTimeZone);
  const cycleStartDateKey = toDateKey(currentCycle.startDate);
  const currentWeek = createCalendarRowsForWeek(
    cycleStartDateKey,
    cycleCard,
    visiblePlan,
    currentWeekStart,
    'current'
  );
  const nextWeek = createCalendarRowsForWeek(
    cycleStartDateKey,
    cycleCard,
    visiblePlan,
    addDays(currentWeekStart, 7),
    'next'
  );
  const todayFocus = [...currentWeek.days, ...nextWeek.days].find((day) => day.date === todayDateKey)?.workout || null;

  return {
    timezone: effectiveTimezone,
    todayDate: todayDateKey,
    currentProgram: cycleCard,
    todayFocus,
    weeks: [currentWeek, nextWeek],
  };
}

module.exports = {
  createCycle,
  createCycleFromWeeklyPlan,
  createPlanForCycle,
  deleteCycle,
  extendCycleDraft,
  getCanonicalHomeDashboard,
  getCycleDetails,
  getCycleFull,
  getHomeDashboard,
  getProgramOverviewV2,
  getProgramsOverview,
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  rescheduleUpcomingCycle,
  updateCycleDraft,
  updateUpcomingDraftTimeline,
};
