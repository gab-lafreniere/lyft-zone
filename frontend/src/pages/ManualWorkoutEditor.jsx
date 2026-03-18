import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useManualProgram } from "../context/ManualProgramContext";
import { fetchExercises } from "../services/api";
import { computeWorkoutMetrics } from "../utils/workoutMetrics";

function normalizeTempoValue(value) {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .split("")
    .filter((digit) => digit >= "0" && digit <= "5")
    .join("")
    .slice(0, 4);

  if (!digits) {
    return "";
  }

  if (digits.length === 3) {
    return `${digits}0`;
  }

  return digits;
}

function formatTempoValue(value) {
  const normalized = normalizeTempoValue(value);

  if (!normalized) {
    return "";
  }

  return normalized.split("").join("-");
}

function normalizeMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getFieldMatchRank(values, query) {
  const normalizedValues = Array.isArray(values)
    ? values.map(normalizeMatchValue).filter(Boolean)
    : [normalizeMatchValue(values)].filter(Boolean);

  let containsMatch = null;

  for (const value of normalizedValues) {
    if (!value.includes(query)) {
      continue;
    }

    if (value.startsWith(query)) {
      return 0;
    }

    if (containsMatch == null) {
      containsMatch = 1;
    }
  }

  return containsMatch;
}

function rankExercises(exercises, query) {
  const normalizedQuery = normalizeMatchValue(query);

  if (!normalizedQuery) {
    return exercises;
  }

  return exercises
    .map((exercise, originalIndex) => {
      const nameRank = getFieldMatchRank(exercise.name, normalizedQuery);
      const aliasesRank = getFieldMatchRank(exercise.aliases, normalizedQuery);
      const keywordsRank = getFieldMatchRank(exercise.keywords, normalizedQuery);

      let tier = 3;
      let startsWithRank = 1;

      if (nameRank != null) {
        tier = 0;
        startsWithRank = nameRank;
      } else if (aliasesRank != null) {
        tier = 1;
        startsWithRank = aliasesRank;
      } else if (keywordsRank != null) {
        tier = 2;
        startsWithRank = keywordsRank;
      }

      return {
        exercise,
        originalIndex,
        tier,
        startsWithRank,
        normalizedName: normalizeMatchValue(exercise.name),
      };
    })
    .sort((left, right) => {
      if (left.tier !== right.tier) {
        return left.tier - right.tier;
      }

      if (left.startsWithRank !== right.startsWithRank) {
        return left.startsWithRank - right.startsWithRank;
      }

      if (left.normalizedName !== right.normalizedName) {
        return left.normalizedName.localeCompare(right.normalizedName);
      }

      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.exercise);
}

const FILTER_OPTIONS = {
  muscle: ["Chest", "Back", "Quads"],
  equipment: ["Barbell", "Dumbbell", "Machine"],
  type: ["Compound", "Isolation"],
};

const FILTER_LABELS = {
  muscle: "Muscle",
  equipment: "Equipment",
  type: "Type",
};

const REST_OPTIONS = ["30s", "45s", "60s", "75s", "90s", "120s", "150s", "180s", "240s", "300s"];
const RIR_CYCLE = [2, 1, 0, 4, 3];

function getNextRestValue(currentValue, direction) {
  const currentIndex = Math.max(0, REST_OPTIONS.indexOf(currentValue));
  const nextIndex = Math.min(
    REST_OPTIONS.length - 1,
    Math.max(0, currentIndex + direction)
  );

  return REST_OPTIONS[nextIndex];
}

function getNextRirValue(currentValue) {
  const currentIndex = RIR_CYCLE.indexOf(Number(currentValue));
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  return RIR_CYCLE[(safeIndex + 1) % RIR_CYCLE.length];
}

function getRirButtonClasses(value) {
  switch (Number(value)) {
    case 0:
      return "border-amber-200 bg-amber-100 text-amber-800";
    case 1:
      return "border-amber-100 bg-amber-50 text-amber-700";
    case 3:
      return "border-sky-100 bg-sky-50 text-sky-700";
    case 4:
      return "border-slate-200 bg-slate-200 text-slate-700";
    case 2:
    default:
      return "border-primary/20 bg-primary/10 text-primary";
  }
}

function formatMinutes(value) {
  return `${value}m`;
}

function getMetricBarWidth(value, maxValue) {
  if (value <= 0 || maxValue <= 0) {
    return "0%";
  }

  return `${Math.max(8, Math.min(100, (value / maxValue) * 100))}%`;
}

export default function ManualWorkoutEditor() {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showAddBlockSheet, setShowAddBlockSheet] = useState(false);
  const [openBlockId, setOpenBlockId] = useState(null);
  const [openSupersetExerciseByBlock, setOpenSupersetExerciseByBlock] = useState({});
  const [isWorkoutTitleEditing, setIsWorkoutTitleEditing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState(null);
  const [pendingScrollToLastBlock, setPendingScrollToLastBlock] = useState(false);
  const [tempoDrafts, setTempoDrafts] = useState({});
  const [repsDrafts, setRepsDrafts] = useState({});
  const [searchFilters, setSearchFilters] = useState({
    muscle: "",
    equipment: "",
    type: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [exerciseResults, setExerciseResults] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(false);
  const [exerciseError, setExerciseError] = useState("");
  const [activeSearchTarget, setActiveSearchTarget] = useState(null);

  const navigate = useNavigate();
  const { workoutId } = useParams();
  const searchUiRef = useRef(null);
  const workoutTitleInputRef = useRef(null);
  const {
    programDraft,
    updateWorkoutName,
    updateBlock,
    updateSupersetExercise,
    updateSupersetSetCount,
    removeBlock,
    addSet,
    removeSet,
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
  const shouldShowSearchPanel =
    isSearchOpen || Boolean(debouncedSearchQuery) || Boolean(activeSearchTarget);
  const rankedExerciseResults = useMemo(
    () => rankExercises(exerciseResults, debouncedSearchQuery),
    [exerciseResults, debouncedSearchQuery]
  );
  const workoutMetrics = useMemo(() => computeWorkoutMetrics(workout), [workout]);
  const workoutStatItems = useMemo(
    () => [
      {
        label: "Exercises",
        value: String(workoutMetrics.exerciseCount),
        width: getMetricBarWidth(workoutMetrics.exerciseCount, 12),
      },
      {
        label: "Sets",
        value: String(workoutMetrics.setCount),
        width: getMetricBarWidth(workoutMetrics.setCount, 32),
      },
      {
        label: "Dur.",
        value: formatMinutes(workoutMetrics.estimatedDurationMinutes),
        width: getMetricBarWidth(workoutMetrics.estimatedDurationMinutes, 120),
      },
      {
        label: "TUT",
        value: formatMinutes(workoutMetrics.totalTUTMinutes),
        width: getMetricBarWidth(workoutMetrics.totalTUTMinutes, 60),
      },
    ],
    [workoutMetrics]
  );

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
      if (!debouncedSearchQuery) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [activeSearchTarget, debouncedSearchQuery]);

  useEffect(() => {
    if (!shouldShowSearchPanel || activeSearchTarget) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (searchUiRef.current?.contains(event.target)) {
        return;
      }

      setIsSearchOpen(false);
      setOpenFilterMenu(null);
      if (searchQuery.trim()) {
        setSearchQuery("");
        setDebouncedSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [shouldShowSearchPanel, activeSearchTarget, searchQuery]);

  useEffect(() => {
    if (!isWorkoutTitleEditing) {
      return;
    }

    workoutTitleInputRef.current?.focus();
    workoutTitleInputRef.current?.select();
  }, [isWorkoutTitleEditing]);

  useEffect(() => {
    if (!pendingScrollToLastBlock || !workout?.blocks.length) {
      return;
    }

    const lastBlock = workout.blocks[workout.blocks.length - 1];
    setOpenBlockId(lastBlock.id);

    const frameId = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-block-id="${lastBlock.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingScrollToLastBlock(false);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [pendingScrollToLastBlock, workout]);

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
    setOpenBlockId((prev) => (prev === blockId ? null : blockId));
  };

  const toggleSupersetExercise = (blockId, exerciseIndex) => {
    setOpenSupersetExerciseByBlock((prev) => ({
      ...prev,
      [blockId]: prev[blockId] === exerciseIndex ? null : exerciseIndex,
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
      setSearchQuery("");
      setDebouncedSearchQuery("");
      setIsSearchOpen(false);
      setOpenFilterMenu(null);
      return;
    }

    appendSingleBlockFromExercise(workout.id, exercise);
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setIsSearchOpen(false);
    setOpenFilterMenu(null);
    setPendingScrollToLastBlock(true);
  };

  const activateA2Selection = (blockId, exerciseIndex) => {
    setActiveSearchTarget({
      type: "superset-slot",
      blockId,
      exerciseIndex,
    });
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
  };

  const handleWorkoutTitleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      setIsWorkoutTitleEditing(false);
    }
  };

  const handleFilterValueSelect = (filterKey, value) => {
    setSearchFilters((prev) => ({ ...prev, [filterKey]: value }));
    setOpenFilterMenu(null);
  };

  const handleFilterClear = (event, filterKey) => {
    event.stopPropagation();
    setSearchFilters((prev) => ({ ...prev, [filterKey]: "" }));
    setOpenFilterMenu(null);
  };

  const getTempoFieldKey = (blockId, exerciseIndex = null) =>
    exerciseIndex == null ? blockId : `${blockId}-${exerciseIndex}`;

  const getRepsFieldKey = (blockId, setIndex, exerciseIndex = null) =>
    exerciseIndex == null
      ? `${blockId}-${setIndex}`
      : `${blockId}-${exerciseIndex}-${setIndex}`;

  const beginTempoEditing = (blockId, currentValue, exerciseIndex = null) => {
    const fieldKey = getTempoFieldKey(blockId, exerciseIndex);
    setTempoDrafts((prev) => ({
      ...prev,
      [fieldKey]: String(currentValue || "").replace(/\D/g, "").slice(0, 4),
    }));
  };

  const changeTempoDraft = (blockId, value, exerciseIndex = null) => {
    const fieldKey = getTempoFieldKey(blockId, exerciseIndex);
    const nextValue = String(value || "")
      .replace(/\D/g, "")
      .split("")
      .filter((digit) => digit >= "0" && digit <= "5")
      .join("")
      .slice(0, 4);

    setTempoDrafts((prev) => ({
      ...prev,
      [fieldKey]: nextValue,
    }));
  };

  const commitTempoDraft = (workoutId, blockId, currentValue, exerciseIndex = null) => {
    const fieldKey = getTempoFieldKey(blockId, exerciseIndex);
    const draftValue = tempoDrafts[fieldKey];
    const normalizedTempo = normalizeTempoValue(
      draftValue == null ? currentValue : draftValue
    );

    if (exerciseIndex == null) {
      updateBlock(workoutId, blockId, { tempo: normalizedTempo });
    } else {
      updateSupersetExercise(workoutId, blockId, exerciseIndex, {
        tempo: normalizedTempo,
      });
    }

    setTempoDrafts((prev) => {
      const nextDrafts = { ...prev };
      delete nextDrafts[fieldKey];
      return nextDrafts;
    });
  };

  const beginRepsEditing = (blockId, setIndex, currentValue, exerciseIndex = null) => {
    const fieldKey = getRepsFieldKey(blockId, setIndex, exerciseIndex);
    setRepsDrafts((prev) => ({
      ...prev,
      [fieldKey]:
        currentValue === "" || currentValue == null ? "" : String(currentValue),
    }));
  };

  const changeRepsDraft = (blockId, setIndex, value, exerciseIndex = null) => {
    const fieldKey = getRepsFieldKey(blockId, setIndex, exerciseIndex);
    setRepsDrafts((prev) => ({
      ...prev,
      [fieldKey]: String(value || "").replace(/\D/g, "").slice(0, 3),
    }));
  };

  const commitRepsDraft = (
    workoutId,
    blockId,
    setIndex,
    currentValue,
    exerciseIndex = null
  ) => {
    const fieldKey = getRepsFieldKey(blockId, setIndex, exerciseIndex);
    const draftValue = repsDrafts[fieldKey];
    const normalizedValue =
      draftValue == null
        ? currentValue
        : draftValue === ""
          ? ""
          : Math.min(100, Number(draftValue));

    updateSet(workoutId, blockId, setIndex, { reps: normalizedValue }, exerciseIndex);

    setRepsDrafts((prev) => {
      const nextDrafts = { ...prev };
      delete nextDrafts[fieldKey];
      return nextDrafts;
    });
  };

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-primary/10 bg-background-light/85 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-1 items-center gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center justify-center rounded-full p-2 transition-colors hover:bg-primary/10 select-none"
                aria-label="Back"
              >
                <span className="material-symbols-outlined text-slate-700">
                  arrow_back
                </span>
              </button>

              <div className="flex-1">
                {isWorkoutTitleEditing ? (
                  <input
                    ref={workoutTitleInputRef}
                    type="text"
                    value={workout.name}
                    onChange={(e) => updateWorkoutName(workout.id, e.target.value)}
                    onBlur={() => setIsWorkoutTitleEditing(false)}
                    onKeyDown={handleWorkoutTitleKeyDown}
                    placeholder="Workout Name"
                    className="w-full border-none bg-transparent p-0 text-lg font-bold text-slate-900 focus:ring-0"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="truncate text-lg font-bold text-slate-900">
                      {workout.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsWorkoutTitleEditing(true)}
                      className="rounded-full p-1 text-slate-400 transition-colors hover:bg-primary/10 hover:text-primary select-none"
                      aria-label="Edit workout title"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            ref={searchUiRef}
            className="mt-3 rounded-xl border border-slate-200 bg-white/85 p-3 shadow-sm"
          >
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">
                search
              </span>
              <input
                type="text"
                placeholder="Search exercises..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchOpen(true)}
                className="w-full rounded-lg border-none bg-slate-50 py-2.5 pl-10 pr-12 text-base transition-all focus:ring-2 focus:ring-primary/30"
              />
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 select-none"
                  aria-label="Clear search"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              )}
            </div>

            {shouldShowSearchPanel && (
              <div className="mt-3 space-y-2">
                {activeSearchTarget && (
                  <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
                    <p className="text-xs font-semibold text-primary">
                      Selecting exercise for A2
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveSearchTarget(null)}
                      className="text-[10px] font-bold uppercase tracking-wider text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(FILTER_LABELS).map(([filterKey, label]) => {
                      const isActive = Boolean(searchFilters[filterKey]);

                      return (
                        <button
                          key={filterKey}
                          type="button"
                          onClick={() =>
                            setOpenFilterMenu((prev) => (prev === filterKey ? null : filterKey))
                          }
                          className={[
                            "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors select-none",
                            isActive
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-slate-200 bg-slate-50 text-slate-500",
                          ].join(" ")}
                        >
                          <span>{searchFilters[filterKey] || label}</span>
                          {isActive ? (
                            <span
                              onClick={(event) => handleFilterClear(event, filterKey)}
                              className="material-symbols-outlined text-sm"
                            >
                              close
                            </span>
                          ) : (
                            <span className="material-symbols-outlined text-sm">
                              keyboard_arrow_down
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {openFilterMenu && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      {FILTER_OPTIONS[openFilterMenu].map((option) => {
                        const isSelected = searchFilters[openFilterMenu] === option;

                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => handleFilterValueSelect(openFilterMenu, option)}
                            className={[
                              "rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors select-none",
                              isSelected
                                ? "bg-primary text-slate-900"
                                : "bg-white text-slate-600",
                            ].join(" ")}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="max-h-[32dvh] overflow-y-auto">
                  {isLoadingExercises && (
                    <p className="px-2 py-3 text-sm text-slate-500">Loading exercises...</p>
                  )}

                  {!isLoadingExercises && exerciseError && (
                    <p className="px-2 py-3 text-sm text-red-500">{exerciseError}</p>
                  )}

                  {!isLoadingExercises && !exerciseError && rankedExerciseResults.length === 0 && (
                    <p className="px-2 py-3 text-sm text-slate-500">No exercises found.</p>
                  )}

                  {!isLoadingExercises &&
                    !exerciseError &&
                    rankedExerciseResults.map((exercise) => (
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
                  className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400"
                >
                  <span className="material-symbols-outlined text-base">science</span>
                  Create custom exercise beta
                </button>
              </div>
            )}
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
            {workoutStatItems.map((item) => (
              <div key={item.label} className="space-y-1">
                <p className="text-[10px] font-medium uppercase text-slate-500">
                  {item.label}
                </p>
                <p className="text-lg font-bold text-primary">{item.value}</p>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-primary" style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Muscular Distribution
            </p>

            {workoutMetrics.muscleDistribution.map((item) => (
              <div key={item.key} className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-slate-600">{item.label}</span>
                  <span className="text-primary">{item.rawSets} sets</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${item.percentageOfWorkout}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
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
            const isCollapsed = openBlockId !== block.id;

            if (block.type === "superset") {
              const isIncompleteSuperset = block.exercises.some(
                (exercise) => !String(exercise.exerciseId || "").trim()
              );

              return (
                <section
                  key={block.id}
                  data-superset-block={block.id}
                  data-block-id={block.id}
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
                    <div className="flex items-center gap-3 select-none">
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
                        const exerciseCollapsed =
                          openSupersetExerciseByBlock[block.id] !== exerciseIndex;

                        return (
                          <div key={exerciseKey}>
                            <div className="rounded-t-lg border border-primary/10 border-b-0 bg-white p-3">
                              <div className="flex items-start gap-3 select-none">
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
                                    <p className="pt-2 text-sm font-bold text-slate-900">
                                      {exercise.name}
                                    </p>
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
                                      inputMode="numeric"
                                      value={
                                        tempoDrafts[getTempoFieldKey(block.id, exerciseIndex)] ??
                                        formatTempoValue(exercise.tempo)
                                      }
                                      onFocus={() =>
                                        beginTempoEditing(
                                          block.id,
                                          exercise.tempo,
                                          exerciseIndex
                                        )
                                      }
                                      onChange={(e) =>
                                        changeTempoDraft(
                                          block.id,
                                          e.target.value,
                                          exerciseIndex
                                        )
                                      }
                                      onBlur={() =>
                                        commitTempoDraft(
                                          workout.id,
                                          block.id,
                                          exercise.tempo,
                                          exerciseIndex
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                                    />
                                  </div>
                                </div>

                                <div className="mb-2 grid grid-cols-12 gap-2 px-2">
                                  <div className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Set</div>
                                  <div className="col-span-5 text-[10px] font-bold uppercase text-slate-400">Reps</div>
                                  <div className="col-span-4 text-[10px] font-bold uppercase text-slate-400">RIR</div>
                                  <div className="col-span-1" />
                                </div>

                                <div className="space-y-2">
                                  {exercise.sets.map((set, setIndex) => (
                                    <div
                                      key={`${exerciseKey}-set-${setIndex}`}
                                      className="grid grid-cols-12 items-center gap-2 rounded-lg bg-white p-2"
                                    >
                                      <div className="col-span-2 text-sm font-bold text-slate-500">{setIndex + 1}</div>
                                      <div className="col-span-5">
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min="0"
                                          max="100"
                                          step="1"
                                          value={
                                            repsDrafts[
                                              getRepsFieldKey(
                                                block.id,
                                                setIndex,
                                                exerciseIndex
                                              )
                                            ] ?? set.reps
                                          }
                                          onFocus={() =>
                                            beginRepsEditing(
                                              block.id,
                                              setIndex,
                                              set.reps,
                                              exerciseIndex
                                            )
                                          }
                                          onChange={(e) =>
                                            changeRepsDraft(
                                              block.id,
                                              setIndex,
                                              e.target.value,
                                              exerciseIndex
                                            )
                                          }
                                          onBlur={() =>
                                            commitRepsDraft(
                                              workout.id,
                                              block.id,
                                              setIndex,
                                              set.reps,
                                              exerciseIndex
                                            )
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          className="w-full rounded border-slate-200 bg-slate-50 p-1.5 text-sm focus:border-primary focus:ring-primary"
                                        />
                                      </div>
                                      <div className="col-span-4">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateSet(
                                              workout.id,
                                              block.id,
                                              setIndex,
                                              { rpe: getNextRirValue(set.rpe) },
                                              exerciseIndex
                                            )
                                          }
                                          className={[
                                            "flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-bold transition-all active:scale-95",
                                            getRirButtonClasses(set.rpe),
                                          ].join(" ")}
                                          aria-label={`RIR ${set.rpe}. Tap to cycle`}
                                        >
                                          {set.rpe}
                                        </button>
                                      </div>
                                      <div className="col-span-1 flex justify-end">
                                        <span className="block h-6 w-6" aria-hidden="true" />
                                      </div>
                                    </div>
                                  ))}
                                </div>

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
                            Sets
                          </label>

                          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <button
                              type="button"
                              onClick={() =>
                                updateSupersetSetCount(
                                  workout.id,
                                  block.id,
                                  Math.max(1, (block.sets || 1) - 1)
                                )
                              }
                              className="border-r border-slate-200 px-3 py-2 text-slate-500 hover:bg-slate-50"
                            >
                              -
                            </button>
                            <span className="flex-1 text-center text-sm font-bold">{block.sets}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateSupersetSetCount(
                                  workout.id,
                                  block.id,
                                  (block.sets || 0) + 1
                                )
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
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(workout.id, block.id, {
                                  rest: getNextRestValue(block.rest, -1),
                                })
                              }
                              className="border-r border-slate-200 px-3 py-2 text-slate-500 transition-colors hover:bg-slate-50 select-none"
                              aria-label="Decrease rest interval"
                            >
                              <span className="material-symbols-outlined text-base">remove</span>
                            </button>
                            <span className="flex-1 px-3 text-center text-sm font-bold text-slate-700">
                              {block.rest}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(workout.id, block.id, {
                                  rest: getNextRestValue(block.rest, 1),
                                })
                              }
                              className="border-l border-slate-200 px-3 py-2 text-slate-500 transition-colors hover:bg-slate-50 select-none"
                              aria-label="Increase rest interval"
                            >
                              <span className="material-symbols-outlined text-base">add</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            }

            const canRemoveSingleSet = block.sets.length > 1;

            return (
              <section
                key={block.id}
                data-block-id={block.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 p-4">
                  <div className="flex items-center gap-3 select-none">
                    <span className="material-symbols-outlined cursor-grab text-slate-400">
                      drag_indicator
                    </span>
                    <p className="font-bold text-slate-900">{block.exercise}</p>
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
                          inputMode="numeric"
                          value={tempoDrafts[getTempoFieldKey(block.id)] ?? formatTempoValue(block.tempo)}
                          onFocus={() => beginTempoEditing(block.id, block.tempo)}
                          onChange={(e) => changeTempoDraft(block.id, e.target.value)}
                          onBlur={() =>
                            commitTempoDraft(workout.id, block.id, block.tempo)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Rest
                        </label>
                        <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(workout.id, block.id, {
                                rest: getNextRestValue(block.rest, -1),
                              })
                            }
                            className="border-r border-slate-200 px-3 py-2 text-slate-500 transition-colors hover:bg-slate-50 select-none"
                            aria-label="Decrease rest interval"
                          >
                            <span className="material-symbols-outlined text-base">remove</span>
                          </button>
                          <span className="flex-1 px-3 text-center text-sm font-bold text-slate-700">
                            {block.rest}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(workout.id, block.id, {
                                rest: getNextRestValue(block.rest, 1),
                              })
                            }
                            className="border-l border-slate-200 px-3 py-2 text-slate-500 transition-colors hover:bg-slate-50 select-none"
                            aria-label="Increase rest interval"
                          >
                            <span className="material-symbols-outlined text-base">add</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="mb-2 grid grid-cols-12 gap-2 px-2">
                        <div className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Set</div>
                        <div className="col-span-5 text-[10px] font-bold uppercase text-slate-400">Reps</div>
                        <div className="col-span-4 text-[10px] font-bold uppercase text-slate-400">RIR</div>
                        <div className="col-span-1" />
                      </div>

                      <div className="space-y-2">
                        {block.sets.map((set, setIndex) => (
                          <div
                            key={`${block.id}-set-${setIndex}`}
                            className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-2"
                          >
                            <div className="col-span-2 text-sm font-bold text-slate-500">{setIndex + 1}</div>
                            <div className="col-span-5">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                max="100"
                                step="1"
                                value={repsDrafts[getRepsFieldKey(block.id, setIndex)] ?? set.reps}
                                onFocus={() =>
                                  beginRepsEditing(block.id, setIndex, set.reps)
                                }
                                onChange={(e) =>
                                  changeRepsDraft(block.id, setIndex, e.target.value)
                                }
                                onBlur={() =>
                                  commitRepsDraft(
                                    workout.id,
                                    block.id,
                                    setIndex,
                                    set.reps
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                                className="w-full rounded border-slate-200 bg-white p-1.5 text-sm focus:border-primary focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-4">
                              <button
                                type="button"
                                onClick={() =>
                                  updateSet(workout.id, block.id, setIndex, {
                                    rpe: getNextRirValue(set.rpe),
                                  })
                                }
                                className={[
                                  "flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-bold transition-all active:scale-95",
                                  getRirButtonClasses(set.rpe),
                                ].join(" ")}
                                aria-label={`RIR ${set.rpe}. Tap to cycle`}
                              >
                                {set.rpe}
                              </button>
                            </div>
                            <div className="col-span-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => removeSet(workout.id, block.id, setIndex)}
                                disabled={!canRemoveSingleSet}
                                className={[
                                  "rounded p-1 transition-colors",
                                  canRemoveSingleSet
                                    ? "text-slate-400 hover:text-red-500"
                                    : "cursor-not-allowed text-slate-200",
                                ].join(" ")}
                                aria-label="Remove set"
                              >
                                <span className="material-symbols-outlined text-lg">
                                  delete
                                </span>
                              </button>
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
