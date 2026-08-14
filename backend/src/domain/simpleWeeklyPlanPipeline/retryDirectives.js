// Closed, backend-owned directive tables.
//
// No text from Output 02, Output 04, or any model response is ever injected into a
// directive. The only model-authored text that reaches a retry request is the previous
// complete plan being repaired, and only for the creator repair path.

// Binder directives are deliberately count-free. Telling the binder how many workouts
// to expect would make it fabricate one, which destroys the ability to tell a creator
// failure from a binder failure. See product decision D1.
const BINDER_RETRY_DIRECTIVES = Object.freeze({
  WORKOUT_COVERAGE:
    'Every workout present in the SOURCE PLAN must appear exactly once in your response. '
    + 'Bind only what the SOURCE PLAN contains. If the SOURCE PLAN contains fewer workouts '
    + 'than you expect, return only those.',
  BLOCK_ARITY:
    'A SUPERSET is one block that contains all of its exercises. Never emit one block per '
    + 'superset exercise, and never merge separate blocks into one.',
  VERBATIM_SPANS:
    'Every value you return must be copied character for character from the SOURCE PLAN. '
    + 'Never rephrase, reformat, convert units, or compute a value.',
  EXERCISE_IDS:
    'Copy each exerciseId exactly from the SOURCE PLAN, and bind only exercises the SOURCE '
    + 'PLAN actually prescribes inside a workout.',
  REST_SCOPE:
    'Put a rest on the block only when the SOURCE PLAN scopes it to the whole superset '
    + 'round. Otherwise put it on the exercise it belongs to.',
  SET_COUNTS:
    'Copy each set count exactly as the SOURCE PLAN states it. Never adjust a set count to '
    + 'make a block look consistent.',
  COVERAGE:
    'Bind every executable block in every workout, from the first block to the last, and '
    + 'bind each one exactly once. A workout often ends with a cardio or finisher block '
    + 'after its strength work; that closing block is executable and must be bound like '
    + 'any other. Do not stop before the end of a workout, do not skip a block in the '
    + 'middle, and never repeat an exercise the SOURCE PLAN prescribes only once.',
});

const BINDER_DIRECTIVE_BY_CODE = Object.freeze({
  BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING: 'COVERAGE',
  BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS: 'COVERAGE',
  BOUND_PLAN_SCHEMA_INVALID: 'VERBATIM_SPANS',
  BOUND_PLAN_SPAN_NOT_IN_SOURCE: 'VERBATIM_SPANS',
  BOUND_PLAN_WORKOUT_COUNT_MISMATCH: 'WORKOUT_COVERAGE',
  BOUND_PLAN_BLOCK_ARITY_INVALID: 'BLOCK_ARITY',
  BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED: 'BLOCK_ARITY',
  BOUND_PLAN_EXERCISE_OUTSIDE_POOL: 'EXERCISE_IDS',
  BOUND_PLAN_EXERCISE_TYPE_MISMATCH: 'EXERCISE_IDS',
  BOUND_PLAN_REST_SCOPE_INVALID: 'REST_SCOPE',
  BOUND_PLAN_SETS_INVALID: 'SET_COUNTS',
  BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL: 'SET_COUNTS',
});

function buildBinderRetryDirective(failureCodes = []) {
  const keys = Array.from(new Set(
    failureCodes
      .map((code) => BINDER_DIRECTIVE_BY_CODE[code])
      .filter(Boolean)
  ));
  const selected = keys.length ? keys : ['VERBATIM_SPANS'];

  return [
    'BINDING CORRECTION',
    'Your previous response did not satisfy a mechanical requirement of this task.',
    'Re-read the SOURCE PLAN and bind it again, completely and exactly.',
    ...selected.map((key) => `- ${BINDER_RETRY_DIRECTIVES[key]}`),
    'Bind only what the SOURCE PLAN contains. Do not add, remove, or invent anything.',
  ].join('\n');
}

// The backend states what was violated. It never states how to fix it: Call #1 owns
// every coaching decision, including whether the right answer is 3+3, 4+4, or a broader
// revision of the week.
const CREATOR_REPAIR_VIOLATIONS = Object.freeze({
  WORKOUT_COUNT: ({ received, expected }) =>
    `Workout count expected ${expected}, produced ${received}.`,
  SUPERSET_EQUAL_SETS: ({ location, received }) =>
    `A SUPERSET block at ${location} contains exercises with different set counts (${received}).`,
  POOL_ONLY_EXERCISES: ({ received }) =>
    `An exercise identifier outside the eligible exercise pool was used (${received}).`,
});

const CREATOR_REPAIR_INSTRUCTIONS = Object.freeze([
  'PLAN REPAIR',
  'The plan below is the complete plan you generated on the previous attempt.',
  'It violated a hard constraint of this request:',
  '',
  '{{VIOLATION}}',
  '',
  'Revise the complete weekly plan so that this violation is fixed.',
  'Preserve the valid coaching decisions from the previous plan where appropriate.',
  'Make any secondary adjustments required to keep the entire weekly plan coherent and balanced.',
  'Re-check every instruction in this request, not only the constraint that failed.',
  'Return the complete corrected plan in the same human-readable form.',
  'Never return a patch, a diff, a fragment, or a description of what you changed.',
].join('\n'));

function buildCreatorRepairViolation(constraint, facts = {}) {
  const template = CREATOR_REPAIR_VIOLATIONS[constraint];
  if (!template) {
    throw new Error(`Unknown creator repair constraint: ${constraint}`);
  }
  return `${template(facts)} Revise the complete plan to satisfy the original requirements.`;
}

// Assembles the repair request from the original locked prompt plus exactly one
// backend-authored violation description plus the previous plan verbatim.
// buildProgramGenerationPrompt is never modified; attempt 1 stays byte-identical.
function buildCreatorRepairRequest({
  systemMessage,
  userMessage,
  previousPlanText,
  constraint,
  facts,
}) {
  if (typeof previousPlanText !== 'string' || !previousPlanText.trim()) {
    throw new Error('A previous plan is required to build a repair request');
  }
  const violation = buildCreatorRepairViolation(constraint, facts);

  return {
    systemMessage,
    userMessage: [
      userMessage,
      '',
      CREATOR_REPAIR_INSTRUCTIONS.replace('{{VIOLATION}}', violation),
      '',
      'PREVIOUS PLAN',
      previousPlanText,
    ].join('\n'),
    violation,
  };
}

module.exports = {
  BINDER_DIRECTIVE_BY_CODE,
  BINDER_RETRY_DIRECTIVES,
  CREATOR_REPAIR_INSTRUCTIONS,
  CREATOR_REPAIR_VIOLATIONS,
  buildBinderRetryDirective,
  buildCreatorRepairRequest,
  buildCreatorRepairViolation,
};
