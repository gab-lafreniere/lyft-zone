const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProgramGenerationProfileNarrativeError,
  buildAppliedBlockedConstraintsNarrative,
  buildAthleteProfileNarrative,
  buildCardioPreference,
  buildExercisePreference,
  buildIntroduction,
  buildMusclePriorities,
  buildPhysicalConsiderations,
  buildPhysicalNotes,
} = require('../../src/domain/programGeneration/prompts/programGenerationProfileNarrative');

function createAthleteBrief(overrides = {}) {
  return {
    primaryGoal: 'HYPERTROPHY',
    experience: 'advanced',
    trainingSchedule: {
      sessionsPerWeek: 3,
      approximateDurationMinutes: 90,
    },
    ...overrides,
  };
}

test('introduction humanizes all experience levels, selects a or an, and renders goal, frequency, and duration', () => {
  const cases = [
    ['beginner', 'a beginner'],
    ['intermediate', 'an intermediate'],
    ['advanced', 'an advanced'],
  ];

  cases.forEach(([experience, expectedArticle]) => {
    const text = buildIntroduction(
      createAthleteBrief({
        primaryGoal: 'MIXED',
        experience: experience.toUpperCase(),
      })
    );

    assert.match(
      text,
      new RegExp(`for ${expectedArticle} bodybuilding athlete`)
    );
    assert.match(text, /primary goal is mixed\./);
    assert.match(text, /exactly 3 times per week/);
    assert.match(text, /approximately 90 minutes/);
    assert.doesNotMatch(
      text,
      /You are a bodybuilding coach responsible for creating training programs for the Lyft Zone application\./
    );
    assert.doesNotMatch(
      text,
      /\[experienceLevel\]|\[primaryGoal\]|\[sessionsPerWeek\]|\[durationPerSession\]|undefined|null|\{/
    );
  });
});

test('introduction fails closed when an essential value is missing', () => {
  assert.throws(
    () =>
      buildIntroduction(
        createAthleteBrief({
          experience: null,
        })
      ),
    ProgramGenerationProfileNarrativeError
  );
});

test('muscle priorities omit empty data and render every singular, plural, and combined form', () => {
  assert.equal(buildMusclePriorities(), '');
  assert.equal(
    buildMusclePriorities({ primary: 'upper_chest' }),
    "The athlete's primary muscle priority is Upper Chest."
  );
  assert.equal(
    buildMusclePriorities({ secondary: ['rear_delts'] }),
    "The athlete's secondary muscle priority is Rear Delts."
  );
  assert.equal(
    buildMusclePriorities({
      secondary: ['rear_delts', 'upper_back'],
    }),
    "The athlete's secondary muscle priorities are Rear Delts and Upper Back."
  );
  assert.equal(
    buildMusclePriorities({
      primary: 'upper_chest',
      secondary: ['rear_delts', 'upper_back'],
    }),
    [
      "The athlete's primary muscle priority is Upper Chest.",
      'Their secondary muscle priorities are Rear Delts and Upper Back.',
    ].join('\n')
  );
  assert.equal(
    buildMusclePriorities({ deprioritized: 'obliques' }),
    'The athlete wants to place less emphasis on Obliques.'
  );
});

test('direct primary and secondary fields are canonical and deduplicate derived microFocuses', () => {
  const text = buildMusclePriorities({
    primary: 'upper_chest',
    secondary: ['upper_chest', 'rear_delts', 'rear_delts'],
    microFocuses: [
      {
        area: 'upper_chest',
        parentArea: 'chest',
        priority: 'primary',
      },
      {
        area: 'rear_delts',
        parentArea: 'shoulders',
        priority: 'secondary',
      },
    ],
  });

  assert.equal(
    text,
    [
      "The athlete's primary muscle priority is Upper Chest.",
      'Their secondary muscle priority is Rear Delts.',
    ].join('\n')
  );
  assert.equal(text.match(/Upper Chest/g).length, 1);
  assert.equal(text.match(/Rear Delts/g).length, 1);
  assert.doesNotMatch(text, /microFocuses|parentArea|upper_chest|rear_delts/);
});

test('cardio preference omits null and renders every canonical role without raw enums', () => {
  assert.equal(buildCardioPreference(null), '');
  const expectedFragments = {
    none: 'does not want cardio included',
    warm_up_only: 'only a brief, light cardio warm-up',
    cardio_sessions: 'include dedicated cardio after',
    warm_up_and_cardio: 'include both a brief, light cardio warm-up',
  };

  Object.entries(expectedFragments).forEach(([role, fragment]) => {
    const text = buildCardioPreference({ role });
    assert.match(text, new RegExp(fragment));
    assert.doesNotMatch(text, new RegExp(role));
  });
});

test('cardio modalities render zero, one, or many only for enabled cardio roles', () => {
  const withoutModalities = buildCardioPreference({
    role: 'cardio_sessions',
    preferredModalities: [],
  });
  const oneModality = buildCardioPreference({
    role: 'cardio_sessions',
    preferredModalities: ['stationary_bike'],
  });
  const multipleModalities = buildCardioPreference({
    role: 'warm_up_and_cardio',
    preferredModalities: ['stationary_bike', 'elliptical'],
  });
  const noneWithIgnoredModalities = buildCardioPreference({
    role: 'none',
    preferredModalities: ['stationary_bike'],
  });

  assert.doesNotMatch(withoutModalities, /prefers/);
  assert.match(oneModality, /prefers Stationary Bike for cardio/);
  assert.match(
    multipleModalities,
    /prefers Stationary Bike and Elliptical for cardio/
  );
  assert.doesNotMatch(noneWithIgnoredModalities, /Stationary Bike|prefers/);
  assert.equal(
    multipleModalities.match(/warm-up/g).length,
    1
  );
});

test('unknown cardio roles fail closed without inventing guidance', () => {
  assert.throws(
    () => buildCardioPreference({ role: 'future_role' }),
    ProgramGenerationProfileNarrativeError
  );
});

test('exercise preference omits null and renders the three real Training Profile enums', () => {
  assert.equal(buildExercisePreference(null), '');
  assert.match(
    buildExercisePreference({ preference: 'machines' }),
    /prefers machine-based exercises.*soft preference, not a restriction/
  );
  assert.match(
    buildExercisePreference({ preference: 'free_weights' }),
    /prefers free-weight exercises.*soft preference, not a restriction/
  );
  assert.match(
    buildExercisePreference({ preference: 'no_preference' }),
    /has no particular exercise-type preference/
  );
});

test('unknown exercise preferences fail closed', () => {
  assert.throws(
    () => buildExercisePreference({ preference: 'future_preference' }),
    ProgramGenerationProfileNarrativeError
  );
});

test('physical considerations render only caution signals with stable multiple issues', () => {
  const text = buildPhysicalConsiderations([
    {
      aiSummary: '  Occasional knee discomfort.  ',
      confirmedSignals: [
        {
          type: 'movementPattern',
          value: 'knee_flexion',
          decision: 'caution',
        },
      ],
    },
    {
      aiSummary: ' ',
      confirmedSignals: [
        {
          type: 'jointStressTag',
          value: 'deep_knee_flexion',
          decision: 'caution',
        },
      ],
    },
  ]);

  assert.match(text, /Physical consideration #1:/);
  assert.match(text, /"Occasional knee discomfort\."/);
  assert.match(text, /- Caution: Knee Flexion \(movement pattern\)/);
  assert.match(text, /Physical consideration #2:/);
  assert.doesNotMatch(
    text.slice(text.indexOf('Physical consideration #2:')),
    /Summary:/
  );
  assert.match(
    text,
    /- Caution: Deep Knee Flexion \(joint-stress tag\)/
  );
  assert.equal(
    text.match(/Treat CAUTION signals as reasons/g).length,
    1
  );
  assert.equal(
    text.match(/CAUTION signals are not blocked constraints/g)
      .length,
    1
  );
  assert.doesNotMatch(text, /MONITOR/i);
});

test('physical considerations ignore monitor, blocked, and unknown signals and deduplicate cautions across issues', () => {
  const text = buildPhysicalConsiderations([
    {
      aiSummary: 'Monitor source',
      confirmedSignals: [
        {
          type: 'movementPattern',
          value: 'knee_flexion',
          decision: 'monitor',
        },
        {
          type: 'jointStressTag',
          value: 'spinal_loading',
          decision: 'blocked',
        },
      ],
    },
    {
      aiSummary: 'Caution source',
      confirmedSignals: [
        {
          type: 'movementPattern',
          value: 'knee_flexion',
          decision: 'caution',
        },
        {
          type: 'movementPattern',
          value: 'knee_flexion',
          decision: 'caution',
        },
        {
          type: 'exerciseId',
          value: 'private_exercise',
          decision: 'monitor',
        },
      ],
    },
  ]);

  assert.doesNotMatch(text, /Monitor source|MONITOR|spinal|private/i);
  assert.match(text, /"Caution source"/);
  assert.equal(text.match(/Caution: Knee Flexion/g).length, 1);
});

test('monitor-only physical considerations are omitted completely', () => {
  const text = buildPhysicalConsiderations([
    {
      aiSummary: 'Monitor-only summary',
      confirmedSignals: [
        {
          type: 'movementPattern',
          value: 'knee_flexion',
          decision: 'monitor',
        },
      ],
    },
  ]);

  assert.equal(text, '');
  assert.doesNotMatch(text, /MONITOR/i);
});

test('physical notes omit null and blank values and quote trimmed athlete data', () => {
  assert.equal(buildPhysicalNotes(null), '');
  assert.equal(buildPhysicalNotes('   '), '');
  assert.equal(
    buildPhysicalNotes('  Keep setup changes simple.  '),
    [
      'Additional notes provided by the athlete that may help you design the program:',
      '',
      '"Keep setup changes simple."',
    ].join('\n')
  );
});

test('full athlete narrative preserves the requested section order', () => {
  const text = buildAthleteProfileNarrative(
    createAthleteBrief({
      musclePriorities: { primary: 'upper_chest' },
      cardio: { role: 'none' },
      exercisePreference: { preference: 'machines' },
      physicalConsiderations: [
        {
          confirmedSignals: [
            {
              type: 'movementPattern',
              value: 'knee_flexion',
              decision: 'caution',
            },
          ],
        },
      ],
      physicalNotes: 'Use a stable setup.',
    })
  );
  const orderedFragments = [
    'ATHLETE PROFILE AND TRAINING REQUEST',
    'primary muscle priority',
    'does not want cardio',
    'prefers machine-based exercises',
    'Physical consideration #1',
    'Additional notes provided',
  ];
  let previousIndex = -1;

  orderedFragments.forEach((fragment) => {
    const index = text.indexOf(fragment);
    assert.equal(index > previousIndex, true, fragment);
    previousIndex = index;
  });
});

test('blocked constraints stay narrative and omit the obsolete APPLIED CONSTRAINTS JSON block', () => {
  const text = buildAppliedBlockedConstraintsNarrative({
    blockedMovementPatterns: ['vertical_push'],
    blockedJointStressTags: ['deep_knee_flexion'],
    cardioRole: 'none',
    confirmedCautions: [
      { type: 'movementPattern', value: 'knee_flexion' },
    ],
  });

  assert.match(text, /Blocked movement pattern: Vertical Push/);
  assert.match(text, /Blocked joint-stress tag: Deep Knee Flexion/);
  assert.doesNotMatch(
    text,
    /APPLIED CONSTRAINTS|cardioRole|confirmedCautions|knee_flexion|\{/
  );
});
