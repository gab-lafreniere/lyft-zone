-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "user_profiles"
ADD COLUMN "age" INTEGER,
ADD COLUMN "ageInputDate" DATE,
ADD COLUMN "sex" "Sex";
