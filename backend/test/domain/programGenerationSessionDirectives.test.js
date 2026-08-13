const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProgramGenerationSessionDirectives,
} = require('../../src/domain/programGeneration/prompts/programGenerationSessionDirectives');

const WARM_UP_SHOULD =
  'You should include a 5-minute light cardio warm-up as the first executable block of each workout.';
const WARM_UP_MUST =
  'You must include a 5-minute light cardio warm-up as the first executable block of every workout.';
const POST_CARDIO_MINIMUMS = Object.freeze({
  10: 'You should include at least 10 minutes of easy post-workout cardio when it can fit without compromising the resistance-training priority.',
  15: 'You should include at least 15 minutes of easy post-workout cardio when it can fit without compromising the resistance-training priority.',
  20: 'You must include at least 20 minutes of easy post-workout cardio at the end of each workout.',
  30: 'You must include at least 30 minutes of easy post-workout cardio at the end of each workout.',
});
const POST_CARDIO_QUALITY =
  'Any post-workout cardio should be easy, low-interference, conversational steady-state work that does not reduce resistance-training quality or recovery. Do not add HIIT unless explicitly requested elsewhere.';
const INTERMEDIATE_LONG =
  'Use the available session time productively. Do not artificially compress the resistance-training portion into a short workout when additional productive volume would improve the program.';
const ADVANCED_LONG =
  'Because this is an advanced athlete, use the available session time productively and do not be overly conservative with resistance-training volume when additional high-quality work is appropriate.';
const INTERMEDIATE_VERY_LONG =
  'The athlete has substantial training time available. Build a complete resistance-training session and use that time meaningfully rather than stopping once a conventional 60–75 minute workout has been reached.';
const ADVANCED_VERY_LONG =
  'This is an advanced athlete with substantial training time available. Build a high-volume but recoverable resistance-training session and use the available time meaningfully rather than stopping once a conventional 60–75 minute workout has been reached.';
const ADVANCED_VOLUME_PERMISSION =
  'For very long advanced sessions, resistance-training volume may appropriately extend beyond a conventional 18–20 working sets when the additional work remains high quality, non-redundant, and recoverable.';
const LONG_SESSION_SPECIALIZATION_GUARDRAIL =
  'Long session duration does not justify excessive specialization. Generally avoid exceeding approximately 30 direct working sets per week for any single muscle group. When a prioritized muscle is already approaching that range, use remaining productive training time for other muscle groups, balanced accessory work, or the requested cardio rather than adding more direct volume to that muscle.';
const NO_JUNK_VOLUME =
  'Do not add junk volume merely to fill time. Additional work must remain productive, non-redundant, and appropriate for the athlete’s level, priorities, and recovery.';
const CARDIO_VISIBILITY =
  'When cardio is included or required, render it as an explicit executable CARDIO block in the human-readable workout rather than only mentioning it in notes.';
const ALL_VOLUME_DIRECTIVES = [
  INTERMEDIATE_LONG,
  ADVANCED_LONG,
  INTERMEDIATE_VERY_LONG,
  ADVANCED_VERY_LONG,
];

function build(overrides = {}) {
  return buildProgramGenerationSessionDirectives({
    requestedDurationMinutes: 60,
    experience: 'beginner',
    cardioRole: 'none',
    ...overrides,
  });
}

test('warm-up directives select the exact 30- and 45-minute boundaries', () => {
  [
    [29, null],
    [30, WARM_UP_SHOULD],
    [44, WARM_UP_SHOULD],
    [45, WARM_UP_MUST],
  ].forEach(([requestedDurationMinutes, expected]) => {
    const directives = build({
      requestedDurationMinutes,
      cardioRole: 'warm_up_and_cardio',
    });

    assert.equal(directives.includes(WARM_UP_SHOULD), expected === WARM_UP_SHOULD);
    assert.equal(directives.includes(WARM_UP_MUST), expected === WARM_UP_MUST);
  });
});

test('post-workout cardio minimums select the exact duration band', () => {
  [
    [59, null],
    [60, 10],
    [74, 10],
    [75, 15],
    [89, 15],
    [90, 20],
    [119, 20],
    [120, 30],
  ].forEach(([requestedDurationMinutes, expectedMinutes]) => {
    const directives = build({
      requestedDurationMinutes,
      cardioRole: 'warm_up_and_cardio',
    });

    Object.entries(POST_CARDIO_MINIMUMS).forEach(([minutes, directive]) => {
      assert.equal(
        directives.includes(directive),
        Number(minutes) === expectedMinutes,
        `${requestedDurationMinutes} minutes should select only ${expectedMinutes}`
      );
    });
    assert.equal(directives.includes(POST_CARDIO_QUALITY), true);
  });
});

test('experience and duration select only the intended long-session volume band', () => {
  [
    ['beginner', 120, null, false],
    ['intermediate', 74, null, false],
    ['intermediate', 75, INTERMEDIATE_LONG, false],
    ['intermediate', 104, INTERMEDIATE_LONG, false],
    ['intermediate', 105, INTERMEDIATE_VERY_LONG, false],
    ['advanced', 75, ADVANCED_LONG, false],
    ['advanced', 104, ADVANCED_LONG, false],
    ['advanced', 105, ADVANCED_VERY_LONG, true],
    ['advanced', 120, ADVANCED_VERY_LONG, true],
  ].forEach(([
    experience,
    requestedDurationMinutes,
    expectedVolumeDirective,
    expectsPermission,
  ]) => {
    const directives = build({ experience, requestedDurationMinutes });

    ALL_VOLUME_DIRECTIVES.forEach((directive) => {
      assert.equal(
        directives.includes(directive),
        directive === expectedVolumeDirective,
        `${experience} at ${requestedDurationMinutes} selected an incorrect volume band`
      );
    });
    assert.equal(
      directives.includes(NO_JUNK_VOLUME),
      Boolean(expectedVolumeDirective) || requestedDurationMinutes >= 105
    );
    assert.equal(
      directives.includes(ADVANCED_VOLUME_PERMISSION),
      expectsPermission
    );
  });
});

test('very long sessions add the specialization guardrail for every experience level', () => {
  for (const experience of ['beginner', 'intermediate', 'advanced']) {
    for (const requestedDurationMinutes of [104, 105, 120]) {
      const directives = build({ experience, requestedDurationMinutes });
      const hasGuardrail = requestedDurationMinutes >= 105;

      assert.equal(
        directives.includes(LONG_SESSION_SPECIALIZATION_GUARDRAIL),
        hasGuardrail,
        `${experience} at ${requestedDurationMinutes} minutes selected the wrong specialization behavior`
      );
      if (hasGuardrail) {
        assert.equal(directives.includes(NO_JUNK_VOLUME), true);
        assert.equal(
          directives.indexOf(LONG_SESSION_SPECIALIZATION_GUARDRAIL) <
            directives.indexOf(NO_JUNK_VOLUME),
          true
        );
      }
    }
  }

  const text = LONG_SESSION_SPECIALIZATION_GUARDRAIL;
  assert.doesNotMatch(text, /must not exceed 30/i);
  assert.doesNotMatch(text, /at least 30|minimum(?: of)? 30/i);
});

test('cardio roles do not leak directives across role boundaries', () => {
  const warmUpOnly = build({
    requestedDurationMinutes: 120,
    experience: 'advanced',
    cardioRole: 'warm_up_only',
  });
  assert.equal(warmUpOnly.includes(WARM_UP_MUST), true);
  assert.equal(warmUpOnly.includes(POST_CARDIO_QUALITY), false);
  Object.values(POST_CARDIO_MINIMUMS).forEach((directive) => {
    assert.equal(warmUpOnly.includes(directive), false);
  });
  assert.equal(warmUpOnly.includes(CARDIO_VISIBILITY), true);

  const none = build({
    requestedDurationMinutes: 120,
    experience: 'advanced',
    cardioRole: 'none',
  });
  assert.equal(none.includes(WARM_UP_MUST), false);
  assert.equal(none.includes(POST_CARDIO_QUALITY), false);
  assert.equal(none.includes(CARDIO_VISIBILITY), false);
  assert.equal(none.includes(ADVANCED_VERY_LONG), true);

  const cardioSessions = build({
    requestedDurationMinutes: 120,
    experience: 'advanced',
    cardioRole: 'cardio_sessions',
  });
  assert.equal(cardioSessions.includes(WARM_UP_MUST), false);
  assert.equal(cardioSessions.includes(POST_CARDIO_QUALITY), false);
  Object.values(POST_CARDIO_MINIMUMS).forEach((directive) => {
    assert.equal(cardioSessions.includes(directive), false);
  });
  assert.equal(cardioSessions.includes(CARDIO_VISIBILITY), true);
});

test('advanced volume permission is non-binding and the helper is deterministic and pure', () => {
  const input = {
    requestedDurationMinutes: 120,
    experience: 'advanced',
    cardioRole: 'warm_up_and_cardio',
  };
  const before = structuredClone(input);
  const first = buildProgramGenerationSessionDirectives(input);
  const second = buildProgramGenerationSessionDirectives(input);
  const text = first.join('\n');

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(first, [
    WARM_UP_MUST,
    POST_CARDIO_MINIMUMS[30],
    POST_CARDIO_QUALITY,
    ADVANCED_VERY_LONG,
    ADVANCED_VOLUME_PERMISSION,
    LONG_SESSION_SPECIALIZATION_GUARDRAIL,
    NO_JUNK_VOLUME,
    CARDIO_VISIBILITY,
  ]);
  assert.match(text, /may appropriately extend beyond/);
  assert.doesNotMatch(text, /minimum.{0,20}sets|at least \d+ (?:working )?sets/i);
});

test('invalid requested durations fail closed', () => {
  for (const requestedDurationMinutes of [null, 0, 60.5]) {
    assert.throws(
      () => build({ requestedDurationMinutes }),
      TypeError
    );
  }
});
