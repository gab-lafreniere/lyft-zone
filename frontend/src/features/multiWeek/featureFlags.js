export function isWorkoutScopedAutosaveEnabled() {
  return process.env.REACT_APP_ENABLE_WORKOUT_SCOPED_AUTOSAVE === "true";
}
