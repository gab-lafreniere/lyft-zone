const test = require('node:test');
const assert = require('node:assert/strict');

const { diffWorkoutList } = require('../../services/draftDocumentDiff');

function buildWorkout(weekNumber, workoutNumber) {
  const workoutId = `week_${weekNumber}_workout_${workoutNumber}`;
  const blockId = `${workoutId}_block`;
  const exerciseId = `${blockId}_exercise`;

  return {
    id: workoutId,
    name: `Week ${weekNumber} Workout ${workoutNumber}`,
    orderIndex: workoutNumber,
    scheduledDay: null,
    estimatedDurationMinutes: 60,
    notes: null,
    blocks: [
      {
        id: blockId,
        orderIndex: 1,
        blockType: 'SINGLE',
        label: null,
        roundCount: null,
        restStrategy: 'AFTER_EXERCISE',
        restSeconds: 90,
        notes: null,
        exercises: [
          {
            id: exerciseId,
            exerciseId: 'exr_movement_example',
            exerciseName: 'Movement Example',
            bodyParts: ['chest'],
            muscleFocus: ['chest'],
            orderIndex: 1,
            executionNotes: null,
            defaultTempo: null,
            defaultRestSeconds: null,
            defaultTargetRir: null,
            defaultTargetRpe: 8.5,
            intensificationMethod: 'NONE',
            cardioPrescription: null,
            notes: null,
            setTemplates: Array.from({ length: 25 }, (_, setOffset) => ({
              id: `${exerciseId}_set_${setOffset + 1}`,
              setIndex: setOffset + 1,
              setType: setOffset === 0 ? 'TOP_SET' : 'WORKING',
              targetReps: null,
              minReps: 8,
              maxReps: 12,
              targetSeconds: null,
              targetRir: null,
              targetRpe: 8.5,
              tempo: null,
              restSeconds: null,
              notes: setOffset === 0 ? 'preserved note' : null,
            })),
          },
        ],
      },
    ],
  };
}

function buildSixWeekFixture() {
  return Array.from({ length: 6 }, (_, weekOffset) => ({
    weekNumber: weekOffset + 1,
    workouts: Array.from({ length: 6 }, (_, workoutOffset) =>
      buildWorkout(weekOffset + 1, workoutOffset + 1)
    ),
  }));
}

function countChangedWorkouts(currentWeeks, incomingWeeks) {
  return currentWeeks.reduce((count, week, index) => {
    const diff = diffWorkoutList(
      week.workouts,
      incomingWeeks[index].workouts,
      `week ${week.weekNumber}`
    );
    return (
      count +
      diff.workoutUpdates.filter((entry) => entry.scalarChanged || entry.blockChanged).length
    );
  }, 0);
}

test('a realistic 6-week/36-workout/900-set no-op classifies zero workouts as changed', () => {
  const current = buildSixWeekFixture();
  const incoming = structuredClone(current);

  assert.equal(countChangedWorkouts(current, incoming), 0);
});

test('adding two sets in the realistic fixture classifies exactly one of 36 workouts as changed', () => {
  const current = buildSixWeekFixture();
  const incoming = structuredClone(current);
  const sets = incoming[3].workouts[4].blocks[0].exercises[0].setTemplates;
  sets.push(
    { ...sets[sets.length - 1], id: undefined, setIndex: 26 },
    { ...sets[sets.length - 1], id: undefined, setIndex: 27 }
  );

  assert.equal(countChangedWorkouts(current, incoming), 1);
});
