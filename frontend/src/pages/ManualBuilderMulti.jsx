import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useManualProgram } from "../context/ManualProgramContext";

export default function ManualBuilderMulti() {
  const navigate = useNavigate();
  const { programDraft, setSelectedWeek } = useManualProgram();

  const programName = programDraft.programName || "New Program";
  const sessionsPerWeek = programDraft.sessionsPerWeek || 4;
  const programLength = programDraft.programLength || 8;

  const selectedWeek = programDraft.selectedWeek || 1;
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);

  const workoutCards = programDraft.workouts.map((workout) => {
    const exerciseCount = workout.blocks.reduce((total, block) => {
      if (block.type === "single") {
        return block.exerciseId ? total + 1 : total;
      }
      if (block.type === "superset") {
        return total + block.exercises.filter((exercise) => exercise.exerciseId).length;
      }
      return total;
    }, 0);

    const setCount = workout.blocks.reduce((total, block) => {
      if (block.type === "single") {
        return block.exerciseId ? total + block.sets.length : total;
      }
      if (block.type === "superset") {
        return (
          total +
          block.exercises.reduce(
            (sum, exercise) => sum + (exercise.exerciseId ? exercise.sets.length : 0),
            0
          )
        );
      }
      return total;
    }, 0);

    return {
      ...workout,
      meta: `${exerciseCount} exercises • ${setCount} sets • ~45 min • 32m TUT`,
    };
  });

  const weeklyVolumeHeights = [70, 75, 85, 80, 40, 50, 65, 95];

  const muscleDistribution = [
    { label: "Chest", sets: "12 sets", width: "60%" },
    { label: "Back", sets: "14 sets", width: "70%" },
    { label: "Shoulders", sets: "10 sets", width: "50%" },
    { label: "Quads", sets: "12 sets", width: "60%" },
    { label: "Hamstrings", sets: "8 sets", width: "40%" },
    { label: "Glutes", sets: "6 sets", width: "30%" },
    { label: "Biceps", sets: "6 sets", width: "30%" },
    { label: "Triceps", sets: "6 sets", width: "30%" },
    { label: "Calves", sets: "4 sets", width: "20%" },
    { label: "Abs", sets: "4 sets", width: "20%" },
  ];

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
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
        {/* Weekly Volume */}
        <div className="mb-4 px-1">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Weekly Volume (Sets)
            </span>
            <span className="text-[10px] font-bold tracking-tight text-primary">
              Avg: 52
            </span>
          </div>

          <div className="flex h-12 items-end justify-between gap-1.5 rounded-lg border border-slate-100/50 bg-white/30 px-2 py-1">
            {weeklyVolumeHeights.slice(0, programLength).map((height, index) => (
              <div
                key={index}
                className={[
                  "flex-1 rounded-t-sm transition-all duration-500 hover:opacity-80",
                  index === selectedWeek - 1 ? "bg-primary" : "bg-slate-200",
                ].join(" ")}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        {/* Week Tabs */}
        <div className="mb-6 w-full">
          <div
            className="grid rounded-lg bg-slate-100 p-1"
            style={{ gridTemplateColumns: `repeat(${programLength}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: programLength }).map((_, index) => {
              const week = index + 1;
              const isSelected = selectedWeek === week;

              return (
                <div key={week} className="relative flex items-center justify-center">
                  {index > 0 && (
                    <div className="absolute left-0 top-2 bottom-2 w-px bg-slate-200" />
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedWeek(week)}
                    className={[
                      "z-10 w-full rounded-md py-2 text-[10px] font-bold transition-all",
                      isSelected
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700",
                    ].join(" ")}
                  >
                    W{week}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="rounded-xl border border-slate-100 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Exercises", value: "18", width: "w-3/4" },
              { label: "Sets", value: "54", width: "w-2/3" },
              { label: "AVG. Time", value: "42m", width: "w-1/2" },
              { label: "AVG. TUT", value: "32m", width: "w-1/3" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {item.label}
                </span>
                <span className="text-sm font-bold text-slate-700">
                  {item.value}
                </span>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full bg-primary ${item.width}`} />
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
              {muscleDistribution.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                    <span className="text-slate-600">{item.label}</span>
                    <span className="text-primary">{item.sets}</span>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-primary"
                      style={{ width: item.width }}
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
              onClick={() =>
                navigate(`/program/manual-builder/workout/${workout.id}`)
              }
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
                    readOnly
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

          <div className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-white/50 p-6 transition-colors hover:border-primary/50">
            <div className="flex flex-col items-center justify-center gap-2">
              <span className="material-symbols-outlined text-slate-300 transition-colors hover:text-primary">
                add_circle
              </span>
              <span className="text-sm font-semibold text-slate-400 transition-colors hover:text-primary">
                Create Workout {sessionsPerWeek}
              </span>
            </div>
          </div>
        </div>

        <div className="h-28" />
      </main>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            className="flex w-full items-center justify-center rounded-xl bg-primary py-4 font-bold text-white"
          >
            <span>Publish Multi Week Program</span>
          </button>
        </div>
      </div>
    </div>
  );
}
