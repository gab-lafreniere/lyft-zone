const WARM_UP_CARDIO_ROLES = new Set([
  'warm_up_only',
  'warm_up_and_cardio',
]);
const CARDIO_ENABLED_ROLES = new Set([
  'warm_up_only',
  'cardio_sessions',
  'warm_up_and_cardio',
]);

const WARM_UP_SHOULD_DIRECTIVE =
  'You should include a 5-minute light cardio warm-up as the first executable block of each workout.';
const WARM_UP_MUST_DIRECTIVE =
  'You must include a 5-minute light cardio warm-up as the first executable block of every workout.';

const POST_CARDIO_SHOULD_10_DIRECTIVE =
  'You should include at least 10 minutes of easy post-workout cardio when it can fit without compromising the resistance-training priority.';
const POST_CARDIO_SHOULD_15_DIRECTIVE =
  'You should include at least 15 minutes of easy post-workout cardio when it can fit without compromising the resistance-training priority.';
const POST_CARDIO_MUST_20_DIRECTIVE =
  'You must include at least 20 minutes of easy post-workout cardio at the end of each workout.';
const POST_CARDIO_MUST_30_DIRECTIVE =
  'You must include at least 30 minutes of easy post-workout cardio at the end of each workout.';
const POST_CARDIO_QUALITY_DIRECTIVE =
  'Any post-workout cardio should be easy, low-interference, conversational steady-state work that does not reduce resistance-training quality or recovery. Do not add HIIT unless explicitly requested elsewhere.';

const INTERMEDIATE_LONG_SESSION_DIRECTIVE =
  'Use the available session time productively. Do not artificially compress the resistance-training portion into a short workout when additional productive volume would improve the program.';
const ADVANCED_LONG_SESSION_DIRECTIVE =
  'Because this is an advanced athlete, use the available session time productively and do not be overly conservative with resistance-training volume when additional high-quality work is appropriate.';
const INTERMEDIATE_VERY_LONG_SESSION_DIRECTIVE =
  'The athlete has substantial training time available. Build a complete resistance-training session and use that time meaningfully rather than stopping once a conventional 60–75 minute workout has been reached.';
const ADVANCED_VERY_LONG_SESSION_DIRECTIVE =
  'This is an advanced athlete with substantial training time available. Build a high-volume but recoverable resistance-training session and use the available time meaningfully rather than stopping once a conventional 60–75 minute workout has been reached.';
const ADVANCED_VOLUME_PERMISSION_DIRECTIVE =
  'For very long advanced sessions, resistance-training volume may appropriately extend beyond a conventional 18–20 working sets when the additional work remains high quality, non-redundant, and recoverable.';
const LONG_SESSION_SPECIALIZATION_GUARDRAIL =
  'Long session duration does not justify excessive specialization. Generally avoid exceeding approximately 30 direct working sets per week for any single muscle group. When a prioritized muscle is already approaching that range, use remaining productive training time for other muscle groups, balanced accessory work, or the requested cardio rather than adding more direct volume to that muscle.';
const NO_JUNK_VOLUME_DIRECTIVE =
  'Do not add junk volume merely to fill time. Additional work must remain productive, non-redundant, and appropriate for the athlete’s level, priorities, and recovery.';
const CARDIO_VISIBILITY_DIRECTIVE =
  'When cardio is included or required, render it as an explicit executable CARDIO block in the human-readable workout rather than only mentioning it in notes.';

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function buildProgramGenerationSessionDirectives({
  requestedDurationMinutes,
  experience,
  cardioRole,
} = {}) {
  if (
    !Number.isSafeInteger(requestedDurationMinutes) ||
    requestedDurationMinutes < 1
  ) {
    throw new TypeError('A positive integer requested duration is required');
  }

  const normalizedExperience = normalizeIdentifier(experience);
  const normalizedCardioRole = normalizeIdentifier(cardioRole);
  const directives = [];

  if (WARM_UP_CARDIO_ROLES.has(normalizedCardioRole)) {
    if (requestedDurationMinutes >= 45) {
      directives.push(WARM_UP_MUST_DIRECTIVE);
    } else if (requestedDurationMinutes >= 30) {
      directives.push(WARM_UP_SHOULD_DIRECTIVE);
    }
  }

  if (normalizedCardioRole === 'warm_up_and_cardio') {
    if (requestedDurationMinutes >= 120) {
      directives.push(POST_CARDIO_MUST_30_DIRECTIVE);
    } else if (requestedDurationMinutes >= 90) {
      directives.push(POST_CARDIO_MUST_20_DIRECTIVE);
    } else if (requestedDurationMinutes >= 75) {
      directives.push(POST_CARDIO_SHOULD_15_DIRECTIVE);
    } else if (requestedDurationMinutes >= 60) {
      directives.push(POST_CARDIO_SHOULD_10_DIRECTIVE);
    }

    directives.push(POST_CARDIO_QUALITY_DIRECTIVE);
  }

  let volumeDirective = null;
  if (requestedDurationMinutes >= 105) {
    if (normalizedExperience === 'advanced') {
      volumeDirective = ADVANCED_VERY_LONG_SESSION_DIRECTIVE;
    } else if (normalizedExperience === 'intermediate') {
      volumeDirective = INTERMEDIATE_VERY_LONG_SESSION_DIRECTIVE;
    }
  } else if (requestedDurationMinutes >= 75) {
    if (normalizedExperience === 'advanced') {
      volumeDirective = ADVANCED_LONG_SESSION_DIRECTIVE;
    } else if (normalizedExperience === 'intermediate') {
      volumeDirective = INTERMEDIATE_LONG_SESSION_DIRECTIVE;
    }
  }

  if (volumeDirective) {
    directives.push(volumeDirective);
  }
  if (
    normalizedExperience === 'advanced' &&
    requestedDurationMinutes >= 105
  ) {
    directives.push(ADVANCED_VOLUME_PERMISSION_DIRECTIVE);
  }
  if (requestedDurationMinutes >= 105) {
    directives.push(LONG_SESSION_SPECIALIZATION_GUARDRAIL);
  }
  if (volumeDirective || requestedDurationMinutes >= 105) {
    directives.push(NO_JUNK_VOLUME_DIRECTIVE);
  }

  if (CARDIO_ENABLED_ROLES.has(normalizedCardioRole)) {
    directives.push(CARDIO_VISIBILITY_DIRECTIVE);
  }

  return directives;
}

module.exports = {
  buildProgramGenerationSessionDirectives,
};
