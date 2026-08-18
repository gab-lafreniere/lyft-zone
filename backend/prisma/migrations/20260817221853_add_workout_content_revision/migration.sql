-- AlterTable
-- Additive optimistic-concurrency counters for future workout-scoped saves.
-- Phase 1 leaves both columns unused by application behavior.
ALTER TABLE "workouts"
ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "weekly_plan_workouts"
ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 1;
