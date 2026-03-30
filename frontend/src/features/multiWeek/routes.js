export function getCycleDetailsPath(cycleId) {
  return `/program/cycles/${cycleId}`;
}

export function getCycleBuilderPath(cycleId) {
  return `/program/cycles/${cycleId}/builder`;
}

export function getCycleWorkoutEditorPath(cycleId, workoutId) {
  return `/program/cycles/${cycleId}/builder/workout/${workoutId}`;
}
