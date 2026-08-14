const Ajv = require('ajv');

const {
  BOUND_PLAN_SCHEMA_VERSION,
  buildSimpleWeeklyPlanBoundPlanSchema,
} = require('./boundPlanSchema');

const ajv = new Ajv({ allErrors: true, strict: false });
let compiledBoundPlanValidator = null;

function getBoundPlanValidator() {
  if (!compiledBoundPlanValidator) {
    compiledBoundPlanValidator = ajv.compile(
      buildSimpleWeeklyPlanBoundPlanSchema()
    );
  }
  return compiledBoundPlanValidator;
}

// Every verbatim span the binder returns must be a literal substring of the source
// plan. This is a reject-only predicate: it can invalidate a binding, it can never
// produce one. It has no grammar, no headings and no field labels, so it cannot form
// an opinion about what the source means.
const VERBATIM_SPAN_FIELDS = Object.freeze([
  'reps',
  'rir',
  'rpe',
  'tempo',
  'rest',
  'duration',
  'intensity',
  'notes',
]);

// VERIFICATION ONLY. This projection is used solely to answer "does this string occur
// in the source"; it never touches the bound value, which flows downstream verbatim.
//
// Call #1 emits markdown, so a binder copying the visible words of
// `- Rest: **0 sec** between paired exercises` legitimately returns
// `0 sec between paired exercises`. Emphasis markers are presentation, not content, so
// they are folded on both sides exactly like whitespace and unicode dashes.
//
// Folding `_` also softens the match for exerciseId, which is harmless: exerciseId
// carries a separate exact, case-sensitive pool-membership check (V3), so an invented
// identifier is still rejected there.
function normalizeForSpanMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function issue(code, path, message, extra = {}) {
  return { code, path, message, ...extra };
}

function blockPath(workoutIndex, blockIndex) {
  return `$/workouts/${workoutIndex}/blocks/${blockIndex}`;
}

function exercisePath(workoutIndex, blockIndex, exerciseIndex) {
  return `${blockPath(workoutIndex, blockIndex)}/exercises/${exerciseIndex}`;
}

function eachExercise(boundPlan, visit) {
  (boundPlan?.workouts || []).forEach((workout, workoutIndex) => {
    (workout?.blocks || []).forEach((block, blockIndex) => {
      (block?.exercises || []).forEach((exercise, exerciseIndex) => {
        visit({
          exercise,
          block,
          workout,
          workoutIndex,
          blockIndex,
          exerciseIndex,
        });
      });
    });
  });
}

function verifySchema(boundPlan) {
  const validate = getBoundPlanValidator();
  if (validate(boundPlan)) {
    return [];
  }
  return [
    issue(
      'BOUND_PLAN_SCHEMA_INVALID',
      '$',
      'Bound plan does not match the BoundPlan v1 contract',
      {
        expected: { schemaVersion: BOUND_PLAN_SCHEMA_VERSION },
        detail: structuredClone(validate.errors || []).slice(0, 20),
      }
    ),
  ];
}

function verifySpans(boundPlan, generatedPlanText) {
  const haystack = normalizeForSpanMatch(generatedPlanText);
  const failures = [];
  let checked = 0;

  function check(value, path) {
    if (value == null) {
      return;
    }
    checked += 1;
    const needle = normalizeForSpanMatch(value);
    if (!needle || haystack.includes(needle)) {
      return;
    }
    failures.push(
      issue(
        'BOUND_PLAN_SPAN_NOT_IN_SOURCE',
        path,
        'Bound value is not present verbatim in the source plan',
        { received: value }
      )
    );
  }

  eachExercise(boundPlan, ({
    exercise,
    workoutIndex,
    blockIndex,
    exerciseIndex,
  }) => {
    const base = exercisePath(workoutIndex, blockIndex, exerciseIndex);
    check(exercise.exerciseId, `${base}/exerciseId`);
    VERBATIM_SPAN_FIELDS.forEach((field) => {
      check(exercise[field], `${base}/${field}`);
    });
    (exercise.machineSettings || []).forEach((setting, settingIndex) => {
      check(setting?.value, `${base}/machineSettings/${settingIndex}/value`);
    });
  });

  (boundPlan?.workouts || []).forEach((workout, workoutIndex) => {
    check(workout?.name, `$/workouts/${workoutIndex}/name`);
    (workout?.blocks || []).forEach((block, blockIndex) => {
      check(
        block?.restAfterRound,
        `${blockPath(workoutIndex, blockIndex)}/restAfterRound`
      );
    });
  });

  return { failures, checked };
}

function verifyEligibility(boundPlan, eligibleExerciseLookup = {}) {
  const failures = [];

  eachExercise(boundPlan, ({
    exercise,
    block,
    workoutIndex,
    blockIndex,
    exerciseIndex,
  }) => {
    const path = `${exercisePath(workoutIndex, blockIndex, exerciseIndex)}/exerciseId`;
    const eligible = eligibleExerciseLookup[exercise.exerciseId];
    if (!eligible) {
      failures.push(
        issue(
          'BOUND_PLAN_EXERCISE_OUTSIDE_POOL',
          path,
          'Bound exerciseId is not a member of the eligible exercise pool',
          { received: exercise.exerciseId }
        )
      );
      return;
    }
    const expected = block.type === 'CARDIO' ? 'cardio' : 'strength';
    if (String(eligible.trainingType || '').toLowerCase() !== expected) {
      failures.push(
        issue(
          'BOUND_PLAN_EXERCISE_TYPE_MISMATCH',
          path,
          `${block.type} requires a ${expected} exercise`,
          { received: eligible.trainingType, expected }
        )
      );
    }
  });

  return failures;
}

// Arity is asserted here rather than in the JSON schema on purpose. Under strict
// Structured Outputs a schema-level `SUPERSET => minItems 2` would constrain
// decoding and could compel the model to invent a second exercise when the source
// superset is only partly legible. A backend assertion reports the inconsistency
// instead of coercing fabrication.
function verifyArity(boundPlan) {
  const failures = [];

  (boundPlan?.workouts || []).forEach((workout, workoutIndex) => {
    (workout?.blocks || []).forEach((block, blockIndex) => {
      const path = blockPath(workoutIndex, blockIndex);
      const count = (block?.exercises || []).length;

      if (block.type === 'SINGLE' && count !== 1) {
        failures.push(issue(
          'BOUND_PLAN_BLOCK_ARITY_INVALID',
          path,
          'SINGLE blocks must contain exactly one exercise',
          { received: count, expected: 1, blockType: block.type }
        ));
      }
      if (block.type === 'CARDIO' && count !== 1) {
        failures.push(issue(
          'BOUND_PLAN_BLOCK_ARITY_INVALID',
          path,
          'CARDIO blocks must contain exactly one exercise',
          { received: count, expected: 1, blockType: block.type }
        ));
      }
      if (block.type === 'SUPERSET' && count < 2) {
        failures.push(issue(
          'BOUND_PLAN_BLOCK_ARITY_INVALID',
          path,
          'SUPERSET blocks must contain at least two exercises',
          { received: count, expected: 2, blockType: block.type }
        ));
      }
      // Product decision D5: the backend is arity agnostic, but the Manual Builder
      // superset contract is exactly two lanes (A1/A2). Reject wider blocks until
      // the editor supports them.
      if (block.type === 'SUPERSET' && count > 2) {
        failures.push(issue(
          'BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED',
          path,
          'Supersets with more than two lanes are not supported yet',
          { received: count, expected: 2 }
        ));
      }
    });
  });

  return failures;
}

function verifySetCardinality(boundPlan) {
  const failures = [];

  eachExercise(boundPlan, ({
    exercise,
    block,
    workoutIndex,
    blockIndex,
    exerciseIndex,
  }) => {
    const path = `${exercisePath(workoutIndex, blockIndex, exerciseIndex)}/sets`;
    if (block.type === 'CARDIO') {
      if (exercise.sets !== null) {
        failures.push(issue(
          'BOUND_PLAN_SETS_INVALID',
          path,
          'CARDIO exercises must not carry a set count',
          { received: exercise.sets, expected: null }
        ));
      }
      return;
    }
    if (!Number.isInteger(exercise.sets) || exercise.sets < 1) {
      failures.push(issue(
        'BOUND_PLAN_SETS_INVALID',
        path,
        'Strength exercises must carry a positive integer set count',
        { received: exercise.sets, expected: { minimum: 1 } }
      ));
    }
  });

  return failures;
}

function verifyWorkoutCount(boundPlan, sessionsPerWeek) {
  const received = (boundPlan?.workouts || []).length;
  if (!Number.isInteger(sessionsPerWeek) || received === sessionsPerWeek) {
    return [];
  }
  return [
    issue(
      'BOUND_PLAN_WORKOUT_COUNT_MISMATCH',
      '$/workouts',
      'Bound workout count does not match the requested sessions per week',
      { received, expected: sessionsPerWeek }
    ),
  ];
}

function verifyRestScope(boundPlan) {
  const failures = [];

  (boundPlan?.workouts || []).forEach((workout, workoutIndex) => {
    (workout?.blocks || []).forEach((block, blockIndex) => {
      if (block.type !== 'SUPERSET' && block.restAfterRound != null) {
        failures.push(issue(
          'BOUND_PLAN_REST_SCOPE_INVALID',
          `${blockPath(workoutIndex, blockIndex)}/restAfterRound`,
          'Only SUPERSET blocks may carry a round-scoped rest',
          { received: block.restAfterRound, blockType: block.type }
        ));
      }
    });
  });

  return failures;
}

// Product decision D4: unequal lanes fail closed. The backend never pads a lane and
// never modifies the coach's prescription. Call #1 states this constraint explicitly
// (programGenerationPrompt.js), so a confirmed violation makes creator repair eligible.
function verifySupersetSetEquality(boundPlan) {
  const failures = [];

  (boundPlan?.workouts || []).forEach((workout, workoutIndex) => {
    (workout?.blocks || []).forEach((block, blockIndex) => {
      if (block.type !== 'SUPERSET') {
        return;
      }
      const laneSets = (block.exercises || []).map((exercise) => exercise.sets);
      const distinct = Array.from(new Set(laneSets));
      if (distinct.length > 1) {
        failures.push(issue(
          'BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL',
          blockPath(workoutIndex, blockIndex),
          'All exercises in a SUPERSET must have the same number of sets',
          { received: laneSets }
        ));
      }
    });
  });

  return failures;
}

const EXERCISE_ID_CHARACTER = /[A-Za-z0-9_-]/;

// Exact token matching, not substring matching.
//
// Plain indexOf counts `exr_leg_press` inside every `exr_leg_press_calf_raise`, which
// inflates the occurrence total. That was harmless while coverage was a warning, but
// coverage now drives a binder retry and can fail closed, so a phantom occurrence could
// burn a retry or reject a sound generation. A match counts only when neither
// neighbouring character can be part of an identifier.
function findAllOccurrences(haystack, needle) {
  const offsets = [];
  if (!needle) {
    return offsets;
  }
  let cursor = haystack.indexOf(needle);
  while (cursor !== -1) {
    const before = cursor === 0 ? '' : haystack[cursor - 1];
    const afterIndex = cursor + needle.length;
    const after = afterIndex >= haystack.length ? '' : haystack[afterIndex];
    if (
      !EXERCISE_ID_CHARACTER.test(before) &&
      !EXERCISE_ID_CHARACTER.test(after)
    ) {
      offsets.push(cursor);
    }
    // Advance by one so a rejected match never hides a valid one behind it.
    cursor = haystack.indexOf(needle, cursor + 1);
  }
  return offsets;
}

// Closed-dictionary occurrence accounting.
//
// This iterates the eligible pool, a backend-owned closed vocabulary, and asks only
// "how many times does this known token occur here?". It is NOT a parser: it has no
// grammar, no headings, no block concept, and it never infers structure. An id Call #1
// invents in prose is not in the pool, so it is never a candidate.
//
// The invariant is exact multiset equality between source occurrences and bound
// occurrences for every eligible id. Corpus evidence (six real source/bind pairs)
// showed five exact matches and one deviation, which was the confirmed real omission.
// The previous [min,max] envelope heuristic is replaced because it could only see an
// omission at a workout boundary; a dropped middle block stayed inside the envelope.
function buildCoverageDiagnostic({
  boundPlan,
  generatedPlanText,
  eligibleExerciseLookup = {},
}) {
  const source = String(generatedPlanText || '');
  const boundCounts = new Map();

  eachExercise(boundPlan, ({ exercise }) => {
    boundCounts.set(
      exercise.exerciseId,
      (boundCounts.get(exercise.exerciseId) || 0) + 1
    );
  });

  let poolIdOccurrencesInSource = 0;
  let boundOccurrences = 0;
  let missingOccurrences = 0;
  let surplusOccurrences = 0;
  const mismatches = [];
  const seen = new Set();

  function record(exerciseId, sourceCount, boundCount) {
    poolIdOccurrencesInSource += sourceCount;
    boundOccurrences += boundCount;
    if (sourceCount === boundCount) {
      return;
    }
    missingOccurrences += Math.max(0, sourceCount - boundCount);
    surplusOccurrences += Math.max(0, boundCount - sourceCount);
    mismatches.push({ exerciseId, sourceCount, boundCount });
  }

  Object.keys(eligibleExerciseLookup).forEach((exerciseId) => {
    const sourceCount = findAllOccurrences(source, exerciseId).length;
    const boundCount = boundCounts.get(exerciseId) || 0;
    if (sourceCount === 0 && boundCount === 0) {
      return;
    }
    seen.add(exerciseId);
    record(exerciseId, sourceCount, boundCount);
  });

  // An id bound but absent from the eligible pool is already rejected by V3; counting
  // it here keeps the arithmetic honest if that rule ever changes.
  boundCounts.forEach((boundCount, exerciseId) => {
    if (seen.has(exerciseId)) {
      return;
    }
    record(exerciseId, findAllOccurrences(source, exerciseId).length, boundCount);
  });

  return {
    poolIdOccurrencesInSource,
    boundOccurrences,
    missingOccurrences,
    surplusOccurrences,
    mismatches,
    integrityViolation: mismatches.length > 0,
  };
}

function verifyOccurrenceIntegrity(coverage) {
  return coverage.mismatches.flatMap((entry) => {
    const shared = {
      exerciseId: entry.exerciseId,
      received: entry.boundCount,
      expected: entry.sourceCount,
    };
    if (entry.boundCount < entry.sourceCount) {
      return [issue(
        'BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING',
        '$/workouts',
        'An eligible exercise occurs in the source more often than it was bound',
        shared
      )];
    }
    return [issue(
      'BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS',
      '$/workouts',
      'An eligible exercise was bound more often than it occurs in the source',
      shared
    )];
  });
}

function verifyBoundPlan({
  boundPlan,
  generatedPlanText,
  eligibleExerciseLookup = {},
  sessionsPerWeek,
}) {
  const schemaFailures = verifySchema(boundPlan);
  if (schemaFailures.length) {
    // Nothing downstream can be trusted to have the right shape.
    return {
      valid: false,
      failures: schemaFailures,
      warnings: [],
      coverage: null,
      spansChecked: 0,
    };
  }

  const spans = verifySpans(boundPlan, generatedPlanText);
  const coverage = buildCoverageDiagnostic({
    boundPlan,
    generatedPlanText,
    eligibleExerciseLookup,
  });
  const failures = [
    ...spans.failures,
    ...verifyEligibility(boundPlan, eligibleExerciseLookup),
    ...verifyArity(boundPlan),
    ...verifySetCardinality(boundPlan),
    ...verifyWorkoutCount(boundPlan, sessionsPerWeek),
    ...verifyRestScope(boundPlan),
    ...verifySupersetSetEquality(boundPlan),
    // Occurrence integrity is an exact invariant, not a heuristic, so it is reported
    // as a failure. The recovery policy decides whether that earns a retry.
    ...verifyOccurrenceIntegrity(coverage),
  ];

  return {
    valid: failures.length === 0,
    failures,
    warnings: [],
    coverage,
    spansChecked: spans.checked,
  };
}

module.exports = {
  VERBATIM_SPAN_FIELDS,
  buildCoverageDiagnostic,
  normalizeForSpanMatch,
  verifyBoundPlan,
};
