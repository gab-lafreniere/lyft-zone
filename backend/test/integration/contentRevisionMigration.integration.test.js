const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { startLocalPostgres } = require('./support/localPostgres');
const { applyMigrations } = require('./support/applyMigrations');

const MIGRATION_NAME = '20260817221853_add_workout_content_revision';
const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  'prisma',
  'migrations',
  MIGRATION_NAME,
  'migration.sql'
);

let pgHandle = null;
let skipReason = null;

before(async () => {
  pgHandle = await startLocalPostgres();
  if (!pgHandle) {
    skipReason =
      'Local Postgres tooling was not found on PATH; skipping contentRevision migration proof.';
  }
});

after(() => {
  if (pgHandle) {
    pgHandle.stop();
  }
});

async function seedPreMigrationRows(client) {
  await client.query(`
    INSERT INTO "users" ("id", "email", "createdAt", "updatedAt")
    VALUES ('migration_user', 'migration-proof@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO "training_cycles" (
      "id", "userId", "name", "startDate", "endDate", "durationWeeks",
      "status", "mode", "createdAt", "updatedAt"
    ) VALUES (
      'migration_cycle', 'migration_user', 'Migration Cycle', DATE '2026-09-07',
      DATE '2026-09-13', 1, 'PLANNED', 'FIXED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "plans" (
      "id", "trainingCycleId", "name", "versionNumber", "sourceType", "status",
      "createdAt", "updatedAt"
    ) VALUES (
      'migration_plan', 'migration_cycle', 'Migration Plan', 1, 'USER', 'DRAFT',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "plan_weeks" (
      "id", "planId", "weekNumber", "orderIndex", "createdAt", "updatedAt"
    ) VALUES (
      'migration_week', 'migration_plan', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "workouts" (
      "id", "planWeekId", "name", "orderIndex", "createdAt", "updatedAt"
    ) VALUES (
      'existing_cycle_workout', 'migration_week', 'Existing Cycle Workout', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "weekly_plan_parents" (
      "id", "userId", "sourceType", "createdAt", "updatedAt"
    ) VALUES (
      'migration_weekly_parent', 'migration_user', 'MANUAL',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "weekly_plan_versions" (
      "id", "weeklyPlanParentId", "versionNumber", "name", "sessionsPerWeek",
      "status", "createdAt", "updatedAt"
    ) VALUES (
      'migration_weekly_version', 'migration_weekly_parent', 1, 'Migration Weekly Plan',
      2, 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "weekly_plan_workouts" (
      "id", "weeklyPlanVersionId", "name", "orderIndex", "createdAt", "updatedAt"
    ) VALUES (
      'existing_weekly_workout', 'migration_weekly_version', 'Existing Weekly Workout', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);
}

test('migration backfills existing workouts and defaults new workouts to contentRevision 1', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  await applyMigrations(pgHandle.url, { before: MIGRATION_NAME });
  const client = new Client({ connectionString: pgHandle.url });
  await client.connect();

  try {
    await seedPreMigrationRows(client);
    await client.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));

    const existingRows = await client.query(`
      SELECT 'cycle' AS kind, "contentRevision"
      FROM "workouts"
      WHERE "id" = 'existing_cycle_workout'
      UNION ALL
      SELECT 'weekly' AS kind, "contentRevision"
      FROM "weekly_plan_workouts"
      WHERE "id" = 'existing_weekly_workout'
      ORDER BY kind;
    `);
    assert.deepEqual(existingRows.rows, [
      { kind: 'cycle', contentRevision: 1 },
      { kind: 'weekly', contentRevision: 1 },
    ]);

    await client.query(`
      INSERT INTO "workouts" (
        "id", "planWeekId", "name", "orderIndex", "createdAt", "updatedAt"
      ) VALUES (
        'new_cycle_workout', 'migration_week', 'New Cycle Workout', 2,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "weekly_plan_workouts" (
        "id", "weeklyPlanVersionId", "name", "orderIndex", "createdAt", "updatedAt"
      ) VALUES (
        'new_weekly_workout', 'migration_weekly_version', 'New Weekly Workout', 2,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);

    const newRows = await client.query(`
      SELECT 'cycle' AS kind, "contentRevision"
      FROM "workouts"
      WHERE "id" = 'new_cycle_workout'
      UNION ALL
      SELECT 'weekly' AS kind, "contentRevision"
      FROM "weekly_plan_workouts"
      WHERE "id" = 'new_weekly_workout'
      ORDER BY kind;
    `);
    assert.deepEqual(newRows.rows, [
      { kind: 'cycle', contentRevision: 1 },
      { kind: 'weekly', contentRevision: 1 },
    ]);
  } finally {
    await client.end();
  }
});
