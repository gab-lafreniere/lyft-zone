const MIN_AGE = 18;
const MAX_AGE = 100;
const SUPPORTED_SEX_VALUES = Object.freeze(['MALE', 'FEMALE']);
const SUPPORTED_SEX_SET = new Set(SUPPORTED_SEX_VALUES);

const DEMOGRAPHICS_STATUS = Object.freeze({
  NOT_COLLECTED: 'NOT_COLLECTED',
  LOCKED: 'LOCKED',
  INCONSISTENT: 'INCONSISTENT',
});

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function serializeDateOnly(value) {
  const parts = parseDateOnly(value);
  return parts
    ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
    : null;
}

function dateOnlyToUtcDate(value) {
  const serialized = serializeDateOnly(value);
  return serialized ? new Date(`${serialized}T00:00:00.000Z`) : null;
}

function resolveReferenceDate(referenceDate = new Date()) {
  const value = typeof referenceDate === 'function' ? referenceDate() : referenceDate;
  return parseDateOnly(value);
}

function compareDateParts(left, right) {
  if (left.year !== right.year) {
    return left.year < right.year ? -1 : 1;
  }
  if (left.month !== right.month) {
    return left.month < right.month ? -1 : 1;
  }
  if (left.day !== right.day) {
    return left.day < right.day ? -1 : 1;
  }
  return 0;
}

function isValidStoredAge(value) {
  return Number.isSafeInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
}

function isValidSex(value) {
  return SUPPORTED_SEX_SET.has(value);
}

function deriveDemographicsStatus(record = {}, referenceDate = new Date()) {
  const age = record?.age ?? null;
  const ageInputDate = record?.ageInputDate ?? null;
  const sex = record?.sex ?? null;

  if (age === null && ageInputDate === null && sex === null) {
    return DEMOGRAPHICS_STATUS.NOT_COLLECTED;
  }

  const inputDateParts = parseDateOnly(ageInputDate);
  const referenceDateParts = resolveReferenceDate(referenceDate);
  if (
    isValidStoredAge(age) &&
    inputDateParts &&
    referenceDateParts &&
    compareDateParts(inputDateParts, referenceDateParts) <= 0 &&
    isValidSex(sex)
  ) {
    return DEMOGRAPHICS_STATUS.LOCKED;
  }

  return DEMOGRAPHICS_STATUS.INCONSISTENT;
}

function validateInitialDemographicsPayload(payload) {
  const issues = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'Profile payload must be an object.' }],
    };
  }

  if (hasOwn(payload, 'ageInputDate')) {
    issues.push({
      path: 'ageInputDate',
      message: 'Age input date is managed by the server.',
    });
  }

  if (!hasOwn(payload, 'age') || !hasOwn(payload, 'sex')) {
    issues.push({
      path: '',
      message: 'Age and sex must be submitted together.',
    });
  }

  if (hasOwn(payload, 'age') && !isValidStoredAge(payload.age)) {
    issues.push({
      path: 'age',
      message: `Age must be an integer from ${MIN_AGE} through ${MAX_AGE}.`,
    });
  }

  if (hasOwn(payload, 'sex') && !isValidSex(payload.sex)) {
    issues.push({
      path: 'sex',
      message: 'Sex must be MALE or FEMALE.',
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      age: payload.age,
      sex: payload.sex,
    },
  };
}

function calculateCurrentAge({ storedAge, ageInputDate, referenceDate = new Date() } = {}) {
  if (!isValidStoredAge(storedAge)) {
    return null;
  }

  const input = parseDateOnly(ageInputDate);
  const reference = resolveReferenceDate(referenceDate);
  if (!input || !reference || compareDateParts(reference, input) < 0) {
    return null;
  }

  let anniversaryMonth = input.month;
  let anniversaryDay = input.day;
  if (input.month === 2 && input.day === 29 && !isLeapYear(reference.year)) {
    anniversaryMonth = 3;
    anniversaryDay = 1;
  }

  let completedAnniversaries = reference.year - input.year;
  if (
    reference.month < anniversaryMonth ||
    (reference.month === anniversaryMonth && reference.day < anniversaryDay)
  ) {
    completedAnniversaries -= 1;
  }

  return storedAge + Math.max(0, completedAnniversaries);
}

module.exports = {
  DEMOGRAPHICS_STATUS,
  MAX_AGE,
  MIN_AGE,
  SUPPORTED_SEX_VALUES,
  calculateCurrentAge,
  dateOnlyToUtcDate,
  deriveDemographicsStatus,
  isValidSex,
  isValidStoredAge,
  serializeDateOnly,
  validateInitialDemographicsPayload,
};
