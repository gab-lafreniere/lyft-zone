const { randomUUID } = require('node:crypto');
const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');

const WEEKLY_PLAN_SOURCE_TYPES = new Set(['MANUAL', 'AI']);
const WEEKLY_PLAN_VERSION_STATUSES = new Set([
  'DRAFT',
  'PUBLISHED',
  'SUPERSEDED',
  'ARCHIVED',
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
const SUPPORTED_BODY_PARTS = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'quadriceps', label: 'Quads' },
  { key: 'hamstrings', label: 'Hamstrings' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'calves', label: 'Calves' },
  { key: 'abs', label: 'Abs' },
];

function createStableId(prefix) {
  return `${prefix}_${randomUUID()}`;
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

function normalizeString(value, fallback = '') {
  return String(value ?? fallback);
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

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value) {
  return normalizeArray(value)
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function parseJsonArrayField(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeSourceType(value) {
  const normalized = String(value || 'MANUAL').trim().toUpperCase();
  assertEnumValue(normalized, WEEKLY_PLAN_SOURCE_TYPES, 'source');
  return normalized;
}

function sourceTypeToClientValue(value) {
  return String(value || 'MANUAL').toLowerCase();
}

function roundDisplayMinutes(totalSeconds) {
  if (totalSeconds <= 0) {
    return 0;
  }

  return Math.round(totalSeconds / 60);
}

function parseTempoToSecondsPerRep(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);

  if (!digits) {
    return 0;
  }

  const normalized = digits.length === 3 ? `${digits}0` : digits.padEnd(4, '0');

  return normalized
    .split('')
    .reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);
}

function getSetReps(setTemplate) {
  const reps = Number(
    setTemplate?.targetReps ??
      setTemplate?.maxReps ??
      setTemplate?.minReps ??
      0
  );

  return Number.isFinite(reps) && reps > 0 ? reps : 0;
}

function getSetRir(setTemplate) {
  const rir = Number(setTemplate?.targetRir);
  return Number.isFinite(rir) ? rir : 2;
}

function formatTempoLabel(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);

  if (!digits) {
    return null;
  }

  const normalized = digits.length === 3 ? `${digits}0` : digits.padEnd(4, '0');
  return normalized.split('').join('-');
}

function formatRestLabel(value) {
  const restSeconds = normalizeInt(value, null);
  return restSeconds == null ? null : `${restSeconds}s`;
}

function formatRepsLabel(setTemplates = []) {
  const repsValues = setTemplates.map(getSetReps).filter((value) => value > 0);

  if (!repsValues.length) {
    return 'Custom reps';
  }

  const min = Math.min(...repsValues);
  const max = Math.max(...repsValues);
  return min === max ? `${min}` : `${min}-${max}`;
}

function normalizeBodyPartsForMetrics(value) {
  const supportedKeys = new Set(SUPPORTED_BODY_PARTS.map((part) => part.key));

  return normalizeStringArray(value).filter((entry) => supportedKeys.has(entry));
}

function createDistributionAccumulator() {
  return Object.fromEntries(
    SUPPORTED_BODY_PARTS.map(({ key }) => [key, { rawSets: 0, normalizedShare: 0 }])
  );
}

function addDistributionContribution(accumulator, bodyParts, setCount) {
  const normalized = normalizeBodyPartsForMetrics(bodyParts);

  if (!normalized.length || setCount <= 0) {
    return;
  }

  const sharePerBodyPart = 1 / normalized.length;
  normalized.forEach((bodyPart) => {
    accumulator[bodyPart].rawSets += setCount;
    accumulator[bodyPart].normalizedShare += setCount * sharePerBodyPart;
  });
}

function finalizeDistribution(accumulator, totalRealSets) {
  if (totalRealSets <= 0) {
    return SUPPORTED_BODY_PARTS.map(({ key, label }) => ({
      key,
      label,
      rawSets: 0,
      normalizedShare: 0,
      percentageOfWorkout: 0,
    }));
  }

  return SUPPORTED_BODY_PARTS.map(({ key, label }) => ({
    key,
    label,
    rawSets: accumulator[key].rawSets,
    normalizedShare: accumulator[key].normalizedShare,
    percentageOfWorkout: Math.min(
      100,
      (accumulator[key].normalizedShare / totalRealSets) * 100
    ),
  }));
}

function computeWeeklyPlanWorkoutMetrics(workout) {
  if (!workout || !Array.isArray(workout.blocks) || workout.blocks.length === 0) {
    return {
      exerciseCount: 0,
      setCount: 0,
      estimatedDurationMinutes: 0,
      totalTUTMinutes: 0,
      totalTUTSeconds: 0,
      muscleDistribution: finalizeDistribution(createDistributionAccumulator(), 0),
    };
  }

  let exerciseCount = 0;
  let setCount = 0;
  let totalTUTSeconds = 0;
  let totalDurationSeconds = 0;
  const distribution = createDistributionAccumulator();

  workout.blocks.forEach((block) => {
    const exercises = normalizeArray(block.exercises);

    if (block.blockType === 'SINGLE') {
      const primaryExercise = exercises[0];
      if (!primaryExercise?.exerciseId || !String(primaryExercise.exerciseName || '').trim()) {
        return;
      }

      const setTemplates = normalizeArray(primaryExercise.setTemplates);
      const blockSetCount = setTemplates.length;

      if (blockSetCount <= 0) {
        return;
      }

      const tempoValue =
        primaryExercise.defaultTempo ??
        setTemplates[0]?.tempo ??
        null;
      const tempoSecondsPerRep = parseTempoToSecondsPerRep(tempoValue);
      const blockTUTSeconds = setTemplates.reduce(
        (sum, setTemplate) => sum + getSetReps(setTemplate) * tempoSecondsPerRep,
        0
      );

      exerciseCount += 1;
      setCount += blockSetCount;
      totalTUTSeconds += blockTUTSeconds;
      totalDurationSeconds +=
        blockTUTSeconds +
        (normalizeInt(
          block.restSeconds ??
            primaryExercise.defaultRestSeconds ??
            setTemplates[0]?.restSeconds,
          0
        ) *
          Math.max(0, blockSetCount - 1) *
          1.15) +
        90;

      addDistributionContribution(distribution, primaryExercise.bodyParts, blockSetCount);
      return;
    }

    if (block.blockType !== 'SUPERSET') {
      return;
    }

    const populatedExercises = exercises.filter(
      (exercise) => exercise.exerciseId && String(exercise.exerciseName || '').trim()
    );
    const populatedLaneCount = populatedExercises.length;

    if (populatedLaneCount <= 0) {
      return;
    }

    const supersetSetCount = Math.max(
      0,
      block.roundCount || populatedExercises[0]?.setTemplates?.length || 0
    );

    if (supersetSetCount <= 0) {
      return;
    }

    const blockTUTSeconds = populatedExercises.reduce((sum, exercise) => {
      const laneSets = normalizeArray(exercise.setTemplates).slice(0, supersetSetCount);
      const laneTempoSecondsPerRep = parseTempoToSecondsPerRep(
        exercise.defaultTempo ?? laneSets[0]?.tempo
      );

      return (
        sum +
        laneSets.reduce(
          (laneSum, setTemplate) => laneSum + getSetReps(setTemplate) * laneTempoSecondsPerRep,
          0
        )
      );
    }, 0);

    exerciseCount += populatedLaneCount;
    setCount += supersetSetCount * populatedLaneCount;
    totalTUTSeconds += blockTUTSeconds;
    totalDurationSeconds +=
      blockTUTSeconds +
      (normalizeInt(block.restSeconds, 0) * Math.max(0, supersetSetCount - 1) * 1.15) +
      90;

    populatedExercises.forEach((exercise) => {
      addDistributionContribution(distribution, exercise.bodyParts, supersetSetCount);
    });
  });

  return {
    exerciseCount,
    setCount,
    estimatedDurationMinutes: roundDisplayMinutes(totalDurationSeconds),
    totalTUTMinutes: roundDisplayMinutes(totalTUTSeconds),
    totalTUTSeconds,
    muscleDistribution: finalizeDistribution(distribution, setCount),
  };
}

function aggregateWeeklyPlanMetrics(workouts = []) {
  const workoutMetrics = workouts.map((workout) => computeWeeklyPlanWorkoutMetrics(workout));
  const nonEmptyWorkouts = workoutMetrics.filter((metrics) => metrics.setCount > 0);
  const distribution = createDistributionAccumulator();

  const totalExerciseCount = workoutMetrics.reduce((sum, metrics) => sum + metrics.exerciseCount, 0);
  const totalSetCount = workoutMetrics.reduce((sum, metrics) => sum + metrics.setCount, 0);
  const totalDurationMinutes = workoutMetrics.reduce(
    (sum, metrics) => sum + metrics.estimatedDurationMinutes,
    0
  );

  workoutMetrics.forEach((metrics) => {
    metrics.muscleDistribution.forEach((entry) => {
      distribution[entry.key].rawSets += entry.rawSets;
      distribution[entry.key].normalizedShare += entry.normalizedShare;
    });
  });

  return {
    totalExerciseCount,
    totalSetCount,
    averageDurationMinutes:
      nonEmptyWorkouts.length > 0
        ? Math.round(totalDurationMinutes / nonEmptyWorkouts.length)
        : 0,
    averageTUTMinutes:
      nonEmptyWorkouts.length > 0
        ? Math.round(
            nonEmptyWorkouts.reduce((sum, metrics) => sum + metrics.totalTUTMinutes, 0) /
              nonEmptyWorkouts.length
          )
        : 0,
    muscleDistribution: finalizeDistribution(distribution, totalSetCount),
  };
}

function normalizeSetTemplatesInput(setTemplates = []) {
  return normalizeArray(setTemplates).map((setTemplate, index) => ({
    id: normalizeOptionalString(setTemplate.id) || createStableId('wpset'),
    setIndex: normalizeInt(setTemplate.setIndex, index + 1),
    setType: String(setTemplate.setType || 'WORKING').toUpperCase(),
    targetReps: normalizeInt(setTemplate.targetReps, null),
    minReps: normalizeInt(setTemplate.minReps, null),
    maxReps: normalizeInt(setTemplate.maxReps, null),
    targetSeconds: normalizeInt(setTemplate.targetSeconds, null),
    targetRir: normalizeNumeric(setTemplate.targetRir),
    targetRpe: normalizeNumeric(setTemplate.targetRpe),
    tempo: normalizeOptionalString(setTemplate.tempo),
    restSeconds: normalizeInt(setTemplate.restSeconds, null),
    notes: normalizeOptionalString(setTemplate.notes),
  }));
}

function normalizeExercisesInput(exercises = []) {
  return normalizeArray(exercises).map((exercise, index) => ({
    id: normalizeOptionalString(exercise.id) || createStableId('wpex'),
    exerciseId: normalizeOptionalString(exercise.exerciseId),
    exerciseName: normalizeString(exercise.exerciseName || exercise.name || ''),
    bodyParts: normalizeStringArray(exercise.bodyParts),
    muscleFocus: normalizeStringArray(exercise.muscleFocus),
    orderIndex: normalizeInt(exercise.orderIndex, index + 1),
    executionNotes: normalizeOptionalString(exercise.executionNotes),
    defaultTempo: normalizeOptionalString(exercise.defaultTempo),
    defaultRestSeconds: normalizeInt(exercise.defaultRestSeconds, null),
    defaultTargetRir: normalizeNumeric(exercise.defaultTargetRir),
    defaultTargetRpe: normalizeNumeric(exercise.defaultTargetRpe),
    intensificationMethod: exercise.intensificationMethod
      ? String(exercise.intensificationMethod).toUpperCase()
      : null,
    notes: normalizeOptionalString(exercise.notes),
    setTemplates: normalizeSetTemplatesInput(exercise.setTemplates),
  }));
}

function normalizeBlocksInput(blocks = []) {
  return normalizeArray(blocks).map((block, index) => ({
    id: normalizeOptionalString(block.id) || createStableId('wpblock'),
    orderIndex: normalizeInt(block.orderIndex, index + 1),
    blockType: String(block.blockType || 'SINGLE').toUpperCase(),
    label: normalizeOptionalString(block.label),
    roundCount: normalizeInt(block.roundCount, null),
    restStrategy: block.restStrategy ? String(block.restStrategy).toUpperCase() : null,
    restSeconds: normalizeInt(block.restSeconds, null),
    notes: normalizeOptionalString(block.notes),
    exercises: normalizeExercisesInput(block.exercises),
  }));
}

function normalizeWorkoutsInput(workouts = []) {
  return normalizeArray(workouts).map((workout, index) => ({
    id: normalizeOptionalString(workout.id) || createStableId('wpworkout'),
    name: normalizeString(workout.name || ''),
    orderIndex: normalizeInt(workout.orderIndex, index + 1),
    estimatedDurationMinutes: normalizeInt(workout.estimatedDurationMinutes, null),
    notes: normalizeOptionalString(workout.notes),
    blocks: normalizeBlocksInput(workout.blocks),
  }));
}

function validateDraftDocument(payload, mode = 'draft') {
  if (!String(payload.name || '').trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
  }

  const sessionsPerWeek = normalizeInt(payload.sessionsPerWeek, null);
  if (sessionsPerWeek == null || sessionsPerWeek < 1 || sessionsPerWeek > 7) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'sessionsPerWeek must be between 1 and 7');
  }

  const workouts = normalizeWorkoutsInput(payload.workouts);
  assertUniqueIndexes(workouts, 'orderIndex', 'workout orderIndex', 'workouts');

  const workoutNames = new Map();
  workouts.forEach((workout, workoutIndex) => {
    if (mode === 'publish' && !String(workout.name || '').trim()) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `name is required for workouts[${workoutIndex}]`
      );
    }

    const normalizedWorkoutName = String(workout.name || '').trim().toLowerCase();
    if (mode === 'publish' && normalizedWorkoutName) {
      if (workoutNames.has(normalizedWorkoutName)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Workout names must be unique');
      }
      workoutNames.set(normalizedWorkoutName, true);
    }

    if (mode === 'publish' && (!Array.isArray(workout.blocks) || workout.blocks.length === 0)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `blocks must be a non-empty array for workouts[${workoutIndex}]`
      );
    }

    assertUniqueIndexes(workout.blocks, 'orderIndex', 'block orderIndex', `workouts[${workoutIndex}].blocks`);

    workout.blocks.forEach((block, blockIndex) => {
      assertEnumValue(block.blockType, BLOCK_TYPES, 'blockType');
      assertEnumValue(block.restStrategy, BLOCK_REST_STRATEGIES, 'restStrategy');

      if (mode === 'publish' && block.blockType === 'SINGLE' && block.exercises.length !== 1) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `single blocks must contain exactly one exercise in workouts[${workoutIndex}].blocks[${blockIndex}]`
        );
      }

      assertUniqueIndexes(
        block.exercises,
        'orderIndex',
        'exercise orderIndex',
        `workouts[${workoutIndex}].blocks[${blockIndex}].exercises`
      );

      block.exercises.forEach((exercise, exerciseIndex) => {
        assertEnumValue(
          exercise.intensificationMethod,
          INTENSIFICATION_METHODS,
          'intensificationMethod'
        );
        assertUniqueIndexes(
          exercise.setTemplates,
          'setIndex',
          'setIndex',
          `workouts[${workoutIndex}].blocks[${blockIndex}].exercises[${exerciseIndex}].setTemplates`
        );

        exercise.setTemplates.forEach((setTemplate) => {
          assertEnumValue(setTemplate.setType, SET_TYPES, 'setType');
        });

        if (
          mode === 'publish' &&
          (!String(exercise.exerciseId || '').trim() || !String(exercise.exerciseName || '').trim())
        ) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `exerciseId and exerciseName are required for published blocks`
          );
        }
      });

      if (mode === 'publish' && block.blockType === 'SUPERSET') {
        if (!block.exercises.length) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Superset blocks must contain exercises');
        }

        if (
          block.exercises.some(
            (exercise) =>
              !String(exercise.exerciseId || '').trim() ||
              !String(exercise.exerciseName || '').trim()
          )
        ) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Superset blocks cannot contain empty lanes');
        }
      }
    });
  });

  if (mode === 'publish' && workouts.length !== sessionsPerWeek) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'sessionsPerWeek must match the number of workouts before publishing'
    );
  }

  return {
    name: String(payload.name).trim(),
    sessionsPerWeek,
    workouts,
  };
}

async function assertUserExists(userId) {
  const prisma = getPrisma();

  if (!userId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'userId is required');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  return user;
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

function collectExerciseIds(workouts = []) {
  return workouts.flatMap((workout) =>
    workout.blocks.flatMap((block) =>
      block.exercises
        .map((exercise) => exercise.exerciseId)
        .filter(Boolean)
    )
  );
}

function toWorkoutCreateInput(workouts) {
  return workouts.map((workout) => ({
    id: workout.id,
    name: workout.name,
    orderIndex: workout.orderIndex,
    estimatedDurationMinutes: workout.estimatedDurationMinutes ?? undefined,
    notes: workout.notes ?? undefined,
    blocks: {
      create: workout.blocks.map((block) => ({
        id: block.id,
        orderIndex: block.orderIndex,
        blockType: block.blockType,
        label: block.label ?? undefined,
        roundCount: block.roundCount ?? undefined,
        restStrategy: block.restStrategy ?? undefined,
        restSeconds: block.restSeconds ?? undefined,
        notes: block.notes ?? undefined,
        exercises: {
          create: block.exercises.map((exercise) => ({
            id: exercise.id,
            exerciseId: exercise.exerciseId ?? undefined,
            exerciseName: exercise.exerciseName,
            bodyParts: exercise.bodyParts,
            muscleFocus: exercise.muscleFocus,
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
                id: setTemplate.id,
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
      })),
    },
  }));
}

const weeklyPlanVersionInclude = {
  workouts: {
    orderBy: { orderIndex: 'asc' },
    include: {
      blocks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          exercises: {
            orderBy: { orderIndex: 'asc' },
            include: {
              exercise: {
                select: {
                  exerciseId: true,
                  name: true,
                  bodyParts: true,
                  muscleFocus: true,
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
};

const weeklyPlanParentInclude = (userId) => {
  const include = {
    latestDraftVersion: {
      include: weeklyPlanVersionInclude,
    },
    latestPublishedVersion: {
      include: weeklyPlanVersionInclude,
    },
  };

  if (userId) {
    include.bookmarks = {
      where: { userId },
    };
  }

  return include;
};

function pickVisibleVersion(parent) {
  return parent.latestPublishedVersion || parent.latestDraftVersion || null;
}

function mapVersionToBuilderPayload(parent, version) {
  return {
    weeklyPlanParentId: parent.id,
    weeklyPlanVersionId: version.id,
    status: version.status,
    source: sourceTypeToClientValue(parent.sourceType),
    updatedAt: version.updatedAt,
    builderPayload: {
      programName: version.name,
      sessionsPerWeek: version.sessionsPerWeek,
      programLength: 8,
      startDate: null,
      endDate: null,
      isMultiWeek: false,
      selectedWeek: 1,
      workouts: version.workouts.map((workout) => ({
        id: workout.id,
        name: workout.name,
        blocks: workout.blocks.map((block) => {
          if (block.blockType === 'SINGLE') {
            const exercise = block.exercises[0];
            const setTemplates = normalizeArray(exercise?.setTemplates);

            return {
              id: block.id,
              type: 'single',
              exercise: exercise?.exerciseName || '',
              exerciseId: exercise?.exerciseId || null,
              bodyParts: normalizeStringArray(
                exercise?.bodyParts ?? exercise?.exercise?.bodyParts ?? []
              ),
              muscleFocus: normalizeStringArray(
                exercise?.muscleFocus ?? exercise?.exercise?.muscleFocus ?? []
              ),
              tempo: (exercise?.defaultTempo || setTemplates[0]?.tempo || '3010').replace(/\D/g, '').slice(0, 4),
              rest: formatRestLabel(
                block.restSeconds ?? exercise?.defaultRestSeconds ?? setTemplates[0]?.restSeconds ?? 120
              ) || '120s',
              sets: setTemplates.map((setTemplate) => ({
                reps: getSetReps(setTemplate),
                rpe: getSetRir(setTemplate),
              })),
              notes: block.notes || exercise?.notes || '',
            };
          }

          const exercises = block.exercises.map((exercise, index) => ({
            label: `A${index + 1}`,
            name: exercise.exerciseName || '',
            exerciseId: exercise.exerciseId || null,
            bodyParts: normalizeStringArray(
              exercise.bodyParts ?? exercise.exercise?.bodyParts ?? []
            ),
            muscleFocus: normalizeStringArray(
              exercise.muscleFocus ?? exercise.exercise?.muscleFocus ?? []
            ),
            tempo: (
              exercise.defaultTempo ||
              exercise.setTemplates[0]?.tempo ||
              '3010'
            ).replace(/\D/g, '').slice(0, 4),
            sets: exercise.setTemplates.map((setTemplate) => ({
              reps: getSetReps(setTemplate),
              rpe: getSetRir(setTemplate),
            })),
            notes: exercise.notes || '',
          }));

          return {
            id: block.id,
            type: 'superset',
            sets: block.roundCount || Math.max(1, exercises[0]?.sets?.length || 1),
            rest: formatRestLabel(block.restSeconds) || '120s',
            exercises,
          };
        }),
      })),
    },
  };
}

function mapVisibleParentToListItem(parent, userId) {
  const visibleVersion = pickVisibleVersion(parent);

  if (!visibleVersion) {
    return null;
  }

  const summary = aggregateWeeklyPlanMetrics(visibleVersion.workouts);

  return {
    id: parent.id,
    weeklyPlanParentId: parent.id,
    visibleVersionId: visibleVersion.id,
    name: visibleVersion.name,
    status: visibleVersion.status,
    source: sourceTypeToClientValue(parent.sourceType),
    frequencyPerWeek: visibleVersion.sessionsPerWeek,
    totalWeeklySets: summary.totalSetCount,
    createdAt: visibleVersion.createdAt,
    isBookmarked: Boolean(parent.bookmarks?.some((bookmark) => bookmark.userId === userId)),
  };
}

function mapVisibleParentToDetails(parent, userId) {
  const visibleVersion = pickVisibleVersion(parent);

  if (!visibleVersion) {
    return null;
  }

  const summary = aggregateWeeklyPlanMetrics(visibleVersion.workouts);
  const workoutDetails = visibleVersion.workouts.map((workout) => {
    const metrics = computeWeeklyPlanWorkoutMetrics(workout);

    return {
      id: workout.id,
      name: workout.name,
      orderIndex: workout.orderIndex,
      metrics: {
        exerciseCount: metrics.exerciseCount,
        setCount: metrics.setCount,
        estimatedDurationMinutes: metrics.estimatedDurationMinutes,
        totalTUTMinutes: metrics.totalTUTMinutes,
      },
      blocks: workout.blocks.map((block) => {
        if (block.blockType === 'SINGLE') {
          const exercise = block.exercises[0];
          const setTemplates = normalizeArray(exercise?.setTemplates);
          return {
            id: block.id,
            type: 'single',
            orderIndex: block.orderIndex,
            exercise: {
              exerciseId: exercise?.exerciseId || exercise?.exercise?.exerciseId || '',
              name:
                exercise?.exerciseName ||
                exercise?.exercise?.name ||
                'Unknown exercise',
              imageUrl: null,
            },
            prescription: {
              setCount: setTemplates.length,
              repsLabel: formatRepsLabel(setTemplates),
              tempoLabel: formatTempoLabel(exercise?.defaultTempo || setTemplates[0]?.tempo),
              restLabel: formatRestLabel(
                block.restSeconds ??
                  exercise?.defaultRestSeconds ??
                  setTemplates[0]?.restSeconds
              ),
            },
            notes: block.notes || exercise?.notes || null,
          };
        }

        return {
          id: block.id,
          type: 'superset',
          orderIndex: block.orderIndex,
          label: block.label || `Superset ${String.fromCharCode(64 + block.orderIndex)}`,
          restLabel: formatRestLabel(block.restSeconds),
          exercises: block.exercises.map((exercise, index) => ({
            laneLabel: `A${index + 1}`,
            exerciseId: exercise.exerciseId || exercise.exercise?.exerciseId || '',
            name:
              exercise.exerciseName ||
              exercise.exercise?.name ||
              'Unknown exercise',
            imageUrl: null,
            prescription: {
              setCount: normalizeArray(exercise.setTemplates).length,
              repsLabel: formatRepsLabel(exercise.setTemplates),
              tempoLabel: formatTempoLabel(
                exercise.defaultTempo || exercise.setTemplates[0]?.tempo
              ),
            },
          })),
        };
      }),
    };
  });

  return {
    id: parent.id,
    weeklyPlanParentId: parent.id,
    visibleVersionId: visibleVersion.id,
    name: visibleVersion.name,
    status: visibleVersion.status,
    source: sourceTypeToClientValue(parent.sourceType),
    isBookmarked: Boolean(parent.bookmarks?.some((bookmark) => bookmark.userId === userId)),
    createdAt: visibleVersion.createdAt,
    updatedAt: visibleVersion.updatedAt,
    summary: {
      frequencyPerWeek: visibleVersion.sessionsPerWeek,
      workoutCount: visibleVersion.workouts.length,
      totalWeeklySets: summary.totalSetCount,
      totalExercises: summary.totalExerciseCount,
      averageWorkoutDurationMinutes: summary.averageDurationMinutes,
      averageWorkoutTUTMinutes: summary.averageTUTMinutes,
      weeklyTotals: Object.fromEntries(
        summary.muscleDistribution.map((entry) => [entry.key, entry.rawSets])
      ),
    },
    workouts: workoutDetails,
  };
}

async function createWeeklyPlan(payload) {
  const prisma = getPrisma();
  const userId = normalizeOptionalString(payload.userId);
  const sourceType = normalizeSourceType(payload.source);
  const document = validateDraftDocument(
    {
      name: payload.name,
      sessionsPerWeek: payload.sessionsPerWeek,
      workouts: payload.workouts || [],
    },
    'draft'
  );

  await assertUserExists(userId);
  await assertKnownExerciseIds(collectExerciseIds(document.workouts));

  const parent = await prisma.$transaction(async (tx) => {
    const createdParent = await tx.weeklyPlanParent.create({
      data: {
        userId,
        sourceType,
      },
    });

    const createdVersion = await tx.weeklyPlanVersion.create({
      data: {
        weeklyPlanParentId: createdParent.id,
        versionNumber: 1,
        name: document.name,
        sessionsPerWeek: document.sessionsPerWeek,
        status: 'DRAFT',
        workouts: {
          create: toWorkoutCreateInput(document.workouts),
        },
      },
      include: weeklyPlanVersionInclude,
    });

    await tx.weeklyPlanParent.update({
      where: { id: createdParent.id },
      data: {
        latestDraftVersionId: createdVersion.id,
      },
    });

    return tx.weeklyPlanParent.findUnique({
      where: { id: createdParent.id },
      include: weeklyPlanParentInclude(userId),
    });
  });

  return mapVersionToBuilderPayload(parent, parent.latestDraftVersion);
}

async function listVisibleWeeklyPlans(userId) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(userId);
  await assertUserExists(normalizedUserId);

  const parents = await prisma.weeklyPlanParent.findMany({
    where: {
      userId: normalizedUserId,
      OR: [
        { latestDraftVersionId: { not: null } },
        { latestPublishedVersionId: { not: null } },
      ],
    },
    include: weeklyPlanParentInclude(normalizedUserId),
  });

  return parents
    .map((parent) => mapVisibleParentToListItem(parent, normalizedUserId))
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

async function getWeeklyPlanDetails(weeklyPlanParentId, userId) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(userId);
  await assertUserExists(normalizedUserId);

  const parent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: normalizedUserId,
    },
    include: weeklyPlanParentInclude(normalizedUserId),
  });

  if (!parent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  const details = mapVisibleParentToDetails(parent, normalizedUserId);
  if (!details) {
    throw new ApiError(404, 'NOT_FOUND', 'Visible weekly plan version not found');
  }

  return details;
}

function cloneWorkoutTree(workouts = []) {
  return workouts.map((workout) => ({
    id: createStableId('wpworkout'),
    name: workout.name,
    orderIndex: workout.orderIndex,
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
    notes: workout.notes,
    blocks: workout.blocks.map((block) => ({
      id: createStableId('wpblock'),
      orderIndex: block.orderIndex,
      blockType: block.blockType,
      label: block.label,
      roundCount: block.roundCount,
      restStrategy: block.restStrategy,
      restSeconds: block.restSeconds,
      notes: block.notes,
      exercises: block.exercises.map((exercise) => ({
        id: createStableId('wpex'),
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        bodyParts: parseJsonArrayField(exercise.bodyParts),
        muscleFocus: parseJsonArrayField(exercise.muscleFocus),
        orderIndex: exercise.orderIndex,
        executionNotes: exercise.executionNotes,
        defaultTempo: exercise.defaultTempo,
        defaultRestSeconds: exercise.defaultRestSeconds,
        defaultTargetRir: exercise.defaultTargetRir,
        defaultTargetRpe: exercise.defaultTargetRpe,
        intensificationMethod: exercise.intensificationMethod,
        notes: exercise.notes,
        setTemplates: exercise.setTemplates.map((setTemplate) => ({
          id: createStableId('wpset'),
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
}

async function openOrCreateEditDraft(weeklyPlanParentId, userId) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(userId);
  await assertUserExists(normalizedUserId);

  const parent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: normalizedUserId,
    },
    include: weeklyPlanParentInclude(normalizedUserId),
  });

  if (!parent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  if (parent.latestDraftVersion) {
    return mapVersionToBuilderPayload(parent, parent.latestDraftVersion);
  }

  if (!parent.latestPublishedVersion) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No editable version found for this weekly plan');
  }

  const clonedParent = await prisma.$transaction(async (tx) => {
    const nextVersionNumber = parent.latestPublishedVersion.versionNumber + 1;
    const clonedVersion = await tx.weeklyPlanVersion.create({
      data: {
        weeklyPlanParentId: parent.id,
        originVersionId: parent.latestPublishedVersion.id,
        versionNumber: nextVersionNumber,
        name: parent.latestPublishedVersion.name,
        sessionsPerWeek: parent.latestPublishedVersion.sessionsPerWeek,
        status: 'DRAFT',
        workouts: {
          create: toWorkoutCreateInput(cloneWorkoutTree(parent.latestPublishedVersion.workouts)),
        },
      },
      include: weeklyPlanVersionInclude,
    });

    await tx.weeklyPlanParent.update({
      where: { id: parent.id },
      data: {
        latestDraftVersionId: clonedVersion.id,
      },
    });

    return tx.weeklyPlanParent.findUnique({
      where: { id: parent.id },
      include: weeklyPlanParentInclude(normalizedUserId),
    });
  });

  return mapVersionToBuilderPayload(clonedParent, clonedParent.latestDraftVersion);
}

async function updateWeeklyPlanDraft(weeklyPlanParentId, versionId, payload) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(payload.userId);
  await assertUserExists(normalizedUserId);

  const parent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: normalizedUserId,
    },
    select: {
      id: true,
      sourceType: true,
      latestDraftVersionId: true,
    },
  });

  if (!parent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  if (parent.latestDraftVersionId !== versionId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'This draft is not the current editable version');
  }

  const document = validateDraftDocument(payload, 'draft');
  await assertKnownExerciseIds(collectExerciseIds(document.workouts));

  const updatedParent = await prisma.$transaction(async (tx) => {
    const draft = await tx.weeklyPlanVersion.findFirst({
      where: {
        id: versionId,
        weeklyPlanParentId,
        status: 'DRAFT',
      },
      select: {
        id: true,
      },
    });

    if (!draft) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft version not found');
    }

    await tx.weeklyPlanWorkout.deleteMany({
      where: {
        weeklyPlanVersionId: versionId,
      },
    });

    await tx.weeklyPlanVersion.update({
      where: { id: versionId },
      data: {
        name: document.name,
        sessionsPerWeek: document.sessionsPerWeek,
        workouts: {
          create: toWorkoutCreateInput(document.workouts),
        },
      },
    });

    return tx.weeklyPlanParent.findUnique({
      where: { id: weeklyPlanParentId },
      include: weeklyPlanParentInclude(normalizedUserId),
    });
  });

  return mapVersionToBuilderPayload(updatedParent, updatedParent.latestDraftVersion);
}

async function publishWeeklyPlanDraft(weeklyPlanParentId, payload) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(payload.userId);
  await assertUserExists(normalizedUserId);

  const parent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: normalizedUserId,
    },
    include: weeklyPlanParentInclude(normalizedUserId),
  });

  if (!parent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  if (!parent.latestDraftVersion) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No draft available to publish');
  }

  validateDraftDocument(
    {
      name: parent.latestDraftVersion.name,
      sessionsPerWeek: parent.latestDraftVersion.sessionsPerWeek,
      workouts: parent.latestDraftVersion.workouts.map((workout) => ({
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
            bodyParts: parseJsonArrayField(exercise.bodyParts),
            muscleFocus: parseJsonArrayField(exercise.muscleFocus),
            orderIndex: exercise.orderIndex,
            executionNotes: exercise.executionNotes,
            defaultTempo: exercise.defaultTempo,
            defaultRestSeconds: exercise.defaultRestSeconds,
            defaultTargetRir: exercise.defaultTargetRir,
            defaultTargetRpe: exercise.defaultTargetRpe,
            intensificationMethod: exercise.intensificationMethod,
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
      })),
    },
    'publish'
  );

  const response = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const currentPublishedVersionId = parent.latestPublishedVersion?.id || null;
    const currentDraftVersionId = parent.latestDraftVersion.id;

    if (currentPublishedVersionId) {
      await tx.weeklyPlanVersion.update({
        where: { id: currentPublishedVersionId },
        data: {
          status: 'SUPERSEDED',
          supersededAt: now,
        },
      });
    }

    await tx.weeklyPlanVersion.update({
      where: { id: currentDraftVersionId },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        supersededAt: null,
        archivedAt: null,
      },
    });

    await tx.weeklyPlanParent.update({
      where: { id: weeklyPlanParentId },
      data: {
        latestPublishedVersionId: currentDraftVersionId,
        latestDraftVersionId: null,
      },
    });

    return {
      weeklyPlanParentId,
      visibleVersionId: currentDraftVersionId,
      supersededVersionId: currentPublishedVersionId,
      status: 'PUBLISHED',
    };
  });

  return response;
}

async function setWeeklyPlanBookmark(weeklyPlanParentId, userId, shouldBookmark) {
  const prisma = getPrisma();
  const normalizedUserId = normalizeOptionalString(userId);
  await assertUserExists(normalizedUserId);

  const parent = await prisma.weeklyPlanParent.findFirst({
    where: {
      id: weeklyPlanParentId,
      userId: normalizedUserId,
    },
    select: { id: true },
  });

  if (!parent) {
    throw new ApiError(404, 'NOT_FOUND', 'Weekly plan not found');
  }

  if (shouldBookmark) {
    await prisma.weeklyPlanBookmark.upsert({
      where: {
        userId_weeklyPlanParentId: {
          userId: normalizedUserId,
          weeklyPlanParentId,
        },
      },
      update: {},
      create: {
        userId: normalizedUserId,
        weeklyPlanParentId,
      },
    });
  } else {
    await prisma.weeklyPlanBookmark.deleteMany({
      where: {
        userId: normalizedUserId,
        weeklyPlanParentId,
      },
    });
  }

  return {
    weeklyPlanParentId,
    isBookmarked: shouldBookmark,
  };
}

module.exports = {
  createWeeklyPlan,
  getWeeklyPlanDetails,
  listVisibleWeeklyPlans,
  openOrCreateEditDraft,
  publishWeeklyPlanDraft,
  setWeeklyPlanBookmark,
  updateWeeklyPlanDraft,
};
