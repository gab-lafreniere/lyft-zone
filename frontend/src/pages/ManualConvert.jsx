import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useManualProgram } from "../context/ManualProgramContext";
import { useMultiWeekProgram } from "../context/MultiWeekProgramContext";
import { getCycleBuilderPath } from "../features/multiWeek/routes";
import { createCycleFromWeeklyPlan } from "../services/api";

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addWeeks(date, weeks) {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7 - 1);
  return next;
}

function addDays(dateValue, days) {
  const next = new Date(`${dateValue}T00:00:00`);
  next.setDate(next.getDate() + days);
  return formatDateInput(next);
}

function getTodayDateInput() {
  return formatDateInput(new Date());
}

function calculateDurationWeeks(startDateValue, endDateValue) {
  const startDate = new Date(`${startDateValue}T00:00:00`);
  const endDate = new Date(`${endDateValue}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  const dayDifference = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);
  if (dayDifference < 0) {
    return null;
  }

  return Math.floor(dayDifference / 7) + 1;
}

function clampDateString(value, minValue, maxValue) {
  if (!value) {
    return maxValue;
  }

  if (value < minValue) {
    return minValue;
  }

  if (value > maxValue) {
    return maxValue;
  }

  return value;
}

export default function ManualConvert() {
  const navigate = useNavigate();
  const { programDraft, draftMetadata } = useManualProgram();
  const { hydrateProgramDraft } = useMultiWeekProgram();

  const programName = programDraft.programName || "New Program";
  const sessionsPerWeek = programDraft.sessionsPerWeek || 4;
  const todayDate = getTodayDateInput();
  const initialStartDate = programDraft.startDate || todayDate;
  const initialProgramLength = programDraft.programLength || 8;
  const initialEndDate =
    programDraft.endDate ||
    formatDateInput(addWeeks(new Date(`${initialStartDate}T00:00:00`), initialProgramLength));

  const [startDate, setStartDate] = useState(initialStartDate);
  const [programLength, setProgramLength] = useState(initialProgramLength);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const previewText = useMemo(() => {
    return `This ${programLength}-week program will duplicate your ${sessionsPerWeek}-session weekly template across all weeks.`;
  }, [programLength, sessionsPerWeek]);

  const finalWeekStartDate = useMemo(
    () => addDays(startDate || todayDate, Math.max(0, (programLength - 1) * 7)),
    [programLength, startDate, todayDate]
  );
  const finalWeekEndDate = useMemo(
    () => addDays(startDate || todayDate, Math.max(0, programLength * 7 - 1)),
    [programLength, startDate, todayDate]
  );

  const handleLengthChange = (weeks) => {
    setProgramLength(weeks);

    const nextFinalWeekStart = addDays(startDate || todayDate, Math.max(0, (weeks - 1) * 7));
    const nextFinalWeekEnd = addDays(startDate || todayDate, Math.max(0, weeks * 7 - 1));
    setEndDate((prev) => clampDateString(prev, nextFinalWeekStart, nextFinalWeekEnd));
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);

    const nextFinalWeekStart = addDays(value, Math.max(0, (programLength - 1) * 7));
    const nextFinalWeekEnd = addDays(value, Math.max(0, programLength * 7 - 1));
    setEndDate((prev) => clampDateString(prev, nextFinalWeekStart, nextFinalWeekEnd));
  };

  const handleEndDateChange = (value) => {
    setEndDate(clampDateString(value, finalWeekStartDate, finalWeekEndDate));
  };

  const handleConvert = async () => {
    if (!draftMetadata.weeklyPlanParentId || isSubmitting) {
      return;
    }

    setSubmitError("");
    setIsSubmitting(true);

    try {
      const derivedProgramLength = calculateDurationWeeks(startDate, endDate);

      if (!startDate || !endDate || derivedProgramLength == null) {
        throw new Error("Please choose a valid future date range.");
      }

      const response = await createCycleFromWeeklyPlan({
        weeklyPlanParentId: draftMetadata.weeklyPlanParentId,
        name: programName,
        startDate,
        endDate,
        durationWeeks: Number(derivedProgramLength),
      });

      hydrateProgramDraft(response);
      navigate(getCycleBuilderPath(response.cycleId));
    } catch (error) {
      setSubmitError(error.message || "Unable to convert this weekly plan");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-x-hidden pb-32">
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
          <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-4">
              <div className="rounded-lg bg-primary/20 p-3 text-primary">
                <span className="material-symbols-outlined">fitness_center</span>
              </div>

              <div>
                <h2 className="text-xl font-bold">Multi week program</h2>
                <p className="text-sm text-slate-500">{programName}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold leading-tight tracking-tight">
              Timeline Settings
            </h3>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-600">
                Start Date
              </label>

              <div className="relative flex items-center">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  placeholder="Select start date"
                  min={todayDate}
                  className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary"
                />
                <span className="material-symbols-outlined absolute left-4 text-primary">
                  calendar_today
                </span>
              </div>
            </div>

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
              {!([6, 7, 8].includes(programLength)) && (
                <p className="text-xs font-medium text-primary">
                  Custom length: {programLength} weeks
                </p>
              )}
            </div>

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
                  type="date"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  min={finalWeekStartDate}
                  max={finalWeekEndDate}
                  className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary"
                />
                <span className="material-symbols-outlined absolute left-4 text-slate-400">
                  event_available
                </span>
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">info</span>
              <p className="text-sm text-slate-600">{previewText}</p>
            </div>
          </div>

          {submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {submitError}
            </div>
          )}
        </main>

        <footer className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-background-light/80 p-6 backdrop-blur-md">
          <button
            type="button"
            onClick={handleConvert}
            disabled={isSubmitting || !draftMetadata.weeklyPlanParentId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-bold text-slate-900 shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating..." : "Convert to Multi week"}
            <span className="material-symbols-outlined">add_circle</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
