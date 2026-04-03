const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');
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
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeInt(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeNumeric(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  return {
    programName: serializedPlan?.name || cycle.name,
    sessionsPerWeek: getWeekSessionsPerWeek(serializedPlan?.weeks?.[0]),
    programLength: cycle.durationWeeks,
    startDate: toDateKey(cycle.startDate),
    endDate: toDateKey(cycle.endDate),
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

function getOccurrenceDateKey(startDateKey, weekNumber, workoutOrderIndex) {
  return addDays(startDateKey, (weekNumber - 1) * 7 + (workoutOrderIndex - 1));
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
    estimatedDurationMinutes: workout.estimatedDurationMinutes || null,
    notes: workout.notes || null,
    blocks: (workout.blocks || []).map((block) => ({
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label || null,
      roundCount: block.roundCount || null,
      restStrategy: block.restStrategy || null,
      restSeconds: block.restSeconds || null,
      notes: block.notes || null,
      exercises: (block.exercises || []).map((exercise) => ({
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes || null,
        defaultTempo: exercise.defaultTempo || null,
        defaultRestSeconds: exercise.defaultRestSeconds || null,
        defaultTargetRir: exercise.defaultTargetRir ?? null,
        defaultTargetRpe: exercise.defaultTargetRpe ?? null,
        intensificationMethod: exercise.intensificationMethod || null,
        notes: exercise.notes || null,
        setTemplates: (exercise.setTemplates || []).map((setTemplate) => ({
          setIndex: setTemplate.setIndex,
          setType: setTemplate.setType || null,
          targetReps: setTemplate.targetReps ?? null,
          minReps: setTemplate.minReps ?? null,
          maxReps: setTemplate.maxReps ?? null,
          targetSeconds: setTemplate.targetSeconds ?? null,
          targetRir: setTemplate.targetRir ?? null,
          targetRpe: setTemplate.targetRpe ?? null,
          tempo: setTemplate.tempo || null,
          restSeconds: setTemplate.restSeconds ?? null,
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

async function normalizeSingleDraft(tx, cycleId) {
  const drafts = await tx.plan.findMany({
    where: {
      trainingCycleId: cycleId,
      status: 'DRAFT',
    },
    orderBy: { updatedAt: 'desc' },
    include: fullPlanInclude,
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

function buildPlanCreateWeeksInput(weeks = []) {
  return weeks.map((week) => ({
    weekNumber: week.weekNumber,
    orderIndex: week.orderIndex,
    label: week.label || null,
    notes: week.notes || null,
    workouts: {
      create: week.workouts.map((workout) => ({
        name: workout.name,
        orderIndex: workout.orderIndex,
        scheduledDay: workout.scheduledDay || null,
        estimatedDurationMinutes: workout.estimatedDurationMinutes || null,
        notes: workout.notes || null,
        blocks: {
          create: workout.blocks.map((block) => ({
            orderIndex: block.orderIndex,
            blockType: block.blockType,
            label: block.label || null,
            roundCount: block.roundCount || null,
            restStrategy: block.restStrategy || null,
            restSeconds: block.restSeconds || null,
            notes: block.notes || null,
            blockExercises: {
              create: block.exercises.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                orderIndex: exercise.orderIndex,
                executionNotes: exercise.executionNotes || null,
                defaultTempo: exercise.defaultTempo || null,
                defaultRestSeconds: exercise.defaultRestSeconds || null,
                defaultTargetRir: exercise.defaultTargetRir ?? null,
                defaultTargetRpe: exercise.defaultTargetRpe ?? null,
                intensificationMethod: exercise.intensificationMethod || 'NONE',
                notes: exercise.notes || null,
                setTemplates: {
                  create: exercise.setTemplates.map((setTemplate) => ({
                    setIndex: setTemplate.setIndex,
                    setType: setTemplate.setType || 'WORKING',
                    targetReps: setTemplate.targetReps ?? null,
                    minReps: setTemplate.minReps ?? null,
                    maxReps: setTemplate.maxReps ?? null,
                    targetSeconds: setTemplate.targetSeconds ?? null,
                    targetRir: setTemplate.targetRir ?? null,
                    targetRpe: setTemplate.targetRpe ?? null,
                    tempo: setTemplate.tempo || null,
                    restSeconds: setTemplate.restSeconds ?? null,
                    notes: setTemplate.notes || null,
                  })),
                },
              })),
            },
          })),
        },
      })),
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
            exerciseName: exercise.exerciseName || exercise.exercise?.name || '',
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

function buildDocumentFromWeeklyVersion(version, durationWeeks, workoutDayAssignments = new Map()) {
  const workouts = version.workouts.map((workout) => ({
    name: workout.name,
    orderIndex: workout.orderIndex,
    scheduledDay: workoutDayAssignments.get(workout.orderIndex) || null,
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

  ensureNotPastDate(startDateKey, todayDateKey, 'startDate');
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

    const publishedPlan = await tx.plan.create({
      data: {
        trainingCycleId: cycle.id,
        name: document.name,
        versionNumber: 1,
        sourceType: 'USER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        weeks: {
          create: buildPlanCreateWeeksInput(document.weeks),
        },
      },
      include: fullPlanInclude,
    });

    return { cycle, publishedPlan };
  });

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
    .map((cycle) =>
      buildCycleCard(
        cycle,
        pickVisiblePlan(cycle.plans),
        resolveEffectiveTimezone(cycle.timezone, requestedTimezone, DEFAULT_TIMEZONE)
      )
    )
    .filter((card) => card.visiblePlanId);

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
      const visiblePlan = pickVisiblePlan(cycle.plans);
      if (!visiblePlan) {
        return null;
      }

      return buildProgramOverviewCardSource(cycle, visiblePlan, requestedTimezone);
    })
    .filter(Boolean);

  const activeCard =
    cards.find((card) => card.temporalStatus === 'active' && card.editorialStatus === 'published') ||
    cards.find((card) => card.temporalStatus === 'active') ||
    null;
  const todayDateKey = getTodayDateKey(activeCard?.timezone || timezone);
  const upcomingCards = cards.filter((card) => card.temporalStatus === 'upcoming');
  const nextUpcomingByTime =
    [...upcomingCards].sort((left, right) => compareDateKeys(left.startDate, right.startDate))[0] ||
    null;
  const publishedUpcoming = upcomingCards
    .filter((card) => card.editorialStatus === 'published')
    .sort((left, right) => compareDateKeys(left.startDate, right.startDate));
  const draftUpcoming = upcomingCards
    .filter((card) => card.editorialStatus !== 'published')
    .sort((left, right) => compareDateKeys(left.startDate, right.startDate));
  const prioritizedUpcoming = [...publishedUpcoming, ...draftUpcoming].slice(0, 2);
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
  const visiblePlan = pickVisiblePlan(cycle.plans);
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

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

    if (temporalStatus === 'past') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be edited');
    }

    let draftPlan = await normalizeSingleDraft(tx, cycleId);
    const publishedPlan = pickLatestPublished(cycle.plans);
    let state = 'reused';

    if (draftPlan && !isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
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
            weeks: {
              create: buildPlanCreateWeeksInput(sourceDocument.weeks),
            },
          },
          include: fullPlanInclude,
        });
        state = 'fresh';
      }
    }

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
      draftState: {
        state,
        effectiveTimezone,
        localDate: getTodayDateKey(effectiveTimezone),
        isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
        canExtendDraft: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
      },
      updatedAt: draftPlan.updatedAt,
    };
  });
}

async function updateCycleDraft(cycleId, planId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  const document = validateCycleDocument(payload, 'draft');
  await assertKnownExerciseIds(collectExerciseIdsFromWeeks(document.weeks));

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

    if (temporalStatus === 'past') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be edited');
    }

    const draftPlan = await normalizeSingleDraft(tx, cycleId);
    if (!draftPlan || draftPlan.id !== planId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'This draft is not the current editable version');
    }

    if (!isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
      await tx.plan.delete({ where: { id: draftPlan.id } });
      throw new ApiError(409, 'DRAFT_EXPIRED', 'This draft expired and must be reopened from the published version');
    }

    if (temporalStatus === 'active') {
      const todayDateKey = getTodayDateKey(effectiveTimezone);
      const cycleStartDateKey = toDateKey(cycle.startDate);
      const existingDraftDocument = clonePlanDocument(draftPlan);
      const existingWorkoutsByKey = new Map();

      existingDraftDocument.weeks.forEach((week) => {
        week.workouts.forEach((workout) => {
          existingWorkoutsByKey.set(
            `${week.weekNumber}:${workout.orderIndex}`,
            createComparableWorkout(workout)
          );
        });
      });

      document.weeks.forEach((week) => {
        week.workouts.forEach((workout) => {
          const occurrenceDateKey = getOccurrenceDateKey(
            cycleStartDateKey,
            week.weekNumber,
            workout.orderIndex
          );

          if (compareDateKeys(occurrenceDateKey, todayDateKey) < 0) {
            const existingComparable = existingWorkoutsByKey.get(
              `${week.weekNumber}:${workout.orderIndex}`
            );
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

    await tx.workout.deleteMany({
      where: {
        planWeek: {
          planId: draftPlan.id,
        },
      },
    });

    await tx.planWeek.deleteMany({
      where: {
        planId: draftPlan.id,
      },
    });

    const updatedPlan = await tx.plan.update({
      where: { id: draftPlan.id },
      data: {
        name: document.name,
        trainingCycle: {
          update: {
            name: document.name,
          },
        },
        weeks: {
          create: buildPlanCreateWeeksInput(document.weeks),
        },
      },
      include: fullPlanInclude,
    });

    return {
      cycleId,
      planId: updatedPlan.id,
      status: updatedPlan.status,
      temporalStatus,
      timezone: effectiveTimezone,
      builderPayload: buildCycleBuilderPayload(cycle, updatedPlan),
      draftState: {
        state: 'reused',
        effectiveTimezone,
        localDate: getTodayDateKey(effectiveTimezone),
        isGraceWindow: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
        canExtendDraft: temporalStatus === 'active' && isWithinGraceWindow(effectiveTimezone),
      },
      updatedAt: updatedPlan.updatedAt,
    };
  });
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
            workout.orderIndex
          );

          if (compareDateKeys(occurrenceDateKey, todayDateKey) < 0) {
            return (
              publishedWeek?.workouts.find((entry) => entry.orderIndex === workout.orderIndex) ||
              workout
            );
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

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);

    if (temporalStatus === 'past') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Past cycles cannot be published');
    }

    const draftPlan = await normalizeSingleDraft(tx, cycleId);
    if (!draftPlan) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No draft available to publish');
    }

    if (!isDraftStillUsable(cycle, draftPlan, effectiveTimezone, Boolean(payload.allowCrossDayDraft))) {
      await tx.plan.delete({ where: { id: draftPlan.id } });
      throw new ApiError(409, 'DRAFT_EXPIRED', 'This draft expired and must be reopened from the published version');
    }

    const publishedPlan = pickLatestPublished(cycle.plans);
    const sourceDocument =
      temporalStatus === 'active' && publishedPlan
        ? mergePublishedAndDraftWorkouts(cycle, publishedPlan, draftPlan, effectiveTimezone)
        : clonePlanDocument(draftPlan);

    validateCycleDocument(sourceDocument, 'publish');
    await assertKnownExerciseIds(collectExerciseIdsFromWeeks(sourceDocument.weeks));

    const latestPlan = cycle.plans[0];
    const newPublishedPlan = await tx.plan.create({
      data: {
        trainingCycleId: cycle.id,
        parentPlanId: draftPlan.id,
        name: sourceDocument.name,
        versionNumber: (latestPlan?.versionNumber ?? 0) + 1,
        sourceType: draftPlan.sourceType || 'USER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        weeks: {
          create: buildPlanCreateWeeksInput(sourceDocument.weeks),
        },
      },
      include: fullPlanInclude,
    });

    if (publishedPlan) {
      await tx.plan.update({
        where: { id: publishedPlan.id },
        data: {
          status: 'SUPERSEDED',
        },
      });
    }

    await tx.trainingCycle.update({
      where: { id: cycle.id },
      data: {
        name: sourceDocument.name,
      },
    });

    await tx.plan.delete({
      where: { id: draftPlan.id },
    });

    return {
      cycleId: cycle.id,
      publishedPlanId: newPublishedPlan.id,
      status: 'PUBLISHED',
      temporalStatus,
      timezone: effectiveTimezone,
      cycle: {
        id: cycle.id,
        name: sourceDocument.name,
        startDate: toDateKey(cycle.startDate),
        endDate: toDateKey(cycle.endDate),
        durationWeeks: cycle.durationWeeks,
      },
      builderPayload: buildCycleBuilderPayload(cycle, newPublishedPlan),
      updatedAt: newPublishedPlan.updatedAt,
    };
  });
}

async function rescheduleUpcomingCycle(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);
    const effectiveTimezone = resolveEffectiveTimezone(cycle.timezone, payload.timezone, DEFAULT_TIMEZONE);
    const temporalStatus = deriveTemporalStatus(cycle, effectiveTimezone);
    const todayDateKey = getTodayDateKey(effectiveTimezone);

    if (temporalStatus !== 'upcoming') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Only upcoming cycles can be rescheduled');
    }

    const { startDateKey: normalizedStartDateKey, endDateKey: nextEndDateKey, durationWeeks: nextDurationWeeks } =
      normalizeCanonicalMultiWeekDateRange(
        payload.newStartDate,
        payload.durationWeeks,
        payload.newEndDate || payload.endDate,
        'newStartDate',
        'newEndDate'
      );

    ensureNotPastDate(normalizedStartDateKey, todayDateKey, 'startDate');
    ensureNotPastDate(nextEndDateKey, todayDateKey, 'endDate');

    if (nextDurationWeeks > cycle.durationWeeks) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Extending a cycle beyond its current structure is not supported yet'
      );
    }

    const existingCycles = await tx.trainingCycle.findMany({
      where: { userId },
      select: { id: true, startDate: true, endDate: true },
    });
    validateNoOverlap(existingCycles, normalizedStartDateKey, nextEndDateKey, cycle.id);

    let draftPlan = await normalizeSingleDraft(tx, cycle.id);
    const publishedPlan = pickLatestPublished(cycle.plans);

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
          weeks: {
            create: buildPlanCreateWeeksInput(sourceDocument.weeks),
          },
        },
        include: fullPlanInclude,
      });
    }

    if (draftPlan) {
      const trimmedDocument = trimDocumentWeeks(
        validateCycleDocument(clonePlanDocument(draftPlan), 'draft'),
        nextDurationWeeks
      );

      await tx.workout.deleteMany({
        where: {
          planWeek: {
            planId: draftPlan.id,
          },
        },
      });

      await tx.planWeek.deleteMany({
        where: {
          planId: draftPlan.id,
        },
      });

      draftPlan = await tx.plan.update({
        where: { id: draftPlan.id },
        data: {
          weeks: {
            create: buildPlanCreateWeeksInput(trimmedDocument.weeks),
          },
        },
        include: fullPlanInclude,
      });
    }

    const updatedCycle = await tx.trainingCycle.update({
      where: { id: cycle.id },
      data: {
        startDate: parseDateInput(normalizedStartDateKey),
        endDate: parseDateInput(nextEndDateKey),
        durationWeeks: nextDurationWeeks,
      },
      include: {
        plans: {
          orderBy: { versionNumber: 'desc' },
          include: fullPlanInclude,
        },
      },
    });

    const nextDraftPlan = pickLatestDraft(updatedCycle.plans);
    const visiblePlan = nextDraftPlan || pickLatestPublished(updatedCycle.plans);

    return {
      cycleId: updatedCycle.id,
      cycle: {
        id: updatedCycle.id,
        startDate: toDateKey(updatedCycle.startDate),
        endDate: toDateKey(updatedCycle.endDate),
        durationWeeks: updatedCycle.durationWeeks,
        timezone: effectiveTimezone,
      },
      visiblePlanId: visiblePlan?.id || null,
      status: visiblePlan?.status || 'DRAFT',
      builderPayload: visiblePlan ? buildCycleBuilderPayload(updatedCycle, visiblePlan) : null,
      temporalStatus: deriveTemporalStatus(updatedCycle, effectiveTimezone),
      timezone: effectiveTimezone,
    };
  });
}

async function deleteCycle(cycleId, payload = {}) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  await assertUserExists(userId);

  return prisma.$transaction(async (tx) => {
    const cycle = await loadCycleForUser(tx, cycleId, userId);

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
      const occurrenceDateKey = getOccurrenceDateKey(startDateKey, week.weekNumber, workout.orderIndex);
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
  getCycleDetails,
  getCycleFull,
  getHomeDashboard,
  getProgramOverviewV2,
  getProgramsOverview,
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  rescheduleUpcomingCycle,
  updateCycleDraft,
};
