function adaptSimpleWeeklyPlanStructureToLegacyGeometry(
  structure,
  { sessionsPerWeek }
) {
  const workouts = [];

  for (
    let workoutIndex = 1;
    workoutIndex <= sessionsPerWeek;
    workoutIndex += 1
  ) {
    const workout = structure[`workout_${workoutIndex}`];
    workouts.push({
      name: workout.name,
      blocks: workout.blocks.map((block) => {
        if (block.type === 'SINGLE') {
          return {
            blockType: 'SINGLE',
            roundCount: null,
            setCounts: [block.setCount],
          };
        }
        if (block.type === 'SUPERSET') {
          return {
            blockType: 'SUPERSET',
            roundCount: block.setCount,
            setCounts: [block.setCount, block.setCount],
          };
        }
        if (block.type === 'CARDIO') {
          return {
            blockType: 'CARDIO',
            roundCount: null,
            setCounts: [0],
          };
        }
        throw new TypeError(`Unsupported block type: ${block.type}`);
      }),
    });
  }

  return {
    schemaVersion: 1,
    planName: structure.planName,
    workouts,
  };
}

module.exports = {
  adaptSimpleWeeklyPlanStructureToLegacyGeometry,
};
