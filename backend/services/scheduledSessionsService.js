const { getPrisma } = require('../lib/prisma');
const { ApiError } = require('./usersService');

const SESSION_STATUSES = new Set([
  'PLANNED',
  'COMPLETED',
  'SKIPPED',
  'RESCHEDULED',
  'CANCELED',
]);

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

module.exports = {
  createScheduledSessions,
  listScheduledSessions,
};
