export function getWeeklyPlansPath() {
  return "/program/all";
}

export function getWeeklyPlanDetailsPath(weeklyPlanParentId, workoutId = null) {
  const searchParams = new URLSearchParams();

  if (workoutId) {
    searchParams.set("workoutId", workoutId);
  }

  const search = searchParams.toString();
  return `/program/all/${weeklyPlanParentId}${search ? `?${search}` : ""}`;
}

export function getManualBuilderPath() {
  return "/program/manual-builder";
}

