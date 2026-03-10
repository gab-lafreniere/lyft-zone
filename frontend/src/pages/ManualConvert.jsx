import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useManualProgram } from "../context/ManualProgramContext";

function formatDateInput(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addWeeks(date, weeks) {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7 - 1);
  return next;
}

export default function ManualConvert() {
  const navigate = useNavigate();
  const { programDraft, updateProgramMeta, toggleMultiWeek } = useManualProgram();

  const programName = programDraft.programName || "New Program";
  const sessionsPerWeek = programDraft.sessionsPerWeek || 4;

  const [startDate, setStartDate] = useState(programDraft.startDate || "Oct 24, 2023");
  const [programLength, setProgramLength] = useState(programDraft.programLength || 8);
  const [endDate, setEndDate] = useState(programDraft.endDate || "Dec 19, 2023");

  const previewText = useMemo(() => {
    return `This ${programLength}-week program will duplicate your ${sessionsPerWeek}-session weekly template across all weeks.`;
  }, [programLength, sessionsPerWeek]);

  const handleLengthChange = (weeks) => {
    setProgramLength(weeks);

    const parsed = new Date(startDate);
    if (!Number.isNaN(parsed.getTime())) {
      setEndDate(formatDateInput(addWeeks(parsed, weeks)));
    }
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setEndDate(formatDateInput(addWeeks(parsed, programLength)));
    }
  };

  const handleConvert = () => {
    updateProgramMeta({
      startDate,
      endDate,
      programLength,
    });
    toggleMultiWeek(true);
    navigate("/program/manual-builder-multi");
  };

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-x-hidden pb-32">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
          <div className="flex items-center justify-between p-4">
            <button
              type="button"
              onClick={() => navigate("/program/manual-builder")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-900 transition-colors hover:bg-slate-200/50"
              aria-label="Back"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>

            <h1 className="flex-1 pr-10 text-center text-lg font-bold leading-tight tracking-tight">
              Create Program
            </h1>
          </div>
        </header>

        <main className="flex flex-col gap-6 px-4 pt-6">
          {/* Program Identity */}
          <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-4">
              <div className="rounded-lg bg-primary/20 p-3 text-primary">
                <span className="material-symbols-outlined">
                  fitness_center
                </span>
              </div>

              <div>
                <h2 className="text-xl font-bold">Multi week program</h2>
                <p className="text-sm text-slate-500">{programName}</p>
              </div>
            </div>
          </div>

          {/* Timeline Settings */}
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold leading-tight tracking-tight">
              Timeline Settings
            </h3>

            {/* Start Date */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-600">
                Start Date
              </label>

              <div className="relative flex items-center">
                <input
                  type="text"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  placeholder="Select start date"
                  className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary"
                />
                <span className="material-symbols-outlined absolute left-4 text-primary">
                  calendar_today
                </span>
              </div>
            </div>

            {/* Program Length */}
            <div className="flex flex-col gap-2 pt-2">
              <label className="text-sm font-medium text-slate-600">
                Program Length
              </label>

              <div className="flex h-12 w-full items-center justify-center rounded-xl bg-slate-100 p-1">
                {[6, 7, 8].map((weeks) => {
                  const checked = programLength === weeks;

                  return (
                    <button
                      key={weeks}
                      type="button"
                      onClick={() => handleLengthChange(weeks)}
                      className={[
                        "flex h-full grow items-center justify-center overflow-hidden rounded-lg px-2 text-sm font-bold transition-all",
                        checked
                          ? "bg-white text-primary shadow-sm"
                          : "text-slate-500",
                      ].join(" ")}
                    >
                      <span className="truncate">{weeks} weeks</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* End Date */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-600">
                  End Date (Auto-calculated)
                </label>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Editable
                </span>
              </div>

              <div className="relative flex items-center">
                <input
                  type="text"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary"
                />
                <span className="material-symbols-outlined absolute left-4 text-slate-400">
                  event_available
                </span>
              </div>
            </div>
          </div>

          {/* Info Card */}
          <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">
                info
              </span>
              <p className="text-sm text-slate-600">{previewText}</p>
            </div>
          </div>
        </main>

        {/* Footer CTA */}
        <footer className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-background-light/80 p-6 backdrop-blur-md">
          <button
            type="button"
            onClick={handleConvert}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-bold text-slate-900 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          >
            Convert to Multi week
            <span className="material-symbols-outlined">add_circle</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
