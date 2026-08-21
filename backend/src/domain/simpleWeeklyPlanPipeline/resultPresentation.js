const STRUCTURE_ITEM_MAX_LENGTH = 160;
const MUSCLE_PRIORITY_MAX_ITEMS = 6;
const SECTION_ITEM_MAX_LENGTH = 240;
const SECTION_MAX_ITEMS = 3;
const PROGRAM_PRESENTATION_HEADING = 'PROGRAM PRESENTATION';
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

function extractProgramPresentation(generatedPlanText) {
  const lines = String(generatedPlanText || '').split(/\r?\n/);
  const startIndex = lines.findIndex(
    (line) => String(line || '').trim().toUpperCase() === PROGRAM_PRESENTATION_HEADING
  );
  if (startIndex < 0) {
    return null;
  }

  const result = {
    title: null,
    summary: null,
    progression: null,
    coachingNotes: [],
  };
  let matchedField = false;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '').trim();
    if (!line) {
      continue;
    }
    if (/^#{0,2}\s*(?:Day|Session|Workout)\s+\d+\b/i.test(line)) {
      break;
    }
    const field = line.match(/^(TITLE|SUMMARY|PROGRESSION|NOTE):\s*(.*)$/i);
    if (!field) {
      if (matchedField) {
        break;
      }
      continue;
    }
    matchedField = true;
    const key = field[1].toUpperCase();
    const value = field[2].trim();
    if (!value) {
      continue;
    }
    if (key === 'NOTE') {
      if (result.coachingNotes.length < SECTION_MAX_ITEMS) {
        result.coachingNotes.push(value);
      }
    } else {
      const target = key.toLowerCase();
      if (!result[target]) {
        result[target] = value;
      }
    }
  }

  return matchedField ? result : null;
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

const TITLE_PRIORITY_LABELS = Object.freeze({
  chest: 'Chest',
  upperchest: 'Chest',
  midchest: 'Chest',
  lowerchest: 'Chest',
  back: 'Back',
  lats: 'Back',
  upperback: 'Back',
  lowerback: 'Back',
  shoulders: 'Shoulders',
  frontdelts: 'Shoulders',
  sidedelts: 'Shoulders',
  reardelts: 'Shoulders',
  biceps: 'Biceps',
  bicepslonghead: 'Biceps',
  bicepsshorthead: 'Biceps',
  triceps: 'Triceps',
  tricepslonghead: 'Triceps',
  tricepslateralhead: 'Triceps',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Glutes',
  calves: 'Calves',
  abs: 'Core',
  core: 'Core',
  obliques: 'Core',
});

function buildPriorityTitle(musclePriorities) {
  const labels = [];
  toArray(musclePriorities).forEach((value) => {
    const key = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const label = TITLE_PRIORITY_LABELS[key];
    if (label && !labels.includes(label) && labels.length < 2) {
      labels.push(label);
    }
  });
  if (labels.length === 0) {
    return null;
  }
  const candidate = `${labels.join(' + ')} Hypertrophy`;
  const validation = validateTitle(candidate);
  return validation.ok ? validation.value : null;
}

function firstValid(validator, candidates, fallback) {
  for (const candidate of candidates) {
    const result = validator(candidate);
    if (result.ok) {
      return result.value;
    }
  }
  return fallback;
}

function validCoachingNotes(value) {
  return toArray(value)
    .slice(0, SECTION_MAX_ITEMS)
    .map(validateCoachingNote)
    .filter((result) => result.ok)
    .map((result) => result.value);
}

function firstUsableNotes(candidates) {
  for (const candidate of candidates) {
    const notes = validCoachingNotes(candidate);
    if (notes.length > 0) {
      return notes;
    }
  }
  return [];
}

function exactBoundScalar(boundPresentation, exactPresentation, key) {
  const bound = boundPresentation?.[key];
  const exact = exactPresentation?.[key];
  return typeof bound === 'string' && bound === exact ? bound : null;
}

function exactBoundNotes(boundPresentation, exactPresentation) {
  const bound = boundPresentation?.coachingNotes;
  const exact = exactPresentation?.coachingNotes;
  if (
    !Array.isArray(bound) ||
    !Array.isArray(exact) ||
    bound.length !== exact.length ||
    bound.some((value, index) => value !== exact[index])
  ) {
    return null;
  }
  return bound;
}

function buildSimpleWeeklyPlanResultPresentationFallback(completedDocument) {
  const musclePriorities = buildMusclePriorities(completedDocument);
  const title = firstValid(
    validateTitle,
    [completedDocument?.name, buildPriorityTitle(musclePriorities)],
    FALLBACK_TITLE
  );
  return {
    title,
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
  boundPresentation = null,
  presentationContractEnabled = true,
} = {}) {
  const sections = extractGeneralSections(generatedPlanText);
  const exactPresentation = presentationContractEnabled
    ? extractProgramPresentation(generatedPlanText)
    : null;
  const structuredPresentation = presentationContractEnabled &&
    boundPresentation &&
    typeof boundPresentation === 'object' &&
    !Array.isArray(boundPresentation)
    ? boundPresentation
    : null;
  const musclePriorities = buildMusclePriorities(completedDocument);
  const title = firstValid(
    validateTitle,
    [
      exactBoundScalar(structuredPresentation, exactPresentation, 'title'),
      exactPresentation?.title,
      completedDocument?.name,
      buildPriorityTitle(musclePriorities),
    ],
    FALLBACK_TITLE
  );
  const summary = firstValid(
    validateSummary,
    [
      exactBoundScalar(structuredPresentation, exactPresentation, 'summary'),
      exactPresentation?.summary,
      sections.summary.join(' '),
    ],
    null
  );
  const progression = firstValid(
    validateProgression,
    [
      exactBoundScalar(
        structuredPresentation,
        exactPresentation,
        'progression'
      ),
      exactPresentation?.progression,
      sections.progression.join(' '),
    ],
    FALLBACK_PROGRESSION
  );

  return {
    title,
    summary,
    weeklyStructure: buildWeeklyStructure(completedDocument),
    musclePriorities,
    constraintNotes: sections.constraintNotes,
    progression,
    coachingNotes: firstUsableNotes([
      exactBoundNotes(structuredPresentation, exactPresentation),
      exactPresentation?.coachingNotes,
      sections.coachingNotes,
    ]),
  };
}

module.exports = {
  buildSimpleWeeklyPlanResultPresentation,
  buildSimpleWeeklyPlanResultPresentationFallback,
  extractGeneralSections,
  extractProgramPresentation,
  isUnsafePresentationLine,
};
