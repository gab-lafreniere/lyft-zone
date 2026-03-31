import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useManualProgram } from "../context/ManualProgramContext";
import { useMultiWeekProgram } from "../context/MultiWeekProgramContext";
import { getCycleBuilderPath } from "../features/multiWeek/routes";
import { createCycleFromWeeklyPlan } from "../services/api";

const WEEKDAY_ROWS = [
  { day: "MONDAY", shortLabel: "M", fullLabel: "Monday" },
  { day: "TUESDAY", shortLabel: "T", fullLabel: "Tuesday" },
  { day: "WEDNESDAY", shortLabel: "W", fullLabel: "Wednesday" },
  { day: "THURSDAY", shortLabel: "T", fullLabel: "Thursday" },
  { day: "FRIDAY", shortLabel: "F", fullLabel: "Friday" },
  { day: "SATURDAY", shortLabel: "S", fullLabel: "Saturday" },
  { day: "SUNDAY", shortLabel: "S", fullLabel: "Sunday" },
];

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

function buildInitialWeekdaySlots(workouts = []) {
  const orderedWorkouts = [...workouts].sort(
    (left, right) => (left.orderIndex || 0) - (right.orderIndex || 0)
  );

  return WEEKDAY_ROWS.map((entry, index) => ({
    ...entry,
    workout: orderedWorkouts[index]
      ? {
          id: orderedWorkouts[index].id,
          name: orderedWorkouts[index].name,
          orderIndex: orderedWorkouts[index].orderIndex,
          blocks: orderedWorkouts[index].blocks || [],
        }
      : null,
  }));
}

function moveWorkoutWithDownwardPush(slots, sourceIndex, direction) {
  const targetIndex = sourceIndex + direction;
  if (
    sourceIndex < 0 ||
    sourceIndex >= slots.length ||
    targetIndex < 0 ||
    targetIndex >= slots.length ||
    !slots[sourceIndex]?.workout
  ) {
    return null;
  }

  const nextSlots = slots.map((slot) => ({ ...slot }));
  const movingWorkout = nextSlots[sourceIndex].workout;
  nextSlots[sourceIndex] = {
    ...nextSlots[sourceIndex],
    workout: null,
  };

  let displacedWorkout = movingWorkout;
  for (let index = targetIndex; index < nextSlots.length; index += 1) {
    const existingWorkout = nextSlots[index].workout;
    nextSlots[index] = {
      ...nextSlots[index],
      workout: displacedWorkout,
    };
    displacedWorkout = existingWorkout;

    if (!displacedWorkout) {
      return nextSlots;
    }
  }

  return null;
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
  const templateWorkouts = useMemo(
    () =>
      [...(programDraft.workouts || [])].sort(
        (left, right) => (left.orderIndex || 0) - (right.orderIndex || 0)
      ),
    [programDraft.workouts]
  );
  const initialEndDate =
    programDraft.endDate ||
    formatDateInput(addWeeks(new Date(`${initialStartDate}T00:00:00`), initialProgramLength));

  const [startDate, setStartDate] = useState(initialStartDate);
  const [programLength, setProgramLength] = useState(initialProgramLength);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [weekdaySlots, setWeekdaySlots] = useState(() =>
    buildInitialWeekdaySlots(programDraft.workouts || [])
  );
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
  const weekdayAssignmentError = useMemo(() => {
    if (templateWorkouts.length === 0) {
      return "This weekly template has no workouts to convert.";
    }

    if (templateWorkouts.length > WEEKDAY_ROWS.length) {
      return "This weekly template has more than 7 workouts and cannot use weekday assignment in V1.";
    }

    const assignedWorkoutOrderIndexes = weekdaySlots
      .filter((slot) => slot.workout)
      .map((slot) => slot.workout.orderIndex);
    const uniqueAssignedOrderIndexes = new Set(assignedWorkoutOrderIndexes);

    if (assignedWorkoutOrderIndexes.length !== templateWorkouts.length) {
      return "Each workout must be assigned exactly once.";
    }

    if (uniqueAssignedOrderIndexes.size !== assignedWorkoutOrderIndexes.length) {
      return "Each workout must be assigned exactly once.";
    }

    const expectedWorkoutOrderIndexes = templateWorkouts.map((workout) => workout.orderIndex);
    if (
      expectedWorkoutOrderIndexes.some(
        (orderIndex) => !uniqueAssignedOrderIndexes.has(orderIndex)
      )
    ) {
      return "Each workout must be assigned exactly once.";
    }

    return "";
  }, [templateWorkouts, weekdaySlots]);

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

  const handleMoveWorkout = (sourceIndex, direction) => {
    setWeekdaySlots((prev) => {
      const nextSlots = moveWorkoutWithDownwardPush(prev, sourceIndex, direction);
      return nextSlots || prev;
    });
    setSubmitError("");
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

      if (weekdayAssignmentError) {
        throw new Error(weekdayAssignmentError);
      }

      const response = await createCycleFromWeeklyPlan({
        weeklyPlanParentId: draftMetadata.weeklyPlanParentId,
        name: programName,
        startDate,
        endDate,
        durationWeeks: Number(derivedProgramLength),
        workoutDayAssignments: weekdaySlots
          .filter((slot) => slot.workout)
          .map((slot) => ({
            workoutOrderIndex: slot.workout.orderIndex,
            scheduledDay: slot.day,
          })),
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

          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-bold leading-tight tracking-tight">
                Weekly Schedule
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Assign each workout to a weekday before this template is duplicated across all weeks.
              </p>
            </div>

            <div className="space-y-3">
              {weekdaySlots.map((slot, index) => {
                const canMoveUp = Boolean(moveWorkoutWithDownwardPush(weekdaySlots, index, -1));
                const canMoveDown = Boolean(moveWorkoutWithDownwardPush(weekdaySlots, index, 1));

                return (
                  <div
                    key={slot.day}
                    className="flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100">
                      <span className="text-base font-black text-slate-900">
                        {slot.shortLabel}
                      </span>
                      <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {slot.fullLabel.slice(0, 3)}
                      </span>
                    </div>

                    {slot.workout ? (
                      <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">
                              {slot.workout.name}
                            </p>
                            <p className="mt-1 text-[11px] font-medium text-slate-500">
                              Workout {slot.workout.orderIndex}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleMoveWorkout(index, -1)}
                              disabled={!canMoveUp}
                              className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Move ${slot.workout.name} up`}
                            >
                              <span className="material-symbols-outlined text-base">arrow_upward</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveWorkout(index, 1)}
                              disabled={!canMoveDown}
                              className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Move ${slot.workout.name} down`}
                            >
                              <span className="material-symbols-outlined text-base">arrow_downward</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[76px] flex-1 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4">
                        <p className="text-sm font-medium text-slate-400">Rest day</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {weekdayAssignmentError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {weekdayAssignmentError}
              </div>
            )}
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
            disabled={isSubmitting || !draftMetadata.weeklyPlanParentId || Boolean(weekdayAssignmentError)}
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
