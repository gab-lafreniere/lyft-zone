import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useManualProgram } from "../context/ManualProgramContext";
import { fetchExercises } from "../services/api";

function toNumberOrEmpty(value) {
  if (value === "") {
    return "";
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? "" : parsed;
}

export default function ManualWorkoutEditor() {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showAddBlockSheet, setShowAddBlockSheet] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState({});
  const [collapsedSupersetExercises, setCollapsedSupersetExercises] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [exerciseResults, setExerciseResults] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(false);
  const [exerciseError, setExerciseError] = useState("");
  const [activeSearchTarget, setActiveSearchTarget] = useState(null);

  const navigate = useNavigate();
  const { workoutId } = useParams();
  const searchUiRef = useRef(null);
  const {
    programDraft,
    updateWorkoutName,
    updateBlock,
    updateSupersetExercise,
    removeBlock,
    addSet,
    updateSet,
    appendSingleBlockFromExercise,
    convertSingleBlockToSuperset,
    assignSupersetExercise,
    hasIncompleteSupersets,
  } = useManualProgram();

  const workout = useMemo(() => {
    if (!programDraft.workouts.length) {
      return null;
    }

    return (
      programDraft.workouts.find((item) => item.id === workoutId) ||
      programDraft.workouts[0]
    );
  }, [programDraft.workouts, workoutId]);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!workout && programDraft.isMultiWeek) {
      navigate("/program/manual-builder-multi", { replace: true });
      return;
    }

    if (!workout) {
      navigate("/program/manual-builder", { replace: true });
    }
  }, [navigate, programDraft.isMultiWeek, workout]);

  const hasIncompleteSuperset = hasIncompleteSupersets(workout?.id ?? null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadExercises() {
      setIsLoadingExercises(true);
      setExerciseError("");

      try {
        const results = await fetchExercises({
          q: debouncedSearchQuery,
          limit: 25,
        });

        if (!cancelled) {
          setExerciseResults(results);
        }
      } catch (error) {
        if (!cancelled) {
          setExerciseResults([]);
          setExerciseError(error.message || "Unable to load exercises.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingExercises(false);
        }
      }
    }

    loadExercises();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery]);

  useEffect(() => {
    if (!hasIncompleteSuperset) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasIncompleteSuperset]);

  useEffect(() => {
    if (!workout || !activeSearchTarget) {
      return;
    }

    const targetBlockExists = workout.blocks.some(
      (block) =>
        block.id === activeSearchTarget.blockId &&
        block.type === "superset" &&
        block.exercises[activeSearchTarget.exerciseIndex]
    );

    if (!targetBlockExists) {
      setActiveSearchTarget(null);
    }
  }, [activeSearchTarget, workout]);

  useEffect(() => {
    if (!activeSearchTarget) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (searchUiRef.current?.contains(event.target)) {
        return;
      }

      const targetNode = document.querySelector(
        `[data-superset-block="${activeSearchTarget.blockId}"]`
      );

      if (targetNode?.contains(event.target)) {
        return;
      }

      setActiveSearchTarget(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [activeSearchTarget]);

  if (!workout) {
    return null;
  }

  const handleBack = () => {
    if (programDraft.isMultiWeek) {
      navigate("/program/manual-builder-multi");
      return;
    }

    navigate("/program/manual-builder");
  };

  const toggleBlock = (blockId) => {
    setCollapsedBlocks((prev) => ({
      ...prev,
      [blockId]: !prev[blockId],
    }));
  };

  const toggleSupersetExercise = (blockId, exerciseIndex) => {
    const key = `${blockId}-${exerciseIndex}`;
    setCollapsedSupersetExercises((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleExerciseResultClick = (exercise) => {
    if (activeSearchTarget) {
      assignSupersetExercise(
        workout.id,
        activeSearchTarget.blockId,
        activeSearchTarget.exerciseIndex,
        exercise
      );
      setActiveSearchTarget(null);
      return;
    }

    appendSingleBlockFromExercise(workout.id, exercise);
  };

  const activateA2Selection = (blockId, exerciseIndex) => {
    setActiveSearchTarget({
      type: "superset-slot",
      blockId,
      exerciseIndex,
    });
  };

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-primary/10 bg-background-light/80 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-1 items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center rounded-full p-2 transition-colors hover:bg-primary/10"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-slate-700">
              arrow_back
            </span>
          </button>

          <div className="flex-1">
            <input
              type="text"
              value={workout.name}
              onChange={(e) => updateWorkoutName(workout.id, e.target.value)}
              placeholder="Workout Name"
              className="w-full border-none bg-transparent p-0 text-lg font-bold text-slate-900 focus:ring-0"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4">
        <div className="mb-6 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Workout Analytics
            </h4>
            <span className="material-symbols-outlined text-sm text-slate-400">
              insights
            </span>
          </div>

          <div className="mb-6 grid grid-cols-4 gap-4">
            {[
              { label: "Exercises", value: "06", width: "w-2/3" },
              { label: "Sets", value: "18", width: "w-3/4" },
              { label: "Dur.", value: "65m", width: "w-1/2" },
              { label: "TUT", value: "42m", width: "w-1/3" },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <p className="text-[10px] font-medium uppercase text-slate-500">
                  {item.label}
                </p>
                <p className="text-lg font-bold text-primary">{item.value}</p>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full bg-primary ${item.width}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Muscular Distribution
            </p>

            {[
              { label: "Quads", value: "45%", width: "45%" },
              { label: "Glutes", value: "35%", width: "35%" },
              { label: "Hamstrings", value: "20%", width: "20%" },
            ].map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-slate-600">{item.label}</span>
                  <span className="text-primary">{item.value}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-primary" style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          ref={searchUiRef}
          className="mb-6 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-md"
        >
          <div className="relative mb-3">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">
              search
            </span>
            <input
              type="text"
              placeholder="Search exercises..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border-none bg-slate-50 py-2 pl-10 pr-4 text-sm transition-all focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {activeSearchTarget && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
              <p className="text-xs font-semibold text-primary">
                Selecting exercise for A2
              </p>
              <button
                type="button"
                onClick={() => setActiveSearchTarget(null)}
                className="text-xs font-bold uppercase tracking-wider text-primary"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase text-primary"
            >
              Muscle
              <span className="material-symbols-outlined text-xs">
                keyboard_arrow_down
              </span>
            </button>

            <button
              type="button"
              className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-500"
            >
              Equipment
              <span className="material-symbols-outlined text-xs">
                keyboard_arrow_down
              </span>
            </button>

            <button
              type="button"
              className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-500"
            >
              Type
              <span className="material-symbols-outlined text-xs">
                keyboard_arrow_down
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Exercise library
            </p>

            {isLoadingExercises && (
              <p className="px-2 py-3 text-sm text-slate-500">Loading exercises...</p>
            )}

            {!isLoadingExercises && exerciseError && (
              <p className="px-2 py-3 text-sm text-red-500">{exerciseError}</p>
            )}

            {!isLoadingExercises && !exerciseError && exerciseResults.length === 0 && (
              <p className="px-2 py-3 text-sm text-slate-500">No exercises found.</p>
            )}

            {!isLoadingExercises &&
              !exerciseError &&
              exerciseResults.map((exercise) => (
              <button
                key={exercise.exerciseId}
                type="button"
                onClick={() => handleExerciseResultClick(exercise)}
                className="group flex w-full items-center justify-between rounded-lg p-2 text-left transition-colors hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-bold text-slate-700">
                    {exercise.name}
                  </p>
                </div>

                <span className="material-symbols-outlined text-slate-300 transition-colors group-hover:text-primary">
                  add_circle
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/5"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            Create custom exercise
          </button>
        </div>

        <div className="space-y-6 pb-28">
          {workout.blocks.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-6 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-700">
                No exercise blocks yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Use the search bar above to add the first exercise.
              </p>
            </div>
          )}
          {workout.blocks.map((block) => {
            const isCollapsed = !!collapsedBlocks[block.id];

            if (block.type === "superset") {
              const isIncompleteSuperset = block.exercises.some(
                (exercise) => !String(exercise.exerciseId || "").trim()
              );

              return (
                <section
                  key={block.id}
                  data-superset-block={block.id}
                  className={[
                    "overflow-hidden rounded-xl border-2 shadow-sm",
                    isIncompleteSuperset
                      ? "border-amber-300 bg-amber-50/70"
                      : "border-primary/20 bg-primary/5",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "flex items-center justify-between gap-2 border-b p-4",
                      isIncompleteSuperset
                        ? "border-amber-200 bg-amber-100/70"
                        : "border-primary/10 bg-primary/10",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined cursor-grab text-primary/60">
                        drag_indicator
                      </span>
                      <div className="flex flex-col">
                        <h3 className="font-bold leading-tight text-slate-900">
                          Superset Block
                        </h3>
                        {isIncompleteSuperset && (
                          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                            Incomplete superset
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleBlock(block.id)}
                        className="text-slate-400 transition-colors hover:text-primary"
                      >
                        <span className="material-symbols-outlined">
                          {isCollapsed ? "expand_more" : "expand_less"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => removeBlock(workout.id, block.id)}
                        className="text-slate-400 transition-colors hover:text-red-500"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="space-y-4 p-4">
                      {block.exercises.map((exercise, exerciseIndex) => {
                        const exerciseKey = `${block.id}-${exerciseIndex}`;
                        const exerciseCollapsed = !!collapsedSupersetExercises[exerciseKey];

                        return (
                          <div key={exerciseKey}>
                            <div className="rounded-t-lg border border-primary/10 border-b-0 bg-white p-3">
                              <div className="flex items-start gap-3">
                                <div className="mt-1 shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-black text-slate-900">
                                  {exercise.label}
                                </div>

                                <div className="flex-1">
                                  {!exercise.exerciseId && exerciseIndex === 1 ? (
                                    <button
                                      type="button"
                                      data-a2-target={`${block.id}-${exerciseIndex}`}
                                      onClick={() => activateA2Selection(block.id, exerciseIndex)}
                                      className={[
                                        "w-full rounded-lg border border-dashed px-3 py-2 text-left text-sm font-bold transition-colors",
                                        activeSearchTarget?.blockId === block.id &&
                                        activeSearchTarget?.exerciseIndex === exerciseIndex
                                          ? "border-primary bg-primary/10 text-primary"
                                          : "border-amber-300 bg-amber-50 text-amber-700 hover:border-primary/40 hover:text-primary",
                                      ].join(" ")}
                                    >
                                      Select second exercise
                                    </button>
                                  ) : (
                                    <input
                                      type="text"
                                      value={exercise.name}
                                      onChange={(e) =>
                                        updateSupersetExercise(workout.id, block.id, exerciseIndex, {
                                          name: e.target.value,
                                        })
                                      }
                                      className="w-full border-none bg-transparent p-0 text-sm font-bold text-slate-900 focus:ring-0"
                                    />
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleSupersetExercise(block.id, exerciseIndex)
                                  }
                                  className="text-slate-300 hover:text-slate-500"
                                >
                                  <span className="material-symbols-outlined text-lg">
                                    {exerciseCollapsed ? "expand_more" : "expand_less"}
                                  </span>
                                </button>
                              </div>
                            </div>

                            {!exerciseCollapsed && (
                              <div className="rounded-b-lg border border-primary/10 border-t-0 bg-white p-3">
                                <div className="mb-4 border-b border-slate-100 bg-slate-50/50 px-2 py-3">
                                  <div className="space-y-1">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Tempo
                                    </label>
                                    <input
                                      type="text"
                                      value={exercise.tempo}
                                      onChange={(e) =>
                                        updateSupersetExercise(
                                          workout.id,
                                          block.id,
                                          exerciseIndex,
                                          { tempo: e.target.value }
                                        )
                                      }
                                      className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                                    />
                                  </div>
                                </div>

                                <div className="mb-2 grid grid-cols-11 gap-2 px-2">
                                  <div className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Set</div>
                                  <div className="col-span-5 text-[10px] font-bold uppercase text-slate-400">Reps</div>
                                  <div className="col-span-4 text-[10px] font-bold uppercase text-slate-400">RPE (optional)</div>
                                </div>

                                <div className="space-y-2">
                                  {exercise.sets.map((set, setIndex) => (
                                    <div
                                      key={`${exerciseKey}-set-${setIndex}`}
                                      className="grid grid-cols-11 items-center gap-2 rounded-lg bg-white p-2"
                                    >
                                      <div className="col-span-2 text-sm font-bold text-slate-500">{setIndex + 1}</div>
                                      <div className="col-span-5">
                                        <input
                                          type="number"
                                          value={set.reps}
                                          onChange={(e) =>
                                            updateSet(
                                              workout.id,
                                              block.id,
                                              setIndex,
                                              { reps: toNumberOrEmpty(e.target.value) },
                                              exerciseIndex
                                            )
                                          }
                                          className="w-full rounded border-slate-200 bg-slate-50 p-1.5 text-sm focus:border-primary focus:ring-primary"
                                        />
                                      </div>
                                      <div className="col-span-4">
                                        <input
                                          type="number"
                                          value={set.rpe}
                                          onChange={(e) =>
                                            updateSet(
                                              workout.id,
                                              block.id,
                                              setIndex,
                                              { rpe: toNumberOrEmpty(e.target.value) },
                                              exerciseIndex
                                            )
                                          }
                                          className="w-full rounded border-slate-200 bg-slate-50 p-1.5 text-sm focus:border-primary focus:ring-primary"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addSet(workout.id, block.id, exerciseIndex)}
                                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm font-medium text-slate-500 transition-all hover:border-primary/50 hover:text-primary"
                                >
                                  <span className="material-symbols-outlined text-sm">add</span>
                                  Add Set
                                </button>

                                <div className="mt-4 border-t border-slate-100 pt-4">
                                  <textarea
                                    value={exercise.notes || ""}
                                    onChange={(e) =>
                                      updateSupersetExercise(
                                        workout.id,
                                        block.id,
                                        exerciseIndex,
                                        { notes: e.target.value }
                                      )
                                    }
                                    placeholder="Execution focus (e.g. 2s pause at peak contraction)..."
                                    className="min-h-[60px] w-full resize-none rounded-lg border-none bg-slate-50 p-3 text-sm focus:ring-1 focus:ring-primary"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div className="space-y-1">
                          <label className="px-1 text-[10px] font-bold uppercase text-slate-500">
                            Round Count
                          </label>

                          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(workout.id, block.id, {
                                  rounds: Math.max(1, (block.rounds || 1) - 1),
                                })
                              }
                              className="border-r border-slate-200 px-3 py-2 text-slate-500 hover:bg-slate-50"
                            >
                              -
                            </button>
                            <span className="flex-1 text-center text-sm font-bold">{block.rounds}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(workout.id, block.id, {
                                  rounds: (block.rounds || 0) + 1,
                                })
                              }
                              className="border-l border-slate-200 px-3 py-2 text-slate-500 hover:bg-slate-50"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="px-1 text-[10px] font-bold uppercase text-slate-500">
                            Rest Interval
                          </label>

                          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <input
                              type="text"
                              value={block.rest}
                              onChange={(e) =>
                                updateBlock(workout.id, block.id, { rest: e.target.value })
                              }
                              className="w-full border-none bg-transparent py-2 text-center text-sm font-bold focus:ring-0"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            }

            return (
              <section
                key={block.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 p-4">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined cursor-grab text-slate-400">
                      drag_indicator
                    </span>
                    <input
                      type="text"
                      value={block.exercise}
                      onChange={(e) =>
                        updateBlock(workout.id, block.id, { exercise: e.target.value })
                      }
                      className="border-none bg-transparent p-0 font-bold text-slate-900 focus:ring-0"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => convertSingleBlockToSuperset(workout.id, block.id)}
                      className="text-slate-400 transition-colors hover:text-primary"
                      aria-label="Convert to superset"
                    >
                      <span className="material-symbols-outlined">layers</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleBlock(block.id)}
                      className="text-slate-400 transition-colors hover:text-primary"
                    >
                      <span className="material-symbols-outlined">
                        {isCollapsed ? "expand_more" : "expand_less"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => removeBlock(workout.id, block.id)}
                      className="text-slate-400 transition-colors hover:text-red-500"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className="grid grid-cols-2 gap-4 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Tempo
                        </label>
                        <input
                          type="text"
                          value={block.tempo}
                          onChange={(e) =>
                            updateBlock(workout.id, block.id, { tempo: e.target.value })
                          }
                          className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Rest
                        </label>
                        <input
                          type="text"
                          value={block.rest}
                          onChange={(e) =>
                            updateBlock(workout.id, block.id, { rest: e.target.value })
                          }
                          className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="mb-2 grid grid-cols-11 gap-2 px-2">
                        <div className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Set</div>
                        <div className="col-span-5 text-[10px] font-bold uppercase text-slate-400">Reps</div>
                        <div className="col-span-4 text-[10px] font-bold uppercase text-slate-400">RPE (optional)</div>
                      </div>

                      <div className="space-y-2">
                        {block.sets.map((set, setIndex) => (
                          <div
                            key={`${block.id}-set-${setIndex}`}
                            className="grid grid-cols-11 items-center gap-2 rounded-lg bg-slate-50 p-2"
                          >
                            <div className="col-span-2 text-sm font-bold text-slate-500">{setIndex + 1}</div>
                            <div className="col-span-5">
                              <input
                                type="number"
                                value={set.reps}
                                onChange={(e) =>
                                  updateSet(workout.id, block.id, setIndex, {
                                    reps: toNumberOrEmpty(e.target.value),
                                  })
                                }
                                className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-4">
                              <input
                                type="number"
                                value={set.rpe}
                                onChange={(e) =>
                                  updateSet(workout.id, block.id, setIndex, {
                                    rpe: toNumberOrEmpty(e.target.value),
                                  })
                                }
                                className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => addSet(workout.id, block.id)}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm font-medium text-slate-500 transition-all hover:border-primary/50 hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-sm">add</span>
                        Add Set
                      </button>

                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <textarea
                          value={block.notes || ""}
                          onChange={(e) =>
                            updateBlock(workout.id, block.id, { notes: e.target.value })
                          }
                          placeholder="Add technical notes (e.g., focus on depth, slow eccentric)..."
                          className="min-h-[60px] w-full resize-none rounded-lg border-none bg-slate-50 p-3 text-sm focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-primary shadow-lg backdrop-blur-md transition-transform hover:scale-110"
        >
          <span className="material-symbols-outlined">arrow_upward</span>
        </button>
      )}

      {showAddBlockSheet && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full space-y-4 rounded-t-3xl bg-white p-6">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

            <div className="flex items-center justify-between">
              <h4 className="text-xl font-bold">Add Exercise Block</h4>
              <button
                type="button"
                onClick={() => setShowAddBlockSheet(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                disabled
                className="rounded-xl border-2 border-slate-100 bg-slate-50 p-4 text-left opacity-50"
              >
                <span className="material-symbols-outlined mb-2 text-primary">exercise</span>
                <p className="font-bold">Single</p>
                <p className="text-xs text-slate-500">Add from search only</p>
              </button>

              <button
                type="button"
                disabled
                className="rounded-xl border-2 border-slate-100 bg-slate-50 p-4 text-left opacity-50"
              >
                <span className="material-symbols-outlined mb-2 text-slate-400">layers</span>
                <p className="font-bold">Superset</p>
                <p className="text-xs text-slate-500">Convert an existing single block</p>
              </button>

              <button
                type="button"
                className="rounded-xl border-2 border-slate-100 p-4 text-left"
              >
                <span className="material-symbols-outlined mb-2 text-slate-400">bolt</span>
                <p className="font-bold">Circuit</p>
                <p className="text-xs text-slate-500">Rapid fire routine</p>
              </button>

              <button
                type="button"
                className="rounded-xl border-2 border-slate-100 p-4 text-left"
              >
                <span className="material-symbols-outlined mb-2 text-slate-400">timer</span>
                <p className="font-bold">EMOM</p>
                <p className="text-xs text-slate-500">Every min on the min</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
