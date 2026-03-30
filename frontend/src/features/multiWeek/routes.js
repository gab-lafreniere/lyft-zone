export function getCyclesLibraryPath() {
  return `/program/cycles`;
}

export function getCycleDetailsPath(cycleId) {
  return `/program/cycles/${cycleId}`;
}

export function getCycleBuilderPath(cycleId) {
  return `/program/cycles/${cycleId}/builder`;
}

export function getCycleWorkoutEditorPath(cycleId, weekNumber, orderIndex) {
  return `/program/cycles/${cycleId}/builder/week/${weekNumber}/workout/${orderIndex}`;
}
