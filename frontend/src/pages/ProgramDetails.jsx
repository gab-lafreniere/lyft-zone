import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const whiteThumb =
  "https://dummyimage.com/160x160/ffffff/cbd5e1.png&text=Exercise";

const programs = {
  "v-taper-foundation": {
    id: "v-taper-foundation",
    name: "V-Taper Foundation",
    status: "draft",
    source: "manual",
    summary: {
      frequencyPerWeek: 4,
      workoutCount: 4,
      totalWeeklySets: 48,
      totalExercises: 22,
      averageWorkoutDurationMinutes: 55,
      averageWorkoutTUTMinutes: 35,
    },
    workouts: [
      {
        id: "w1",
        name: "Workout 1: Upper Power",
        metrics: {
          exerciseCount: 6,
          setCount: 18,
          estimatedDurationMinutes: 75,
        },
        blocks: [
          {
            id: "b1",
            type: "single",
            orderIndex: 1,
            exercise: {
              name: "Barbell Bench Press",
              imageUrl: whiteThumb,
            },
            prescription: {
              setCount: 3,
              repsLabel: "8",
              tempoLabel: "3-1-1-0",
              restLabel: "180s",
            },
            notes:
              "Focus on explosion on the concentric phase. Keep back pinned.",
          },
          {
            id: "b2",
            type: "single",
            orderIndex: 2,
            exercise: {
              name: "Incline Dumbbell Press",
              imageUrl: whiteThumb,
            },
            prescription: {
              setCount: 3,
              repsLabel: "10",
              tempoLabel: "3-1-1-0",
              restLabel: "90s",
            },
          },
          {
            id: "b3",
            type: "single",
            orderIndex: 3,
            exercise: {
              name: "Weighted Dips",
              imageUrl: whiteThumb,
            },
            prescription: {
              setCount: 3,
              repsLabel: "10",
              tempoLabel: "3-1-1-0",
              restLabel: "90s",
            },
          },
          {
            id: "b4",
            type: "superset",
            orderIndex: 4,
            label: "Superset A",
            restLabel: "90s",
            exercises: [
              {
                laneLabel: "A1",
                name: "Pull-Ups",
                imageUrl: whiteThumb,
                prescription: {
                  setCount: 4,
                  repsLabel: "10",
                  tempoLabel: "2-0-1-0",
                },
              },
              {
                laneLabel: "A2",
                name: "Dumbbell Lateral Raise",
                imageUrl: whiteThumb,
                prescription: {
                  setCount: 4,
                  repsLabel: "15",
                  tempoLabel: "2-0-1-0",
                },
              },
            ],
          },
        ],
      },
      {
        id: "w2",
        name: "Workout 2: Lower Power",
        metrics: {
          exerciseCount: 5,
          setCount: 15,
          estimatedDurationMinutes: 65,
        },
        blocks: [],
      },
      {
        id: "w3",
        name: "Workout 3: Upper Volume",
        metrics: {
          exerciseCount: 6,
          setCount: 16,
          estimatedDurationMinutes: 60,
        },
        blocks: [],
      },
      {
        id: "w4",
        name: "Workout 4: Lower Volume",
        metrics: {
          exerciseCount: 5,
          setCount: 14,
          estimatedDurationMinutes: 58,
        },
        blocks: [],
      },
    ],
    weeklyMuscleDistribution: [
      { label: "Chest & Back", percentage: 40 },
      { label: "Legs & Posterior", percentage: 35 },
      { label: "Shoulders & Arms", percentage: 25 },
    ],
  },
};

function formatMinutes(value) {
    return `${value}m`;
  }
  
  function getMetricBarWidth(value, maxValue) {
    if (value <= 0 || maxValue <= 0) {
      return "0%";
    }
  
    return `${Math.max(8, Math.min(100, (value / maxValue) * 100))}%`;
  }

export default function ProgramDetails() {
  const navigate = useNavigate();
  const { programId } = useParams();

  const program = useMemo(
    () => programs[programId] || programs["v-taper-foundation"],
    [programId]
  );

  const [activeWorkoutId, setActiveWorkoutId] = useState(
    program.workouts[0]?.id || null
  );

  const activeWorkout =
    program.workouts.find((workout) => workout.id === activeWorkoutId) ||
    program.workouts[0];
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);

  const topStats = useMemo(
    () => [
      {
        label: "Exercises",
        value: String(program.summary.totalExercises),
        width: getMetricBarWidth(program.summary.totalExercises, 32),
      },
      {
        label: "Sets",
        value: String(program.summary.totalWeeklySets),
        width: getMetricBarWidth(program.summary.totalWeeklySets, 80),
      },
      {
        label: "AVG. Time",
        value: formatMinutes(program.summary.averageWorkoutDurationMinutes),
        width: getMetricBarWidth(program.summary.averageWorkoutDurationMinutes, 120),
      },
      {
        label: "AVG. TUT",
        value: formatMinutes(program.summary.averageWorkoutTUTMinutes),
        width: getMetricBarWidth(program.summary.averageWorkoutTUTMinutes, 60),
      },
    ],
    [program]
  );

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
            <button
            type="button"
            onClick={() => navigate("/program/all")}
            className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
            >
            <span className="material-symbols-outlined text-slate-700">
                arrow_back
            </span>
            </button>

            <h1 className="truncate text-lg font-bold tracking-tight">
            {program.name}
            </h1>
        </div>

        <button
            type="button"
            onClick={() => navigate("/program/manual-builder")}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Edit program settings"
        >
            <span className="material-symbols-outlined text-xl font-light">
            settings
            </span>
        </button>
        </div>
      </header>

      <main className="px-4 pb-24 pt-4 space-y-6">
        <section className="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm">
          <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative z-10 space-y-5">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                Program Name
              </p>
              <h2 className="text-2xl font-bold">{program.name}</h2>
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:bg-slate-200"
            >
              Start training
            </button>
          </div>
        </section>

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
                {program.weeklyMuscleDistribution.map((item) => (
                    <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                        <span className="text-slate-600">{item.label}</span>
                        <span className="text-primary">{item.percentage}%</span>
                    </div>

                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                        className="h-full bg-primary"
                        style={{ width: `${item.percentage}%` }}
                        />
                    </div>
                    </div>
                ))}
                </div>
            )}
        </div>

        <nav className="hide-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
          {program.workouts.map((workout) => {
            const isActive = workout.id === activeWorkout?.id;

            return (
              <button
                key={workout.id}
                type="button"
                onClick={() => setActiveWorkoutId(workout.id)}
                className={[
                  "shrink-0 rounded-full px-6 py-2 text-xs font-bold whitespace-nowrap transition-colors",
                  isActive
                    ? "border border-primary/20 bg-primary/10 text-primary"
                    : "bg-white text-slate-500 hover:bg-slate-100",
                ].join(" ")}
              >
                Workout {workout.name.split(":")[0].replace("Workout ", "")}
              </button>
            );
          })}
        </nav>

        {activeWorkout && (
          <section className="space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <h3 className="text-xl font-bold">{activeWorkout.name}</h3>
              <div className="mt-2 flex gap-4 text-[11px] font-semibold text-slate-500">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    fitness_center
                  </span>
                  {activeWorkout.metrics.exerciseCount} exercises
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    layers
                  </span>
                  {activeWorkout.metrics.setCount} sets
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    schedule
                  </span>
                  {activeWorkout.metrics.estimatedDurationMinutes} min
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {activeWorkout.blocks.map((block) => {
                if (block.type === "single") {
                  return (
                    <div
                      key={block.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="relative mb-4 flex items-center gap-4">
                        <div className="absolute -left-1 -top-1 flex size-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
                          {block.orderIndex}
                        </div>

                        <img
                          src={block.exercise.imageUrl}
                          alt={block.exercise.name}
                          className="ml-10 h-16 w-16 rounded-lg border border-slate-200 bg-white object-contain p-1"
                        />

                        <h4 className="text-xl font-bold">{block.exercise.name}</h4>
                      </div>

                      <div className="mb-4 grid grid-cols-4 gap-2 border-y border-slate-200 py-4">
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            Sets
                          </p>
                          <p className="text-base font-bold text-primary">
                            {block.prescription.setCount}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            Reps
                          </p>
                          <p className="text-base font-bold">
                            {block.prescription.repsLabel}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            Tempo
                          </p>
                          <p className="text-[11px] font-bold">
                            {block.prescription.tempoLabel}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            Rest
                          </p>
                          <p className="text-base font-bold">
                            {block.prescription.restLabel}
                          </p>
                        </div>
                      </div>

                      {block.notes && (
                        <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-3">
                          <span className="material-symbols-outlined text-[18px] text-primary">
                            info
                          </span>
                          <p className="text-[11px] italic leading-relaxed text-slate-600">
                            Note: {block.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={block.id}
                    className="rounded-2xl border border-slate-200 bg-slate-100 p-4"
                  >
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
                        {block.orderIndex}
                      </div>

                      <span className="material-symbols-outlined text-[18px] text-primary">
                        dynamic_feed
                      </span>

                      <h5 className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                        {block.label}
                      </h5>
                    </div>

                    <div className="space-y-3">
                      {block.exercises.map((exercise) => (
                        <div
                          key={exercise.laneLabel}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="mb-4 flex items-center gap-4">
                            <div className="flex size-7 items-center justify-center rounded-md bg-slate-600 text-[10px] font-bold text-white">
                              {exercise.laneLabel}
                            </div>

                            <img
                              src={exercise.imageUrl}
                              alt={exercise.name}
                              className="h-14 w-14 rounded-lg border border-slate-200 bg-white object-contain p-1"
                            />

                            <h4 className="text-lg font-bold">{exercise.name}</h4>
                          </div>

                          <div className="grid grid-cols-3 gap-2 border-t border-slate-200 py-3">
                            <div className="text-center">
                              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                                Sets
                              </p>
                              <p className="text-sm font-bold text-primary">
                                {exercise.prescription.setCount}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                                Reps
                              </p>
                              <p className="text-sm font-bold">
                                {exercise.prescription.repsLabel}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                                Tempo
                              </p>
                              <p className="text-[10px] font-bold">
                                {exercise.prescription.tempoLabel}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex justify-center">
                      <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-5 py-2 text-primary">
                        <span className="material-symbols-outlined text-[16px]">
                          timer
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest">
                          Shared Rest: {block.restLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}