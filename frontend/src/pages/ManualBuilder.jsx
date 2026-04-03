import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useManualProgram } from "../context/ManualProgramContext";
import { resolveBackTarget } from "../features/weeklyPlans/navigation";
import {
  getWeeklyPlanDetailsPath,
  getWeeklyPlansPath,
} from "../features/weeklyPlans/routes";
import { deleteWeeklyPlan, publishWeeklyPlanDraft } from "../services/api";
import {
  aggregateWorkoutMetrics,
  computeWorkoutMetrics,
} from "../utils/workoutMetrics";

function formatMinutes(value) {
  return `${value}m`;
}

function getMetricBarWidth(value, maxValue) {
  if (value <= 0 || maxValue <= 0) {
    return "0%";
  }

  return `${Math.max(8, Math.min(100, (value / maxValue) * 100))}%`;
}

function canMoveSelectedWorkouts(workouts, selectedIds, direction) {
  const selectedIdSet = new Set(selectedIds);

  if (!selectedIdSet.size) {
    return false;
  }

  if (direction === "up") {
    return workouts.some(
      (workout, index) =>
        selectedIdSet.has(workout.id) &&
        index > 0 &&
        !selectedIdSet.has(workouts[index - 1].id)
    );
  }

  return workouts.some(
    (workout, index) =>
      selectedIdSet.has(workout.id) &&
      index < workouts.length - 1 &&
      !selectedIdSet.has(workouts[index + 1].id)
  );
}

function normalizeWorkoutName(value) {
  return String(value || "").trim().toLowerCase();
}

function validatePlanName(value) {
  return String(value || "").trim() ? "" : "Plan name is required";
}

export default function ManualBuilder() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    programDraft,
    draftMetadata,
    addWorkout,
    moveWorkouts,
    duplicateWorkouts,
    persistDraftNow,
    removeWorkouts,
    updateProgramMeta,
    updateSessionsPerWeek,
    resetProgramDraft,
  } = useManualProgram();
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedWorkoutIds, setSelectedWorkoutIds] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsProgramNameDraft, setSettingsProgramNameDraft] = useState("");
  const [settingsNameError, setSettingsNameError] = useState("");
  const [hasInteractedWithSettingsName, setHasInteractedWithSettingsName] = useState(false);
  const [settingsSessionsPerWeek, setSettingsSessionsPerWeek] = useState(4);
  const [settingsSessionsError, setSettingsSessionsError] = useState("");
  const [showDeleteProgramConfirm, setShowDeleteProgramConfirm] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishingAndTransforming, setIsPublishingAndTransforming] = useState(false);
  const [publishAndTransformError, setPublishAndTransformError] = useState("");
  const [deleteProgramError, setDeleteProgramError] = useState("");
  const [isDeleteBlockedByLinkedCycle, setIsDeleteBlockedByLinkedCycle] = useState(false);
  const [isDeletingProgram, setIsDeletingProgram] = useState(false);

  const programName = programDraft.programName;
  const sessionsPerWeek = programDraft.sessionsPerWeek || 4;
  const createdWorkoutCount = programDraft.workouts.length;
  const canCreateWorkout = createdWorkoutCount < sessionsPerWeek;
  const hasEmptyWorkouts = useMemo(
    () =>
      programDraft.workouts.some(
        (workout) => !Array.isArray(workout.blocks) || workout.blocks.length === 0
      ),
    [programDraft.workouts]
  );
  const selectedWorkoutIdSet = useMemo(
    () => new Set(selectedWorkoutIds),
    [selectedWorkoutIds]
  );
  const canMoveUp = useMemo(
    () => canMoveSelectedWorkouts(programDraft.workouts, selectedWorkoutIds, "up"),
    [programDraft.workouts, selectedWorkoutIds]
  );
  const canMoveDown = useMemo(
    () => canMoveSelectedWorkouts(programDraft.workouts, selectedWorkoutIds, "down"),
    [programDraft.workouts, selectedWorkoutIds]
  );
  const canDuplicate =
    selectedWorkoutIds.length > 0 &&
    createdWorkoutCount + selectedWorkoutIds.length <= sessionsPerWeek;
  const canDelete = selectedWorkoutIds.length > 0;

  const workoutNameValidationById = useMemo(() => {
    const normalizedNameCounts = new Map();

    programDraft.workouts.forEach((workout) => {
      const normalizedName = normalizeWorkoutName(workout.name);

      if (!normalizedName) {
        return;
      }

      normalizedNameCounts.set(
        normalizedName,
        (normalizedNameCounts.get(normalizedName) || 0) + 1
      );
    });

    return Object.fromEntries(
      programDraft.workouts.map((workout) => {
        const normalizedName = normalizeWorkoutName(workout.name);
        const isEmptyName = normalizedName.length === 0;
        const isDuplicateName =
          !isEmptyName && (normalizedNameCounts.get(normalizedName) || 0) > 1;

        return [
          workout.id,
          {
            isEmptyName,
            isDuplicateName,
            nameError: isEmptyName
              ? "Workout name is required"
              : isDuplicateName
                ? "Workout name must be unique"
                : "",
          },
        ];
      })
    );
  }, [programDraft.workouts]);

  const hasInvalidWorkoutNames = useMemo(
    () =>
      programDraft.workouts.some((workout) => {
        const validation = workoutNameValidationById[workout.id];
        return Boolean(validation?.nameError);
      }),
    [programDraft.workouts, workoutNameValidationById]
  );
  const hasInvalidWorkouts = hasEmptyWorkouts || hasInvalidWorkoutNames;
  const isWeeklyTemplateComplete = createdWorkoutCount === sessionsPerWeek;
  const isWeeklyTemplateReady = isWeeklyTemplateComplete && !hasInvalidWorkouts;

  const weeklyMetrics = useMemo(
    () => aggregateWorkoutMetrics(programDraft.workouts),
    [programDraft.workouts]
  );
  const topStats = useMemo(
    () => [
      {
        label: "Exercises",
        value: String(weeklyMetrics.totalExerciseCount),
        width: getMetricBarWidth(
          weeklyMetrics.totalExerciseCount,
          Math.max(1, sessionsPerWeek * 8)
        ),
      },
      {
        label: "Sets",
        value: String(weeklyMetrics.totalSetCount),
        width: getMetricBarWidth(
          weeklyMetrics.totalSetCount,
          Math.max(1, sessionsPerWeek * 20)
        ),
      },
      {
        label: "AVG. Time",
        value: formatMinutes(weeklyMetrics.averageDurationMinutes),
        width: getMetricBarWidth(weeklyMetrics.averageDurationMinutes, 120),
      },
      {
        label: "AVG. TUT",
        value: formatMinutes(weeklyMetrics.averageTUTMinutes),
        width: getMetricBarWidth(weeklyMetrics.averageTUTMinutes, 60),
      },
    ],
    [sessionsPerWeek, weeklyMetrics]
  );

  const workoutCards = useMemo(
    () =>
      programDraft.workouts.map((workout) => {
        const metrics = computeWorkoutMetrics(workout);

        return {
          ...workout,
          meta: `${metrics.exerciseCount} exercises • ${metrics.setCount} sets • ~${metrics.estimatedDurationMinutes} min • ${metrics.totalTUTMinutes}m TUT`,
        };
      }),
    [programDraft.workouts]
  );

  const settingsCanSave = settingsProgramNameDraft.trim().length > 0;
  const backTarget = resolveBackTarget(location, "/program");

  const saveStatusLabel = useMemo(() => {
    if (draftMetadata.saveState === "saving") {
      return "Saving...";
    }

    if (draftMetadata.saveState === "error") {
      return "Save failed";
    }

    if (draftMetadata.lastSavedAt) {
      return "Saved";
    }

    return "Draft";
  }, [draftMetadata.lastSavedAt, draftMetadata.saveState]);

  const toggleEditMode = () => {
    setIsEditMode((prev) => {
      if (prev) {
        setSelectedWorkoutIds([]);
      }

      return !prev;
    });
  };

  const toggleWorkoutSelection = (workoutId) => {
    setSelectedWorkoutIds((prev) =>
      prev.includes(workoutId)
        ? prev.filter((id) => id !== workoutId)
        : [...prev, workoutId]
    );
  };

  const handleMove = (direction) => {
    if ((direction === "up" && !canMoveUp) || (direction === "down" && !canMoveDown)) {
      return;
    }

    moveWorkouts(selectedWorkoutIds, direction);
  };

  const handleDuplicate = () => {
    if (!canDuplicate) {
      return;
    }

    duplicateWorkouts(selectedWorkoutIds);
  };

  const handleDelete = () => {
    if (!canDelete) {
      return;
    }

    removeWorkouts(selectedWorkoutIds);
    setSelectedWorkoutIds([]);
  };

  const openSettingsPanel = () => {
    setSettingsProgramNameDraft(programDraft.programName);
    setSettingsNameError("");
    setHasInteractedWithSettingsName(false);
    setSettingsSessionsPerWeek(programDraft.sessionsPerWeek || 4);
    setSettingsSessionsError("");
    setDeleteProgramError("");
    setIsDeleteBlockedByLinkedCycle(false);
    setShowDeleteProgramConfirm(false);
    setIsSettingsOpen(true);
  };

  const closeSettingsPanel = () => {
    setIsSettingsOpen(false);
    setSettingsNameError("");
    setHasInteractedWithSettingsName(false);
    setSettingsSessionsError("");
    setDeleteProgramError("");
    setIsDeleteBlockedByLinkedCycle(false);
    setShowDeleteProgramConfirm(false);
  };

  const handleSettingsNameChange = (event) => {
    const nextValue = event.target.value;
    setSettingsProgramNameDraft(nextValue);

    if (settingsNameError && nextValue.trim()) {
      setSettingsNameError("");
    }
  };

  const handleSettingsNameBlur = () => {
    setHasInteractedWithSettingsName(true);
    setSettingsNameError(validatePlanName(settingsProgramNameDraft));
  };

  const decrementSettingsSessions = () => {
    const nextValue = Math.max(1, settingsSessionsPerWeek - 1);

    if (nextValue < createdWorkoutCount) {
      setSettingsSessionsError(
        "Delete existing workouts before reducing sessions per week"
      );
      return;
    }

    setSettingsSessionsPerWeek(nextValue);
    setSettingsSessionsError("");
  };

  const incrementSettingsSessions = () => {
    setSettingsSessionsPerWeek((prev) => Math.min(7, prev + 1));
    setSettingsSessionsError("");
  };

  const handleSaveSettings = () => {
    const nextSettingsNameError = validatePlanName(settingsProgramNameDraft);
    setHasInteractedWithSettingsName(true);
    setSettingsNameError(nextSettingsNameError);

    if (nextSettingsNameError) {
      return;
    }

    updateProgramMeta({ programName: settingsProgramNameDraft.trim() });
    updateSessionsPerWeek(settingsSessionsPerWeek);
    closeSettingsPanel();
  };

  const handleDeleteProgram = async () => {
    if (!draftMetadata.loadedFromBackend) {
      resetProgramDraft();
      closeSettingsPanel();
      navigate("/program");
      return;
    }

    if (!draftMetadata.weeklyPlanParentId || isDeletingProgram) {
      return;
    }

    setDeleteProgramError("");
    setIsDeleteBlockedByLinkedCycle(false);
    setIsDeletingProgram(true);

    try {
      await deleteWeeklyPlan(draftMetadata.weeklyPlanParentId);
      closeSettingsPanel();
      navigate(getWeeklyPlansPath(), { replace: true });
    } catch (error) {
      setIsDeleteBlockedByLinkedCycle(
        error?.code === "WEEKLY_PLAN_LINKED_TO_CYCLE"
      );
      setDeleteProgramError(
        error.message ||
          "Unable to delete this weekly plan."
      );
    } finally {
      setIsDeletingProgram(false);
    }
  };

  const handleBack = () => {
    navigate(backTarget);
  };

  const handlePublish = async () => {
    if (
      !isWeeklyTemplateReady ||
      !draftMetadata.weeklyPlanParentId ||
      isPublishing
    ) {
      return;
    }

    setIsPublishing(true);

    try {
      await persistDraftNow();
      await publishWeeklyPlanDraft(draftMetadata.weeklyPlanParentId);
      navigate(getWeeklyPlanDetailsPath(draftMetadata.weeklyPlanParentId), {
        replace: true,
        state: {
          from: location.state?.returnTo || getWeeklyPlansPath(),
        },
      });
    } catch (error) {
      // Keep the builder open so the user can retry publishing.
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePublishAndTransform = async () => {
    if (!isWeeklyTemplateReady || isPublishing || isPublishingAndTransforming) {
      return;
    }

    if (!draftMetadata.weeklyPlanParentId) {
      setPublishAndTransformError(
        "This weekly plan must be saved before it can be published and transformed."
      );
      return;
    }

    if (!draftMetadata.weeklyPlanVersionId || draftMetadata.status !== "draft") {
      setPublishAndTransformError(
        "An editable draft is required before this weekly plan can be published and transformed."
      );
      return;
    }

    setPublishAndTransformError("");
    setIsPublishingAndTransforming(true);

    try {
      await persistDraftNow();
      await publishWeeklyPlanDraft(draftMetadata.weeklyPlanParentId);
      navigate("/program/manual-convert", {
        state: {
          from: `${location.pathname}${location.search || ""}`,
        },
      });
    } catch (error) {
      setPublishAndTransformError(
        error.message ||
          "Unable to publish and transform this weekly plan."
      );
    } finally {
      setIsPublishingAndTransforming(false);
    }
  };

  const actionButtonClass = (enabled, tone = "neutral") =>
    [
      "inline-flex h-9 w-9 items-center justify-center rounded-full transition-all select-none",
      enabled
        ? tone === "danger"
          ? "text-red-500 hover:bg-red-50 hover:text-red-600 active:scale-95 active:bg-red-100"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 active:scale-95 active:bg-slate-200/70"
        : "cursor-not-allowed opacity-40",
    ].join(" ");

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/70 backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-md items-center justify-center px-4">
          <button
            type="button"
            onClick={handleBack}
            className="absolute left-4 flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-xl font-light">
              arrow_back
            </span>
          </button>

          <div className="flex flex-col items-center justify-center px-4 text-center">
            <h1 className="mx-auto text-sm font-bold leading-tight sm:text-base">
              {programName}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-slate-500">
                Draft
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {saveStatusLabel}
              </span>
            </div>
          </div>

          <div className="absolute right-4 flex items-center gap-3">
            <button
              type="button"
              onClick={openSettingsPanel}
              className="flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Open plan settings"
            >
              <span className="material-symbols-outlined text-xl font-light">
                settings
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/5" />

          <div className="relative flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">Weekly Template</h2>
              <p className="mt-1 text-sm text-slate-500">
                {sessionsPerWeek} Sessions/week
              </p>
            </div>
          </div>

          <div className="mt-1 flex gap-2">
            {Array.from({ length: sessionsPerWeek }).map((_, index) => (
              <div
                key={index}
                className={[
                  "h-1.5 flex-1 rounded-full",
                  index < createdWorkoutCount ? "bg-primary" : "bg-slate-200",
                ].join(" ")}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
          <div className="grid grid-cols-4 gap-2">
            {topStats.map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {item.label}
                </span>
                <span className="text-sm font-bold text-slate-700">
                  {item.value}
                </span>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-primary" style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setShowMuscleDistribution((prev) => !prev)}
            className="flex w-full items-center justify-between"
          >
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Weekly Muscle Distribution
            </h4>
            <span
              className={[
                "material-symbols-outlined text-lg text-slate-400 transition-transform",
                showMuscleDistribution ? "rotate-180" : "",
              ].join(" ")}
            >
              expand_more
            </span>
          </button>

          {showMuscleDistribution && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
              {weeklyMetrics.muscleDistribution.map((item) => (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase">
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
          )}
        </div>

        <div className="flex min-h-[44px] items-center justify-between gap-3 pt-2">
          <h3 className="min-w-0 truncate px-1 text-xs font-bold uppercase tracking-wider text-slate-700">
            Workout Schedule
          </h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {isEditMode && selectedWorkoutIds.length > 0 && (
              <>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMove("up")}
                    disabled={!canMoveUp}
                    className={actionButtonClass(canMoveUp)}
                    aria-label="Move selected workouts up"
                  >
                    <span className="material-symbols-outlined text-[20px] leading-none">
                      expand_less
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove("down")}
                    disabled={!canMoveDown}
                    className={actionButtonClass(canMoveDown)}
                    aria-label="Move selected workouts down"
                  >
                    <span className="material-symbols-outlined text-[20px] leading-none">
                      expand_more
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDuplicate}
                  disabled={!canDuplicate}
                  className={[actionButtonClass(canDuplicate), "ml-1"].join(" ")}
                  aria-label="Duplicate selected workouts"
                >
                  <span className="material-symbols-outlined text-[20px] leading-none">
                    content_copy
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!canDelete}
                  className={[actionButtonClass(canDelete, "danger"), "ml-1.5"].join(" ")}
                  aria-label="Delete selected workouts"
                >
                  <span className="material-symbols-outlined text-[20px] leading-none">
                    delete
                  </span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={toggleEditMode}
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                isEditMode
                  ? "bg-primary/10 text-primary"
                  : "text-primary hover:bg-primary/10",
              ].join(" ")}
            >
              Edit
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {workoutCards.map((workout, index) => {
            const isSelected = selectedWorkoutIdSet.has(workout.id);
            const validation = workoutNameValidationById[workout.id] || {
              nameError: "",
            };
            const isEmptyWorkout =
              !Array.isArray(workout.blocks) || workout.blocks.length === 0;

            return (
              <button
                key={workout.id}
                type="button"
                onClick={() =>
                  isEditMode
                    ? toggleWorkoutSelection(workout.id)
                    : navigate(`/program/manual-builder/workout/${workout.id}`, {
                        state: {
                          from: `${location.pathname}${location.search || ""}`,
                        },
                      })
                }
                className={[
                  "group flex w-full items-start gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-colors",
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : validation.nameError || isEmptyWorkout
                      ? "border-red-200"
                      : "border-slate-100",
                ].join(" ")}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                  {isEditMode ? (
                    <span
                      className={[
                        "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-slate-900"
                          : "border-slate-300 bg-white",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-sm">check</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-slate-400">
                      {index + 1}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        "block truncate text-base font-semibold",
                        validation.nameError ? "text-red-600" : "text-slate-800",
                      ].join(" ")}
                    >
                      {workout.name}
                    </span>
                  </div>

                  {validation.nameError && (
                    <p className="mt-1 text-xs font-medium text-red-500">
                      {validation.nameError}
                    </p>
                  )}

                  {isEmptyWorkout && (
                    <p className="mt-1 text-xs font-medium text-red-500">
                      Add at least 1 block
                    </p>
                  )}

                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 opacity-80">
                    {workout.meta}
                  </p>
                </div>

                {!isEditMode && (
                  <span className="material-symbols-outlined pt-0.5 text-slate-400">
                    chevron_right
                  </span>
                )}
              </button>
            );
          })}

          {canCreateWorkout && (
            <button
              type="button"
              onClick={() => addWorkout()}
              className="w-full cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-white/50 p-6 transition-colors hover:border-primary/50"
            >
              <div className="flex flex-col items-center justify-center gap-2">
                <span className="material-symbols-outlined text-slate-300 transition-colors hover:text-primary">
                  add_circle
                </span>
                <span className="text-sm font-semibold text-slate-400 transition-colors hover:text-primary">
                  Create Workout {createdWorkoutCount + 1}
                </span>
                {createdWorkoutCount === 0 && (
                  <span className="text-xs font-medium text-slate-400">
                    Start building your weekly template
                  </span>
                )}
              </div>
            </button>
          )}
        </div>

        <div className="flex flex-col items-center pb-12 pt-8">
          <button
            type="button"
            disabled={!isWeeklyTemplateReady || isPublishing || isPublishingAndTransforming}
            onClick={handlePublishAndTransform}
            className={[
              "flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border-2 p-3 font-semibold transition-all",
              isWeeklyTemplateReady && !isPublishing && !isPublishingAndTransforming
                ? "border-primary/30 bg-white text-primary hover:border-primary/50"
                : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
            ].join(" ")}
          >
            <span className="material-symbols-outlined">calendar_today</span>
            {isPublishingAndTransforming
              ? "Publishing & transforming..."
              : "Turn into multi-week program"}
          </button>

          {publishAndTransformError ? (
            <p className="mt-3 max-w-xs text-center text-sm font-medium text-red-500">
              {publishAndTransformError}
            </p>
          ) : null}

          <p className="mt-4 px-8 text-center text-[10px] uppercase tracking-widest leading-relaxed text-slate-400">
            Transforming to weekly program allows plan modifications across
            multiple weeks.
          </p>
        </div>

        <div className="h-28" />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            disabled={
              !isWeeklyTemplateReady ||
              !draftMetadata.weeklyPlanParentId ||
              isPublishing
            }
            onClick={handlePublish}
            className={[
              "flex w-full items-center justify-center rounded-xl py-4 font-bold transition-colors",
              isWeeklyTemplateReady && draftMetadata.weeklyPlanParentId && !isPublishing
                ? "bg-primary text-slate-900"
                : "cursor-not-allowed bg-slate-300 text-white/60",
            ].join(" ")}
          >
            <span>{isPublishing ? "Publishing..." : "Publish Program"}</span>
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close settings"
            onClick={closeSettingsPanel}
          />

          <div className="relative w-full rounded-t-3xl bg-white p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Plan Settings</h3>
              <button
                type="button"
                onClick={closeSettingsPanel}
                className="flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close plan settings"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-5">
              <section className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Plan Name
                </label>
                <input
                  type="text"
                  value={settingsProgramNameDraft}
                  onChange={handleSettingsNameChange}
                  onBlur={handleSettingsNameBlur}
                  className={[
                    "h-12 w-full rounded-xl border bg-white px-4 font-medium outline-none transition-all focus:border-transparent focus:ring-2",
                    settingsNameError
                      ? "border-red-300 focus:ring-red-200"
                      : "border-slate-200 focus:ring-primary",
                  ].join(" ")}
                />
                {hasInteractedWithSettingsName && settingsNameError && (
                  <p className="text-sm font-medium text-red-500">
                    {settingsNameError}
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Sessions Per Week
                  </label>
                  <p className="mt-1 text-xs text-slate-400">
                    You can&apos;t go below the number of workouts already created.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={decrementSettingsSessions}
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 transition-colors hover:bg-slate-100"
                      aria-label="Decrease sessions per week"
                    >
                      <span className="material-symbols-outlined">remove</span>
                    </button>

                    <div className="flex-1 text-center">
                      <span className="text-3xl font-black text-slate-900">
                        {settingsSessionsPerWeek}
                      </span>
                      <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-primary">
                        Sessions
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={incrementSettingsSessions}
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 transition-colors hover:bg-slate-100"
                      aria-label="Increase sessions per week"
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                </div>

                {settingsSessionsError && (
                  <p className="text-sm font-medium text-red-500">
                    {settingsSessionsError}
                  </p>
                )}
              </section>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeSettingsPanel}
                  className="flex-1 rounded-xl border border-slate-200 py-3 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={!settingsCanSave}
                  className={[
                    "flex-1 rounded-xl py-3 font-semibold transition-colors",
                    settingsCanSave
                      ? "bg-primary text-slate-900"
                      : "cursor-not-allowed bg-slate-300 text-white/60",
                  ].join(" ")}
                >
                  Save
                </button>
              </div>

              <section className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
                {!showDeleteProgramConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteProgramConfirm(true)}
                    className="mt-3 w-full rounded-xl border border-red-200 bg-white py-3 font-semibold text-red-500 transition-colors hover:bg-red-50"
                  >
                    Delete Program
                  </button>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm text-red-600">
                      {draftMetadata.loadedFromBackend
                        ? "Are you sure you want to delete this weekly plan? This action can't be undone."
                        : "Delete this draft program? This action can&apos;t be undone."}
                    </p>
                    {deleteProgramError ? (
                      <p className="text-sm font-medium text-red-600">
                        {deleteProgramError}
                      </p>
                    ) : null}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setShowDeleteProgramConfirm(false)}
                        className="flex-1 rounded-xl border border-slate-200 bg-white py-3 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteProgram}
                        disabled={isDeletingProgram || isDeleteBlockedByLinkedCycle}
                        className={[
                          "flex-1 rounded-xl py-3 font-semibold transition-colors",
                          isDeletingProgram || isDeleteBlockedByLinkedCycle
                            ? "cursor-not-allowed bg-slate-300 text-white/60"
                            : "bg-red-500 text-white hover:bg-red-600",
                        ].join(" ")}
                      >
                        {isDeletingProgram ? "Deleting..." : "Delete Program"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
