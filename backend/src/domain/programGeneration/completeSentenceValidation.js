const COMPLETE_SENTENCE_TERMINAL_PATTERN = /[.!?]$/;
const COMPLETE_SENTENCE_BOUNDARY_PATTERN = /[.!?]+(?=\s|$)/g;

function normalizeExplanatoryText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countCompleteSentences(value) {
  const normalized = normalizeExplanatoryText(value);
  if (!normalized || !COMPLETE_SENTENCE_TERMINAL_PATTERN.test(normalized)) {
    return 0;
  }

  return normalized.match(COMPLETE_SENTENCE_BOUNDARY_PATTERN)?.length || 0;
}

function validateCompleteSentenceText(
  value,
  {
    path = 'text',
    minimumSentences = 1,
    maximumSentences = 3,
  } = {}
) {
  const normalized = normalizeExplanatoryText(value);
  const issues = [];

  if (!normalized) {
    issues.push({
      code: 'EXPLANATION_REQUIRED',
      path,
      message: 'Explanation must contain non-whitespace text',
    });
    return {
      ok: false,
      value: null,
      sentenceCount: 0,
      issues,
    };
  }

  if (!COMPLETE_SENTENCE_TERMINAL_PATTERN.test(normalized)) {
    issues.push({
      code: 'INCOMPLETE_EXPLANATION',
      path,
      message: 'Explanation must end with ".", "!", or "?"',
    });
  }

  const sentenceCount = countCompleteSentences(normalized);
  if (
    sentenceCount < minimumSentences ||
    sentenceCount > maximumSentences
  ) {
    issues.push({
      code: 'INVALID_EXPLANATION_SENTENCE_COUNT',
      path,
      message: `Explanation must contain ${minimumSentences} to ${maximumSentences} complete sentences`,
      expected: {
        minimumSentences,
        maximumSentences,
      },
      actual: sentenceCount,
    });
  }

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? normalized : null,
    sentenceCount,
    issues,
  };
}

module.exports = {
  countCompleteSentences,
  normalizeExplanatoryText,
  validateCompleteSentenceText,
};
