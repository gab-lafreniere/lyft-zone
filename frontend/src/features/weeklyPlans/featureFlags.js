export function isAIWeeklyPlanFrontendEnabled() {
  return process.env.REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND === "true";
}

export function isWeeklyWorkoutScopedAutosaveEnabled() {
  return process.env.REACT_APP_ENABLE_WEEKLY_WORKOUT_SCOPED_AUTOSAVE === "true";
}
