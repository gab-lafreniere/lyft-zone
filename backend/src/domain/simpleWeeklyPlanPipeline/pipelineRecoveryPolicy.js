// The error/recovery matrix, expressed as data.
//
// Verification reports facts; this module decides ownership and the single next action.
// Nothing here reads Output 02 or Output 04 content: it routes on failure codes and
// attempt state only.

const RECOVERY_LEVELS = Object.freeze({
  OFF: 'OFF',
  BINDER_ONLY: 'BINDER_ONLY',
  FULL: 'FULL',
});

const RECOVERY_BUDGETS = Object.freeze({
  maxCreatorAttempts: 2,
  maxBinderAttemptsPerCreatorOutput: 2,
  maxBinderAttemptsTotal: 4,
  maxFallbackAttempts: 1,
});

const ACTIONS = Object.freeze({
  PROCEED: 'PROCEED',
  RETRY_BINDER: 'RETRY_BINDER',
  REPAIR_CREATOR: 'REPAIR_CREATOR',
  FAIL_CLOSED: 'FAIL_CLOSED',
});

const OWNERS = Object.freeze({
  BINDER: 'BINDER',
  CREATOR_CANDIDATE: 'CREATOR_CANDIDATE',
});

// A creator repair is only ever offered for a constraint the Call #1 prompt actually
// states to the coach. Re-running the creator to fix something it was never told is
// unbounded and unverifiable.
//
//   WORKOUT_COUNT        programGenerationProfileNarrative.js — "train exactly N times per week"
//   SUPERSET_EQUAL_SETS  programGenerationPrompt.js — "same number of sets" within a SUPERSET
//   POOL_ONLY_EXERCISES  programGenerationPrompt.js — "Use only exercises from the eligible exercise pool"
const FAILURE_POLICY = Object.freeze({
  BOUND_PLAN_SCHEMA_INVALID: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_SPAN_NOT_IN_SOURCE: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_BLOCK_ARITY_INVALID: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_SETS_INVALID: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_REST_SCOPE_INVALID: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_EXERCISE_TYPE_MISMATCH: { owner: OWNERS.BINDER, constraint: null },
  // Occurrence-integrity violations are binding faults, never coaching faults: the
  // source is unchanged between binds, so a deficit or surplus is the binder's doing.
  // They therefore earn a binder retry and, with no budget left, fail closed — they
  // must never be silently accepted and must never reach creator repair.
  BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS: { owner: OWNERS.BINDER, constraint: null },
  BOUND_PLAN_WORKOUT_COUNT_MISMATCH: {
    owner: OWNERS.CREATOR_CANDIDATE,
    constraint: 'WORKOUT_COUNT',
    terminalCode: 'CREATOR_WORKOUT_COUNT_UNSATISFIED',
  },
  BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL: {
    owner: OWNERS.CREATOR_CANDIDATE,
    constraint: 'SUPERSET_EQUAL_SETS',
    terminalCode: 'CREATOR_SUPERSET_SET_COUNT_UNEQUAL',
  },
  BOUND_PLAN_EXERCISE_OUTSIDE_POOL: {
    owner: OWNERS.CREATOR_CANDIDATE,
    constraint: 'POOL_ONLY_EXERCISES',
    terminalCode: 'CREATOR_EXERCISE_OUTSIDE_POOL',
  },
});

function policyFor(code) {
  return FAILURE_POLICY[code] || { owner: OWNERS.BINDER, constraint: null };
}

function classifyFailures(failures = []) {
  const codes = Array.from(new Set(failures.map((failure) => failure.code)));
  const binderCodes = codes.filter(
    (code) => policyFor(code).owner === OWNERS.BINDER
  );
  const creatorCodes = codes.filter(
    (code) => policyFor(code).owner === OWNERS.CREATOR_CANDIDATE
  );
  const constraints = Array.from(new Set(
    creatorCodes.map((code) => policyFor(code).constraint)
  )).sort();

  return {
    codes,
    binderCodes,
    creatorCodes,
    constraints,
    // A bind carrying any binder-owned defect is simply a bad bind. Only a bind that is
    // mechanically sound yet still violates a creator constraint is evidence about the
    // source document.
    owner: binderCodes.length > 0
      ? OWNERS.BINDER
      : creatorCodes.length > 0
        ? OWNERS.CREATOR_CANDIDATE
        : null,
  };
}

function terminalCodeFor(constraints) {
  if (!constraints.length) {
    return 'BOUND_PLAN_VERIFICATION_FAILED';
  }
  const entry = Object.values(FAILURE_POLICY).find(
    (policy) => policy.constraint === constraints[0]
  );
  return entry?.terminalCode || 'BOUND_PLAN_VERIFICATION_FAILED';
}

function budgetsFor(state) {
  return {
    binderForPlanRemaining:
      RECOVERY_BUDGETS.maxBinderAttemptsPerCreatorOutput - state.binderAttemptForPlan,
    binderTotalRemaining:
      RECOVERY_BUDGETS.maxBinderAttemptsTotal - state.binderAttemptsTotal,
    creatorRemaining:
      RECOVERY_BUDGETS.maxCreatorAttempts - state.creatorAttempt,
  };
}

function canRetryBinder(state, level) {
  if (level === RECOVERY_LEVELS.OFF) {
    return false;
  }
  const budgets = budgetsFor(state);
  return budgets.binderForPlanRemaining > 0 && budgets.binderTotalRemaining > 0;
}

function canRepairCreator(state, level) {
  if (level !== RECOVERY_LEVELS.FULL || state.creatorRepairUsed) {
    return false;
  }
  const budgets = budgetsFor(state);
  // A repaired plan must still get a full binder allowance of its own, otherwise it
  // could be discarded because its first bind happened to be defective.
  return (
    budgets.creatorRemaining > 0 &&
    budgets.binderTotalRemaining >= RECOVERY_BUDGETS.maxBinderAttemptsPerCreatorOutput
  );
}

/**
 * Decides the single next action after a bound-plan verification result.
 *
 * state:
 *   recoveryLevel                     OFF | BINDER_ONLY | FULL
 *   creatorAttempt                    1-based Call #1 attempt number
 *   binderAttemptForPlan              1-based Call #2 attempt for the current Call #1 output
 *   binderAttemptsTotal               Call #2 attempts consumed so far in this run
 *   creatorRepairUsed                 one-way boolean
 *   previousConstraintsForPlan        constraints seen on the previous bind of this
 *                                     same Call #1 output, or null on the first bind
 */
function decideRecoveryAction({ failures = [], coverage = null, state }) {
  const classification = classifyFailures(failures);

  if (!classification.owner) {
    return { action: ACTIONS.PROCEED, classification };
  }

  const level = state.recoveryLevel || RECOVERY_LEVELS.OFF;

  if (classification.owner === OWNERS.BINDER) {
    if (canRetryBinder(state, level)) {
      return {
        action: ACTIONS.RETRY_BINDER,
        classification,
        reason: 'BINDER_DEFECT',
        failureCodes: classification.codes,
      };
    }
    return {
      action: ACTIONS.FAIL_CLOSED,
      classification,
      code: classification.binderCodes[0],
      reason: 'BINDER_DEFECT_UNRECOVERED',
    };
  }

  // Creator-owned constraint violated by a mechanically sound bind.
  const previous = state.previousConstraintsForPlan;
  const reproduced = Array.isArray(previous) &&
    previous.length === classification.constraints.length &&
    previous.every((constraint, index) => constraint === classification.constraints[index]);

  // Two independent binds of the same unchanged source agreeing on the violation do not
  // prove a creator failure. They make a creator repair eligible, because the violated
  // constraint is one Call #1 was explicitly given.
  if (!reproduced && canRetryBinder(state, level)) {
    return {
      action: ACTIONS.RETRY_BINDER,
      classification,
      reason: 'CREATOR_CONSTRAINT_UNCONFIRMED',
      failureCodes: classification.codes,
    };
  }

  if (reproduced && canRepairCreator(state, level)) {
    return {
      action: ACTIONS.REPAIR_CREATOR,
      classification,
      reason: 'CREATOR_CONSTRAINT_REPRODUCED',
      constraint: classification.constraints[0],
      failureCodes: classification.codes,
    };
  }

  return {
    action: ACTIONS.FAIL_CLOSED,
    classification,
    code: terminalCodeFor(classification.constraints),
    reason: reproduced
      ? 'CREATOR_CONSTRAINT_UNSATISFIED'
      : 'CREATOR_CONSTRAINT_UNCONFIRMED_NO_BUDGET',
  };
}

module.exports = {
  ACTIONS,
  FAILURE_POLICY,
  OWNERS,
  RECOVERY_BUDGETS,
  RECOVERY_LEVELS,
  classifyFailures,
  decideRecoveryAction,
};
