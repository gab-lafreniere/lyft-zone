const TITLE_MAX_LENGTH = 160;
const STRUCTURE_ITEM_MAX_LENGTH = 160;
const MUSCLE_PRIORITY_MAX_ITEMS = 6;
const SECTION_ITEM_MAX_LENGTH = 240;
const SECTION_MAX_ITEMS = 3;
const SUMMARY_MAX_LENGTH = 500;
const PROGRESSION_MAX_LENGTH = 500;

const SECTION_BY_HEADING = new Map([
  ['summary', 'summary'],
  ['overview', 'summary'],
  ['plan summary', 'summary'],
  ['program overview', 'summary'],
  ['weekly logic', 'summary'],
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
  ['practical notes', 'coachingNotes'],
  ['how to use this plan', 'coachingNotes'],
  ['implementation notes', 'coachingNotes'],
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
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

  return (
    !line ||
    /^workout\s+\d+\b/i.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^[A-Z][.)]\s+/.test(line) ||
    /\b(?:exerciseId|sets?|reps?|RIR|tempo|rest)\b/i.test(line) ||
    /\b(?:exr|ex|exercise)_[A-Za-z0-9_-]+\b/i.test(line)
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
        activeSection = null;
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
  return {
    title: normalizeText(completedDocument?.name, TITLE_MAX_LENGTH) || '',
    summary: null,
    weeklyStructure: [],
    musclePriorities: [],
    constraintNotes: [],
    progression: null,
    coachingNotes: [],
  };
}

function buildSimpleWeeklyPlanResultPresentation({
  generatedPlanText,
  completedDocument,
} = {}) {
  const sections = extractGeneralSections(generatedPlanText);

  return {
    title: normalizeText(completedDocument?.name, TITLE_MAX_LENGTH) || '',
    summary: normalizeText(sections.summary.join(' '), SUMMARY_MAX_LENGTH),
    weeklyStructure: buildWeeklyStructure(completedDocument),
    musclePriorities: buildMusclePriorities(completedDocument),
    constraintNotes: sections.constraintNotes,
    progression: normalizeText(
      sections.progression.join(' '),
      PROGRESSION_MAX_LENGTH
    ),
    coachingNotes: sections.coachingNotes,
  };
}

module.exports = {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
  extractGeneralSections,
  isUnsafePresentationLine,
};
