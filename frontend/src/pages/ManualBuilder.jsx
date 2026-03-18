import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useManualProgram } from "../context/ManualProgramContext";
import { aggregateWorkoutMetrics, computeWorkoutMetrics } from "../utils/workoutMetrics";

function formatMinutes(value) {
  return `${value}m`;
}

function getMetricBarWidth(value, maxValue) {
  if (value <= 0 || maxValue <= 0) {
    return "0%";
  }

  return `${Math.max(8, Math.min(100, (value / maxValue) * 100))}%`;
}

export default function ManualBuilder() {
  const navigate = useNavigate();
  const { programDraft, addWorkout, updateWorkoutName } = useManualProgram();
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);

  const programName = programDraft.programName || "New Program";
  const sessionsPerWeek = programDraft.sessionsPerWeek || 4;
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
        width: getMetricBarWidth(weeklyMetrics.totalSetCount, Math.max(1, sessionsPerWeek * 20)),
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

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/70 backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-md items-center justify-center px-4">
            <div className="flex flex-col items-center justify-center px-4 text-center">
            <h1 className="mx-auto text-sm font-bold leading-tight sm:text-base">
                {programName}
            </h1>
            <span className="mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-slate-500">
                Draft
            </span>
            </div>

            <div className="absolute right-4 flex items-center gap-3">
            <button
                type="button"
                className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
                aria-label="Settings"
            >
                <span className="material-symbols-outlined text-xl font-light">
                settings
                </span>
            </button>
            </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {/* Top Summary Card */}
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
              <div key={index} className="h-1.5 flex-1 rounded-full bg-primary" />
            ))}
            {Array.from({ length: Math.max(0, 4 - sessionsPerWeek) }).map(
              (_, index) => (
                <div
                  key={`empty-${index}`}
                  className="h-1.5 flex-1 rounded-full bg-slate-200"
                />
              )
            )}
          </div>
        </div>

        {/* Stats */}
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

        {/* Weekly Muscle Distribution */}
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

        {/* Workout Schedule Header */}
        <div className="flex items-center justify-between pt-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-700">
            Workout Schedule
          </h3>
          <span className="text-xs font-medium text-primary">Reorder</span>
        </div>

        {/* Workout Cards */}
        <div className="space-y-3">
        {workoutCards.map((workout) => (
            <button
                key={workout.id}
                type="button"
                onClick={() => navigate(`/program/manual-builder/workout/${workout.id}`)}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left shadow-sm"
            >
                <div className="cursor-grab text-slate-300">
                <span className="material-symbols-outlined">drag_indicator</span>
                </div>

                <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <input
                    type="text"
                    value={workout.name}
                    onChange={(e) => updateWorkoutName(workout.id, e.target.value)}
                    className="w-full border-none bg-transparent p-0 text-base font-semibold focus:ring-0"
                    />
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
                Create Workout {workoutCards.length + 1}
              </span>
            </div>
          </button>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-col items-center pb-12 pt-8">
          <button
            type="button"
            onClick={() => navigate("/program/manual-convert")}
            className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 py-3 font-semibold text-slate-400 transition-all"
          >
            <span className="material-symbols-outlined text-slate-400">
              calendar_today
            </span>
            Convert to multi week program
          </button>

          <p className="mt-4 px-8 text-center text-[10px] uppercase tracking-widest leading-relaxed text-slate-400">
            Transforming to weekly program allows plan modifications across
            multiple weeks.
          </p>
        </div>

        <div className="h-28" />
      </main>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            className="flex w-full items-center justify-center rounded-xl bg-slate-300 py-4 font-bold text-white/60 cursor-not-allowed"
          >
            <span>Publish Program</span>
          </button>
        </div>
      </div>
    </div>
  );
}
