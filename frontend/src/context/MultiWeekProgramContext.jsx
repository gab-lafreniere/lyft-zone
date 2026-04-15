import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mapCycleBuilderPayload, mapMultiWeekDraftToApi } from "../features/multiWeek/mappers";
import { updateCycleDraft } from "../services/api";

const MultiWeekProgramContext = createContext(null);
export const MAX_BLOCK_SET_COUNT = 10;
const DAY_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSetUpdates(updates = {}) {
  const nextUpdates = { ...updates };

  if (typeof nextUpdates.reps === "number" && !Number.isNaN(nextUpdates.reps)) {
    nextUpdates.reps = clampNumber(nextUpdates.reps, 0, 100);
  }

  if (typeof nextUpdates.rpe === "number" && !Number.isNaN(nextUpdates.rpe)) {
    nextUpdates.rpe = clampNumber(nextUpdates.rpe, 0, 4);
  }

  return nextUpdates;
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSingleSetRow() {
  return { reps: 8, rpe: 2 };
}

function createSupersetSetRow() {
  return { reps: 10, rpe: 2 };
}

function createSetRows(count, createRow) {
  return Array.from({ length: Math.max(1, count) }, () => createRow());
}

function normalizeSupersetExerciseSets(exercise, targetCount) {
  const safeCount = Math.max(1, targetCount);
  const existingSets = Array.isArray(exercise?.sets) ? exercise.sets : [];

  if (existingSets.length === safeCount) {
    return exercise;
  }

  if (existingSets.length > safeCount) {
    return {
      ...exercise,
      sets: existingSets.slice(0, safeCount),
    };
  }

  return {
    ...exercise,
    sets: [
      ...existingSets,
      ...createSetRows(safeCount - existingSets.length, createSupersetSetRow),
    ],
  };
}

function normalizeSupersetBlock(block) {
  const populatedCounts = Array.isArray(block.exercises)
    ? block.exercises
        .map((exercise) => (Array.isArray(exercise?.sets) ? exercise.sets.length : 0))
        .filter((count) => count > 0)
    : [];
  const targetCount = Math.max(1, block.sets ?? populatedCounts[0] ?? 1);

  return {
    ...block,
    sets: targetCount,
    exercises: (block.exercises || []).map((exercise) =>
      normalizeSupersetExerciseSets(exercise, targetCount)
    ),
  };
}

function createDefaultSingleBlock() {
  return {
    id: createId("block"),
    type: "single",
    exercise: "",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    rest: "120s",
    sets: createSetRows(2, createSingleSetRow),
    notes: "",
  };
}

function createEmptySupersetExercise(label, setCount = 2) {
  return {
    label,
    name: "",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    sets: createSetRows(setCount, createSupersetSetRow),
    notes: "",
  };
}

function createDefaultSupersetBlock() {
  return normalizeSupersetBlock({
    id: createId("block"),
    type: "superset",
    sets: 2,
    rest: "120s",
    exercises: [
      createEmptySupersetExercise("A1", 2),
      createEmptySupersetExercise("A2", 2),
    ],
  });
}

function createWorkout(name, withTemplateBlocks = true) {
  return {
    id: createId("workout"),
    name,
    blocks: withTemplateBlocks
      ? [createDefaultSingleBlock(), createDefaultSupersetBlock()]
      : [],
  };
}

function cloneWorkoutForDuplicate(workout) {
  return {
    ...workout,
    id: createId("workout"),
    blocks: (workout.blocks || []).map((block) => ({
      ...block,
      id: createId("block"),
      exercises:
        block.type === "superset"
          ? (block.exercises || []).map((exercise) => ({
              ...exercise,
              sets: Array.isArray(exercise.sets)
                ? exercise.sets.map((set) => ({ ...set }))
                : [],
            }))
          : block.exercises,
      sets: Array.isArray(block.sets)
        ? block.sets.map((set) => ({ ...set }))
        : block.sets,
    })),
  };
}

function getDayIndex(day) {
  return DAY_OF_WEEK.indexOf(day || "");
}

function createInitialDraft() {
  return {
    programName: "",
    sessionsPerWeek: 0,
    programLength: 0,
    startDate: null,
    endDate: null,
    selectedWeek: 1,
    weeks: [],
  };
}

function createInitialDraftMetadata() {
  return {
    cycleId: null,
    cyclePlanId: null,
    status: "draft",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    loadedFromBackend: false,
    lastSavedAt: null,
    saveState: "idle",
    lastPersistedSignature: "",
    draftState: null,
    allowCrossDayDraft: false,
    lastSaveErrorMessage: null,
    lastSaveErrorCode: null,
  };
}

function updateSelectedWeekDraft(prev, updater) {
  const selectedWeekIndex = Math.max(0, (prev.selectedWeek || 1) - 1);
  if (!prev.weeks[selectedWeekIndex]) {
    return prev;
  }

  const nextWeeks = prev.weeks.map((week, index) =>
    index === selectedWeekIndex ? updater(week) : week
  );

  return {
    ...prev,
    weeks: nextWeeks,
  };
}

function resolvePreservedSelectedWeek(currentSelectedWeek, nextDraft) {
  const validWeekNumbers = new Set((nextDraft?.weeks || []).map((week) => week.weekNumber));

  if (validWeekNumbers.has(currentSelectedWeek)) {
    return currentSelectedWeek;
  }

  if (validWeekNumbers.has(nextDraft?.selectedWeek)) {
    return nextDraft.selectedWeek;
  }

  return nextDraft?.weeks?.[0]?.weekNumber || 1;
}

export function MultiWeekProgramProvider({ children }) {
  const [multiWeekDraft, setMultiWeekDraft] = useState(createInitialDraft);
  const [draftMetadata, setDraftMetadata] = useState(createInitialDraftMetadata);
  const multiWeekDraftRef = useRef(multiWeekDraft);
  const draftMetadataRef = useRef(draftMetadata);

  useEffect(() => {
    multiWeekDraftRef.current = multiWeekDraft;
  }, [multiWeekDraft]);

  useEffect(() => {
    draftMetadataRef.current = draftMetadata;
  }, [draftMetadata]);

  const selectedWeek = useMemo(
    () => multiWeekDraft.weeks.find((week) => week.weekNumber === multiWeekDraft.selectedWeek) || multiWeekDraft.weeks[0] || null,
    [multiWeekDraft.selectedWeek, multiWeekDraft.weeks]
  );

  const programDraft = useMemo(
    () => ({
      ...multiWeekDraft,
      isMultiWeek: true,
      workouts: selectedWeek?.workouts || [],
    }),
    [multiWeekDraft, selectedWeek]
  );

  const persistDraftNow = useCallback(async (overrideDraft = null) => {
    const currentMetadata = draftMetadataRef.current;
    const currentPlanId = currentMetadata?.cyclePlanId || null;
    if (
      !currentMetadata.loadedFromBackend ||
      !currentMetadata.cycleId ||
      !currentPlanId
    ) {
      return null;
    }

    const nextDraft = overrideDraft || multiWeekDraftRef.current;
    const payload = mapMultiWeekDraftToApi(nextDraft);
    const signature = JSON.stringify(payload);

    if (signature === currentMetadata.lastPersistedSignature) {
      return null;
    }

    setDraftMetadata((prev) => (
      prev.saveState === "saving"
        ? prev
        : {
            ...prev,
            saveState: "saving",
          }
    ));

    try {
      const response = await updateCycleDraft(currentMetadata.cycleId, currentPlanId, {
        ...payload,
        allowCrossDayDraft: currentMetadata.allowCrossDayDraft,
      });

      const activePlanId = response?.planId || null;
      const nextState = mapCycleBuilderPayload(response);
      setMultiWeekDraft((prev) => ({
        ...nextState.programDraft,
        selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
      }));
      setDraftMetadata((prev) => ({
        ...prev,
        ...nextState.metadata,
        cycleId: nextState.metadata.cycleId,
        cyclePlanId: activePlanId || nextState.metadata.cyclePlanId,
        lastSavedAt: response.updatedAt || new Date().toISOString(),
        saveState: "saved",
        lastSaveErrorMessage: null,
        lastSaveErrorCode: null,
      }));

      return response;
    } catch (error) {
      setDraftMetadata((prev) => (
        prev.saveState === "error"
          ? prev
          : {
              ...prev,
              saveState: "error",
              lastSaveErrorMessage: error?.message || "Unable to autosave this draft.",
              lastSaveErrorCode: error?.code || null,
            }
      ));
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!draftMetadata.loadedFromBackend || !draftMetadata.cycleId || !draftMetadata.cyclePlanId) {
      return undefined;
    }

    const signature = JSON.stringify(mapMultiWeekDraftToApi(multiWeekDraft));
    if (signature === draftMetadata.lastPersistedSignature) {
      return undefined;
    }

    setDraftMetadata((prev) => {
      if (prev.saveState === "saving" || prev.saveState === "dirty") {
        return prev;
      }

      return {
        ...prev,
        saveState: "dirty",
      };
    });

    const timeoutId = window.setTimeout(() => {
      persistDraftNow(multiWeekDraft).catch((error) => {
        console.error("[MultiWeekProgramContext] autosave failed", {
          cycleId: draftMetadataRef.current?.cycleId || null,
          cyclePlanId: draftMetadataRef.current?.cyclePlanId || null,
          errorCode: error?.code || null,
          errorMessage: error?.message || null,
        });
      });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    draftMetadata.cycleId,
    draftMetadata.cyclePlanId,
    draftMetadata.lastPersistedSignature,
    draftMetadata.loadedFromBackend,
    multiWeekDraft,
    persistDraftNow,
  ]);

  const hydrateProgramDraft = useCallback((response) => {
    const nextState = mapCycleBuilderPayload(response);
    setMultiWeekDraft((prev) => ({
      ...nextState.programDraft,
      selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
    }));
    setDraftMetadata({
      ...createInitialDraftMetadata(),
      ...nextState.metadata,
    });
  }, []);

  const updateProgramMeta = useCallback((updates = {}) => {
    setMultiWeekDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const setSelectedWeek = useCallback((week) => {
    setMultiWeekDraft((prev) => ({ ...prev, selectedWeek: week }));
  }, []);

  const updateWorkoutName = useCallback((workoutId, name) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) =>
          workout.id === workoutId ? { ...workout, name } : workout
        ),
      }))
    );
  }, []);

  const addWorkout = useCallback((name) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        if (week.workouts.length >= prev.sessionsPerWeek) {
          return week;
        }

        const nextIndex = week.workouts.length + 1;
        return {
          ...week,
          workouts: [
            ...week.workouts,
            createWorkout(name || `Workout ${nextIndex}`, false),
          ],
        };
      })
    );
  }, []);

  const moveWorkouts = useCallback((workoutIds, direction) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const nextWorkouts = [...week.workouts];

        if (direction === "up") {
          for (let index = 1; index < nextWorkouts.length; index += 1) {
            if (
              selectedIdSet.has(nextWorkouts[index].id) &&
              !selectedIdSet.has(nextWorkouts[index - 1].id)
            ) {
              [nextWorkouts[index - 1], nextWorkouts[index]] = [
                nextWorkouts[index],
                nextWorkouts[index - 1],
              ];
            }
          }
        } else {
          for (let index = nextWorkouts.length - 2; index >= 0; index -= 1) {
            if (
              selectedIdSet.has(nextWorkouts[index].id) &&
              !selectedIdSet.has(nextWorkouts[index + 1].id)
            ) {
              [nextWorkouts[index], nextWorkouts[index + 1]] = [
                nextWorkouts[index + 1],
                nextWorkouts[index],
              ];
            }
          }
        }

        return {
          ...week,
          workouts: nextWorkouts,
        };
      })
    );
  }, []);

  const duplicateWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        if (week.workouts.length + selectedIdSet.size > prev.sessionsPerWeek) {
          return week;
        }

        const nextWorkouts = [];
        week.workouts.forEach((workout) => {
          nextWorkouts.push(workout);
          if (selectedIdSet.has(workout.id)) {
            nextWorkouts.push(cloneWorkoutForDuplicate(workout));
          }
        });

        return {
          ...week,
          workouts: nextWorkouts,
        };
      })
    );
  }, []);

  const removeWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.filter((workout) => !selectedIdSet.has(workout.id)),
      }))
    );
  }, []);

  const updateBlock = useCallback((workoutId, blockId, updates) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) =>
          workout.id === workoutId
            ? {
                ...workout,
                blocks: workout.blocks.map((block) =>
                  block.id === blockId ? { ...block, ...updates } : block
                ),
              }
            : workout
        ),
      }))
    );
  }, []);

  const updateSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, updates) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId || block.type !== "superset") {
                return block;
              }

              return normalizeSupersetBlock({
                ...block,
                exercises: block.exercises.map((exercise, index) =>
                  index === exerciseIndex ? { ...exercise, ...updates } : exercise
                ),
              });
            }),
          };
        }),
      }))
    );
  }, []);

  const updateSupersetSetCount = useCallback((workoutId, blockId, nextCount) => {
    const safeCount = clampNumber(nextCount || 1, 1, MAX_BLOCK_SET_COUNT);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId || block.type !== "superset") {
                return block;
              }

              return normalizeSupersetBlock({
                ...block,
                sets: safeCount,
              });
            }),
          };
        }),
      }))
    );
  }, []);

  const removeBlock = useCallback((workoutId, blockId) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) =>
          workout.id === workoutId
            ? {
                ...workout,
                blocks: workout.blocks.filter((block) => block.id !== blockId),
              }
            : workout
        ),
      }))
    );
  }, []);

  const addSet = useCallback((workoutId, blockId, exerciseIndex = null) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId) {
                return block;
              }

              if (block.type === "single") {
                if (block.sets.length >= MAX_BLOCK_SET_COUNT) {
                  return block;
                }

                return {
                  ...block,
                  sets: [...block.sets, createSingleSetRow()],
                };
              }

              if ((block.sets || 1) >= MAX_BLOCK_SET_COUNT) {
                return block;
              }

              return normalizeSupersetBlock({
                ...block,
                sets: (block.sets || 1) + 1,
              });
            }),
          };
        }),
      }))
    );
  }, []);

  const removeSet = useCallback((workoutId, blockId, setIndex, exerciseIndex = null) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId) {
                return block;
              }

              if (block.type === "single") {
                if (block.sets.length <= 1) {
                  return block;
                }

                return {
                  ...block,
                  sets: block.sets.filter((_, index) => index !== setIndex),
                };
              }

              if ((block.sets || 1) <= 1) {
                return block;
              }

              return normalizeSupersetBlock({
                ...block,
                sets: (block.sets || 1) - 1,
              });
            }),
          };
        }),
      }))
    );
  }, []);

  const moveWorkoutToScheduledDay = useCallback((workoutId, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const movingWorkout = workouts.find((workout) => workout.id === workoutId);
        if (!movingWorkout) {
          return week;
        }

        const targetWorkout = workouts.find(
          (workout) =>
            workout.id !== workoutId && (workout.scheduledDay || null) === nextScheduledDay
        );
        const sourceScheduledDay = movingWorkout.scheduledDay || null;

        return {
          ...week,
          workouts: workouts.map((workout) => {
            if (workout.id === workoutId) {
              return {
                ...workout,
                scheduledDay: nextScheduledDay,
              };
            }

            if (targetWorkout && workout.id === targetWorkout.id) {
              return {
                ...workout,
                scheduledDay: sourceScheduledDay,
              };
            }

            return workout;
          }),
        };
      })
    );
  }, []);

  const moveSelectedWeekWorkoutToScheduledDay = useCallback((orderIndex, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const movingWorkout = workouts.find(
          (workout) => Number(workout.orderIndex) === Number(orderIndex)
        );
        if (!movingWorkout) {
          return week;
        }

        const targetWorkout = workouts.find(
          (workout) =>
            Number(workout.orderIndex) !== Number(orderIndex) &&
            (workout.scheduledDay || null) === nextScheduledDay
        );
        const sourceScheduledDay = movingWorkout.scheduledDay || null;

        return {
          ...week,
          workouts: workouts.map((workout) => {
            if (Number(workout.orderIndex) === Number(orderIndex)) {
              return {
                ...workout,
                scheduledDay: nextScheduledDay,
              };
            }

            if (targetWorkout && workout.id === targetWorkout.id) {
              return {
                ...workout,
                scheduledDay: sourceScheduledDay,
              };
            }

            return workout;
          }),
        };
      })
    );
  }, []);

  const duplicateSelectedWeekWorkout = useCallback((orderIndex, targetScheduledDay = null) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const sourceWorkout = workouts.find(
          (workout) => Number(workout.orderIndex) === Number(orderIndex)
        );

        if (!sourceWorkout) {
          return week;
        }

        const occupiedDays = new Set(
          workouts.map((workout) => workout.scheduledDay).filter((day) => DAY_OF_WEEK.includes(day))
        );
        const sourceDayIndex = getDayIndex(sourceWorkout.scheduledDay);
        const nextEmptyAfter = DAY_OF_WEEK.find(
          (day, index) => index > sourceDayIndex && !occupiedDays.has(day)
        );
        const nextEmptyBefore = DAY_OF_WEEK.find(
          (day, index) => index < sourceDayIndex && !occupiedDays.has(day)
        );
        const targetDay =
          DAY_OF_WEEK.includes(targetScheduledDay) && !occupiedDays.has(targetScheduledDay)
            ? targetScheduledDay
            : nextEmptyAfter || nextEmptyBefore || null;

        if (!targetDay) {
          return week;
        }

        const maxOrderIndex = workouts.reduce(
          (maxValue, workout) => Math.max(maxValue, Number(workout.orderIndex) || 0),
          0
        );
        const duplicatedWorkout = cloneWorkoutForDuplicate(sourceWorkout);

        return {
          ...week,
          workouts: [
            ...workouts,
            {
              ...duplicatedWorkout,
              orderIndex: maxOrderIndex + 1,
              scheduledDay: targetDay,
            },
          ],
        };
      })
    );
  }, []);

  const deleteSelectedWeekWorkout = useCallback((orderIndex) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: (week.workouts || []).filter(
          (workout) => Number(workout.orderIndex) !== Number(orderIndex)
        ),
      }))
    );
  }, []);

  const updateSet = useCallback((workoutId, blockId, setIndex, updates, exerciseIndex = null) => {
    const normalizedUpdates = normalizeSetUpdates(updates);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId) {
                return block;
              }

              if (block.type === "single") {
                return {
                  ...block,
                  sets: block.sets.map((set, index) =>
                    index === setIndex ? { ...set, ...normalizedUpdates } : set
                  ),
                };
              }

              if (typeof exerciseIndex !== "number" || !block.exercises[exerciseIndex]) {
                return block;
              }

              const nextExercises = block.exercises.map((exercise, index) =>
                index === exerciseIndex
                  ? {
                      ...exercise,
                      sets: exercise.sets.map((set, idx) =>
                        idx === setIndex ? { ...set, ...normalizedUpdates } : set
                      ),
                    }
                  : exercise
              );

              return normalizeSupersetBlock({
                ...block,
                exercises: nextExercises,
              });
            }),
          };
        }),
      }))
    );
  }, []);

  const appendSingleBlockFromExercise = useCallback((workoutId, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    const block = {
      id: createId("block"),
      type: "single",
      exercise: exercise.name,
      exerciseId: exercise.exerciseId,
      bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
      muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
      tempo: "3010",
      rest: "120s",
      sets: createSetRows(2, createSingleSetRow),
      notes: "",
    };

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) =>
          workout.id === workoutId
            ? { ...workout, blocks: [...workout.blocks, block] }
            : workout
        ),
      }))
    );
  }, []);

  const convertSingleBlockToSuperset = useCallback((workoutId, blockId) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId || block.type !== "single") {
                return block;
              }

              return {
                id: block.id,
                type: "superset",
                sets: Math.max(1, block.sets.length || 1),
                rest: block.rest,
                exercises: [
                  {
                    label: "A1",
                    name: block.exercise,
                    exerciseId: block.exerciseId ?? null,
                    bodyParts: Array.isArray(block.bodyParts) ? block.bodyParts : [],
                    muscleFocus: Array.isArray(block.muscleFocus) ? block.muscleFocus : [],
                    tempo: block.tempo,
                    sets: block.sets,
                    notes: block.notes,
                  },
                  createEmptySupersetExercise("A2", Math.max(1, block.sets.length || 1)),
                ],
              };
            }),
          };
        }),
      }))
    );
  }, []);

  const assignSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId || block.type !== "superset") {
                return block;
              }

              return {
                ...block,
                exercises: block.exercises.map((entry, index) =>
                  index === exerciseIndex
                    ? {
                        ...entry,
                        name: exercise.name,
                        exerciseId: exercise.exerciseId,
                        bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
                        muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
                      }
                    : entry
                ),
              };
            }),
          };
        }),
      }))
    );
  }, []);

  const hasIncompleteSupersets = useCallback((workoutId = null) => {
    return (selectedWeek?.workouts || []).some((workout) => {
      if (workoutId && workout.id !== workoutId) {
        return false;
      }

      return workout.blocks.some(
        (block) =>
          block.type === "superset" &&
          block.exercises.some((exercise) => !String(exercise.exerciseId || "").trim())
      );
    });
  }, [selectedWeek]);

  const updateDraftMetadata = useCallback((updates = {}) => {
    setDraftMetadata((prev) => ({ ...prev, ...updates }));
  }, []);

  const value = useMemo(
    () => ({
      programDraft,
      draftMetadata,
      hydrateProgramDraft,
      persistDraftNow,
      updateProgramMeta,
      setSelectedWeek,
      updateWorkoutName,
      addWorkout,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateBlock,
      updateSupersetExercise,
      updateSupersetSetCount,
      removeBlock,
      moveWorkoutToScheduledDay,
      moveSelectedWeekWorkoutToScheduledDay,
      duplicateSelectedWeekWorkout,
      deleteSelectedWeekWorkout,
      addSet,
      removeSet,
      updateSet,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      hasIncompleteSupersets,
      updateDraftMetadata,
    }),
    [
      programDraft,
      draftMetadata,
      hydrateProgramDraft,
      persistDraftNow,
      updateProgramMeta,
      setSelectedWeek,
      updateWorkoutName,
      addWorkout,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateBlock,
      updateSupersetExercise,
      updateSupersetSetCount,
      removeBlock,
      moveWorkoutToScheduledDay,
      moveSelectedWeekWorkoutToScheduledDay,
      duplicateSelectedWeekWorkout,
      deleteSelectedWeekWorkout,
      addSet,
      removeSet,
      updateSet,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      hasIncompleteSupersets,
      updateDraftMetadata,
    ]
  );

  return (
    <MultiWeekProgramContext.Provider value={value}>
      {children}
    </MultiWeekProgramContext.Provider>
  );
}

export function useMultiWeekProgram() {
  const context = useContext(MultiWeekProgramContext);

  if (!context) {
    throw new Error("useMultiWeekProgram must be used within MultiWeekProgramProvider");
  }

  return context;
}
