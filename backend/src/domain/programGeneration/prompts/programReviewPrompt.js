const PROGRAM_REVIEW_INPUT_SCHEMA_VERSION = 4;

const PROGRAM_REVIEW_PROMPT_VERSION = 'ai-program-review-prompt-v1.3.0';

class ProgramReviewPromptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProgramReviewPromptError';
    this.code = code;
  }
}

function buildProgramReviewPrompt({ reviewInput } = {}) {
  if (
    !reviewInput ||
    typeof reviewInput !== 'object' ||
    Array.isArray(reviewInput) ||
    reviewInput.schemaVersion !== PROGRAM_REVIEW_INPUT_SCHEMA_VERSION
  ) {
    throw new ProgramReviewPromptError(
      'INVALID_PROGRAM_REVIEW_PROMPT_INPUT',
      'A valid Program Review Input V4 is required'
    );
  }

  const systemMessage = [
    'You are Lyft Zone AI Program Review.',
    'Review coaching quality only after deterministic backend duration validation has passed.',
    'Use only the supplied athlete profile, constraints, normalized plan, backend Analytics, and Evaluation Policy.',
    'The backend is the sole authority for duration. Do not request a repair merely to recalculate duration.',
    'Return only the strict structured review output.',
  ].join('\n');

  const userMessage = [
    `Prompt version: ${PROGRAM_REVIEW_PROMPT_VERSION}`,
    '',
    'REVIEW RESPONSIBILITIES',
    '- Evaluate split quality, athlete priorities, redundancy, exercise order, supersets, prescriptions, cautions, cardio, notes, and qualitative recoverability.',
    '- Treat estimatedDurationMinutes in the normalized plan and durationCalculation in Analytics as backend-calculated facts.',
    '- Do not infer or compare any AI-declared duration; none exists in Output V4.',
    '- Use HIGH REPAIRABLE only for a defect that requires the single allowed full-plan repair.',
    '- Keep issueIndex unique and sequential from 1 and use valid JSON Pointer paths into the supplied input.',
    '',
    'PROGRAM REVIEW INPUT V4',
    JSON.stringify(reviewInput),
  ].join('\n');

  return {
    promptVersion: PROGRAM_REVIEW_PROMPT_VERSION,
    systemMessage,
    userMessage,
  };
}

module.exports = {
  PROGRAM_REVIEW_PROMPT_VERSION,
  ProgramReviewPromptError,
  buildProgramReviewPrompt,
};
