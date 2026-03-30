import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMultiWeekProgram } from "../context/MultiWeekProgramContext";
import {
  getCycleDetailsPath,
  getCyclesLibraryPath,
  getCycleWorkoutEditorPath,
} from "../features/multiWeek/routes";
import {
  deleteCycle,
  openOrCreateCycleEditDraft,
  publishCycleDraft,
  rescheduleUpcomingCycle,
} from "../services/api";
import {
  aggregateWorkoutMetrics,
  computeWorkoutMetrics,
} from "../utils/workoutMetrics";

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTodayDateInput() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, days) {
  const next = new Date(`${dateValue}T00:00:00`);
  next.setDate(next.getDate() + days);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveDurationWeeks(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) {
    return null;
  }

  return Math.floor(diffDays / 7) + 1;
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

export default function ManualBuilderMulti() {
  const navigate = useNavigate();
  const { cycleId } = useParams();
  const {
    programDraft,
    draftMetadata,
    hydrateProgramDraft,
    setSelectedWeek,
    updateDraftMetadata,
  } = useMultiWeekProgram();
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingCycle, setIsDeletingCycle] = useState(false);
  const [error, setError] = useState("");
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsStartDate, setSettingsStartDate] = useState("");
  const [settingsEndDate, setSettingsEndDate] = useState("");
  const [settingsDurationWeeks, setSettingsDurationWeeks] = useState(1);
  const [settingsError, setSettingsError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const todayDate = getTodayDateInput();
  const maxDurationWeeks = Math.max(1, programDraft.weeks.length || programDraft.programLength || 1);
  const isUpcomingCycle = draftMetadata.temporalStatus === "upcoming";
  const isTimelineEditable = isUpcomingCycle;

  useEffect(() => {
    let isMounted = true;

    async function loadDraft() {
      if (!cycleId) {
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const response = await openOrCreateCycleEditDraft(cycleId);
        if (isMounted) {
          hydrateProgramDraft(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message || "Unable to load cycle draft.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDraft();

    return () => {
      isMounted = false;
    };
  }, [cycleId, hydrateProgramDraft]);

  useEffect(() => {
    if (
      draftMetadata.temporalStatus !== "active" ||
      !draftMetadata.draftState?.isGraceWindow ||
      !draftMetadata.draftState?.canExtendDraft ||
      draftMetadata.allowCrossDayDraft
    ) {
      return;
    }

    const accepted = window.confirm(
      "A new local day just started. Continue editing temporarily until 00:20?"
    );

    if (accepted) {
      updateDraftMetadata({ allowCrossDayDraft: true });
    }
  }, [draftMetadata, updateDraftMetadata]);

  const selectedWeek = useMemo(
    () =>
      programDraft.weeks.find((week) => week.weekNumber === programDraft.selectedWeek) ||
      programDraft.weeks[0] ||
      null,
    [programDraft.selectedWeek, programDraft.weeks]
  );

  const selectedWeekMetrics = useMemo(
    () => aggregateWorkoutMetrics(selectedWeek?.workouts || []),
    [selectedWeek]
  );

  const weeklyVolumeData = useMemo(() => {
    const weeks = programDraft.weeks || [];
    const rows = weeks.map((week) => {
      const metrics = aggregateWorkoutMetrics(week.workouts || []);

      return {
        weekNumber: week.weekNumber,
        totalSetCount: metrics.totalSetCount,
        totalExerciseCount: metrics.totalExerciseCount,
        isSelected: programDraft.selectedWeek === week.weekNumber,
      };
    });

    const maxSets = rows.reduce((maxValue, week) => Math.max(maxValue, week.totalSetCount), 0);

    return rows.map((week) => ({
      ...week,
      width: getMetricBarWidth(week.totalSetCount, Math.max(1, maxSets)),
    }));
  }, [programDraft.selectedWeek, programDraft.weeks]);

  const topStats = useMemo(
    () => [
      {
        label: "Exercises",
        value: String(selectedWeekMetrics.totalExerciseCount),
        width: getMetricBarWidth(
          selectedWeekMetrics.totalExerciseCount,
          Math.max(1, (programDraft.sessionsPerWeek || 1) * 8)
        ),
      },
      {
        label: "Sets",
        value: String(selectedWeekMetrics.totalSetCount),
        width: getMetricBarWidth(
          selectedWeekMetrics.totalSetCount,
          Math.max(1, (programDraft.sessionsPerWeek || 1) * 20)
        ),
      },
      {
        label: "AVG. Time",
        value: formatMinutes(selectedWeekMetrics.averageDurationMinutes),
        width: getMetricBarWidth(selectedWeekMetrics.averageDurationMinutes, 120),
      },
      {
        label: "AVG. TUT",
        value: formatMinutes(selectedWeekMetrics.averageTUTMinutes),
        width: getMetricBarWidth(selectedWeekMetrics.averageTUTMinutes, 60),
      },
    ],
    [programDraft.sessionsPerWeek, selectedWeekMetrics]
  );

  const workoutCards = useMemo(
    () =>
      (selectedWeek?.workouts || []).map((workout) => {
        const metrics = computeWorkoutMetrics(workout);

        return {
          ...workout,
          meta: `${metrics.exerciseCount} exercises • ${metrics.setCount} sets • ~${metrics.estimatedDurationMinutes} min • ${metrics.totalTUTMinutes}m TUT`,
        };
      }),
    [selectedWeek]
  );

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

  const settingsMinDate = settingsStartDate || todayDate;

  const openSettingsPanel = () => {
    setSettingsStartDate(programDraft.startDate || todayDate);
    setSettingsEndDate(programDraft.endDate || addDays(todayDate, maxDurationWeeks * 7 - 1));
    setSettingsDurationWeeks(programDraft.programLength || maxDurationWeeks);
    setSettingsError("");
    setShowDeleteConfirm(false);
    setIsSettingsOpen(true);
  };

  const closeSettingsPanel = () => {
    setSettingsError("");
    setShowDeleteConfirm(false);
    setIsSettingsOpen(false);
  };

  const handleSettingsStartDateChange = (value) => {
    setSettingsStartDate(value);
    setSettingsError("");

    const nextEndDate = addDays(value, settingsDurationWeeks * 7 - 1);
    setSettingsEndDate(nextEndDate);
  };

  const handleSettingsEndDateChange = (value) => {
    setSettingsEndDate(value);
    setSettingsError("");

    const nextDuration = deriveDurationWeeks(settingsStartDate, value);
    if (nextDuration != null) {
      setSettingsDurationWeeks(nextDuration);
    }
  };

  const handleSettingsDurationChange = (nextValue) => {
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      setSettingsDurationWeeks(1);
      return;
    }

    const safeDuration = Math.max(1, Math.trunc(parsed));
    setSettingsDurationWeeks(safeDuration);
    setSettingsError("");

    if (safeDuration <= maxDurationWeeks) {
      setSettingsEndDate(addDays(settingsStartDate, safeDuration * 7 - 1));
    }
  };

  const handleSaveSettings = async () => {
    if (!cycleId) {
      return;
    }

    setSettingsError("");

    if (!isTimelineEditable) {
      setSettingsError("Timeline settings can only be edited for upcoming cycles.");
      return;
    }

    const derivedDuration = deriveDurationWeeks(settingsStartDate, settingsEndDate);
    if (!settingsStartDate || !settingsEndDate || derivedDuration == null) {
      setSettingsError("Choose a valid future date range.");
      return;
    }

    if (settingsStartDate < todayDate || settingsEndDate < todayDate) {
      setSettingsError("Past dates are not allowed.");
      return;
    }

    if (derivedDuration > maxDurationWeeks) {
      setSettingsError("Extending a cycle beyond its current structure isn't supported yet.");
      return;
    }

    setIsSavingSettings(true);
    setError("");

    try {
      const response = await rescheduleUpcomingCycle(cycleId, {
        newStartDate: settingsStartDate,
        newEndDate: settingsEndDate,
        durationWeeks: derivedDuration,
      });
      hydrateProgramDraft(response);
      closeSettingsPanel();
    } catch (saveError) {
      setSettingsError(saveError.message || "Unable to update timeline settings.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteCycle = async () => {
    if (!cycleId || !showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    setIsDeletingCycle(true);
    setError("");

    try {
      await deleteCycle(cycleId);
      navigate(getCyclesLibraryPath(), { replace: true });
    } catch (deleteError) {
      setSettingsError(deleteError.message || "Unable to delete this cycle.");
      setIsDeletingCycle(false);
    }
  };

  const handlePublish = async () => {
    if (!cycleId || !draftMetadata.cyclePlanId) {
      return;
    }

    setIsPublishing(true);
    setError("");

    try {
      const response = await publishCycleDraft(cycleId, {
        allowCrossDayDraft: draftMetadata.allowCrossDayDraft,
      });
      hydrateProgramDraft(response);
      navigate(getCycleDetailsPath(cycleId), { replace: true });
    } catch (publishError) {
      setError(publishError.message || "Unable to publish cycle.");
    } finally {
      setIsPublishing(false);
    }
  };

  if (isLoading) {
    return <div className="px-4 py-8 text-sm text-slate-500">Loading cycle builder...</div>;
  }

  if (error && !programDraft.weeks.length) {
    return <div className="px-4 py-8 text-sm text-red-500">{error}</div>;
  }

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/70 backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-md items-center justify-center px-4">
          <button
            type="button"
            onClick={() => navigate(getCycleDetailsPath(cycleId))}
            className="absolute left-4 flex size-10 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>

          <div className="flex flex-col items-center justify-center px-4 text-center">
            <h1 className="mx-auto text-sm font-bold leading-tight sm:text-base">
              {programDraft.programName}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-slate-500">
                {draftMetadata.status} · {draftMetadata.temporalStatus}
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
              aria-label="Open cycle settings"
            >
              <span className="material-symbols-outlined text-xl font-light">
                settings
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pb-28 pt-4">
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/5" />

          <div className="relative flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">Multi-Week Cycle</h2>
              <p className="mt-1 text-sm text-slate-500">
                {formatDate(programDraft.startDate)} - {formatDate(programDraft.endDate)}
              </p>
            </div>

            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {programDraft.programLength} weeks
            </span>
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

        <div className="mb-4 px-1">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Weekly Volume (Sets)
            </span>
            <span className="text-[10px] font-bold tracking-tight text-primary">
              Avg:{" "}
              {weeklyVolumeData.length
                ? Math.round(
                    weeklyVolumeData.reduce(
                      (sum, week) => sum + week.totalSetCount,
                      0
                    ) / weeklyVolumeData.length
                  )
                : 0}
            </span>
          </div>

          <div
            className="grid h-12 rounded-lg border border-slate-100/50 bg-white/30 p-1"
            style={{ gridTemplateColumns: `repeat(${programDraft.programLength || 1}, minmax(0, 1fr))` }}
          >
            {weeklyVolumeData.map((week) => (
              <button
                key={week.weekNumber}
                type="button"
                onClick={() => setSelectedWeek(week.weekNumber)}
                className="flex h-full items-end px-1"
                aria-label={`Select week ${week.weekNumber} volume`}
              >
                <span
                  className={[
                    "block w-full rounded-t-sm transition-all duration-500 hover:opacity-80",
                    week.isSelected ? "bg-primary" : "bg-slate-200",
                  ].join(" ")}
                  style={{ height: week.width }}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 w-full">
          <div
            className="grid rounded-lg bg-slate-100 p-1"
            style={{ gridTemplateColumns: `repeat(${programDraft.programLength || 1}, minmax(0, 1fr))` }}
          >
            {programDraft.weeks.map((week) => {
              const isSelected = programDraft.selectedWeek === week.weekNumber;

              return (
                <button
                  key={week.id || week.weekNumber}
                  type="button"
                  onClick={() => setSelectedWeek(week.weekNumber)}
                  className={[
                    "w-full rounded-md py-2 text-[10px] font-bold transition-all",
                    isSelected
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  ].join(" ")}
                >
                  W{week.weekNumber}
                </button>
              );
            })}
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
            <span className="material-symbols-outlined text-lg text-slate-400">
              {showMuscleDistribution ? "expand_less" : "expand_more"}
            </span>
          </button>

          {showMuscleDistribution && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
              {selectedWeekMetrics.muscleDistribution
                .filter((item) => item.rawSets > 0)
                .map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                      <span className="text-slate-600">{item.label}</span>
                      <span className="text-primary">{item.rawSets} sets</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round(item.percentageOfWorkout)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {workoutCards.map((workout) => (
            <button
              key={workout.id}
              type="button"
              onClick={() => navigate(getCycleWorkoutEditorPath(cycleId, workout.id))}
              className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-base font-semibold">{workout.name}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Day {workout.orderIndex}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500 opacity-80">
                  {workout.meta}
                </p>
              </div>

              <span className="material-symbols-outlined text-slate-400">
                chevron_right
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            disabled={isPublishing || !draftMetadata.cyclePlanId}
            onClick={handlePublish}
            className={[
              "flex w-full items-center justify-center rounded-xl py-4 font-bold transition-colors",
              !isPublishing && draftMetadata.cyclePlanId
                ? "bg-primary text-white"
                : "cursor-not-allowed bg-slate-300 text-white/60",
            ].join(" ")}
          >
            <span>{isPublishing ? "Publishing..." : "Publish Cycle"}</span>
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 px-4 pb-6 pt-10">
          <div className="relative w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <button
              type="button"
              onClick={closeSettingsPanel}
              className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close settings"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>

            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                  Settings
                </p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Multi-week timeline
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update dates for upcoming cycles and delete this cycle for debugging when needed.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={settingsStartDate}
                    min={todayDate}
                    onChange={(event) => handleSettingsStartDateChange(event.target.value)}
                    disabled={!isTimelineEditable}
                    className="h-12 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    End date
                  </label>
                  <input
                    type="date"
                    value={settingsEndDate}
                    min={settingsMinDate}
                    onChange={(event) => handleSettingsEndDateChange(event.target.value)}
                    disabled={!isTimelineEditable}
                    className="h-12 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Duration in weeks
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={String(maxDurationWeeks)}
                    value={settingsDurationWeeks}
                    onChange={(event) => handleSettingsDurationChange(event.target.value)}
                    disabled={!isTimelineEditable}
                    className="h-12 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <p className="text-xs text-slate-500">
                    You can shorten this cycle. Extending beyond {maxDurationWeeks} weeks is not supported yet.
                  </p>
                </div>
              </div>

              {!isTimelineEditable && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Timeline edits are only available for upcoming cycles in V1.
                </div>
              )}

              {settingsError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {settingsError}
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={!isTimelineEditable || isSavingSettings}
                  className={[
                    "w-full rounded-xl py-3 font-bold transition-colors",
                    isTimelineEditable && !isSavingSettings
                      ? "bg-primary text-white"
                      : "cursor-not-allowed bg-slate-200 text-slate-400",
                  ].join(" ")}
                >
                  {isSavingSettings ? "Saving..." : "Save timeline settings"}
                </button>

                <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
                  <h3 className="text-sm font-bold text-red-700">Delete cycle</h3>
                  <p className="mt-1 text-xs leading-relaxed text-red-600">
                    This permanently removes the current multi-week cycle and all of its versions.
                  </p>

                  {showDeleteConfirm ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-red-700">
                        Confirm deletion of this cycle?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteCycle}
                          disabled={isDeletingCycle}
                          className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-bold text-white disabled:opacity-60"
                        >
                          {isDeletingCycle ? "Deleting..." : "Confirm delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDeleteCycle}
                      className="mt-3 w-full rounded-xl border border-red-200 bg-white py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50"
                    >
                      Delete cycle
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
