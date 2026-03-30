import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMultiWeekProgram } from "../context/MultiWeekProgramContext";
import {
  getCycleDetailsPath,
  getCycleWorkoutEditorPath,
} from "../features/multiWeek/routes";
import {
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
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [error, setError] = useState("");
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");

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
          setRescheduleDate(response.builderPayload?.startDate || "");
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

  const weeklyMetrics = useMemo(
    () => aggregateWorkoutMetrics(selectedWeek?.workouts || []),
    [selectedWeek]
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

  const handleReschedule = async () => {
    if (!cycleId || !rescheduleDate) {
      return;
    }

    setIsRescheduling(true);
    setError("");

    try {
      const response = await rescheduleUpcomingCycle(cycleId, {
        newStartDate: rescheduleDate,
      });
      hydrateProgramDraft(response);
    } catch (rescheduleError) {
      setError(rescheduleError.message || "Unable to reschedule cycle.");
    } finally {
      setIsRescheduling(false);
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
            <span className="mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-slate-500">
              {draftMetadata.status} · {draftMetadata.temporalStatus}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-28">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">
              {formatDate(programDraft.startDate)} - {formatDate(programDraft.endDate)}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {programDraft.programLength} weeks
            </span>
          </div>

          {draftMetadata.temporalStatus === "upcoming" && (
            <div className="mt-4 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Reschedule start date
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(event) => setRescheduleDate(event.target.value)}
                  className="h-11 flex-1 rounded-xl border border-slate-200 px-3 outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleReschedule}
                  disabled={isRescheduling}
                  className="rounded-xl border border-primary/20 px-4 font-semibold text-primary disabled:opacity-50"
                >
                  {isRescheduling ? "Saving..." : "Move"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-100 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Exercises", value: String(weeklyMetrics.totalExerciseCount) },
              { label: "Sets", value: String(weeklyMetrics.totalSetCount) },
              { label: "AVG. Time", value: `${weeklyMetrics.averageDurationMinutes}m` },
              { label: "AVG. TUT", value: `${weeklyMetrics.averageTUTMinutes}m` },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {item.label}
                </span>
                <span className="text-sm font-bold text-slate-700">
                  {item.value}
                </span>
              </div>
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
              {weeklyMetrics.muscleDistribution
                .filter((item) => item.rawSets > 0)
                .map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                      <span className="text-slate-600">{item.label}</span>
                      <span className="text-primary">{Math.round(item.percentageOfWorkout)}%</span>
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
    </div>
  );
}
