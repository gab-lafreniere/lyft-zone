export function isAIWeeklyPlanFrontendEnabled() {
  return process.env.REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND === "true";
}
