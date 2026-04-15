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
  updateUpcomingDraftTimeline,
} from "../services/api";
import {
  aggregateWorkoutMetrics,
  computeWorkoutMetrics,
} from "../utils/workoutMetrics";

const WEEKDAY_ROWS = [
  { day: "MONDAY", label: "Monday", shortLabel: "M" },
  { day: "TUESDAY", label: "Tuesday", shortLabel: "T" },
  { day: "WEDNESDAY", label: "Wednesday", shortLabel: "W" },
  { day: "THURSDAY", label: "Thursday", shortLabel: "T" },
  { day: "FRIDAY", label: "Friday", shortLabel: "F" },
  { day: "SATURDAY", label: "Saturday", shortLabel: "S" },
  { day: "SUNDAY", label: "Sunday", shortLabel: "S" },
];
const WEEKDAY_INDEX = new Map(
  WEEKDAY_ROWS.map((entry, index) => [entry.day, index])
);
const MAX_CYCLE_DURATION_WEEKS = 8;

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateKeyInTimeZone(timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function compareDateKeys(left, right) {
  if (!left || !right) {
    return 0;
  }

  return left.localeCompare(right);
}

function getRowDateState(calendarDate, todayDateKey) {
  if (!calendarDate || !todayDateKey) {
    return "unknown";
  }

  const comparison = compareDateKeys(calendarDate, todayDateKey);
  if (comparison < 0) {
    return "past";
  }

  if (comparison > 0) {
    return "future";
  }

  return "today";
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

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  return new Date(`${value}T00:00:00`);
}

function getNextMondayDateValue(dateValue = getTodayDateInput()) {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = date.getDay();
  const daysUntilMonday = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
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

function formatMonthHeading(dateValue) {
  return dateValue.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatWeekRange(startDateValue) {
  const startDate = parseDateInput(startDateValue);
  const endDate = parseDateInput(addDays(startDateValue, 6));
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
  const monthStart = getStartOfMonthDate(monthDate);
  const monthEnd = addDays(formatDateInput(addMonths(monthStart, 1)), -1);
  const firstWeekStart = parseDateInput(
    getNextMondayDateValue(addDays(formatDateInput(monthStart), -1))
  );
  const monthIndex = monthStart.getMonth();
  const year = monthStart.getFullYear();
  const normalizedSelectedValue =
    selectedStartDateValue && isMondayDateInput(selectedStartDateValue)
      ? selectedStartDateValue
      : null;
  const options = [];

  for (let cursor = firstWeekStart; formatDateInput(cursor) <= monthEnd; ) {
    const optionValue = formatDateInput(cursor);
    const mondayBelongsToDisplayedMonth =
      cursor.getMonth() === monthIndex && cursor.getFullYear() === year;
    const isSelected = optionValue === normalizedSelectedValue;

    if (optionValue >= minStartDateValue && (mondayBelongsToDisplayedMonth || isSelected)) {
      options.push({
        value: optionValue,
        label: formatWeekRange(optionValue),
        isCurrentWeek: optionValue === minStartDateValue,
        isSelectedOutsideMonth: isSelected && !mondayBelongsToDisplayedMonth,
      });
    }

    cursor = parseDateInput(addDays(optionValue, 7));
  }

  if (
    normalizedSelectedValue &&
    !options.some((option) => option.value === normalizedSelectedValue) &&
    normalizedSelectedValue >= minStartDateValue
  ) {
    options.unshift({
      value: normalizedSelectedValue,
      label: formatWeekRange(normalizedSelectedValue),
      isCurrentWeek: normalizedSelectedValue === minStartDateValue,
      isSelectedOutsideMonth: true,
    });
  }

  return options;
}

function hasAllowedWeeksInMonth(monthDate, minStartDateValue) {
  return buildWeekOptionsForMonth(monthDate, minStartDateValue).length > 0;
}

function isMondayDateInput(value) {
  if (!value) {
    return false;
  }

  return new Date(`${value}T00:00:00`).getDay() === 1;
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

function formatBadgeDate(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return String(date.getDate());
}

function formatShortDateRange(startDateValue, endDateValue) {
  if (!startDateValue || !endDateValue) {
    return "";
  }

  const startDate = new Date(`${startDateValue}T00:00:00`);
  const endDate = new Date(`${endDateValue}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "";
  }

  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return `${startLabel} to ${endLabel}`;
}

function buildUiError(error, fallbackMessage) {
  return {
    message: error?.message || fallbackMessage,
    code: error?.code || null,
  };
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
    moveSelectedWeekWorkoutToScheduledDay,
    duplicateSelectedWeekWorkout,
    deleteSelectedWeekWorkout,
  } = useMultiWeekProgram();
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingCycle, setIsDeletingCycle] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [showMuscleDistribution, setShowMuscleDistribution] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsStartDate, setSettingsStartDate] = useState("");
  const [settingsDurationWeeks, setSettingsDurationWeeks] = useState(1);
  const [settingsSourceWeekNumber, setSettingsSourceWeekNumber] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [isSettingsWeekPickerOpen, setIsSettingsWeekPickerOpen] = useState(false);
  const [settingsWeekPickerMonth, setSettingsWeekPickerMonth] = useState(() =>
    getStartOfMonthDate(getTodayDateInput())
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedWorkoutOrderIndex, setSelectedWorkoutOrderIndex] = useState(null);
  const [planId, setPlanId] = useState(null);

  const todayDate = getTodayDateInput();
  const minSettingsStartDate = useMemo(() => getNextMondayDateValue(todayDate), [todayDate]);
  const currentDraftWeekCount = Math.max(
    1,
    programDraft.weeks.length || programDraft.programLength || 1
  );
  const isUpcomingCycle = draftMetadata.temporalStatus === "upcoming";
  const isActiveCycle = draftMetadata.temporalStatus === "active";
  const isTimelineEditable = isUpcomingCycle;
  const activePlanId = planId || draftMetadata.cyclePlanId || null;
  const editTodayDateKey =
    draftMetadata.draftState?.localDate ||
    getDateKeyInTimeZone(
      draftMetadata.timezone || programDraft.timezone || "America/Toronto"
    );
  const isActiveEditMode = isEditMode && isActiveCycle;

  useEffect(() => {
    if (!cycleId) {
      setIsLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function loadDraft() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await openOrCreateCycleEditDraft(cycleId);
        const activePlanId = response?.planId || null;
        if (cancelled) {
          return;
        }

        setPlanId(activePlanId);
        console.log("ACTIVE PLAN ID:", activePlanId);
        hydrateProgramDraft(response);
        updateDraftMetadata({ cyclePlanId: activePlanId });
        setLoadError(null);
      } catch (loadError) {
        if (!cancelled) {
          setLoadError(buildUiError(loadError, "Unable to load cycle draft."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDraft();

    return () => {
      cancelled = true;
    };
  }, [cycleId, hydrateProgramDraft, updateDraftMetadata]);

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

  const weekdayRows = useMemo(() => {
    const workouts = [...(selectedWeek?.workouts || [])].sort(
      (left, right) => (left.orderIndex || 0) - (right.orderIndex || 0)
    );
    const remainingWorkouts = [...workouts];
    const rows = WEEKDAY_ROWS.map((entry) => ({
      ...entry,
      workout: null,
    }));

    rows.forEach((row) => {
      const explicitIndex = remainingWorkouts.findIndex(
        (workout) => workout.scheduledDay === row.day
      );
      if (explicitIndex >= 0) {
        const [workout] = remainingWorkouts.splice(explicitIndex, 1);
        rows[WEEKDAY_ROWS.findIndex((entry) => entry.day === row.day)] = {
          ...row,
          workout,
        };
      }
    });

    remainingWorkouts.forEach((workout) => {
      const firstEmptyRow = rows.find((row) => !row.workout);
      if (firstEmptyRow) {
        firstEmptyRow.workout = workout;
      }
    });

    return rows.map((row, index) => {
      const calendarDate = programDraft.startDate
        ? addDays(
            programDraft.startDate,
            Math.max(0, ((selectedWeek?.weekNumber || programDraft.selectedWeek || 1) - 1) * 7) +
              (WEEKDAY_INDEX.get(row.day) || 0)
          )
        : null;
      const dateState = getRowDateState(calendarDate, editTodayDateKey);
      const isPastOccurrence = dateState === "past";
      const isTodayOccurrence = dateState === "today";
      const isFutureOccurrence = dateState === "future";
      const workout = row.workout;
      if (!workout) {
        return {
          ...row,
          calendarDate,
          dateState,
          isPastOccurrence,
          isTodayOccurrence,
          isFutureOccurrence,
          meta: null,
          canMoveUp: false,
          canMoveDown: false,
          targetDayUp: null,
          targetDayDown: null,
        };
      }

      const metrics = computeWorkoutMetrics(workout);

      return {
        ...row,
        calendarDate,
        dateState,
        isPastOccurrence,
        isTodayOccurrence,
        isFutureOccurrence,
        workout: {
          ...workout,
          meta: `${metrics.exerciseCount} exercises • ${metrics.setCount} sets • ~${metrics.estimatedDurationMinutes} min • ${metrics.totalTUTMinutes}m TUT`,
        },
        targetDayUp: index > 0 ? WEEKDAY_ROWS[index - 1].day : null,
        targetDayDown: index < WEEKDAY_ROWS.length - 1 ? WEEKDAY_ROWS[index + 1].day : null,
      };
    });
  }, [editTodayDateKey, programDraft.selectedWeek, programDraft.startDate, selectedWeek]);

  const selectedWeekRangeLabel = useMemo(() => {
    if (!programDraft.startDate) {
      return "";
    }

    const currentWeekNumber = selectedWeek?.weekNumber || programDraft.selectedWeek || 1;
    const weekStart = addDays(programDraft.startDate, Math.max(0, (currentWeekNumber - 1) * 7));
    const weekEnd = addDays(weekStart, 6);
    return formatShortDateRange(weekStart, weekEnd);
  }, [programDraft.selectedWeek, programDraft.startDate, selectedWeek]);

  const selectedWorkoutRow = useMemo(
    () =>
      weekdayRows.find(
        (row) =>
          row.workout &&
          Number(row.workout.orderIndex) === Number(selectedWorkoutOrderIndex)
      ) || null,
    [selectedWorkoutOrderIndex, weekdayRows]
  );
  const selectedWorkoutRowIndex = useMemo(
    () =>
      weekdayRows.findIndex(
        (row) =>
          row.workout &&
          Number(row.workout.orderIndex) === Number(selectedWorkoutOrderIndex)
      ),
    [selectedWorkoutOrderIndex, weekdayRows]
  );
  const previousSelectedRow = useMemo(
    () =>
      selectedWorkoutRowIndex > 0 ? weekdayRows[selectedWorkoutRowIndex - 1] || null : null,
    [selectedWorkoutRowIndex, weekdayRows]
  );
  const nextSelectedRow = useMemo(
    () =>
      selectedWorkoutRowIndex >= 0 &&
      selectedWorkoutRowIndex < weekdayRows.length - 1
        ? weekdayRows[selectedWorkoutRowIndex + 1] || null
        : null,
    [selectedWorkoutRowIndex, weekdayRows]
  );

  const hasEmptyWeekdaySlot = useMemo(
    () => weekdayRows.some((row) => !row.workout),
    [weekdayRows]
  );
  const selectedWeekIsFullyPast = useMemo(
    () =>
      Boolean(weekdayRows.length) &&
      weekdayRows.every(
        (row) =>
          row.calendarDate && compareDateKeys(row.calendarDate, editTodayDateKey) < 0
      ),
    [editTodayDateKey, weekdayRows]
  );
  const firstAvailableDuplicateRow = useMemo(() => {
    if (!isActiveEditMode) {
      return null;
    }

    return (
      weekdayRows.find(
        (row) =>
          !row.workout &&
          row.calendarDate &&
          compareDateKeys(row.calendarDate, editTodayDateKey) >= 0
      ) || null
    );
  }, [editTodayDateKey, isActiveEditMode, weekdayRows]);
  const canMoveSelectedPrevious = useMemo(() => {
    if (!selectedWorkoutRow?.workout) {
      return false;
    }

    if (!isActiveEditMode) {
      return Boolean(selectedWorkoutRow.targetDayUp);
    }

    if (selectedWeekIsFullyPast || selectedWorkoutRow.isPastOccurrence) {
      return false;
    }

    return Boolean(previousSelectedRow && !previousSelectedRow.isPastOccurrence);
  }, [isActiveEditMode, previousSelectedRow, selectedWeekIsFullyPast, selectedWorkoutRow]);
  const canMoveSelectedNext = useMemo(() => {
    if (!selectedWorkoutRow?.workout) {
      return false;
    }

    if (!isActiveEditMode) {
      return Boolean(selectedWorkoutRow.targetDayDown);
    }

    if (selectedWeekIsFullyPast || selectedWorkoutRow.isPastOccurrence) {
      return false;
    }

    return Boolean(nextSelectedRow && !nextSelectedRow.isPastOccurrence);
  }, [isActiveEditMode, nextSelectedRow, selectedWeekIsFullyPast, selectedWorkoutRow]);
  const canDeleteSelectedWorkout = useMemo(() => {
    if (!selectedWorkoutRow?.workout) {
      return false;
    }

    if (!isActiveEditMode) {
      return true;
    }

    if (selectedWeekIsFullyPast) {
      return false;
    }

    return !selectedWorkoutRow.isPastOccurrence;
  }, [isActiveEditMode, selectedWeekIsFullyPast, selectedWorkoutRow]);
  const canDuplicateSelectedWorkout = useMemo(() => {
    if (!selectedWorkoutRow?.workout) {
      return false;
    }

    if (!isActiveEditMode) {
      return hasEmptyWeekdaySlot;
    }

    if (selectedWeekIsFullyPast) {
      return false;
    }

    return Boolean(firstAvailableDuplicateRow);
  }, [
    firstAvailableDuplicateRow,
    hasEmptyWeekdaySlot,
    isActiveEditMode,
    selectedWeekIsFullyPast,
    selectedWorkoutRow,
  ]);

  useEffect(() => {
    setSelectedWorkoutOrderIndex(null);
  }, [programDraft.selectedWeek]);

  useEffect(() => {
    if (
      selectedWorkoutOrderIndex == null ||
      weekdayRows.some(
        (row) =>
          row.workout &&
          Number(row.workout.orderIndex) === Number(selectedWorkoutOrderIndex)
      )
    ) {
      return;
    }

    setSelectedWorkoutOrderIndex(null);
  }, [selectedWorkoutOrderIndex, weekdayRows]);

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
  const autosaveError = useMemo(() => {
    if (draftMetadata.saveState !== "error") {
      return null;
    }

    return {
      message: draftMetadata.lastSaveErrorMessage || "Unable to autosave this draft.",
      code: draftMetadata.lastSaveErrorCode || null,
    };
  }, [
    draftMetadata.lastSaveErrorCode,
    draftMetadata.lastSaveErrorMessage,
    draftMetadata.saveState,
  ]);

  const settingsFinalWeekEndDate = useMemo(
    () =>
      addDays(
        settingsStartDate || todayDate,
        Math.max(0, settingsDurationWeeks * 7 - 1)
      ),
    [settingsDurationWeeks, settingsStartDate, todayDate]
  );
  const settingsEndDate = settingsFinalWeekEndDate;
  const selectedSettingsWeekRangeLabel = useMemo(
    () => (settingsStartDate ? formatWeekRange(settingsStartDate) : "Select a week"),
    [settingsStartDate]
  );
  const settingsVisibleWeekOptions = useMemo(
    () =>
      buildWeekOptionsForMonth(
        settingsWeekPickerMonth,
        minSettingsStartDate,
        settingsStartDate
      ),
    [minSettingsStartDate, settingsStartDate, settingsWeekPickerMonth]
  );
  const canGoToPreviousSettingsMonth = useMemo(
    () =>
      hasAllowedWeeksInMonth(addMonths(settingsWeekPickerMonth, -1), minSettingsStartDate),
    [minSettingsStartDate, settingsWeekPickerMonth]
  );
  const settingsWeekPickerMonthLabel = useMemo(
    () => formatMonthHeading(settingsWeekPickerMonth),
    [settingsWeekPickerMonth]
  );
  const isSettingsExtension = settingsDurationWeeks > currentDraftWeekCount;
  const settingsSourceWeekOptions = useMemo(
    () =>
      (programDraft.weeks || []).map((week) => {
        const weekStartDate = programDraft.startDate
          ? addDays(programDraft.startDate, Math.max(0, (week.weekNumber - 1) * 7))
          : null;

        return {
          value: week.weekNumber,
          label: `W${week.weekNumber}`,
          detail: weekStartDate ? formatWeekRange(weekStartDate) : week.label || `Week ${week.weekNumber}`,
        };
      }),
    [programDraft.startDate, programDraft.weeks]
  );
  const hasValidSettingsSourceWeek = useMemo(
    () =>
      settingsSourceWeekOptions.some(
        (option) => Number(option.value) === Number(settingsSourceWeekNumber)
      ),
    [settingsSourceWeekNumber, settingsSourceWeekOptions]
  );

  const openSettingsPanel = () => {
    setSettingsStartDate(programDraft.startDate || todayDate);
    setSettingsDurationWeeks(programDraft.programLength || currentDraftWeekCount);
    setSettingsSourceWeekNumber(
      programDraft.selectedWeek || programDraft.weeks[0]?.weekNumber || 1
    );
    setSettingsError("");
    setIsSettingsWeekPickerOpen(false);
    setShowDeleteConfirm(false);
    setIsSettingsOpen(true);
  };

  const closeSettingsPanel = () => {
    setSettingsError("");
    setIsSettingsWeekPickerOpen(false);
    setShowDeleteConfirm(false);
    setIsSettingsOpen(false);
  };

  const handleSettingsStartDateChange = (value) => {
    setSettingsStartDate(value);
    setSettingsError("");
  };

  const handleSettingsDurationChange = (nextValue) => {
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      setSettingsDurationWeeks(1);
      return;
    }

    const safeDuration = Math.max(
      1,
      Math.min(MAX_CYCLE_DURATION_WEEKS, Math.trunc(parsed))
    );
    setSettingsDurationWeeks(safeDuration);
    if (
      safeDuration > currentDraftWeekCount &&
      !hasValidSettingsSourceWeek
    ) {
      setSettingsSourceWeekNumber(programDraft.selectedWeek || programDraft.weeks[0]?.weekNumber || 1);
    }
    setSettingsError("");
  };

  const decrementSettingsDuration = () => {
    handleSettingsDurationChange(Math.max(1, settingsDurationWeeks - 1));
  };

  const incrementSettingsDuration = () => {
    handleSettingsDurationChange(
      Math.min(MAX_CYCLE_DURATION_WEEKS, settingsDurationWeeks + 1)
    );
  };

  const handleSaveSettings = async () => {
    if (!cycleId || !activePlanId) {
      return;
    }

    setSettingsError("");

    if (!isTimelineEditable) {
      setSettingsError("Timeline settings can only be edited for upcoming cycles.");
      return;
    }

    if (!settingsStartDate) {
      setSettingsError("Choose a valid future start date.");
      return;
    }

    if (!isMondayDateInput(settingsStartDate)) {
      setSettingsError("Start date must be a Monday.");
      return;
    }

    if (settingsStartDate < todayDate || settingsEndDate < todayDate) {
      setSettingsError("Past dates are not allowed.");
      return;
    }

    if (settingsDurationWeeks < 1 || settingsDurationWeeks > MAX_CYCLE_DURATION_WEEKS) {
      setSettingsError("Duration must stay between 1 and 8 weeks.");
      return;
    }

    if (isSettingsExtension && !hasValidSettingsSourceWeek) {
      setSettingsError("Choose one existing source week for the added weeks.");
      return;
    }

    setIsSavingSettings(true);
    setPublishError(null);

    try {
      const response = await updateUpcomingDraftTimeline(cycleId, activePlanId, {
        newStartDate: settingsStartDate,
        durationWeeks: settingsDurationWeeks,
        ...(isSettingsExtension
          ? { sourceWeekNumber: Number(settingsSourceWeekNumber) }
          : {}),
      });
      setPlanId(response?.planId || activePlanId);
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
    setPublishError(null);

    try {
      await deleteCycle(cycleId);
      navigate(getCyclesLibraryPath(), { replace: true });
    } catch (deleteError) {
      setSettingsError(deleteError.message || "Unable to delete this cycle.");
      setIsDeletingCycle(false);
    }
  };

  const handlePublish = async () => {
    if (!cycleId || !activePlanId) {
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      const response = await publishCycleDraft(cycleId, {
        allowCrossDayDraft: draftMetadata.allowCrossDayDraft,
      });
      hydrateProgramDraft(response);
      navigate(getCycleDetailsPath(cycleId), { replace: true });
    } catch (publishError) {
      setPublishError(
        buildUiError(publishError, "Unable to publish cycle.")
      );
    } finally {
      setIsPublishing(false);
    }
  };

  const handleToggleEditMode = () => {
    setIsEditMode((prev) => {
      if (prev) {
        setSelectedWorkoutOrderIndex(null);
      }

      return !prev;
    });
  };

  const handleWorkoutRowClick = (row) => {
    if (!row?.workout) {
      return;
    }

    if (isEditMode) {
      setSelectedWorkoutOrderIndex((prev) =>
        Number(prev) === Number(row.workout.orderIndex) ? null : row.workout.orderIndex
      );
      return;
    }

    navigate(
      getCycleWorkoutEditorPath(
        cycleId,
        selectedWeek?.weekNumber || programDraft.selectedWeek || 1,
        row.workout.orderIndex
      )
    );
  };

  const handleMoveSelectedWorkout = (direction) => {
    if (!selectedWorkoutRow?.workout) {
      return;
    }

    const canMove =
      direction === "previous" ? canMoveSelectedPrevious : canMoveSelectedNext;
    const targetRow =
      direction === "previous" ? previousSelectedRow : nextSelectedRow;

    if (!canMove || !targetRow?.day) {
      return;
    }

    moveSelectedWeekWorkoutToScheduledDay(
      selectedWorkoutRow.workout.orderIndex,
      targetRow.day
    );
  };

  const handleDuplicateSelectedWorkout = () => {
    if (!selectedWorkoutRow?.workout || !canDuplicateSelectedWorkout) {
      return;
    }

    duplicateSelectedWeekWorkout(
      selectedWorkoutRow.workout.orderIndex,
      isActiveEditMode ? firstAvailableDuplicateRow?.day || null : null
    );
  };

  const handleDeleteSelectedWorkout = () => {
    if (!canDeleteSelectedWorkout) {
      return;
    }

    const accepted = window.confirm("Delete this workout from the current week?");
    if (!accepted) {
      return;
    }

    deleteSelectedWeekWorkout(selectedWorkoutRow.workout.orderIndex);
    setSelectedWorkoutOrderIndex(null);
  };

  if (isLoading) {
    return <div className="px-4 py-8 text-sm text-slate-500">Loading cycle builder...</div>;
  }

  if (loadError && !programDraft.weeks.length) {
    return (
      <div className="px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <p>{loadError.message}</p>
          {loadError.code && (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-red-400">
              {loadError.code}
            </p>
          )}
        </div>
      </div>
    );
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
        {autosaveError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <p className="font-semibold">Autosave failed</p>
            <p className="mt-1">{autosaveError.message}</p>
            {autosaveError.code && (
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-amber-500">
                {autosaveError.code}
              </p>
            )}
          </div>
        )}

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

        <div className="mb-4">
          <div className="mb-1 flex items-end justify-between px-1">
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
            className="grid h-12 rounded-lg border border-slate-100/50 bg-white/30 py-1"
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
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Workout Schedule
              </h3>
              {selectedWeekRangeLabel && (
                <p className="mt-1 text-sm font-medium text-slate-500">
                  {selectedWeekRangeLabel}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleToggleEditMode}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors",
                isEditMode
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              ].join(" ")}
            >
              {isEditMode ? "Done" : "Edit"}
            </button>
          </div>

          {isEditMode && (
            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-2 shadow-sm">
              <span className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {selectedWorkoutOrderIndex == null ? "Select a workout" : "Edit week"}
              </span>
              <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleMoveSelectedWorkout("previous")}
                disabled={!canMoveSelectedPrevious}
                className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Move workout to previous day"
                title="Move to previous day"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
              </button>
              <button
                type="button"
                onClick={() => handleMoveSelectedWorkout("next")}
                disabled={!canMoveSelectedNext}
                className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Move workout to next day"
                title="Move to next day"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
              </button>
              <button
                type="button"
                onClick={handleDuplicateSelectedWorkout}
                disabled={!canDuplicateSelectedWorkout}
                className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Duplicate workout in this week"
                title="Duplicate"
              >
                <span className="material-symbols-outlined text-[18px]">content_copy</span>
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedWorkout}
                disabled={!canDeleteSelectedWorkout}
                className="flex size-9 items-center justify-center rounded-full border border-red-200 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Delete workout from this week"
                title="Delete"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
            </div>
          )}

        <div className="space-y-2.5">
          {weekdayRows.map((row) => (
            <div
              key={row.day}
              className={[
                "flex items-center gap-3",
                row.workout
                  ? [
                      "rounded-xl border bg-white p-3 shadow-sm transition-all",
                      isEditMode && row.workout
                        ? Number(selectedWorkoutOrderIndex) === Number(row.workout.orderIndex)
                          ? "border-primary bg-primary/[0.06] ring-1 ring-primary/20"
                          : "border-slate-100 opacity-70"
                        : "border-slate-100",
                    ].join(" ")
                  : "rounded-lg px-3 py-1",
              ].join(" ")}
            >
              <div
                className={[
                  "flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100",
                  row.workout ? "py-2" : "py-1.5",
                ].join(" ")}
              >
                <span className="text-sm font-black leading-none text-slate-900">
                  {formatBadgeDate(row.calendarDate)}
                </span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {row.label.slice(0, 3)}
                </span>
              </div>

              {row.workout ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleWorkoutRowClick(row)}
                    className="group min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-base font-semibold">
                        {row.workout.name}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Day {row.workout.orderIndex}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500 opacity-80">
                      {row.workout.meta}
                    </p>
                  </button>
                  {!isEditMode && (
                    <span className="material-symbols-outlined text-slate-400">
                      chevron_right
                    </span>
                  )}
                </>
              ) : (
                <div className="flex min-h-[42px] flex-1 items-center border-b border-dashed border-slate-200 px-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Rest day
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        </div>

      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-md">
          {publishError && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <p className="font-semibold">Publish failed</p>
              <p className="mt-1">{publishError.message}</p>
              {publishError.code && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                  {publishError.code}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={isPublishing || !activePlanId}
            onClick={handlePublish}
            className={[
              "flex w-full items-center justify-center rounded-xl py-4 font-bold transition-colors",
              !isPublishing && activePlanId
                ? "bg-primary text-white"
                : "cursor-not-allowed bg-slate-300 text-white/60",
            ].join(" ")}
          >
            <span>{isPublishing ? "Publishing..." : "Publish Cycle"}</span>
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close settings"
            onClick={closeSettingsPanel}
          />

          <div className="relative w-full rounded-t-3xl bg-white p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                  Settings
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">
                  Multi-Week Timeline
                </h3>
              </div>
              <button
                type="button"
                onClick={closeSettingsPanel}
                className="flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close settings"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-5">
              <section className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Start Date
                  </label>
                  <p className="mt-1 text-xs text-slate-400">
                    Timeline edits are available for upcoming cycles only.
                  </p>
                </div>
                {!isSettingsWeekPickerOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isTimelineEditable) {
                        return;
                      }

                      setSettingsWeekPickerMonth(
                        getStartOfMonthDate(settingsStartDate || minSettingsStartDate)
                      );
                      setIsSettingsWeekPickerOpen(true);
                    }}
                    disabled={!isTimelineEditable}
                    aria-expanded={false}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-all duration-150 focus:border-transparent focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-sm font-medium text-slate-900">
                        {selectedSettingsWeekRangeLabel}
                      </div>
                      <span className="material-symbols-outlined text-slate-400">
                        expand_more
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 transition-all duration-150">
                    <div className="flex items-center justify-between border-b border-slate-200/80 bg-white/80 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          canGoToPreviousSettingsMonth &&
                          setSettingsWeekPickerMonth((currentMonth) =>
                            addMonths(currentMonth, -1)
                          )
                        }
                        disabled={!canGoToPreviousSettingsMonth}
                        className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                        aria-label="Previous month"
                      >
                        <span className="material-symbols-outlined">chevron_left</span>
                      </button>

                      <p className="text-[13px] font-semibold text-slate-900">
                        {settingsWeekPickerMonthLabel}
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          setSettingsWeekPickerMonth((currentMonth) =>
                            addMonths(currentMonth, 1)
                          )
                        }
                        className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
                        aria-label="Next month"
                      >
                        <span className="material-symbols-outlined">chevron_right</span>
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto p-1.5">
                      <div className="space-y-1.5">
                        {settingsVisibleWeekOptions.map((option) => {
                          const isSelected = option.value === settingsStartDate;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                handleSettingsStartDateChange(option.value);
                                setIsSettingsWeekPickerOpen(false);
                              }}
                              className={[
                                "w-full rounded-lg border px-3 py-2.5 text-left transition-all",
                                isSelected
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-slate-200/90 bg-white hover:border-primary/30 hover:bg-white",
                              ].join(" ")}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900">
                                    {option.label}
                                  </div>
                                  {(option.isCurrentWeek || option.isSelectedOutsideMonth) && (
                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                      {option.isCurrentWeek
                                        ? "Earliest available"
                                        : "Selected outside this month"}
                                    </div>
                                  )}
                                </div>
                                {isSelected && (
                                  <span className="material-symbols-outlined text-[20px] text-primary">
                                    check_circle
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  End Date
                </label>
                <div className="flex h-12 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 font-medium text-slate-600">
                  {formatDate(settingsEndDate)}
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Duration In Weeks
                  </label>
                  <p className="mt-1 text-xs text-slate-400">
                    Trim removes weeks from the end. Extend adds weeks at the end. Changes stay in draft until you publish.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={decrementSettingsDuration}
                      disabled={!isTimelineEditable || settingsDurationWeeks <= 1}
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Decrease duration in weeks"
                    >
                      <span className="material-symbols-outlined">remove</span>
                    </button>

                    <div className="flex-1 text-center">
                      <span className="text-3xl font-black text-slate-900">
                        {settingsDurationWeeks}
                      </span>
                      <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-primary">
                        Weeks
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={incrementSettingsDuration}
                      disabled={!isTimelineEditable || settingsDurationWeeks >= MAX_CYCLE_DURATION_WEEKS}
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Increase duration in weeks"
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                </div>
              </section>

              {isSettingsExtension && (
                <section className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                      Source Week For Added Weeks
                    </label>
                    <p className="mt-1 text-xs text-slate-400">
                      Every added week will duplicate this one existing week.
                    </p>
                  </div>
                  <div
                    className="grid rounded-lg bg-slate-100 p-1"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(
                        1,
                        settingsSourceWeekOptions.length || 1
                      )}, minmax(0, 1fr))`,
                    }}
                  >
                    {settingsSourceWeekOptions.map((option) => {
                      const isSelected =
                        Number(option.value) === Number(settingsSourceWeekNumber);

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setSettingsSourceWeekNumber(option.value);
                            setSettingsError("");
                          }}
                          className={[
                            "w-full rounded-md px-2 py-2 text-[10px] font-bold transition-all",
                            isSelected
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-700",
                          ].join(" ")}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

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

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeSettingsPanel}
                  className="flex-1 rounded-xl border border-slate-200 py-3 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={!isTimelineEditable || isSavingSettings}
                  className={[
                    "flex-1 rounded-xl py-3 font-semibold transition-colors",
                    isTimelineEditable && !isSavingSettings
                      ? "bg-primary text-slate-900"
                      : "cursor-not-allowed bg-slate-300 text-white/60",
                  ].join(" ")}
                >
                  {isSavingSettings ? "Saving..." : "Save"}
                </button>
              </div>

              <section className="space-y-3">
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full rounded-xl border border-red-200 bg-white py-3 font-semibold text-red-500 transition-colors hover:bg-red-50"
                  >
                    Delete Cycle
                  </button>
                ) : (
                  <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
                    <h3 className="text-sm font-bold text-red-700">Confirm deletion of this cycle?</h3>
                    <p className="mt-1 text-sm text-red-600">
                      Delete this multi-week cycle and all of its versions. This action can&apos;t be undone.
                    </p>
                    <div className="mt-3 space-y-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 rounded-xl border border-slate-200 bg-white py-3 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteCycle}
                          disabled={isDeletingCycle}
                          className="flex-1 rounded-xl bg-red-500 py-3 font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
                        >
                          {isDeletingCycle ? "Deleting..." : "Delete Cycle"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
