const DAY_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export function addDays(dateValue, days) {
  const next = new Date(`${dateValue}T00:00:00`);
  next.setDate(next.getDate() + days);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateKeyInTimeZone(timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function compareDateKeys(left, right) {
  if (!left || !right) {
    return null;
  }

  return left.localeCompare(right);
}

export function resolveOccurrenceTemporalState({
  cycleStartDate,
  weekNumber = 1,
  scheduledDay = null,
  weekdayIndex = null,
  todayDateKey = null,
} = {}) {
  const fallbackWeekdayIndex = Number.isInteger(weekdayIndex) ? weekdayIndex : null;
  const scheduledDayIndex = DAY_OF_WEEK.includes(scheduledDay)
    ? DAY_OF_WEEK.indexOf(scheduledDay)
    : null;
  const resolvedWeekdayIndex = scheduledDayIndex ?? fallbackWeekdayIndex;

  if (!cycleStartDate || resolvedWeekdayIndex == null || !todayDateKey) {
    return {
      calendarDate: null,
      dateState: "unknown",
      isPastOccurrence: false,
      isTodayOccurrence: false,
      isFutureOccurrence: false,
    };
  }

  const calendarDate = addDays(
    cycleStartDate,
    Math.max(0, (Math.max(1, Number(weekNumber) || 1) - 1) * 7) + resolvedWeekdayIndex
  );
  const comparison = compareDateKeys(calendarDate, todayDateKey);
  const dateState =
    comparison < 0 ? "past" : comparison > 0 ? "future" : "today";

  return {
    calendarDate,
    dateState,
    isPastOccurrence: dateState === "past",
    isTodayOccurrence: dateState === "today",
    isFutureOccurrence: dateState === "future",
  };
}

export function getOrderIndexFallbackWeekdayIndex(orderIndex) {
  const numericOrderIndex = Number(orderIndex);
  if (!Number.isInteger(numericOrderIndex) || numericOrderIndex < 1) {
    return null;
  }

  return Math.max(0, numericOrderIndex - 1);
}