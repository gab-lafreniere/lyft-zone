-- CreateEnum
CREATE TYPE "TrainingMode" AS ENUM ('FIXED', 'AI_COACH');

-- CreateEnum
CREATE TYPE "TrainingGoal" AS ENUM ('STRENGTH', 'HYPERTROPHY', 'POWERBUILDING', 'CARDIO_FOCUS', 'MOBILITY_FOCUS');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanSourceType" AS ENUM ('SYSTEM', 'USER', 'AI');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('SINGLE', 'SUPERSET', 'GIANT_SET', 'CIRCUIT');

-- CreateEnum
CREATE TYPE "BlockRestStrategy" AS ENUM ('NONE', 'AFTER_EXERCISE', 'AFTER_ROUND');

-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('WARMUP', 'WORKING', 'TOP_SET', 'BACKOFF', 'DROP_SET', 'AMRAP');

-- CreateEnum
CREATE TYPE "ScheduledSessionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'SKIPPED', 'RESCHEDULED', 'CANCELED');

-- CreateEnum
CREATE TYPE "IntensificationMethod" AS ENUM ('NONE', 'DROP_SET', 'REST_PAUSE', 'MYO_REPS', 'TEMPO_EMPHASIS', 'PAUSE_REPS', 'PARTIALS');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryGoal" "TrainingGoal",
    "trainingMode" "TrainingMode",
    "experienceNotes" TEXT,
    "availableSessionsPerWeek" INTEGER,
    "sessionDurationMinutes" INTEGER,
    "trainingPreferences" JSONB,
    "equipmentContext" JSONB,
    "constraints" JSONB,
    "musclePriorities" JSONB,
    "onboardingSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_cycles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL,
    "mode" "TrainingMode" NOT NULL,
    "goalSnapshot" JSONB,
    "profileSnapshot" JSONB,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "trainingCycleId" TEXT NOT NULL,
    "parentPlanId" TEXT,
    "name" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourceType" "PlanSourceType" NOT NULL,
    "status" "PlanStatus" NOT NULL,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "changeSummary" JSONB,
    "generationContext" JSONB,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_weeks" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" TEXT NOT NULL,
    "planWeekId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "scheduledDay" "DayOfWeek",
    "estimatedDurationMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_blocks" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" "BlockType" NOT NULL,
    "label" TEXT,
    "roundCount" INTEGER,
    "restStrategy" "BlockRestStrategy",
    "restSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_exercises" (
    "id" TEXT NOT NULL,
    "workoutBlockId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
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

    CONSTRAINT "block_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_set_templates" (
    "id" TEXT NOT NULL,
    "blockExerciseId" TEXT NOT NULL,
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

    CONSTRAINT "exercise_set_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_sessions" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "status" "ScheduledSessionStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "scheduledEndAt" TIMESTAMP(3),
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "rescheduledFromSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE INDEX "training_cycles_userId_status_idx" ON "training_cycles"("userId", "status");

-- CreateIndex
CREATE INDEX "training_cycles_userId_startDate_idx" ON "training_cycles"("userId", "startDate");

-- CreateIndex
CREATE INDEX "plans_trainingCycleId_status_idx" ON "plans"("trainingCycleId", "status");

-- CreateIndex
CREATE INDEX "plans_trainingCycleId_isReference_idx" ON "plans"("trainingCycleId", "isReference");

-- CreateIndex
CREATE UNIQUE INDEX "plans_trainingCycleId_versionNumber_key" ON "plans"("trainingCycleId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_planId_weekNumber_key" ON "plan_weeks"("planId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_planId_orderIndex_key" ON "plan_weeks"("planId", "orderIndex");

-- CreateIndex
CREATE INDEX "workouts_planWeekId_scheduledDay_idx" ON "workouts"("planWeekId", "scheduledDay");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_planWeekId_orderIndex_key" ON "workouts"("planWeekId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "workout_blocks_workoutId_orderIndex_key" ON "workout_blocks"("workoutId", "orderIndex");

-- CreateIndex
CREATE INDEX "block_exercises_exerciseId_idx" ON "block_exercises"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "block_exercises_workoutBlockId_orderIndex_key" ON "block_exercises"("workoutBlockId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_set_templates_blockExerciseId_setIndex_key" ON "exercise_set_templates"("blockExerciseId", "setIndex");

-- CreateIndex
CREATE INDEX "scheduled_sessions_workoutId_scheduledStartAt_idx" ON "scheduled_sessions"("workoutId", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "scheduled_sessions_status_scheduledStartAt_idx" ON "scheduled_sessions"("status", "scheduledStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_one_reference_per_cycle_idx"
ON "plans"("trainingCycleId")
WHERE "isReference" = true;

-- CreateIndex
CREATE UNIQUE INDEX "plans_one_active_per_cycle_idx"
ON "plans"("trainingCycleId")
WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_trainingCycleId_fkey" FOREIGN KEY ("trainingCycleId") REFERENCES "training_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_parentPlanId_fkey" FOREIGN KEY ("parentPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_planWeekId_fkey" FOREIGN KEY ("planWeekId") REFERENCES "plan_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_blocks" ADD CONSTRAINT "workout_blocks_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_exercises" ADD CONSTRAINT "block_exercises_workoutBlockId_fkey" FOREIGN KEY ("workoutBlockId") REFERENCES "workout_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_exercises" ADD CONSTRAINT "block_exercises_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("exerciseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_set_templates" ADD CONSTRAINT "exercise_set_templates_blockExerciseId_fkey" FOREIGN KEY ("blockExerciseId") REFERENCES "block_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "workouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_rescheduledFromSessionId_fkey" FOREIGN KEY ("rescheduledFromSessionId") REFERENCES "scheduled_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
