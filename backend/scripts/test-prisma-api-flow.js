const assert = require('node:assert/strict');

const baseUrl = process.env.API_BASE_URL || 'http://localhost:5001';

function logStep(message) {
  console.log(`\n[prisma-api-test] ${message}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON response from ${path}: ${text}`);
    }
  }

  return { response, body };
}

function expectStatus(response, body, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} but received ${response.status}: ${JSON.stringify(body, null, 2)}`
    );
  }
}

function assertIsoString(value, fieldName) {
  assert.equal(typeof value, 'string', `${fieldName} should be a string`);
  assert.ok(!Number.isNaN(new Date(value).getTime()), `${fieldName} should be an ISO date string`);
}

function buildPayloads(suffix) {
  const userEmail = `prisma-api-test-${suffix}@example.com`;

  return {
    user: {
      email: userEmail,
    },
    profile: {
      primaryGoal: 'HYPERTROPHY',
      trainingMode: 'FIXED',
      experienceNotes: 'Intermediate lifter returning to structured programming.',
      availableSessionsPerWeek: 4,
      sessionDurationMinutes: 75,
      trainingPreferences: {
        splitPreference: 'upper-lower',
        repStyle: 'moderate',
      },
      equipmentContext: {
        gymType: 'commercial',
        hasMachines: true,
      },
      constraints: {
        avoidExercises: ['exr_barbell_upright_row'],
      },
      musclePriorities: {
        primary: ['upper chest', 'lats', 'rear delts'],
      },
      onboardingSnapshot: {
        wizardVersion: 1,
        source: 'test-prisma-api-flow',
      },
    },
    cycle: {
      name: `Spring Hypertrophy Cycle ${suffix}`,
      startDate: '2026-04-01',
      endDate: '2026-05-24',
      durationWeeks: 8,
      mode: 'FIXED',
      status: 'PLANNED',
      goalSnapshot: {
        primaryGoal: 'HYPERTROPHY',
      },
      profileSnapshot: {
        availableSessionsPerWeek: 4,
        sessionDurationMinutes: 75,
      },
      notes: 'Initial onboarding cycle',
    },
    plan: {
      name: 'Reference Plan V1',
      sourceType: 'SYSTEM',
      status: 'ACTIVE',
      isReference: true,
      generationContext: {
        createdFrom: 'onboarding',
      },
      publishedAt: '2026-03-20T12:00:00.000Z',
      weeks: [
        {
          weekNumber: 1,
          orderIndex: 1,
          label: 'Week 1',
          workouts: [
            {
              name: 'Upper A',
              orderIndex: 1,
              scheduledDay: 'MONDAY',
              estimatedDurationMinutes: 75,
              blocks: [
                {
                  orderIndex: 1,
                  blockType: 'SINGLE',
                  label: 'Primary Press',
                  restStrategy: 'AFTER_EXERCISE',
                  restSeconds: 120,
                  exercises: [
                    {
                      exerciseId: 'exr_incline_dumbbell_press',
                      orderIndex: 1,
                      defaultTempo: '3-1-1',
                      defaultRestSeconds: 120,
                      defaultTargetRir: 2,
                      intensificationMethod: 'NONE',
                      setTemplates: [
                        {
                          setIndex: 1,
                          setType: 'WORKING',
                          targetReps: 8,
                          minReps: 8,
                          maxReps: 10,
                          targetRir: 2,
                          tempo: '3-1-1',
                          restSeconds: 120,
                        },
                        {
                          setIndex: 2,
                          setType: 'WORKING',
                          targetReps: 8,
                          minReps: 8,
                          maxReps: 10,
                          targetRir: 2,
                          tempo: '3-1-1',
                          restSeconds: 120,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              name: 'Lower A',
              orderIndex: 2,
              scheduledDay: 'WEDNESDAY',
              estimatedDurationMinutes: 80,
              blocks: [
                {
                  orderIndex: 1,
                  blockType: 'SINGLE',
                  label: 'Primary Squat',
                  restStrategy: 'AFTER_EXERCISE',
                  restSeconds: 150,
                  exercises: [
                    {
                      exerciseId: 'exr_goblet_squat',
                      orderIndex: 1,
                      defaultTargetRir: 2,
                      intensificationMethod: 'NONE',
                      setTemplates: [
                        {
                          setIndex: 1,
                          setType: 'WORKING',
                          targetReps: 10,
                          minReps: 10,
                          maxReps: 12,
                          targetRir: 2,
                          restSeconds: 150,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function main() {
  const suffix = `${Date.now()}`;
  const payloads = buildPayloads(suffix);

  logStep(`Running end-to-end flow against ${baseUrl}`);

  logStep('Create user');
  const createUserResult = await request('/api/users', {
    method: 'POST',
    body: JSON.stringify(payloads.user),
  });
  expectStatus(createUserResult.response, createUserResult.body, 201);
  assert.ok(createUserResult.body?.user?.id, 'user.id should be present');
  assert.equal(createUserResult.body.user.email, payloads.user.email);
  assertIsoString(createUserResult.body.user.createdAt, 'user.createdAt');
  const userId = createUserResult.body.user.id;

  logStep('Upsert user profile');
  const createProfileResult = await request(`/api/users/${userId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(payloads.profile),
  });
  expectStatus(createProfileResult.response, createProfileResult.body, 200);
  assert.equal(createProfileResult.body?.profile?.userId, userId);
  assert.equal(createProfileResult.body.profile.primaryGoal, 'HYPERTROPHY');

  logStep('Create cycle');
  const createCycleResult = await request('/api/cycles', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      ...payloads.cycle,
    }),
  });
  expectStatus(createCycleResult.response, createCycleResult.body, 201);
  assert.ok(createCycleResult.body?.cycle?.id, 'cycle.id should be present');
  assert.equal(createCycleResult.body.cycle.userId, userId);
  assert.equal(createCycleResult.body.cycle.mode, 'FIXED');
  const cycleId = createCycleResult.body.cycle.id;

  logStep('Fetch full cycle before plan exists');
  const emptyCycleResult = await request(`/api/cycles/${cycleId}/full`);
  expectStatus(emptyCycleResult.response, emptyCycleResult.body, 200);
  assert.equal(emptyCycleResult.body?.cycle?.id, cycleId);
  assert.equal(emptyCycleResult.body.currentPlan, null);

  logStep('Create nested plan');
  const createPlanResult = await request(`/api/cycles/${cycleId}/plans`, {
    method: 'POST',
    body: JSON.stringify(payloads.plan),
  });
  expectStatus(createPlanResult.response, createPlanResult.body, 201);
  assert.ok(createPlanResult.body?.plan?.id, 'plan.id should be present');
  assert.equal(createPlanResult.body.plan.trainingCycleId, cycleId);
  assert.equal(createPlanResult.body.plan.versionNumber, 1);
  assert.ok(Array.isArray(createPlanResult.body.plan.weeks), 'plan.weeks should be an array');
  assert.ok(createPlanResult.body.plan.weeks.length > 0, 'plan.weeks should not be empty');

  const firstWeek = createPlanResult.body.plan.weeks[0];
  const firstWorkout = firstWeek.workouts[0];
  const secondWorkout = firstWeek.workouts[1];
  const firstExercise = firstWorkout.blocks[0].exercises[0];

  assert.equal(firstExercise.exerciseId, 'exr_incline_dumbbell_press');
  const workoutId1 = firstWorkout.id;
  const workoutId2 = secondWorkout.id;
  const planId = createPlanResult.body.plan.id;

  logStep('Fetch full cycle after plan exists');
  const populatedCycleResult = await request(`/api/cycles/${cycleId}/full`);
  expectStatus(populatedCycleResult.response, populatedCycleResult.body, 200);
  assert.equal(populatedCycleResult.body?.cycle?.id, cycleId);
  assert.ok(populatedCycleResult.body.currentPlan, 'currentPlan should be present');
  assert.equal(populatedCycleResult.body.currentPlan.id, planId);
  assert.ok(populatedCycleResult.body.currentPlan.weeks[0].workouts[0].blocks[0].exercises[0].setTemplates);

  logStep('Create scheduled sessions');
  const createSessionsResult = await request('/api/scheduled-sessions', {
    method: 'POST',
    body: JSON.stringify({
      sessions: [
        {
          workoutId: workoutId1,
          scheduledStartAt: '2026-04-07T14:00:00.000Z',
          scheduledEndAt: '2026-04-07T15:15:00.000Z',
          status: 'PLANNED',
          notes: 'Week 1 Upper A',
        },
        {
          workoutId: workoutId2,
          scheduledStartAt: '2026-04-09T14:00:00.000Z',
          scheduledEndAt: '2026-04-09T15:20:00.000Z',
          status: 'PLANNED',
          notes: 'Week 1 Lower A',
        },
      ],
    }),
  });
  expectStatus(createSessionsResult.response, createSessionsResult.body, 201);
  assert.equal(createSessionsResult.body?.sessions?.length, 2);
  assert.equal(createSessionsResult.body.sessions[0].status, 'PLANNED');

  logStep('Fetch scheduled sessions by cycle');
  const cycleSessionsResult = await request(`/api/scheduled-sessions?cycleId=${cycleId}`);
  expectStatus(cycleSessionsResult.response, cycleSessionsResult.body, 200);
  assert.ok(cycleSessionsResult.body.sessions.length >= 2);
  for (const session of cycleSessionsResult.body.sessions) {
    assert.equal(session.workout.plan.trainingCycleId, cycleId);
  }

  logStep('Fetch scheduled sessions by cycle and date range');
  const rangedSessionsResult = await request(
    `/api/scheduled-sessions?cycleId=${cycleId}&startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-30T23:59:59.999Z`
  );
  expectStatus(rangedSessionsResult.response, rangedSessionsResult.body, 200);
  assert.ok(rangedSessionsResult.body.sessions.length >= 2);
  for (const session of rangedSessionsResult.body.sessions) {
    assert.ok(session.workout, 'session.workout should be present');
    assert.equal(session.workout.plan.trainingCycleId, cycleId);
  }

  console.log('\n[prisma-api-test] Flow completed successfully');
  console.log(
    JSON.stringify(
      {
        userId,
        cycleId,
        planId,
        workoutIds: [workoutId1, workoutId2],
        scheduledSessionIds: createSessionsResult.body.sessions.map((session) => session.id),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`\n[prisma-api-test] Failed: ${error.message}`);
  process.exit(1);
});
