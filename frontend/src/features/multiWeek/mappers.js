function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function normalizeNumeric(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTempoValue(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4) || null;
}

function parseRestSeconds(value) {
  const parsed = Number.parseInt(String(value || "").replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function createSetTemplateFromSingleSet(set, index, block, notes = null) {
  const reps = normalizeNumeric(set?.reps, null);
  const rir = normalizeNumeric(set?.rpe, 2);

  return {
    id: set?.id || undefined,
    setIndex: index + 1,
    setType: "WORKING",
    targetReps: reps,
    minReps: reps,
    maxReps: reps,
    targetSeconds: null,
    targetRir: rir,
    targetRpe: null,
    tempo: normalizeTempoValue(block.tempo),
    restSeconds: parseRestSeconds(block.rest),
    notes,
  };
}

function mapSingleBlockToApi(block, index) {
  return {
    id: block.id,
    orderIndex: index + 1,
    blockType: "SINGLE",
    label: null,
    roundCount: null,
    restStrategy: "AFTER_EXERCISE",
    restSeconds: parseRestSeconds(block.rest),
    notes: block.notes || null,
    exercises: [
      {
        id: block.exerciseRowId,
        exerciseId: block.exerciseId || null,
        exerciseName: String(block.exercise || "").trim(),
        bodyParts: normalizeStringArray(block.bodyParts),
        muscleFocus: normalizeStringArray(block.muscleFocus),
        orderIndex: 1,
        executionNotes: block.notes || null,
        defaultTempo: normalizeTempoValue(block.tempo),
        defaultRestSeconds: parseRestSeconds(block.rest),
        defaultTargetRir:
          Array.isArray(block.sets) && block.sets.length
            ? normalizeNumeric(block.sets[0]?.rpe, 2)
            : 2,
        defaultTargetRpe: null,
        intensificationMethod: "NONE",
        notes: block.notes || null,
        setTemplates: Array.isArray(block.sets)
          ? block.sets.map((set, setIndex) =>
              createSetTemplateFromSingleSet(set, setIndex, block, block.notes || null)
            )
          : [],
      },
    ],
  };
}

function mapSupersetBlockToApi(block, index) {
  return {
    id: block.id,
    orderIndex: index + 1,
    blockType: "SUPERSET",
    label: null,
    roundCount: normalizeNumeric(block.sets, 1),
    restStrategy: "AFTER_ROUND",
    restSeconds: parseRestSeconds(block.rest),
    notes: block.notes || null,
    exercises: (block.exercises || []).map((exercise, exerciseIndex) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId || null,
      exerciseName: String(exercise.name || "").trim(),
      bodyParts: normalizeStringArray(exercise.bodyParts),
      muscleFocus: normalizeStringArray(exercise.muscleFocus),
      orderIndex: exerciseIndex + 1,
      executionNotes: exercise.notes || null,
      defaultTempo: normalizeTempoValue(exercise.tempo),
      defaultRestSeconds: parseRestSeconds(block.rest),
      defaultTargetRir:
        Array.isArray(exercise.sets) && exercise.sets.length
          ? normalizeNumeric(exercise.sets[0]?.rpe, 2)
          : 2,
      defaultTargetRpe: null,
      intensificationMethod: "NONE",
      notes: exercise.notes || null,
      setTemplates: Array.isArray(exercise.sets)
        ? exercise.sets.map((set, setIndex) => ({
            id: set?.id || undefined,
            setIndex: setIndex + 1,
            setType: "WORKING",
            targetReps: normalizeNumeric(set?.reps, null),
            minReps: normalizeNumeric(set?.reps, null),
            maxReps: normalizeNumeric(set?.reps, null),
            targetSeconds: null,
            targetRir: normalizeNumeric(set?.rpe, 2),
            targetRpe: null,
            tempo: normalizeTempoValue(exercise.tempo),
            restSeconds: parseRestSeconds(block.rest),
            notes: exercise.notes || null,
          }))
        : [],
    })),
  };
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
      workouts: (week.workouts || []).map((workout, workoutIndex) => ({
        id: workout.id,
        name: String(workout.name || "").trim(),
        orderIndex: workout.orderIndex || workoutIndex + 1,
        estimatedDurationMinutes: null,
        notes: null,
        blocks: (workout.blocks || []).map((block, blockIndex) => {
          if (block.type === "superset") {
            return mapSupersetBlockToApi(block, blockIndex);
          }

          return mapSingleBlockToApi(block, blockIndex);
        }),
      })),
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
      lastPersistedSignature: JSON.stringify(
        mapMultiWeekDraftToApi({
          programName: builderPayload.programName || "",
          weeks,
        })
      ),
      draftState: response.draftState || null,
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
