import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ManualProgramContext = createContext(null);

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultSingleBlock() {
  return {
    id: createId("block"),
    type: "single",
    exercise: "Barbell Back Squat",
    exerciseId: null,
    tempo: "3010",
    rest: "180s",
    sets: [
      { reps: 8, rpe: 2 },
      { reps: 8, rpe: 2 },
    ],
    notes: "",
  };
}

function createDefaultSupersetBlock() {
  return {
    id: createId("block"),
    type: "superset",
    rounds: 4,
    rest: "90s",
    exercises: [
      {
        label: "A1",
        name: "Leg Extension",
        exerciseId: null,
        tempo: "3010",
        sets: [
          { reps: 15, rpe: 3 },
          { reps: 12, rpe: 3 },
        ],
        notes: "",
      },
      {
        label: "A2",
        name: "Seated Leg Curl",
        exerciseId: null,
        tempo: "3010",
        sets: [
          { reps: 12, rpe: 3 },
          { reps: 10, rpe: 3 },
        ],
        notes: "",
      },
    ],
  };
}

function createSingleBlockFromExercise(exercise) {
  return {
    id: createId("block"),
    type: "single",
    exercise: exercise.name,
    exerciseId: exercise.exerciseId,
    tempo: "3010",
    rest: "180s",
    sets: [
      { reps: 8, rpe: 2 },
      { reps: 8, rpe: 2 },
    ],
    notes: "",
  };
}

function createEmptySupersetExercise(label) {
  return {
    label,
    name: "",
    exerciseId: null,
    tempo: "3010",
    sets: [
      { reps: 10, rpe: 3 },
      { reps: 10, rpe: 3 },
    ],
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
              rounds: block.sets.length || 2,
              rest: block.rest,
              exercises: [
                {
                  label: "A1",
                  name: block.exercise,
                  exerciseId: block.exerciseId ?? null,
                  tempo: block.tempo,
                  sets: block.sets,
                  notes: block.notes,
                },
                createEmptySupersetExercise("A2"),
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
                sets: [...block.sets, { reps: 8, rpe: 2 }],
              };
            }

            if (typeof exerciseIndex !== "number" || !block.exercises[exerciseIndex]) {
              return block;
            }

            const nextExercises = block.exercises.map((exercise, index) =>
              index === exerciseIndex
                ? { ...exercise, sets: [...exercise.sets, { reps: 10, rpe: 3 }] }
                : exercise
            );

            return { ...block, exercises: nextExercises };
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

            if (typeof exerciseIndex !== "number" || !block.exercises[exerciseIndex]) {
              return block;
            }

            const nextExercises = block.exercises.map((exercise, index) =>
              index === exerciseIndex
                ? {
                    ...exercise,
                    sets:
                      exercise.sets.length <= 1
                        ? exercise.sets
                        : exercise.sets.filter((_, idx) => idx !== setIndex),
                  }
                : exercise
            );

            return { ...block, exercises: nextExercises };
          }),
        };
      }),
    }));
  }, []);

  const updateSet = useCallback(
    (workoutId, blockId, setIndex, updates, exerciseIndex = null) => {
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
                    index === setIndex ? { ...set, ...updates } : set
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
                    idx === setIndex ? { ...set, ...updates } : set
                  ),
                };
              });

              return { ...block, exercises: nextExercises };
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

              return {
                ...block,
                exercises: block.exercises.map((exercise, index) =>
                  index === exerciseIndex ? { ...exercise, ...updates } : exercise
                ),
              };
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
