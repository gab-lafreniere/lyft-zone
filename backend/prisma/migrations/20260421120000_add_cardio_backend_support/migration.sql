ALTER TYPE "BlockType" ADD VALUE 'CARDIO';

ALTER TABLE "Exercise" ADD COLUMN "cardioModality" TEXT;
ALTER TABLE "Exercise" ADD COLUMN "cardioImpactLevel" TEXT;
ALTER TABLE "Exercise" ADD COLUMN "cardioFatigueScore" INTEGER;
ALTER TABLE "Exercise" ADD COLUMN "lowerBodyFatigueBias" TEXT;

ALTER TABLE "Exercise" ALTER COLUMN "equipmentCategory" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "equipmentNeeded" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "movementPattern" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "bodyParts" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "muscleFocus" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "targetMuscles" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "secondaryMuscles" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "muscleActivation" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "mechanicType" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "unilateralType" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "difficulty" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "isSupersetFriendly" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "fatigueScore" DROP NOT NULL;

ALTER TABLE "weekly_plan_block_exercises" ADD COLUMN "cardioPrescription" JSONB;
ALTER TABLE "block_exercises" ADD COLUMN "cardioPrescription" JSONB;
