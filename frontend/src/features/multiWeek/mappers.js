import { resolveCardioModality } from "../../utils/cardioModality";
import { mapBuilderWorkoutToApi } from "../draftPersistenceMapper";

export function mapCycleWorkoutToApi(workout, workoutIndex) {
  return mapBuilderWorkoutToApi(workout, workoutIndex, {
    includeScheduledDay: true,
  });
}

export function mapMultiWeekDraftToApi(programDraft) {
  return {
    name: String(programDraft.programName || "").trim(),
    weeks: (programDraft.weeks || []).map((week, weekIndex) => ({
      id: week.id,
      weekNumber: week.weekNumber || weekIndex + 1,
      orderIndex: week.orderIndex || weekIndex + 1,
      label: week.label || `Week ${weekIndex + 1}`,
      notes: week.notes || null,
      workouts: (week.workouts || []).map((workout, workoutIndex) =>
        mapCycleWorkoutToApi(workout, workoutIndex)
      ),
    })),
  };
}

export function mapCycleBuilderPayload(response) {
  const builderPayload = response?.builderPayload || {};
  const weeks = (builderPayload.weeks || []).map((week) => ({
    id: week.id,
    weekNumber: week.weekNumber,
    orderIndex: week.orderIndex,
    label: week.label || `Week ${week.weekNumber}`,
    notes: week.notes || "",
    workouts: (week.workouts || []).map((workout) => ({
      ...workout,
      blocks: (workout.blocks || []).map((block) => {
        if (block.type === "cardio") {
          const resolvedExerciseId =
            block.exerciseId || block.exercise?.exerciseId || null;

          return {
            ...block,
            exercise:
              block.exercise && typeof block.exercise === "object"
                ? {
                    ...block.exercise,
                    cardioModality: resolveCardioModality(
                      resolvedExerciseId,
                      block.exercise.cardioModality
                    ),
                  }
                : {
                    exerciseId: resolvedExerciseId,
                    name: block.exercise || "",
                    cardioModality: resolveCardioModality(resolvedExerciseId),
                  },
          };
        }

        if (block.type === "superset") {
          return {
            ...block,
            exercises: (block.exercises || []).map((exercise) => ({
              ...exercise,
              sets: exercise.sets || [],
            })),
          };
        }

        return {
          ...block,
          sets: block.sets || [],
        };
      }),
    })),
  }));

  const programDraft = {
    cycleId: response.cycleId || response.cycle?.id || null,
    planId: response.planId || response.publishedPlanId || response.visiblePlanId || null,
    programName: builderPayload.programName || "",
    sessionsPerWeek: builderPayload.sessionsPerWeek || weeks[0]?.workouts?.length || 0,
    programLength: builderPayload.programLength || weeks.length,
    durationWeeks: builderPayload.programLength || weeks.length,
    startDate: builderPayload.startDate || null,
    endDate: builderPayload.endDate || null,
    timezone: response.timezone || response.draftState?.effectiveTimezone || "America/Toronto",
    temporalStatus: String(response.temporalStatus || response.cycle?.temporalStatus || "upcoming").toLowerCase(),
    selectedWeek: builderPayload.selectedWeek || 1,
    weeks,
  };

  return {
    metadata: {
      cycleId: response.cycleId || response.cycle?.id || null,
      planId: response.planId || response.publishedPlanId || response.visiblePlanId || null,
      cyclePlanId: response.planId || response.publishedPlanId || response.visiblePlanId || null,
      status: String(response.status || "DRAFT").toLowerCase(),
      temporalStatus: String(response.temporalStatus || response.cycle?.temporalStatus || "upcoming").toLowerCase(),
      timezone: response.timezone || response.draftState?.effectiveTimezone || "America/Toronto",
      loadedFromBackend: true,
      lastSavedAt: response.updatedAt || null,
      saveState: "saved",
      revision: response.revision ?? null,
      lastPersistedSignature: JSON.stringify(
        mapMultiWeekDraftToApi({
          programName: builderPayload.programName || "",
          weeks,
        })
      ),
      draftState: response.draftState || null,
      draftTimeline: response.draftTimeline || null,
    },
    programDraft,
    cycleDraft: programDraft,
  };
}

export const mapCycleDraftResponse = mapCycleBuilderPayload;
export const mapCycleDraftToApi = mapMultiWeekDraftToApi;

export function mapCycleCardToUi(item) {
  if (!item) {
    return null;
  }

  return {
    id: item.id || item.cycleId,
    name: item.name,
    startDate: item.startDate,
    endDate: item.endDate,
    durationWeeks: item.durationWeeks,
    temporalStatus: item.temporalStatus,
    editorialStatus: item.editorialStatus,
    visiblePlanId: item.visiblePlanId,
  };
}
