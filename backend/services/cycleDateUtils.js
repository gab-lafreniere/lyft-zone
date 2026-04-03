const DEFAULT_TIMEZONE = 'America/Toronto';

function formatDateKey(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getLocalDateTimeParts(value, timeZone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getFormatter(timeZone).formatToParts(date);
  const result = {};

  parts.forEach((part) => {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute'
    ) {
      result[part.type] = part.value;
    }
  });

  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hour: result.hour,
    minute: result.minute,
    dateKey: formatDateKey(result),
    minutesAfterMidnight: Number(result.hour) * 60 + Number(result.minute),
  };
}

function parseDateInput(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function toDateKey(value) {
  const parsed = parseDateInput(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function addDays(dateKey, days) {
  const parsed = parseDateInput(dateKey);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function diffDateKeys(startDateKey, endDateKey) {
  const start = parseDateInput(startDateKey);
  const end = parseDateInput(endDateKey);

  if (!start || !end) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function compareDateKeys(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function resolveEffectiveTimezone(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) {
      return value;
    }
  }

  return DEFAULT_TIMEZONE;
}

function getTodayDateKey(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return getLocalDateTimeParts(now, timeZone).dateKey;
}

function isWithinGraceWindow(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return getLocalDateTimeParts(now, timeZone).minutesAfterMidnight <= 20;
}

function getDayOfWeek(dateKey) {
  const parsed = parseDateInput(dateKey);
  return parsed.getUTCDay();
}

function getStartOfSundayWeek(dateKey) {
  return addDays(dateKey, -getDayOfWeek(dateKey));
}

function getStartOfMondayWeek(dateKey) {
  const dayOfWeek = getDayOfWeek(dateKey);
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDays(dateKey, mondayOffset);
}

function getEndOfMondayWeek(dateKey) {
  return addDays(getStartOfMondayWeek(dateKey), 6);
}

function isDateWithinRange(dateKey, startDateKey, endDateKey) {
  return compareDateKeys(dateKey, startDateKey) >= 0 && compareDateKeys(dateKey, endDateKey) <= 0;
}

function rangesOverlap(startA, endA, startB, endB) {
  return compareDateKeys(endA, startB) >= 0 && compareDateKeys(endB, startA) >= 0;
}

module.exports = {
  DEFAULT_TIMEZONE,
  addDays,
  compareDateKeys,
  diffDateKeys,
  getEndOfMondayWeek,
  getDayOfWeek,
  getLocalDateTimeParts,
  getStartOfMondayWeek,
  getStartOfSundayWeek,
  getTodayDateKey,
  isDateWithinRange,
  isWithinGraceWindow,
  parseDateInput,
  rangesOverlap,
  resolveEffectiveTimezone,
  toDateKey,
};
