import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ManualProgramContext = createContext(null);

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
    exercise: "Barbell Back Squat",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    rest: "120s",
    sets: createSetRows(2, createSingleSetRow),
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
      {
        label: "A1",
        name: "Leg Extension",
        exerciseId: null,
        bodyParts: [],
        muscleFocus: [],
        tempo: "3010",
        sets: [
          { reps: 15, rpe: 2 },
          { reps: 12, rpe: 2 },
        ],
        notes: "",
      },
      {
        label: "A2",
        name: "Seated Leg Curl",
        exerciseId: null,
        bodyParts: [],
        muscleFocus: [],
        tempo: "3010",
        sets: [
          { reps: 12, rpe: 2 },
          { reps: 10, rpe: 2 },
        ],
        notes: "",
      },
    ],
  });
}

function createSingleBlockFromExercise(exercise) {
  return {
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

function createWorkout(name, withTemplateBlocks = true) {
  return {
    id: createId("workout"),
    name,
    blocks: withTemplateBlocks
      ? [createDefaultSingleBlock(), createDefaultSupersetBlock()]
      : [],
  };
}

function createInitialDraft() {
  return {
    programName: "",
    sessionsPerWeek: 4,
    programLength: 8,
    startDate: null,
    endDate: null,
    isMultiWeek: false,
    selectedWeek: 1,
    workouts: [createWorkout("Workout 1", false)],
  };
}

export function ManualProgramProvider({ children }) {
  const [programDraft, setProgramDraft] = useState(createInitialDraft);

  const updateSupersetSetCount = useCallback((workoutId, blockId, nextCount) => {
    const safeCount = Math.max(1, nextCount || 1);

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
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
    }));
  }, []);

  const createProgramDraft = useCallback((payload = {}) => {
    const sessions = Math.max(1, Math.min(7, payload.sessionsPerWeek ?? 4));
    const workouts = Array.from({ length: sessions }, (_, index) =>
      createWorkout(`Workout ${index + 1}`, false)
    );

    setProgramDraft({
      programName: payload.programName || "New Program",
      sessionsPerWeek: sessions,
      programLength: payload.programLength ?? 8,
      startDate: payload.startDate ?? null,
      endDate: payload.endDate ?? null,
      isMultiWeek: payload.isMultiWeek ?? false,
      selectedWeek: payload.selectedWeek ?? 1,
      workouts,
    });
  }, []);

  const updateProgramMeta = useCallback((updates = {}) => {
    setProgramDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const addWorkout = useCallback((name) => {
    setProgramDraft((prev) => {
      const nextIndex = prev.workouts.length + 1;
      const workoutName = name || `Workout ${nextIndex}`;
      return {
        ...prev,
        sessionsPerWeek: Math.min(7, prev.workouts.length + 1),
        workouts: [...prev.workouts, createWorkout(workoutName, false)],
      };
    });
  }, []);

  const updateWorkoutName = useCallback((workoutId, name) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId ? { ...workout, name } : workout
      ),
    }));
  }, []);

  const appendSingleBlockFromExercise = useCallback((workoutId, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: [...workout.blocks, createSingleBlockFromExercise(exercise)],
            }
          : workout
      ),
    }));
  }, []);

  const convertSingleBlockToSuperset = useCallback((workoutId, blockId) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
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
    }));
  }, []);

  const assignSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
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
                      muscleFocus: Array.isArray(exercise.muscleFocus)
                        ? exercise.muscleFocus
                        : [],
                    }
                  : entry
              ),
            };
          }),
        };
      }),
    }));
  }, []);

  const addBlock = useCallback((workoutId, type = "single") => {
    const block = type === "superset" ? createDefaultSupersetBlock() : createDefaultSingleBlock();

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? { ...workout, blocks: [...workout.blocks, block] }
          : workout
      ),
    }));
  }, []);

  const removeBlock = useCallback((workoutId, blockId) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: workout.blocks.filter((block) => block.id !== blockId),
            }
          : workout
      ),
    }));
  }, []);

  const addSet = useCallback((workoutId, blockId, exerciseIndex = null) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
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
                sets: [...block.sets, createSingleSetRow()],
              };
            }

            return normalizeSupersetBlock({
              ...block,
              sets: (block.sets || 1) + 1,
            });
          }),
        };
      }),
    }));
  }, []);

  const removeSet = useCallback((workoutId, blockId, setIndex, exerciseIndex = null) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
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
    }));
  }, []);

  const updateSet = useCallback(
    (workoutId, blockId, setIndex, updates, exerciseIndex = null) => {
      const normalizedUpdates = normalizeSetUpdates(updates);

      setProgramDraft((prev) => ({
        ...prev,
        workouts: prev.workouts.map((workout) => {
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

              const nextExercises = block.exercises.map((exercise, index) => {
                if (index !== exerciseIndex) {
                  return exercise;
                }

                return {
                  ...exercise,
                  sets: exercise.sets.map((set, idx) =>
                    idx === setIndex ? { ...set, ...normalizedUpdates } : set
                  ),
                };
              });

              return normalizeSupersetBlock({ ...block, exercises: nextExercises });
            }),
          };
        }),
      }));
    },
    []
  );

  const updateBlock = useCallback((workoutId, blockId, updates) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: workout.blocks.map((block) =>
                block.id === blockId ? { ...block, ...updates } : block
              ),
            }
          : workout
      ),
    }));
  }, []);

  const updateSupersetExercise = useCallback(
    (workoutId, blockId, exerciseIndex, updates) => {
      setProgramDraft((prev) => ({
        ...prev,
        workouts: prev.workouts.map((workout) => {
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
      }));
    },
    []
  );

  const hasIncompleteSupersets = useCallback(
    (workoutId = null) => {
      return programDraft.workouts.some((workout) => {
        if (workoutId && workout.id !== workoutId) {
          return false;
        }

        return workout.blocks.some(
          (block) =>
            block.type === "superset" &&
            block.exercises.some((exercise) => !String(exercise.exerciseId || "").trim())
        );
      });
    },
    [programDraft.workouts]
  );

  const toggleMultiWeek = useCallback((value) => {
    setProgramDraft((prev) => ({
      ...prev,
      isMultiWeek: typeof value === "boolean" ? value : !prev.isMultiWeek,
    }));
  }, []);

  const setSelectedWeek = useCallback((week) => {
    setProgramDraft((prev) => ({ ...prev, selectedWeek: week }));
  }, []);

  const value = useMemo(
    () => ({
      programDraft,
      createProgramDraft,
      updateProgramMeta,
      addWorkout,
      updateWorkoutName,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      addBlock,
      removeBlock,
      addSet,
      removeSet,
      updateSupersetSetCount,
      updateSet,
      toggleMultiWeek,
      setSelectedWeek,
      updateBlock,
      updateSupersetExercise,
      hasIncompleteSupersets,
    }),
    [
      programDraft,
      createProgramDraft,
      updateProgramMeta,
      addWorkout,
      updateWorkoutName,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      addBlock,
      removeBlock,
      addSet,
      removeSet,
      updateSupersetSetCount,
      updateSet,
      toggleMultiWeek,
      setSelectedWeek,
      updateBlock,
      updateSupersetExercise,
      hasIncompleteSupersets,
    ]
  );

  return (
    <ManualProgramContext.Provider value={value}>
      {children}
    </ManualProgramContext.Provider>
  );
}

export function useManualProgram() {
  const context = useContext(ManualProgramContext);

  if (!context) {
    throw new Error("useManualProgram must be used within ManualProgramProvider");
  }

  return context;
}
