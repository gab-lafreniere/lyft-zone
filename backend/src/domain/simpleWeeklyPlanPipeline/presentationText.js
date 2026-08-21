const FALLBACK_TITLE = 'Personalized Training Plan';
const FALLBACK_PROGRESSION =
  'Progress gradually while keeping technique consistent and effort controlled.';

function sanitizePresentationText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/^\s*(?:[-*•]\s*)+/, '')
    .replace(/[*_`]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function countSentences(value) {
  const endings = value.match(/[.!?]+["']?(?=\s|$)/g)?.length || 0;
  if (endings === 0) {
    return 1;
  }
  return endings + (/[.!?]["']?$/.test(value) ? 0 : 1);
}

function validateText(value, { minLength, maxLength, minSentences, maxSentences }) {
  const sanitized = sanitizePresentationText(value);
  const sentenceCount = sanitized ? countSentences(sanitized) : 0;
  const hasDanglingEnding = /[-:,]\s*$/.test(sanitized);
  const ok =
    sanitized.length >= minLength &&
    sanitized.length <= maxLength &&
    sentenceCount >= minSentences &&
    sentenceCount <= maxSentences &&
    !hasDanglingEnding;

  return { ok, value: sanitized };
}

function validateTitle(value) {
  const sanitized = sanitizePresentationText(value);
  const wordCount = sanitized ? sanitized.split(/\s+/).length : 0;
  return {
    ok:
      wordCount >= 2 &&
      wordCount <= 8 &&
      sanitized.length >= 10 &&
      sanitized.length <= 70 &&
      !/[-:,]\s*$/.test(sanitized),
    value: sanitized,
  };
}

function validateSummary(value) {
  return validateText(value, {
    minLength: 40,
    maxLength: 220,
    minSentences: 1,
    maxSentences: 1,
  });
}

function validateProgression(value) {
  return validateText(value, {
    minLength: 40,
    maxLength: 300,
    minSentences: 1,
    maxSentences: 2,
  });
}

function validateCoachingNote(value) {
  return validateText(value, {
    minLength: 20,
    maxLength: 160,
    minSentences: 1,
    maxSentences: 1,
  });
}

module.exports = {
  FALLBACK_PROGRESSION,
  FALLBACK_TITLE,
  sanitizePresentationText,
  validateCoachingNote,
  validateProgression,
  validateSummary,
  validateTitle,
};
