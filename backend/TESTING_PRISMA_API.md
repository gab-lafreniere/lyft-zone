# Testing The Prisma API Layer

Base URL:

```text
http://localhost:5001
```

This testing pass covers the happy-path flow:

```text
user -> profile -> cycle -> plan -> full cycle -> scheduled sessions
```

Important implementation notes:
- `GET /api/cycles/:cycleId/full` returns top-level `cycle` and `currentPlan`
- `GET /api/scheduled-sessions` returns `workout.planWeek` and `workout.plan` as siblings under `workout`
- Decimal fields like `targetRir` may come back as strings depending on Prisma serialization

## Runnable End-To-End Check

Run the backend, then execute:

```bash
npm run test:prisma-api-flow
```

Optional base URL override:

```bash
API_BASE_URL=http://localhost:5001 npm run test:prisma-api-flow
```

The script will:
- create a unique test user
- upsert a profile
- create a cycle
- verify `currentPlan: null` before plan creation
- create a nested plan
- fetch the full cycle tree
- create scheduled sessions
- fetch scheduled sessions by cycle and by date range

## Example Requests And Success Shapes

### `POST /api/users`

Request:

```json
{
  "email": "gabriella@example.com"
}
```

Success shape:

```json
{
  "user": {
    "id": "clx_user_123",
    "email": "gabriella@example.com",
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:00:00.000Z"
  }
}
```

### `PUT /api/users/:userId/profile`

Request:

```json
{
  "primaryGoal": "HYPERTROPHY",
  "trainingMode": "FIXED",
  "experienceNotes": "Intermediate lifter returning to structured programming.",
  "availableSessionsPerWeek": 4,
  "sessionDurationMinutes": 75,
  "trainingPreferences": {
    "splitPreference": "upper-lower",
    "repStyle": "moderate"
  },
  "equipmentContext": {
    "gymType": "commercial",
    "hasMachines": true
  },
  "constraints": {
    "avoidExercises": ["exr_barbell_upright_row"]
  },
  "musclePriorities": {
    "primary": ["upper chest", "lats", "rear delts"]
  },
  "onboardingSnapshot": {
    "wizardVersion": 1,
    "source": "frontend-wizard"
  }
}
```

Success shape:

```json
{
  "profile": {
    "id": "clx_profile_123",
    "userId": "clx_user_123",
    "primaryGoal": "HYPERTROPHY",
    "trainingMode": "FIXED",
    "experienceNotes": "Intermediate lifter returning to structured programming.",
    "availableSessionsPerWeek": 4,
    "sessionDurationMinutes": 75,
    "trainingPreferences": {
      "splitPreference": "upper-lower",
      "repStyle": "moderate"
    },
    "equipmentContext": {
      "gymType": "commercial",
      "hasMachines": true
    },
    "constraints": {
      "avoidExercises": ["exr_barbell_upright_row"]
    },
    "musclePriorities": {
      "primary": ["upper chest", "lats", "rear delts"]
    },
    "onboardingSnapshot": {
      "wizardVersion": 1,
      "source": "frontend-wizard"
    },
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:10:00.000Z"
  }
}
```

### `POST /api/cycles`

Request:

```json
{
  "userId": "clx_user_123",
  "name": "Spring Hypertrophy Cycle",
  "startDate": "2026-04-01",
  "endDate": "2026-05-24",
  "durationWeeks": 8,
  "mode": "FIXED",
  "status": "PLANNED",
  "goalSnapshot": {
    "primaryGoal": "HYPERTROPHY"
  },
  "profileSnapshot": {
    "availableSessionsPerWeek": 4,
    "sessionDurationMinutes": 75
  },
  "notes": "Initial onboarding cycle"
}
```

Success shape:

```json
{
  "cycle": {
    "id": "clx_cycle_123",
    "userId": "clx_user_123",
    "name": "Spring Hypertrophy Cycle",
    "startDate": "2026-04-01T00:00:00.000Z",
    "endDate": "2026-05-24T00:00:00.000Z",
    "durationWeeks": 8,
    "status": "PLANNED",
    "mode": "FIXED",
    "goalSnapshot": {
      "primaryGoal": "HYPERTROPHY"
    },
    "profileSnapshot": {
      "availableSessionsPerWeek": 4,
      "sessionDurationMinutes": 75
    },
    "notes": "Initial onboarding cycle",
    "archivedAt": null,
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:00:00.000Z"
  }
}
```

### `POST /api/cycles/:cycleId/plans`

Request:

```json
{
  "name": "Reference Plan V1",
  "sourceType": "SYSTEM",
  "status": "ACTIVE",
  "isReference": true,
  "generationContext": {
    "createdFrom": "onboarding"
  },
  "publishedAt": "2026-03-20T12:00:00.000Z",
  "weeks": [
    {
      "weekNumber": 1,
      "orderIndex": 1,
      "label": "Week 1",
      "workouts": [
        {
          "name": "Upper A",
          "orderIndex": 1,
          "scheduledDay": "MONDAY",
          "estimatedDurationMinutes": 75,
          "blocks": [
            {
              "orderIndex": 1,
              "blockType": "SINGLE",
              "label": "Primary Press",
              "restStrategy": "AFTER_EXERCISE",
              "restSeconds": 120,
              "exercises": [
                {
                  "exerciseId": "exr_incline_dumbbell_press",
                  "orderIndex": 1,
                  "defaultTempo": "3-1-1",
                  "defaultRestSeconds": 120,
                  "defaultTargetRir": 2,
                  "intensificationMethod": "NONE",
                  "setTemplates": [
                    {
                      "setIndex": 1,
                      "setType": "WORKING",
                      "targetReps": 8,
                      "minReps": 8,
                      "maxReps": 10,
                      "targetRir": 2,
                      "tempo": "3-1-1",
                      "restSeconds": 120
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Success shape:

```json
{
  "plan": {
    "id": "clx_plan_123",
    "trainingCycleId": "clx_cycle_123",
    "name": "Reference Plan V1",
    "versionNumber": 1,
    "sourceType": "SYSTEM",
    "status": "ACTIVE",
    "isReference": true,
    "weeks": [
      {
        "id": "clx_week_1",
        "weekNumber": 1,
        "orderIndex": 1,
        "workouts": [
          {
            "id": "clx_workout_1",
            "name": "Upper A",
            "orderIndex": 1,
            "blocks": [
              {
                "id": "clx_block_1",
                "orderIndex": 1,
                "blockType": "SINGLE",
                "exercises": [
                  {
                    "id": "clx_block_ex_1",
                    "exerciseId": "exr_incline_dumbbell_press",
                    "orderIndex": 1,
                    "exercise": {
                      "exerciseId": "exr_incline_dumbbell_press",
                      "name": "Incline Dumbbell Press"
                    },
                    "setTemplates": [
                      {
                        "id": "clx_set_1",
                        "setIndex": 1,
                        "setType": "WORKING"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### `GET /api/cycles/:cycleId/full`

Request:

```text
GET /api/cycles/clx_cycle_123/full
```

Success shape:

```json
{
  "cycle": {
    "id": "clx_cycle_123",
    "userId": "clx_user_123",
    "name": "Spring Hypertrophy Cycle"
  },
  "currentPlan": {
    "id": "clx_plan_123",
    "trainingCycleId": "clx_cycle_123",
    "name": "Reference Plan V1",
    "versionNumber": 1,
    "weeks": []
  }
}
```

If no plan exists yet:

```json
{
  "cycle": {
    "id": "clx_cycle_123",
    "userId": "clx_user_123",
    "name": "Spring Hypertrophy Cycle"
  },
  "currentPlan": null
}
```

### `POST /api/scheduled-sessions`

Request:

```json
{
  "sessions": [
    {
      "workoutId": "clx_workout_1",
      "scheduledStartAt": "2026-04-07T14:00:00.000Z",
      "scheduledEndAt": "2026-04-07T15:15:00.000Z",
      "status": "PLANNED",
      "notes": "Week 1 Upper A"
    },
    {
      "workoutId": "clx_workout_2",
      "scheduledStartAt": "2026-04-09T14:00:00.000Z",
      "scheduledEndAt": "2026-04-09T15:20:00.000Z",
      "status": "PLANNED",
      "notes": "Week 1 Lower A"
    }
  ]
}
```

Success shape:

```json
{
  "sessions": [
    {
      "id": "clx_session_1",
      "workoutId": "clx_workout_1",
      "status": "PLANNED",
      "scheduledStartAt": "2026-04-07T14:00:00.000Z",
      "scheduledEndAt": "2026-04-07T15:15:00.000Z",
      "notes": "Week 1 Upper A"
    }
  ]
}
```

### `GET /api/scheduled-sessions`

Request examples:

```text
GET /api/scheduled-sessions?cycleId=clx_cycle_123
GET /api/scheduled-sessions?startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-30T23:59:59.999Z
GET /api/scheduled-sessions?cycleId=clx_cycle_123&startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-30T23:59:59.999Z
```

Success shape:

```json
{
  "sessions": [
    {
      "id": "clx_session_1",
      "workoutId": "clx_workout_1",
      "status": "PLANNED",
      "scheduledStartAt": "2026-04-07T14:00:00.000Z",
      "scheduledEndAt": "2026-04-07T15:15:00.000Z",
      "notes": "Week 1 Upper A",
      "workout": {
        "id": "clx_workout_1",
        "name": "Upper A",
        "scheduledDay": "MONDAY",
        "planWeek": {
          "id": "clx_week_1",
          "weekNumber": 1
        },
        "plan": {
          "id": "clx_plan_123",
          "versionNumber": 1,
          "trainingCycleId": "clx_cycle_123"
        }
      }
    }
  ]
}
```

## Minimal End-To-End Sequence

1. `POST /api/users`
2. `PUT /api/users/:userId/profile`
3. `POST /api/cycles`
4. `GET /api/cycles/:cycleId/full` and confirm `currentPlan: null`
5. `POST /api/cycles/:cycleId/plans`
6. `GET /api/cycles/:cycleId/full` and confirm nested data
7. `POST /api/scheduled-sessions`
8. `GET /api/scheduled-sessions?cycleId=:cycleId`
9. `GET /api/scheduled-sessions?cycleId=:cycleId&startDate=...&endDate=...`

## Manual Edge Cases

### Users
- duplicate email should return `409`
- missing `email` should return `400`
- uppercase email should be normalized to lowercase

### Profiles
- upsert twice and confirm the same `profile.id` is reused
- fake `userId` should return `404`
- omitting optional fields should still succeed

### Cycles
- `endDate < startDate` should return `400`
- invalid `mode` should return `400`
- fake `userId` should return `404`

### Plans
- fake `cycleId` should return `404`
- fake `exerciseId` should return `400`
- duplicate `week.orderIndex` should return `400`
- duplicate `workout.orderIndex` in the same week should return `400`
- duplicate `block.orderIndex` in the same workout should return `400`
- duplicate `exercise.orderIndex` in the same block should return `400`
- duplicate `setIndex` in the same exercise should return `400`
- empty `weeks` should return `400`
- empty `setTemplates` should return `400`
- invalid enums like `scheduledDay`, `blockType`, and `setType` should return `400`

### Full cycle fetch
- cycle with no plan should return `currentPlan: null`
- active plan should be returned when it exists
- with multiple plans, the active plan should be preferred over reference fallback

### Scheduled sessions
- fake `workoutId` should return `404`
- missing `scheduledStartAt` should return `400`
- `scheduledEndAt <= scheduledStartAt` should return `400`
- invalid `status` should return `400`
- invalid `startDate` or `endDate` query should return `400`
- `endDate < startDate` query should return `400`
- unknown `cycleId` query should return `404`
