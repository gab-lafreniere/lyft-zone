const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWorkoutNames,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/workoutNameNormalization');

let persistedVersionData;
require.cache[require.resolve('../../../lib/prisma')] = {
  id: require.resolve('../../../lib/prisma'),
  filename: require.resolve('../../../lib/prisma'),
  loaded: true,
  exports: {
    getPrisma: () => ({
      user: {
        findUnique: async () => ({ id: 'user_123' }),
      },
      exercise: {
        findMany: async ({ where }) => where.exerciseId.in.map((exerciseId) => ({
          exerciseId,
          trainingType: 'strength',
          cardioModality: null,
        })),
      },
      $transaction: async (callback) => callback({
        weeklyPlanParent: {
          create: async () => ({ id: 'parent_123' }),
          update: async () => ({}),
          findUnique: async () => ({
            id: 'parent_123',
            sourceType: 'AI',
            bookmarks: [],
            latestDraftVersion: null,
            latestPublishedVersion: {
              id: 'version_123',
              ...persistedVersionData,
              workouts: [],
            },
          }),
        },
        weeklyPlanVersion: {
          create: async ({ data }) => {
            persistedVersionData = data;
            return { id: 'version_123', ...data, workouts: [] };
          },
        },
      }),
    }),
  },
};

const {
  createWeeklyPlan,
} = require('../../../services/weeklyPlansService');

function workoutsFromNames(names) {
  return names.map((name, index) => ({
    id: `workout_${index + 1}`,
    name,
    orderIndex: index + 1,
    notes: `unchanged-${index + 1}`,
    blocks: [
      {
        id: `block_${index + 1}`,
        orderIndex: 1,
        blockType: 'SINGLE',
        exercises: [
          {
            id: `exercise_${index + 1}`,
            exerciseId: `exr_test_${index + 1}`,
            exerciseName: `Test Exercise ${index + 1}`,
            orderIndex: 1,
            setTemplates: [],
          },
        ],
      },
    ],
  }));
}

test('preserves the complete focus after stripping only the ordinal prefix', () => {
  const input = workoutsFromNames([
    'Day 1 - Upper Chest Priority Push + Upper Back Support',
  ]);
  const result = normalizeWorkoutNames(input);

  assert.equal(
    result.workouts[0].name,
    'Upper Chest Priority Push + Upper Back Support'
  );
  assert.deepEqual(result.sourceNames, [
    'Day 1 - Upper Chest Priority Push + Upper Back Support',
  ]);
  assert.equal(result.workouts[0].name.includes('+ Upper Back Support'), true);
  assert.deepEqual(input, workoutsFromNames([
    'Day 1 - Upper Chest Priority Push + Upper Back Support',
  ]));
});

test('strips every supported ordinal and separator form', () => {
  const result = normalizeWorkoutNames(workoutsFromNames([
    'Day 1 - Push',
    'Session 2 — Pull',
    'Workout 3 – Legs',
    '• **Jour 4:** Full Body',
  ]));

  assert.deepEqual(
    result.workouts.map((workout) => workout.name),
    ['Push', 'Pull', 'Legs', 'Full Body']
  );
});

test('sanitizes names without prefixes and preserves separators and all focus words', () => {
  const result = normalizeWorkoutNames(workoutsFromNames([
    '  • **Chest** & Back and Arms + Delts — Support,  ',
  ]));
  assert.equal(
    result.workouts[0].name,
    'Chest & Back and Arms + Delts - Support'
  );
});

test('an empty or one-character normalized result falls back to the original name', () => {
  const names = ['Day 1 -', 'Workout 2: X'];
  const result = normalizeWorkoutNames(workoutsFromNames(names));
  assert.deepEqual(result.workouts.map((workout) => workout.name), names);
});

test('collisions retro-suffix every holder with A, B, C', () => {
  const result = normalizeWorkoutNames(workoutsFromNames([
    'Day 1 - Push',
    'Session 2: Push',
    'Workout 3 — Push',
  ]));
  assert.deepEqual(
    result.workouts.map((workout) => workout.name),
    ['Push A', 'Push B', 'Push C']
  );
});

test('a second-order collision uses orderIndex suffixes and remains unique', () => {
  const result = normalizeWorkoutNames(workoutsFromNames([
    'Day 1 - Push',
    'Day 2 - Push',
    'Push A',
  ]));
  assert.deepEqual(
    result.workouts.map((workout) => workout.name),
    ['Push A 1', 'Push B', 'Push A 3']
  );
});

test('normalization is stable when applied to its own output', () => {
  const first = normalizeWorkoutNames(workoutsFromNames([
    'Day 1 - Push',
    'Day 2 - Push',
    'Push A',
  ]));
  const second = normalizeWorkoutNames(first.workouts);
  assert.deepEqual(second.workouts, first.workouts);
});

test('normalized names pass the existing published create path', async () => {
  const normalized = normalizeWorkoutNames(workoutsFromNames([
    'Day 1 - Push',
    'Day 2 - Push',
    'Push A',
  ])).workouts;

  await assert.doesNotReject(() => createWeeklyPlan({
    userId: 'user_123',
    source: 'AI',
    name: 'Normalized Training Plan',
    sessionsPerWeek: normalized.length,
    workouts: normalized,
  }, { initialStatus: 'PUBLISHED' }));
});
