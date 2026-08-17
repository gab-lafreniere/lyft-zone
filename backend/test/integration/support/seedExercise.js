'use strict';

// A minimal, valid Exercise row. Cycle drafts require a real exerciseId FK
// (BlockExercise.exerciseId is non-nullable, onDelete: Restrict); weekly
// plan drafts don't strictly require one, but using the same fixture keeps
// both integration suites consistent.

async function seedExercise(prisma, exerciseId = 'ex_bench_press_test') {
  return prisma.exercise.create({
    data: {
      exerciseId,
      name: 'Bench Press',
      trainingType: 'STRENGTH',
      keywords: ['bench', 'press'],
      overview: 'Test fixture exercise for integration tests.',
      coachingCues: [],
      commonMistakes: [],
      status: 'ACTIVE',
    },
  });
}

module.exports = { seedExercise };
