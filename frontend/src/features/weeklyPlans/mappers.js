import { resolveCardioModality } from "../../utils/cardioModality";
import { mapBuilderWorkoutToApi } from "../draftPersistenceMapper";

function normalizeNumeric(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapProgramDraftToWeeklyPlanUpdate(programDraft) {
  return {
    name: String(programDraft.programName || "").trim(),
    sessionsPerWeek: normalizeNumeric(programDraft.sessionsPerWeek, 1),
    workouts: (programDraft.workouts || []).map((workout, workoutIndex) =>
      mapBuilderWorkoutToApi(workout, workoutIndex)
    ),
  };
}

export function mapBuilderPayloadToProgramDraft(response) {
  const builderPayload = response?.builderPayload || {};

  return {
    metadata: {
      weeklyPlanParentId: response.weeklyPlanParentId,
      weeklyPlanVersionId: response.weeklyPlanVersionId,
      status: String(response.status || "DRAFT").toLowerCase(),
      source: String(response.source || "manual").toLowerCase(),
      loadedFromBackend: true,
      lastSavedAt: response.updatedAt || null,
      saveState: "saved",
      revision: response.revision ?? null,
      lastPersistedSignature: JSON.stringify(
        mapProgramDraftToWeeklyPlanUpdate({
          programName: builderPayload.programName,
          sessionsPerWeek: builderPayload.sessionsPerWeek,
          workouts: builderPayload.workouts || [],
        })
      ),
    },
    programDraft: {
      programName: builderPayload.programName || "",
      sessionsPerWeek: builderPayload.sessionsPerWeek || 4,
      programLength: builderPayload.programLength || 8,
      startDate: builderPayload.startDate || null,
      endDate: builderPayload.endDate || null,
      isMultiWeek: Boolean(builderPayload.isMultiWeek),
      selectedWeek: builderPayload.selectedWeek || 1,
      workouts: (builderPayload.workouts || []).map((workout) => ({
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
    },
  };
}

export function mapWeeklyPlanListItemToUi(item, createdLabel) {
  return {
    id: item.id,
    weeklyPlanParentId: item.weeklyPlanParentId,
    visibleVersionId: item.visibleVersionId,
    name: item.name,
    status: String(item.status || "DRAFT").toLowerCase(),
    source: String(item.source || "manual").toLowerCase(),
    frequencyPerWeek: item.frequencyPerWeek || 0,
    totalWeeklySets: item.totalWeeklySets || 0,
    createdAt: item.createdAt,
    createdLabel,
    isBookmarked: Boolean(item.isBookmarked),
  };
}

function buildWeeklyMuscleDistribution(weeklyTotals = {}) {
  const entries = Object.entries(weeklyTotals)
    .map(([key, value]) => ({
      key,
      value: normalizeNumeric(value, 0),
    }))
    .filter((entry) => entry.value > 0);

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  return entries.map((entry) => ({
    label: entry.key.replace(/_/g, " "),
    percentage: total > 0 ? Math.round((entry.value / total) * 100) : 0,
  }));
}

export function mapWeeklyPlanDetailsToUi(details) {
  return {
    ...details,
    status: String(details.status || "DRAFT").toLowerCase(),
    source: String(details.source || "manual").toLowerCase(),
    weeklyMuscleDistribution: buildWeeklyMuscleDistribution(
      details.summary?.weeklyTotals || {}
    ),
    workouts: (details.workouts || []).map((workout) => ({
      ...workout,
      blocks: (workout.blocks || []).filter((block) => {
        if (block.type === "cardio") {
          return Boolean(block.exercise?.exerciseId && block.exercise?.name);
        }

        if (block.type === "single") {
          return Boolean(block.exercise?.exerciseId && block.exercise?.name);
        }

        return (block.exercises || []).some(
          (exercise) => exercise.exerciseId && exercise.name
        );
      }).map((block) => {
        if (block.type === "cardio") {
          const { prescription, ...cardioBlock } = block;

          return {
            ...cardioBlock,
            cardioPrescription: block.cardioPrescription || prescription || null,
            exercise: {
              ...block.exercise,
              imageUrl:
                block.exercise.imageUrl ||
                "https://dummyimage.com/160x160/ffffff/cbd5e1.png&text=Cardio",
            },
          };
        }

        if (block.type === "single") {
          return {
            ...block,
            exercise: {
              ...block.exercise,
              imageUrl:
                block.exercise.imageUrl ||
                "https://dummyimage.com/160x160/ffffff/cbd5e1.png&text=Exercise",
            },
          };
        }

        return {
          ...block,
          exercises: (block.exercises || [])
            .filter((exercise) => exercise.exerciseId && exercise.name)
            .map((exercise) => ({
              ...exercise,
              imageUrl:
                exercise.imageUrl ||
                "https://dummyimage.com/160x160/ffffff/cbd5e1.png&text=Exercise",
            })),
        };
      }),
    })),
  };
}
