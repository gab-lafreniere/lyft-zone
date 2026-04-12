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

function parseDateInput(value) {
  return new Date(`${value}T00:00:00`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date, weeks) {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7 - 1);
  return next;
}

function getTodayDateInput() {
  return formatDateInput(new Date());
}

function getNextMondayDateInput(dateValue = getTodayDateInput()) {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = date.getDay();
  const daysUntilMonday = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
  return formatDateInput(date);
}

function getCurrentWeekMondayDateInput(dateValue = getTodayDateInput()) {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = date.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - daysSinceMonday);
  return formatDateInput(date);
}

function getStartOfMonthDate(dateValue) {
  const date = dateValue instanceof Date ? new Date(dateValue) : parseDateInput(dateValue);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(dateValue, months) {
  const date = dateValue instanceof Date ? new Date(dateValue) : parseDateInput(dateValue);
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatDisplayDate(value) {
  if (!value) {
    return "--";
  }

  return parseDateInput(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthHeading(dateValue) {
  return dateValue.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatWeekRange(startDateValue) {
  const startDate = parseDateInput(startDateValue);
  const endDate = addDays(startDate, 6);
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = endDate.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });

  return `${startLabel} to ${endLabel}`;
}

function buildWeekOptionsForMonth(monthDate, minStartDateValue, selectedStartDateValue = null) {
  const minStartDate = parseDateInput(minStartDateValue);
  const monthStart = getStartOfMonthDate(monthDate);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const firstWeekStart = parseDateInput(getNextMondayDateInput(formatDateInput(addDays(monthStart, -1))));
  const monthIndex = monthStart.getMonth();
  const year = monthStart.getFullYear();
  const normalizedSelectedValue =
    selectedStartDateValue && isMondayDateInput(selectedStartDateValue)
      ? selectedStartDateValue
      : null;
  const options = [];

  for (let cursor = firstWeekStart; cursor <= monthEnd; cursor = addDays(cursor, 7)) {
    const optionValue = formatDateInput(cursor);
    const mondayBelongsToDisplayedMonth =
      cursor.getMonth() === monthIndex && cursor.getFullYear() === year;
    const isSelected = optionValue === normalizedSelectedValue;

    if (optionValue < minStartDateValue || (!mondayBelongsToDisplayedMonth && !isSelected)) {
      continue;
    }

    options.push({
      value: optionValue,
      label: formatWeekRange(optionValue),
      monthLabel: formatMonthHeading(cursor),
      isCurrentWeek: optionValue === formatDateInput(minStartDate),
      isSelectedOutsideMonth: isSelected && !mondayBelongsToDisplayedMonth,
    });
  }

  if (
    normalizedSelectedValue &&
    !options.some((option) => option.value === normalizedSelectedValue)
  ) {
    const selectedDate = parseDateInput(normalizedSelectedValue);
    if (normalizedSelectedValue >= minStartDateValue) {
      options.unshift({
        value: normalizedSelectedValue,
        label: formatWeekRange(normalizedSelectedValue),
        monthLabel: formatMonthHeading(selectedDate),
        isCurrentWeek: normalizedSelectedValue === formatDateInput(minStartDate),
        isSelectedOutsideMonth: true,
      });
    }
  }

  return options;
}

function isMondayDateInput(value) {
  if (!value) {
    return false;
  }

  return new Date(`${value}T00:00:00`).getDay() === 1;
}

function buildInitialWeekdaySlots(workouts = []) {
  const orderedWorkouts = [...workouts].map((workout, index) => ({
    ...workout,
    orderIndex: workout.orderIndex ?? index + 1,
  }));

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
  const initialStartDate = isMondayDateInput(programDraft.startDate)
    ? programDraft.startDate
    : getNextMondayDateInput(programDraft.startDate || todayDate);
  const initialProgramLength = programDraft.programLength || 8;
  const minStartDate = useMemo(() => getCurrentWeekMondayDateInput(todayDate), [todayDate]);
  const templateWorkouts = useMemo(
    () =>
      [...(programDraft.workouts || [])].map((workout, index) => ({
        ...workout,
        orderIndex: workout.orderIndex ?? index + 1,
      })),
    [programDraft.workouts]
  );

  const [startDate, setStartDate] = useState(initialStartDate);
  const [programLength, setProgramLength] = useState(initialProgramLength);
  const [weekdaySlots, setWeekdaySlots] = useState(() =>
    buildInitialWeekdaySlots(programDraft.workouts || [])
  );
  const [isWeekPickerOpen, setIsWeekPickerOpen] = useState(false);
  const [weekPickerMonth, setWeekPickerMonth] = useState(() =>
    getStartOfMonthDate(initialStartDate)
  );
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const previewText = useMemo(() => {
    return `This ${programLength}-week program will duplicate your ${sessionsPerWeek}-session weekly template across all weeks.`;
  }, [programLength, sessionsPerWeek]);

  const endDate = useMemo(
    () =>
      startDate
        ? formatDateInput(addWeeks(new Date(`${startDate}T00:00:00`), programLength))
        : "",
    [programLength, startDate]
  );
  const weekdayAssignmentError = useMemo(() => {
    if (templateWorkouts.length === 0) {
      return "This weekly template has no workouts to convert.";
    }
  
    if (templateWorkouts.length > WEEKDAY_ROWS.length) {
      return "This weekly template has more than 7 workouts and cannot use weekday assignment in V1.";
    }
  
    const assignedWorkoutIds = weekdaySlots
      .filter((slot) => slot.workout)
      .map((slot) => slot.workout.id);
  
    const uniqueAssignedWorkoutIds = new Set(assignedWorkoutIds);
  
    if (assignedWorkoutIds.length !== templateWorkouts.length) {
      return "Each workout must be assigned exactly once.";
    }
  
    if (uniqueAssignedWorkoutIds.size !== assignedWorkoutIds.length) {
      return "Each workout must be assigned exactly once.";
    }
  
    const expectedWorkoutIds = templateWorkouts.map((workout) => workout.id);
  
    if (expectedWorkoutIds.some((id) => !uniqueAssignedWorkoutIds.has(id))) {
      return "Each workout must be assigned exactly once.";
    }
  
    return "";
  }, [templateWorkouts, weekdaySlots]);
  const selectedStartDateLabel = useMemo(() => formatDisplayDate(startDate), [startDate]);
  const visibleWeekOptions = useMemo(
    () => buildWeekOptionsForMonth(weekPickerMonth, minStartDate, startDate),
    [minStartDate, startDate, weekPickerMonth]
  );
  const canGoToPreviousMonth = useMemo(
    () => buildWeekOptionsForMonth(addMonths(weekPickerMonth, -1), minStartDate, startDate).length > 0,
    [minStartDate, startDate, weekPickerMonth]
  );
  const weekPickerMonthLabel = useMemo(
    () => formatMonthHeading(weekPickerMonth),
    [weekPickerMonth]
  );

  const handleLengthChange = (weeks) => {
    setProgramLength(weeks);
    setSubmitError("");
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    setSubmitError("");
  };

  const openWeekPicker = () => {
    setWeekPickerMonth(getStartOfMonthDate(startDate || minStartDate));
    setIsWeekPickerOpen(true);
  };

  const closeWeekPicker = () => {
    setIsWeekPickerOpen(false);
  };

  const handleSelectWeek = (value) => {
    handleStartDateChange(value);
    closeWeekPicker();
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
      if (!startDate) {
        throw new Error("Please choose a valid start date.");
      }

      if (!isMondayDateInput(startDate)) {
        throw new Error("Start date must be a Monday.");
      }

      if (weekdayAssignmentError) {
        throw new Error(weekdayAssignmentError);

      }

      const workoutOrderIndexById = new Map(
        templateWorkouts.map((workout, index) => [
          workout.id,
          workout.orderIndex ?? index + 1,
        ])
      );
      const response = await createCycleFromWeeklyPlan({
        weeklyPlanParentId: draftMetadata.weeklyPlanParentId,
        name: programName,
        startDate,
        durationWeeks: Number(programLength),
        workoutDayAssignments: weekdaySlots
          .filter((slot) => slot.workout)
          .map((slot) => ({
            workoutOrderIndex: workoutOrderIndexById.get(slot.workout.id),
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

        <main className="flex flex-col gap-5 px-4 pt-5">
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/15 p-2 text-primary">
                <span className="material-symbols-outlined text-[20px]">fitness_center</span>
              </div>

              <div>
                <h2 className="text-lg font-bold leading-tight">Multi week program</h2>
                <p className="text-xs text-slate-500">{programName}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3.5">
            <h3 className="text-lg font-bold leading-tight tracking-tight">
              Timeline Settings
            </h3>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-600">
                Start Date
              </label>

              <div className="relative flex items-center">
                <button
                  type="button"
                  onClick={openWeekPicker}
                  className="flex h-14 w-full items-center rounded-xl border border-slate-200 bg-white pl-12 pr-12 text-left outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary"
                  aria-label="Select start week"
                >
                  <span className="truncate text-sm font-medium text-slate-900">
                    {selectedStartDateLabel}
                  </span>
                </button>
                <span className="material-symbols-outlined absolute left-4 text-primary">
                  calendar_today
                </span>
                <span className="material-symbols-outlined absolute right-4 text-slate-400">
                  expand_more
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Choose a start week. The selected start date remains the Monday of that week.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 pt-1">
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

            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-600">
                  End Date (Auto-calculated)
                </label>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Derived
                </span>
              </div>

              <div className="relative flex h-14 items-center rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm font-medium text-slate-600">
                <span>{endDate || "--"}</span>
                <span className="material-symbols-outlined absolute left-4 text-slate-400">
                  event_available
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-lg font-bold leading-tight tracking-tight">
                Weekly Schedule
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Assign each workout to a weekday before this template is duplicated across all weeks.
              </p>
            </div>

            <div className="space-y-2">
              {weekdaySlots.map((slot, index) => {
                const canMoveUp = Boolean(moveWorkoutWithDownwardPush(weekdaySlots, index, -1));
                const canMoveDown = Boolean(moveWorkoutWithDownwardPush(weekdaySlots, index, 1));

                return (
                  <div
                    key={slot.day}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                  >
                    <div className="flex w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100 py-2">
                      <span className="text-sm font-black text-slate-900">
                        {slot.shortLabel}
                      </span>
                      <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                        {slot.fullLabel.slice(0, 3)}
                      </span>
                    </div>

                    {slot.workout ? (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {slot.workout.name}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                              Workout {slot.workout.orderIndex ?? "—"}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleMoveWorkout(index, -1)}
                              disabled={!canMoveUp}
                              className="flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Move ${slot.workout.name} up`}
                            >
                              <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveWorkout(index, 1)}
                              disabled={!canMoveDown}
                              className="flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Move ${slot.workout.name} down`}
                            >
                              <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[52px] flex-1 items-center rounded-lg bg-slate-50 px-3">
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

        {isWeekPickerOpen && (
          <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/40 backdrop-blur-sm">
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close week picker"
              onClick={closeWeekPicker}
            />

            <div className="relative w-full rounded-t-3xl bg-white p-5 shadow-2xl">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                    Start Date
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">
                    Select a start week
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeWeekPicker}
                  className="flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close week picker"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="mb-4 flex items-center justify-between rounded-2xl bg-slate-50 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setWeekPickerMonth((prev) => addMonths(prev, -1))}
                  disabled={!canGoToPreviousMonth}
                  className="flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Previous month"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>

                <p className="text-sm font-bold text-slate-900">{weekPickerMonthLabel}</p>

                <button
                  type="button"
                  onClick={() => setWeekPickerMonth((prev) => addMonths(prev, 1))}
                  className="flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white"
                  aria-label="Next month"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>

              <div className="max-h-[52vh] space-y-2 overflow-y-auto pb-2">
                {visibleWeekOptions.map((option) => {
                  const isSelected = option.value === startDate;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelectWeek(option.value)}
                      className={[
                        "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {option.isSelectedOutsideMonth
                            ? "Selected week"
                            : option.isCurrentWeek
                              ? "Current week"
                              : option.monthLabel}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pl-3">
                        {option.isCurrentWeek && (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Current
                          </span>
                        )}
                        {isSelected && (
                          <span className="material-symbols-outlined text-primary">check_circle</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
