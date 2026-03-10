import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useManualProgram } from "../context/ManualProgramContext";

export default function ManualNewProgram() {
  const navigate = useNavigate();
  const { createProgramDraft } = useManualProgram();
  const [programName, setProgramName] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);

  const decrementSessions = () => {
    setSessionsPerWeek((prev) => Math.max(1, prev - 1));
  };

  const incrementSessions = () => {
    setSessionsPerWeek((prev) => Math.min(7, prev + 1));
  };

  const handleCreate = () => {
    createProgramDraft({
      programName: programName.trim() || "New Program",
      sessionsPerWeek,
    });
    navigate("/program/manual-builder");
  };

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate("/program")}
            className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-slate-700">
              arrow_back
            </span>
          </button>

          <h1 className="text-lg font-bold tracking-tight">New Program</h1>

          <div className="size-10" />
        </div>
      </header>

      <main className="px-4 py-8 space-y-8">
        <section className="space-y-3">
          <label className="block px-1 text-sm font-bold uppercase tracking-wider text-slate-500">
            Program Name
          </label>

          <input
            type="text"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            placeholder="Upper Lower Strength - October 2025"
            className="h-14 w-full rounded-xl border border-slate-200 bg-white px-4 font-medium outline-none transition-all placeholder:text-sm placeholder:text-slate-400 focus:border-transparent focus:ring-2 focus:ring-primary"
          />
        </section>

        <section className="space-y-4">
          <div className="px-1">
            <label className="block text-sm font-bold uppercase tracking-wider text-slate-500">
              Sessions Per Week
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Number of workouts in your weekly template
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={decrementSessions}
                className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
                aria-label="Decrease sessions"
              >
                <span className="material-symbols-outlined text-3xl">
                  remove
                </span>
              </button>

              <div className="flex-1 text-center">
                <span className="text-5xl font-black text-slate-900">
                  {sessionsPerWeek}
                </span>
                <span className="mt-1 block text-sm font-semibold text-primary">
                  Workouts
                </span>
              </div>

              <button
                type="button"
                onClick={incrementSessions}
                className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
                aria-label="Increase sessions"
              >
                <span className="material-symbols-outlined text-3xl">add</span>
              </button>
            </div>

            <div className="mt-8 flex justify-center gap-2">
              {Array.from({ length: 7 }).map((_, index) => (
                <div
                  key={index}
                  className={[
                    "h-1.5 w-8 rounded-full",
                    index < sessionsPerWeek ? "bg-primary" : "bg-slate-200",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="rounded-lg bg-primary/20 p-2">
            <span className="material-symbols-outlined text-primary">
              fitness_center
            </span>
          </div>

          <div>
            <h4 className="font-bold text-slate-800">
              Manual Mode: Workout Plan
            </h4>
            <p className="mt-0.5 text-sm text-slate-500">
              Define your own split, sets, and rep ranges from scratch.
            </p>
          </div>
        </div>

        <div className="h-24" />
      </main>

      <footer className="sticky bottom-0 z-40 border-t border-slate-200 bg-background-light/80 p-4 backdrop-blur-md">
        <button
          type="button"
          onClick={handleCreate}
          className="w-full rounded-xl bg-primary py-4 font-bold text-white shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          Create Weekly Template
        </button>
      </footer>
    </div>
  );
}
