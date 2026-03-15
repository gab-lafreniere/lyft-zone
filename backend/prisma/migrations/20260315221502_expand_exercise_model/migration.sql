/*
  Warnings:

  - Added the required column `bodyParts` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `coachingCues` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `commonMistakes` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `equipmentNeeded` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fatigueScore` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `isSupersetFriendly` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `keywords` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `muscleActivation` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `muscleFocus` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `secondaryMuscles` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetMuscles` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unilateralType` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Made the column `equipmentCategory` on table `Exercise` required. This step will fail if there are existing NULL values in that column.
  - Made the column `movementPattern` on table `Exercise` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mechanicType` on table `Exercise` required. This step will fail if there are existing NULL values in that column.
  - Made the column `difficulty` on table `Exercise` required. This step will fail if there are existing NULL values in that column.
  - Made the column `trainingType` on table `Exercise` required. This step will fail if there are existing NULL values in that column.
  - Made the column `overview` on table `Exercise` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "aliases" JSONB,
ADD COLUMN     "bodyParts" JSONB NOT NULL,
ADD COLUMN     "coachingCues" JSONB NOT NULL,
ADD COLUMN     "commonMistakes" JSONB NOT NULL,
ADD COLUMN     "equipmentNeeded" JSONB NOT NULL,
ADD COLUMN     "fatigueScore" INTEGER NOT NULL,
ADD COLUMN     "isSupersetFriendly" BOOLEAN NOT NULL,
ADD COLUMN     "keywords" JSONB NOT NULL,
ADD COLUMN     "muscleActivation" JSONB NOT NULL,
ADD COLUMN     "muscleFocus" JSONB NOT NULL,
ADD COLUMN     "secondaryMuscles" JSONB NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "targetMuscles" JSONB NOT NULL,
ADD COLUMN     "unilateralType" TEXT NOT NULL,
ALTER COLUMN "equipmentCategory" SET NOT NULL,
ALTER COLUMN "movementPattern" SET NOT NULL,
ALTER COLUMN "mechanicType" SET NOT NULL,
ALTER COLUMN "difficulty" SET NOT NULL,
ALTER COLUMN "trainingType" SET NOT NULL,
ALTER COLUMN "overview" SET NOT NULL;
