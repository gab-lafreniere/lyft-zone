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

export function mapProgramDraftToWeeklyPlanUpdate(programDraft) {
  return {
    name: String(programDraft.programName || "").trim(),
    sessionsPerWeek: normalizeNumeric(programDraft.sessionsPerWeek, 1),
    workouts: (programDraft.workouts || []).map((workout, workoutIndex) => ({
      id: workout.id,
      name: String(workout.name || "").trim(),
      orderIndex: workoutIndex + 1,
      estimatedDurationMinutes: null,
      notes: null,
      blocks: (workout.blocks || []).map((block, blockIndex) => {
        if (block.type === "superset") {
          return mapSupersetBlockToApi(block, blockIndex);
        }

        return mapSingleBlockToApi(block, blockIndex);
      }),
    })),
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
        if (block.type === "single") {
          return Boolean(block.exercise?.exerciseId && block.exercise?.name);
        }

        return (block.exercises || []).some(
          (exercise) => exercise.exerciseId && exercise.name
        );
      }).map((block) => {
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
