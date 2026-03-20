-- CreateEnum
CREATE TYPE "WeeklyPlanSourceType" AS ENUM ('MANUAL', 'AI');

-- CreateEnum
CREATE TYPE "WeeklyPlanVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "training_cycles" ADD COLUMN "sourceWeeklyPlanParentId" TEXT;

-- CreateTable
CREATE TABLE "weekly_plan_parents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "WeeklyPlanSourceType" NOT NULL,
    "latestDraftVersionId" TEXT,
    "latestPublishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_versions" (
    "id" TEXT NOT NULL,
    "weeklyPlanParentId" TEXT NOT NULL,
    "originVersionId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sessionsPerWeek" INTEGER NOT NULL,
    "status" "WeeklyPlanVersionStatus" NOT NULL,
    "changeSummary" JSONB,
    "generationContext" JSONB,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_workouts" (
    "id" TEXT NOT NULL,
    "weeklyPlanVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "estimatedDurationMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_workout_blocks" (
    "id" TEXT NOT NULL,
    "weeklyPlanWorkoutId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" "BlockType" NOT NULL,
    "label" TEXT,
    "roundCount" INTEGER,
    "restStrategy" "BlockRestStrategy",
    "restSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_workout_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_block_exercises" (
    "id" TEXT NOT NULL,
    "weeklyPlanWorkoutBlockId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "exerciseName" TEXT NOT NULL,
    "bodyParts" JSONB,
    "muscleFocus" JSONB,
    "orderIndex" INTEGER NOT NULL,
    "executionNotes" TEXT,
    "defaultTempo" TEXT,
    "defaultRestSeconds" INTEGER,
    "defaultTargetRir" DECIMAL(4,1),
    "defaultTargetRpe" DECIMAL(4,1),
    "intensificationMethod" "IntensificationMethod",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_block_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_exercise_set_templates" (
    "id" TEXT NOT NULL,
    "weeklyPlanBlockExerciseId" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "setType" "SetType" NOT NULL DEFAULT 'WORKING',
    "targetReps" INTEGER,
    "minReps" INTEGER,
    "maxReps" INTEGER,
    "targetSeconds" INTEGER,
    "targetRir" DECIMAL(4,1),
    "targetRpe" DECIMAL(4,1),
    "tempo" TEXT,
    "restSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_exercise_set_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_bookmarks" (
    "userId" TEXT NOT NULL,
    "weeklyPlanParentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_plan_bookmarks_pkey" PRIMARY KEY ("userId","weeklyPlanParentId")
);

-- CreateIndex
CREATE INDEX "training_cycles_sourceWeeklyPlanParentId_idx" ON "training_cycles"("sourceWeeklyPlanParentId");

-- CreateIndex
CREATE INDEX "weekly_plan_parents_userId_createdAt_idx" ON "weekly_plan_parents"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_parents_latestDraftVersionId_key" ON "weekly_plan_parents"("latestDraftVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_parents_latestPublishedVersionId_key" ON "weekly_plan_parents"("latestPublishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_versions_weeklyPlanParentId_versionNumber_key" ON "weekly_plan_versions"("weeklyPlanParentId", "versionNumber");

-- CreateIndex
CREATE INDEX "weekly_plan_versions_weeklyPlanParentId_status_idx" ON "weekly_plan_versions"("weeklyPlanParentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_workouts_weeklyPlanVersionId_orderIndex_key" ON "weekly_plan_workouts"("weeklyPlanVersionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_workout_blocks_weeklyPlanWorkoutId_orderIndex_key" ON "weekly_plan_workout_blocks"("weeklyPlanWorkoutId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_block_exercises_weeklyPlanWorkoutBlockId_orderIndex_key" ON "weekly_plan_block_exercises"("weeklyPlanWorkoutBlockId", "orderIndex");

-- CreateIndex
CREATE INDEX "weekly_plan_block_exercises_exerciseId_idx" ON "weekly_plan_block_exercises"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_exercise_set_templates_weeklyPlanBlockExerciseId_set_key" ON "weekly_plan_exercise_set_templates"("weeklyPlanBlockExerciseId", "setIndex");

-- CreateIndex
CREATE INDEX "weekly_plan_bookmarks_userId_createdAt_idx" ON "weekly_plan_bookmarks"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_sourceWeeklyPlanParentId_fkey" FOREIGN KEY ("sourceWeeklyPlanParentId") REFERENCES "weekly_plan_parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_parents" ADD CONSTRAINT "weekly_plan_parents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_parents" ADD CONSTRAINT "weekly_plan_parents_latestDraftVersionId_fkey" FOREIGN KEY ("latestDraftVersionId") REFERENCES "weekly_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_parents" ADD CONSTRAINT "weekly_plan_parents_latestPublishedVersionId_fkey" FOREIGN KEY ("latestPublishedVersionId") REFERENCES "weekly_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_versions" ADD CONSTRAINT "weekly_plan_versions_weeklyPlanParentId_fkey" FOREIGN KEY ("weeklyPlanParentId") REFERENCES "weekly_plan_parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_versions" ADD CONSTRAINT "weekly_plan_versions_originVersionId_fkey" FOREIGN KEY ("originVersionId") REFERENCES "weekly_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_workouts" ADD CONSTRAINT "weekly_plan_workouts_weeklyPlanVersionId_fkey" FOREIGN KEY ("weeklyPlanVersionId") REFERENCES "weekly_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_workout_blocks" ADD CONSTRAINT "weekly_plan_workout_blocks_weeklyPlanWorkoutId_fkey" FOREIGN KEY ("weeklyPlanWorkoutId") REFERENCES "weekly_plan_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_block_exercises" ADD CONSTRAINT "weekly_plan_block_exercises_weeklyPlanWorkoutBlockId_fkey" FOREIGN KEY ("weeklyPlanWorkoutBlockId") REFERENCES "weekly_plan_workout_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_block_exercises" ADD CONSTRAINT "weekly_plan_block_exercises_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("exerciseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_exercise_set_templates" ADD CONSTRAINT "weekly_plan_exercise_set_templates_weeklyPlanBlockExerciseId_fkey" FOREIGN KEY ("weeklyPlanBlockExerciseId") REFERENCES "weekly_plan_block_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_bookmarks" ADD CONSTRAINT "weekly_plan_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_bookmarks" ADD CONSTRAINT "weekly_plan_bookmarks_weeklyPlanParentId_fkey" FOREIGN KEY ("weeklyPlanParentId") REFERENCES "weekly_plan_parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
