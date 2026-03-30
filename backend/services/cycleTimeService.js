const DEFAULT_TIMEZONE = 'America/Toronto';

function isValidTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveEffectiveTimezone(...candidates) {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized && isValidTimeZone(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_TIMEZONE;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function normalizeDateOnlyInput(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }

  const asString = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    return asString;
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
}

function dateOnlyToUtcDate(dateOnly) {
  const normalized = normalizeDateOnlyInput(dateOnly);
  if (!normalized) {
    return null;
  }

  return new Date(`${normalized}T00:00:00.000Z`);
}

function addDaysToDateOnly(dateOnly, days) {
  const date = dateOnlyToUtcDate(dateOnly);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return normalizeDateOnlyInput(date);
}

function compareDateOnly(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function getLocalDateTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function getNormalizedLocalDate(timeZone, date = new Date()) {
  return getLocalDateTimeParts(date, timeZone).date;
}

function isWithinGraceWindow(timeZone, date = new Date()) {
  const parts = getLocalDateTimeParts(date, timeZone);
  return parts.hour === 0 && parts.minute <= 20;
}

function deriveTemporalStatus(startDate, endDate, localDate) {
  if (compareDateOnly(localDate, startDate) < 0) {
    return 'upcoming';
  }

  if (compareDateOnly(localDate, endDate) > 0) {
    return 'past';
  }

  return 'active';
}

module.exports = {
  DEFAULT_TIMEZONE,
  addDaysToDateOnly,
  compareDateOnly,
  dateOnlyToUtcDate,
  deriveTemporalStatus,
  getNormalizedLocalDate,
  getLocalDateTimeParts,
  isValidTimeZone,
  isWithinGraceWindow,
  normalizeDateOnlyInput,
  resolveEffectiveTimezone,
};
