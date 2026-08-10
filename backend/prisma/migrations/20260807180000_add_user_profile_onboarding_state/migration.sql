-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "user_profiles"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "onboardingStatus" "OnboardingStatus",
ADD COLUMN "onboardingLastCompletedStep" INTEGER;

ALTER TABLE "user_profiles"
ADD CONSTRAINT "user_profiles_onboarding_step_range"
CHECK (
  "onboardingLastCompletedStep" IS NULL OR
  "onboardingLastCompletedStep" BETWEEN 0 AND 5
);
