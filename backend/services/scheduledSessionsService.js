const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');
const {
  DEFAULT_TIMEZONE,
  addDays,
  getLocalDateTimeParts,
  getTodayDateKey,
  parseDateInput,
  resolveEffectiveTimezone,
  toDateKey,
} = require('./cycleDateUtils');

const SESSION_STATUSES = new Set([
  'PLANNED',
  'COMPLETED',
  'SKIPPED',
  'RESCHEDULED',
  'CANCELED',
]);
const DAY_OFFSETS = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};
const LOCAL_NOON_HOUR = 12;
const LOCAL_NOON_MINUTE = 0;

function isValidDate(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function assertSessionStatus(value) {
  if (value == null) {
    return;
  }

  if (!SESSION_STATUSES.has(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'status is invalid');
  }
}

function resolveWorkoutDayOffset(workout) {
  if (workout?.scheduledDay && DAY_OFFSETS[workout.scheduledDay] != null) {
    return {
      dayOffset: DAY_OFFSETS[workout.scheduledDay],
      usedFallback: false,
    };
  }

  const fallbackOffset = Number(workout?.orderIndex || 0) - 1;
  if (Number.isInteger(fallbackOffset) && fallbackOffset >= 0 && fallbackOffset <= 6) {
    return {
      dayOffset: fallbackOffset,
      usedFallback: true,
    };
  }

  throw new ApiError(
    400,
    'VALIDATION_ERROR',
    `Workout ${workout?.id || ''} is missing scheduledDay and cannot be placed safely in V1`
  );
}

function buildLocalNoonSessionStart(dateKey, timeZone) {
  const parsed = parseDateInput(dateKey);
  if (!parsed) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid session date');
  }

  const baseUtcNoon = new Date(`${dateKey}T12:00:00.000Z`);
  for (let minuteOffset = -24 * 60; minuteOffset <= 24 * 60; minuteOffset += 15) {
    const candidate = new Date(baseUtcNoon.getTime() + minuteOffset * 60000);
    const localParts = getLocalDateTimeParts(candidate, timeZone);

    if (
      localParts.dateKey === dateKey &&
      Number(localParts.hour) === LOCAL_NOON_HOUR &&
      Number(localParts.minute) === LOCAL_NOON_MINUTE
    ) {
      return candidate;
    }
  }

  throw new ApiError(
    400,
    'VALIDATION_ERROR',
    `Unable to resolve a stable local session time for ${dateKey} in ${timeZone}`
  );
}

async function createScheduledSessions(payload) {
  const prisma = getPrisma();
  const sessions = payload.sessions;

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'sessions must be a non-empty array');
  }

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];

    if (!session.workoutId) {
      throw new ApiError(400, 'VALIDATION_ERROR', `workoutId is required for sessions[${index}]`);
    }

    if (!session.scheduledStartAt || !isValidDate(session.scheduledStartAt)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `scheduledStartAt must be a valid ISO date for sessions[${index}]`
      );
    }

    if (session.scheduledEndAt != null && !isValidDate(session.scheduledEndAt)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `scheduledEndAt must be a valid ISO date for sessions[${index}]`
      );
    }

    if (
      session.scheduledEndAt != null &&
      new Date(session.scheduledEndAt) <= new Date(session.scheduledStartAt)
    ) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `scheduledEndAt must be after scheduledStartAt for sessions[${index}]`
      );
    }

    assertSessionStatus(session.status ?? 'PLANNED');
  }

  const workoutIds = Array.from(new Set(sessions.map((session) => session.workoutId)));
  const workouts = await prisma.workout.findMany({
    where: { id: { in: workoutIds } },
    select: { id: true },
  });

  const existingWorkoutIds = new Set(workouts.map((workout) => workout.id));
  for (const workoutId of workoutIds) {
    if (!existingWorkoutIds.has(workoutId)) {
      throw new ApiError(404, 'NOT_FOUND', `Workout not found: ${workoutId}`);
    }
  }

  return prisma.$transaction(
    sessions.map((session) =>
      prisma.scheduledSession.create({
        data: {
          workoutId: session.workoutId,
          status: session.status ?? 'PLANNED',
          scheduledStartAt: new Date(session.scheduledStartAt),
          scheduledEndAt: session.scheduledEndAt ? new Date(session.scheduledEndAt) : undefined,
          notes: session.notes ?? undefined,
        },
      })
    )
  );
}

async function listScheduledSessions(query) {
  const prisma = getPrisma();
  const { cycleId, startDate, endDate } = query;

  if (startDate != null && !isValidDate(startDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'startDate must be a valid ISO date');
  }

  if (endDate != null && !isValidDate(endDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must be a valid ISO date');
  }

  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must be on or after startDate');
  }

  if (cycleId) {
    const cycle = await prisma.trainingCycle.findUnique({
      where: { id: cycleId },
      select: { id: true },
    });

    if (!cycle) {
      throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
    }
  }

  const where = {};

  if (startDate || endDate) {
    where.scheduledStartAt = {};
    if (startDate) {
      where.scheduledStartAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.scheduledStartAt.lte = new Date(endDate);
    }
  }

  if (cycleId) {
    where.workout = {
      planWeek: {
        plan: {
          trainingCycleId: cycleId,
        },
      },
    };
  }

  const sessions = await prisma.scheduledSession.findMany({
    where,
    orderBy: { scheduledStartAt: 'asc' },
    include: {
      workout: {
        select: {
          id: true,
          name: true,
          scheduledDay: true,
          planWeek: {
            select: {
              id: true,
              weekNumber: true,
              plan: {
                select: {
                  id: true,
                  versionNumber: true,
                  trainingCycleId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return sessions.map((session) => ({
    ...session,
    workout: {
      id: session.workout.id,
      name: session.workout.name,
      scheduledDay: session.workout.scheduledDay,
      planWeek: {
        id: session.workout.planWeek.id,
        weekNumber: session.workout.planWeek.weekNumber,
      },
      plan: session.workout.planWeek.plan,
    },
  }));
}

async function regenerateScheduledSessionsForPublishedCycle(cycleId, options = {}) {
  const prisma = getPrisma();
  const userId = options.userId ? String(options.userId).trim() : null;
  const cycle = await prisma.trainingCycle.findFirst({
    where: {
      id: cycleId,
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      timezone: true,
      plans: {
        where: { status: 'PUBLISHED' },
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          weeks: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              weekNumber: true,
              orderIndex: true,
              workouts: {
                orderBy: { orderIndex: 'asc' },
                select: {
                  id: true,
                  name: true,
                  orderIndex: true,
                  scheduledDay: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cycle) {
    throw new ApiError(404, 'NOT_FOUND', 'Training cycle not found');
  }

  const publishedPlan = cycle.plans[0] || null;
  if (!publishedPlan) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No published plan is available for this cycle');
  }

  const effectiveTimezone = resolveEffectiveTimezone(
    cycle.timezone,
    options.timezone,
    DEFAULT_TIMEZONE
  );
  const regenerateFromDateKey =
    toDateKey(options.regenerateFromDateKey) || null;
  const effectiveRegenerateFromDateKey =
    regenerateFromDateKey || getTodayDateKey(effectiveTimezone);
  const cycleStartDateKey = toDateKey(cycle.startDate);
  const cycleEndDateKey = toDateKey(cycle.endDate);
  const sessionsToCreate = [];
  let fallbackOrderIndexCount = 0;

  for (const week of publishedPlan.weeks) {
    for (const workout of week.workouts) {
      const { dayOffset, usedFallback } = resolveWorkoutDayOffset(workout);
      const occurrenceDateKey = addDays(cycleStartDateKey, (week.weekNumber - 1) * 7 + dayOffset);

      if (usedFallback) {
        fallbackOrderIndexCount += 1;
      }

      if (occurrenceDateKey < effectiveRegenerateFromDateKey) {
        continue;
      }

      sessionsToCreate.push({
        workoutId: workout.id,
        status: 'PLANNED',
        scheduledStartAt: buildLocalNoonSessionStart(occurrenceDateKey, effectiveTimezone),
        scheduledEndAt: null,
      });
    }
  }

  const existingSessions = await prisma.scheduledSession.findMany({
    where: {
      workout: {
        planWeek: {
          plan: {
            trainingCycleId: cycle.id,
          },
        },
      },
    },
    select: { id: true, scheduledStartAt: true },
  });
  const sessionsToDelete = existingSessions.filter(
    (session) =>
      getLocalDateTimeParts(session.scheduledStartAt, effectiveTimezone).dateKey >=
      effectiveRegenerateFromDateKey
  );

  await prisma.$transaction(async (tx) => {
    if (sessionsToDelete.length > 0) {
      await tx.scheduledSession.deleteMany({
        where: {
          id: {
            in: sessionsToDelete.map((session) => session.id),
          },
        },
      });
    }

    if (sessionsToCreate.length > 0) {
      await tx.scheduledSession.createMany({
        data: sessionsToCreate,
      });
    }
  });

  return {
    cycleId: cycle.id,
    publishedPlanId: publishedPlan.id,
    publishedPlanVersion: publishedPlan.versionNumber,
    timezone: effectiveTimezone,
    startDate: cycleStartDateKey,
    endDate: cycleEndDateKey,
    regenerateFromDate: effectiveRegenerateFromDateKey,
    deletedCount: sessionsToDelete.length,
    createdCount: sessionsToCreate.length,
    fallbackOrderIndexCount,
  };
}

module.exports = {
  createScheduledSessions,
  listScheduledSessions,
  regenerateScheduledSessionsForPublishedCycle,
};
