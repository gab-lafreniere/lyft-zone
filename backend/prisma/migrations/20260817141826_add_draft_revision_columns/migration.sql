-- AlterTable
-- Adds optimistic-concurrency revision counters to the two mutable
-- draft-document rows (Plan, WeeklyPlanVersion). Default 1 so every
-- currently-open draft is valid immediately; NOT NULL since every row
-- always has a revision. Purely additive: no existing read path changes
-- shape, and clients that don't yet send `revision` are treated as opting
-- out of the check (see backend/services/cyclesService.js and
-- backend/services/weeklyPlansService.js), not rejected.
ALTER TABLE "plans"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "weekly_plan_versions"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
