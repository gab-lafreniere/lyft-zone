export const DAY_OF_WEEK_OPTIONS = [
  { value: "MONDAY", label: "Monday", shortLabel: "Mon" },
  { value: "TUESDAY", label: "Tuesday", shortLabel: "Tue" },
  { value: "WEDNESDAY", label: "Wednesday", shortLabel: "Wed" },
  { value: "THURSDAY", label: "Thursday", shortLabel: "Thu" },
  { value: "FRIDAY", label: "Friday", shortLabel: "Fri" },
  { value: "SATURDAY", label: "Saturday", shortLabel: "Sat" },
  { value: "SUNDAY", label: "Sunday", shortLabel: "Sun" },
];

export const DAY_OF_WEEK_VALUES = DAY_OF_WEEK_OPTIONS.map((option) => option.value);

export const SPACED_DEFAULT_TRAINING_DAYS = {
  "1": ["MONDAY"],
  "2": ["MONDAY", "THURSDAY"],
  "3": ["MONDAY", "WEDNESDAY", "FRIDAY"],
  "4": ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
  "5": ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
  "6": ["MONDAY", "TUESDAY", "WEDNESDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
  "7": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
};

const DAY_INDEX = new Map(DAY_OF_WEEK_VALUES.map((day, index) => [day, index]));

export function getSpacedDefaultTrainingDays(sessionsPerWeek) {
  return [...(SPACED_DEFAULT_TRAINING_DAYS[Number(sessionsPerWeek)] || [])];
}

export function normalizeTrainingDays(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((day) => DAY_INDEX.has(day)))
  ).sort((left, right) => DAY_INDEX.get(left) - DAY_INDEX.get(right));
}

export function areSameTrainingDays(left, right) {
  const normalizedLeft = normalizeTrainingDays(left);
  const normalizedRight = normalizeTrainingDays(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((day, index) => day === normalizedRight[index])
  );
}

export function isValidPreferredTrainingDays(value, sessionsPerWeek) {
  const sessions = Number(sessionsPerWeek);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 7 || !Array.isArray(value)) {
    return false;
  }

  const normalized = normalizeTrainingDays(value);
  return normalized.length === sessions && normalized.length === value.length;
}

export function resolvePreferredTrainingDays(value, sessionsPerWeek) {
  return isValidPreferredTrainingDays(value, sessionsPerWeek)
    ? normalizeTrainingDays(value)
    : getSpacedDefaultTrainingDays(sessionsPerWeek);
}

export function adjustTrainingDaysForSessions(currentDays, sessionsPerWeek, touched) {
  const sessions = Number(sessionsPerWeek);
  const defaults = getSpacedDefaultTrainingDays(sessions);
  if (!defaults.length || !touched) {
    return defaults;
  }

  const nextDays = normalizeTrainingDays(currentDays);
  while (nextDays.length > sessions) {
    nextDays.pop();
  }

  const candidates = [
    ...defaults,
    ...DAY_OF_WEEK_VALUES,
  ];
  candidates.forEach((day) => {
    if (nextDays.length < sessions && !nextDays.includes(day)) {
      nextDays.push(day);
    }
  });

  return normalizeTrainingDays(nextDays).slice(0, sessions);
}
