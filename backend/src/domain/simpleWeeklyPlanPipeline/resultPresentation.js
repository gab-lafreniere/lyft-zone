const STRUCTURE_ITEM_MAX_LENGTH = 160;
const MUSCLE_PRIORITY_MAX_ITEMS = 6;
const SECTION_ITEM_MAX_LENGTH = 240;
const SECTION_MAX_ITEMS = 3;
const {
  FALLBACK_PROGRESSION,
  FALLBACK_TITLE,
  sanitizePresentationText,
  validateCoachingNote,
  validateProgression,
  validateSummary,
  validateTitle,
} = require('./presentationText');

const SECTION_BY_HEADING = new Map([
  ['summary', 'summary'],
  ['overview', 'summary'],
  ['plan summary', 'summary'],
  ['program overview', 'summary'],
  ['weekly logic', 'summary'],
  ['weekly structure', 'summary'],
  ['weekly split', 'summary'],
  ['weekly volume logic', 'summary'],
  ['overall weekly logic', 'summary'],
  ['overall strategy', 'summary'],
  ['constraints', 'constraintNotes'],
  ['constraint notes', 'constraintNotes'],
  ['constraint management', 'constraintNotes'],
  ['cautions', 'constraintNotes'],
  ['adaptations', 'constraintNotes'],
  ['progression', 'progression'],
  ['progression approach', 'progression'],
  ['progression plan', 'progression'],
  ['coaching notes', 'coachingNotes'],
  ['notes', 'coachingNotes'],
  ['notes on execution', 'coachingNotes'],
  ['coaching note', 'coachingNotes'],
  ['training note', 'coachingNotes'],
  ['execution notes', 'coachingNotes'],
  ['practical notes', 'coachingNotes'],
  ['how to use this plan', 'coachingNotes'],
  ['implementation notes', 'coachingNotes'],
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, maxLength) {
  const normalized = sanitizePresentationText(value);
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeHeading(value) {
  return String(value || '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*{1,2}|\*{1,2}$/g, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

function isUnsafePresentationLine(value) {
  const line = String(value || '').trim();
  const sanitized = sanitizePresentationText(line);

  return (
    !line ||
    /^workout\s+\d+\b/i.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^[A-Z][.)]\s+/.test(line) ||
    /\bexerciseId\b/i.test(line) ||
    /\bexr_[A-Za-z0-9_-]+/i.test(line) ||
    /\b\d+\s*(?:x|×)\s*\d+\b/i.test(sanitized) ||
    /\b\d+\s*(?:sets?|reps?)\b/i.test(sanitized) ||
    /\bRIR\s*\d/i.test(sanitized) ||
    /\b\d\s*-\s*\d\s*-\s*\d\s*-\s*\d\b/.test(sanitized)
  );
}

function extractGeneralSections(generatedPlanText) {
  const sections = {
    summary: [],
    constraintNotes: [],
    progression: [],
    coachingNotes: [],
  };
  let activeSection = null;

  String(generatedPlanText || '')
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const heading = SECTION_BY_HEADING.get(normalizeHeading(rawLine));
      if (heading) {
        activeSection = heading;
        return;
      }

      if (!activeSection || sections[activeSection].length >= SECTION_MAX_ITEMS) {
        return;
      }

      if (isUnsafePresentationLine(rawLine)) {
        return;
      }

      const normalized = normalizeText(rawLine, SECTION_ITEM_MAX_LENGTH);
      if (normalized) {
        sections[activeSection].push(normalized);
      }
    });

  return sections;
}

function buildWeeklyStructure(completedDocument) {
  return toArray(completedDocument?.workouts)
    .map((workout, index) => ({
      name: normalizeText(workout?.name, STRUCTURE_ITEM_MAX_LENGTH),
      orderIndex:
        Number.isSafeInteger(workout?.orderIndex) && workout.orderIndex > 0
          ? workout.orderIndex
          : index + 1,
      originalIndex: index,
    }))
    .filter((entry) => entry.name)
    .sort(
      (left, right) =>
        left.orderIndex - right.orderIndex ||
        left.originalIndex - right.originalIndex
    )
    .map((entry) => entry.name);
}

function buildMusclePriorities(completedDocument) {
  const priorities = [];
  const seen = new Set();

  toArray(completedDocument?.workouts).forEach((workout) => {
    toArray(workout?.blocks).forEach((block) => {
      toArray(block?.exercises).forEach((exercise) => {
        toArray(exercise?.muscleFocus).forEach((value) => {
          const normalized = normalizeText(value, STRUCTURE_ITEM_MAX_LENGTH);
          const key = normalized?.toLowerCase();
          if (
            normalized &&
            !seen.has(key) &&
            priorities.length < MUSCLE_PRIORITY_MAX_ITEMS
          ) {
            seen.add(key);
            priorities.push(normalized);
          }
        });
      });
    });
  });

  return priorities;
}

function buildSimpleWeeklyPlanResultPresentationFallback(completedDocument) {
  const title = validateTitle(completedDocument?.name);
  return {
    title: title.ok ? title.value : FALLBACK_TITLE,
    summary: null,
    weeklyStructure: [],
    musclePriorities: [],
    constraintNotes: [],
    progression: FALLBACK_PROGRESSION,
    coachingNotes: [],
  };
}

function buildSimpleWeeklyPlanResultPresentation({
  generatedPlanText,
  completedDocument,
} = {}) {
  const sections = extractGeneralSections(generatedPlanText);
  const title = validateTitle(completedDocument?.name);
  const summary = validateSummary(sections.summary.join(' '));
  const progression = validateProgression(sections.progression.join(' '));

  return {
    title: title.ok ? title.value : FALLBACK_TITLE,
    summary: summary.ok ? summary.value : null,
    weeklyStructure: buildWeeklyStructure(completedDocument),
    musclePriorities: buildMusclePriorities(completedDocument),
    constraintNotes: sections.constraintNotes,
    progression: progression.ok ? progression.value : FALLBACK_PROGRESSION,
    coachingNotes: sections.coachingNotes
      .map(validateCoachingNote)
      .filter((result) => result.ok)
      .map((result) => result.value),
  };
}

module.exports = {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
  extractGeneralSections,
  isUnsafePresentationLine,
};
