require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const path = require('path');

const {
  validateExerciseLibraryFromFiles,
  formatIssueForLog,
} = require('../src/exercise-library/validate-exercises');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const exercisesPath = path.join(__dirname, '../src/exercise-library/exercises.json');
const schemaPath = path.join(__dirname, '../src/exercise-library/exercise-schema.json');
const enumsPath = path.join(__dirname, '../src/exercise-library/exercise-enums.json');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function toExerciseRecord(exercise) {
  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    aliases: exercise.aliases ?? null,
    equipmentCategory: exercise.equipmentCategory,
    equipmentNeeded: exercise.equipmentNeeded,
    movementPattern: exercise.movementPattern,
    bodyParts: exercise.bodyParts,
    muscleFocus: exercise.muscleFocus,
    targetMuscles: exercise.targetMuscles,
    secondaryMuscles: exercise.secondaryMuscles,
    muscleActivation: exercise.muscleActivation,
    mechanicType: exercise.mechanicType,
    unilateralType: exercise.unilateralType,
    difficulty: exercise.difficulty,
    trainingType: exercise.trainingType,
    keywords: exercise.keywords,
    overview: exercise.overview,
    coachingCues: exercise.coachingCues,
    commonMistakes: exercise.commonMistakes,
    isSupersetFriendly: exercise.isSupersetFriendly,
    fatigueScore: exercise.fatigueScore,
    status: exercise.status,
  };
}

async function getExistingExerciseIds(exerciseIds) {
  const rows = await prisma.exercise.findMany({
    where: { exerciseId: { in: exerciseIds } },
    select: { exerciseId: true },
  });

  return new Set(rows.map((row) => row.exerciseId));
}

function logValidationSummary(results) {
  console.log('');
  console.log('Exercise library validation summary');
  console.log(`Total exercises: ${results.exercises.length}`);
  console.log(`Validation errors: ${results.errors.length}`);
  console.log(`Validation warnings: ${results.warnings.length}`);
  console.log(`Valid exercises: ${results.validExercises.length}`);
  console.log(`Invalid exercises: ${results.invalidExercises.length}`);
  console.log('');

  if (results.issues.length > 0) {
    for (const issue of results.issues) {
      console.log(formatIssueForLog(issue));
    }
    console.log('');
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const results = validateExerciseLibraryFromFiles({
    exercisesPath,
    schemaPath,
    enumsPath,
  });

  logValidationSummary(results);

  if (results.errors.length > 0) {
    throw new Error('Exercise library validation failed. No database writes were performed.');
  }

  const existingIds = await getExistingExerciseIds(
    results.validExercises.map((exercise) => exercise.exerciseId)
  );

  const existingCount = existingIds.size;
  const createCount = results.validExercises.length - existingCount;
  const updateCount = existingCount;

  if (args.dryRun) {
    console.log('Dry run only');
    console.log(`Would upsert: ${results.validExercises.length}`);
    console.log(`Would create: ${createCount}`);
    console.log(`Would update: ${updateCount}`);
    return;
  }

  for (const exercise of results.validExercises) {
    const data = toExerciseRecord(exercise);
    await prisma.exercise.upsert({
      where: { exerciseId: exercise.exerciseId },
      create: data,
      update: data,
    });
  }

  console.log('');
  console.log('Exercise library import complete');
  console.log(`Upserted: ${results.validExercises.length}`);
  console.log(`Created: ${createCount}`);
  console.log(`Updated: ${updateCount}`);
}

run()
  .catch((error) => {
    console.error('');
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
