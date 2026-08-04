const CARDIO_ROLE_TEXT = Object.freeze({
  none:
    'The athlete does not want cardio included in this training plan. Do not create any CARDIO block.',
  warm_up_only:
    'The athlete wants only a brief, light cardio warm-up at the beginning of relevant workouts. Keep it to approximately 5 minutes and do not add dedicated cardio after resistance training.',
  cardio_sessions:
    'When the available training time permits, include dedicated cardio after the resistance-training portion of relevant workouts. Do not create cardio-only workouts and do not place dedicated cardio before resistance training.',
  warm_up_and_cardio:
    'When the available training time permits, include both a brief, light cardio warm-up of approximately 5 minutes at the beginning of relevant workouts and dedicated cardio after the resistance-training portion. Do not create cardio-only workouts.',
});

const EXERCISE_PREFERENCE_TEXT = Object.freeze({
  machines:
    'The athlete generally prefers machine-based exercises. This is a soft preference, not a restriction. Use other eligible exercises when coaching judgment favors them.',
  free_weights:
    'The athlete generally prefers free-weight exercises. This is a soft preference, not a restriction. Use other eligible exercises when coaching judgment favors them.',
  no_preference:
    'The athlete has no particular exercise-type preference. Select the most appropriate exercises from the allowed exercise pool according to coaching judgment.',
});

const PHYSICAL_SIGNAL_DECISION_WEIGHTS = Object.freeze({
  caution: 1,
});

const PHYSICAL_SIGNAL_TYPE_LABELS = Object.freeze({
  movementPattern: 'movement pattern',
  jointStressTag: 'joint-stress tag',
});

const HUMANIZED_IDENTIFIER_OVERRIDES = Object.freeze({
  knee_dominant_load: 'Knee-Dominant Load',
});

class ProgramGenerationProfileNarrativeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProgramGenerationProfileNarrativeError';
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeSignalType(value) {
  return String(value || '').trim();
}

function humanizeIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return '';
  }

  if (HUMANIZED_IDENTIFIER_OVERRIDES[normalized]) {
    return HUMANIZED_IDENTIFIER_OVERRIDES[normalized];
  }

  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatNaturalList(values) {
  if (values.length <= 1) {
    return values[0] || '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function normalizeUniqueIdentifiers(value, excluded = new Set()) {
  const identifiers = [];
  const seen = new Set(excluded);

  toArray(value).forEach((entry) => {
    const normalized = normalizeIdentifier(entry);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      identifiers.push(normalized);
    }
  });

  return identifiers;
}

function requireNaturalValue(value, fieldName) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    throw new ProgramGenerationProfileNarrativeError(
      `${fieldName} is required to render the athlete profile`
    );
  }
  return normalized.replace(/_/g, ' ');
}

function buildIntroduction(athleteBrief = {}) {
  const experience = requireNaturalValue(
    athleteBrief.experience,
    'experience'
  );
  const primaryGoal = requireNaturalValue(
    athleteBrief.primaryGoal,
    'primaryGoal'
  );
  const sessionsPerWeek =
    athleteBrief.trainingSchedule?.sessionsPerWeek;
  const durationPerSession =
    athleteBrief.trainingSchedule?.approximateDurationMinutes;

  if (
    !Number.isSafeInteger(sessionsPerWeek) ||
    sessionsPerWeek <= 0 ||
    !Number.isSafeInteger(durationPerSession) ||
    durationPerSession <= 0
  ) {
    throw new ProgramGenerationProfileNarrativeError(
      'A valid training schedule is required to render the athlete profile'
    );
  }

  const demographics = athleteBrief.demographics;
  let requestSentence;

  if (demographics) {
    const sex = demographics.sex === 'MALE'
      ? 'male'
      : demographics.sex === 'FEMALE'
        ? 'female'
        : null;
    const ageBand = typeof demographics.ageBand === 'string'
      ? demographics.ageBand.trim()
      : '';

    if (!sex || !ageBand) {
      throw new ProgramGenerationProfileNarrativeError(
        'Demographics are invalid'
      );
    }

    requestSentence = `Create one complete, individualized, practical, and recoverable weekly training program for a ${sex} bodybuilding athlete ${ageBand} whose experience level is ${experience} and whose primary goal is ${primaryGoal}.`;
  } else {
    const article = /^[aeiou]/i.test(experience) ? 'an' : 'a';
    requestSentence = `Create one complete, individualized, practical, and recoverable weekly training program for ${article} ${experience} bodybuilding athlete whose primary goal is ${primaryGoal}.`;
  }

  return [
    'ATHLETE PROFILE AND TRAINING REQUEST',
    '',
    requestSentence,
    '',
    `The athlete wants to train exactly ${sessionsPerWeek} times per week, with each workout designed for approximately ${durationPerSession} minutes according to Lyft Zone's backend duration method.`,
  ].join('\n');
}

function buildMusclePriorities(musclePriorities = {}) {
  // primary and secondary are canonical. microFocuses is derived metadata and
  // is intentionally never rendered as an additional source of priorities.
  const primary = normalizeIdentifier(musclePriorities.primary);
  const secondary = normalizeUniqueIdentifiers(
    musclePriorities.secondary,
    new Set(primary ? [primary] : [])
  );
  const deprioritized = normalizeIdentifier(
    musclePriorities.deprioritized
  );
  const lines = [];

  if (primary) {
    lines.push(
      `The athlete's primary muscle priority is ${humanizeIdentifier(primary)}.`
    );
  }

  if (secondary.length === 1) {
    lines.push(
      `${primary ? 'Their' : "The athlete's"} secondary muscle priority is ${humanizeIdentifier(secondary[0])}.`
    );
  } else if (secondary.length > 1) {
    lines.push(
      `${primary ? 'Their' : "The athlete's"} secondary muscle priorities are ${formatNaturalList(secondary.map(humanizeIdentifier))}.`
    );
  }

  if (deprioritized) {
    lines.push(
      `The athlete wants to place less emphasis on ${humanizeIdentifier(deprioritized)}.`
    );
  }

  return lines.join('\n');
}

function buildCardioPreference(cardio = null) {
  if (!cardio) {
    return '';
  }

  const role = normalizeIdentifier(cardio.role);
  const roleText = CARDIO_ROLE_TEXT[role];
  if (!roleText) {
    throw new ProgramGenerationProfileNarrativeError(
      'Cardio role is invalid'
    );
  }

  if (role === 'none') {
    return roleText;
  }

  const modalities = normalizeUniqueIdentifiers(
    cardio.preferredModalities
  ).map(humanizeIdentifier);
  if (modalities.length === 0) {
    return roleText;
  }

  return [
    roleText,
    '',
    `The athlete prefers ${formatNaturalList(modalities)} for cardio. Use a matching eligible cardio exercise when available. If none is available, use another appropriate eligible cardio modality from the allowed exercise pool.`,
  ].join('\n');
}

function buildExercisePreference(exercisePreference = null) {
  if (!exercisePreference) {
    return '';
  }

  const preference = normalizeIdentifier(
    exercisePreference.preference
  );
  const preferenceText = EXERCISE_PREFERENCE_TEXT[preference];
  if (!preferenceText) {
    throw new ProgramGenerationProfileNarrativeError(
      'Exercise preference is invalid'
    );
  }
  return preferenceText;
}

function selectStrongestPhysicalSignals(issues) {
  const strongestByKey = new Map();

  issues.forEach((issue) => {
    toArray(issue?.confirmedSignals).forEach((signal) => {
      const type = normalizeSignalType(signal?.type);
      const value = normalizeIdentifier(signal?.value);
      const decision = normalizeIdentifier(signal?.decision);
      if (
        !PHYSICAL_SIGNAL_TYPE_LABELS[type] ||
        !value ||
        !PHYSICAL_SIGNAL_DECISION_WEIGHTS[decision]
      ) {
        return;
      }

      const key = `${type}:${value}`;
      const current = strongestByKey.get(key);
      if (
        !current ||
        PHYSICAL_SIGNAL_DECISION_WEIGHTS[decision] >
          PHYSICAL_SIGNAL_DECISION_WEIGHTS[current]
      ) {
        strongestByKey.set(key, decision);
      }
    });
  });

  return strongestByKey;
}

function buildPhysicalConsiderations(physicalConsiderations) {
  const issues = toArray(physicalConsiderations).filter(
    (issue) => issue && typeof issue === 'object' && !Array.isArray(issue)
  );
  const strongestByKey = selectStrongestPhysicalSignals(issues);
  const renderedSignalKeys = new Set();
  const renderedIssues = [];

  issues.forEach((issue) => {
    const signals = [];

    toArray(issue.confirmedSignals).forEach((signal) => {
      const type = normalizeSignalType(signal?.type);
      const value = normalizeIdentifier(signal?.value);
      const decision = normalizeIdentifier(signal?.decision);
      const key = `${type}:${value}`;
      if (
        strongestByKey.get(key) !== decision ||
        renderedSignalKeys.has(key)
      ) {
        return;
      }

      renderedSignalKeys.add(key);
      signals.push({ type, value, decision });
    });

    if (signals.length === 0) {
      return;
    }

    const issueLines = [
      `Physical consideration #${renderedIssues.length + 1}:`,
    ];
    const summary =
      typeof issue.aiSummary === 'string' ? issue.aiSummary.trim() : '';
    if (summary) {
      issueLines.push('', 'Summary:', `"${summary}"`);
    }
    issueLines.push('', 'Confirmed considerations:');
    signals.forEach((signal) => {
      issueLines.push(
        `- ${humanizeIdentifier(signal.decision)}: ${humanizeIdentifier(signal.value)} (${PHYSICAL_SIGNAL_TYPE_LABELS[signal.type]})`
      );
    });
    renderedIssues.push(issueLines.join('\n'));
  });

  if (renderedIssues.length === 0) {
    return '';
  }

  return [
    ...renderedIssues,
    'Treat CAUTION signals as reasons to adapt exercise selection, exercise order, training volume, fatigue exposure, or exercise prescriptions when relevant.',
    'CAUTION signals are not blocked constraints.',
  ].join('\n\n');
}

function buildPhysicalNotes(physicalNotes) {
  const notes =
    typeof physicalNotes === 'string' ? physicalNotes.trim() : '';
  if (!notes) {
    return '';
  }

  return [
    'Additional notes provided by the athlete that may help you design the program:',
    '',
    `"${notes}"`,
  ].join('\n');
}

function buildAthleteProfileNarrative(athleteBrief = {}) {
  return [
    buildIntroduction(athleteBrief),
    buildMusclePriorities(athleteBrief.musclePriorities),
    buildCardioPreference(athleteBrief.cardio),
    buildExercisePreference(athleteBrief.exercisePreference),
    buildPhysicalConsiderations(athleteBrief.physicalConsiderations),
    buildPhysicalNotes(athleteBrief.physicalNotes),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildAppliedBlockedConstraintsNarrative(
  appliedConstraints = {}
) {
  const blockedMovementPatterns = normalizeUniqueIdentifiers(
    appliedConstraints.blockedMovementPatterns
  );
  const blockedJointStressTags = normalizeUniqueIdentifiers(
    appliedConstraints.blockedJointStressTags
  );
  if (
    blockedMovementPatterns.length === 0 &&
    blockedJointStressTags.length === 0
  ) {
    return '';
  }

  const lines = [
    'BLOCKED CONSTRAINTS ALREADY APPLIED TO THE ELIGIBLE EXERCISE POOL',
    '',
    'The following blocked constraints have already been enforced when constructing the eligible exercise pool:',
  ];
  blockedMovementPatterns.forEach((value) => {
    lines.push(
      `- Blocked movement pattern: ${humanizeIdentifier(value)}`
    );
  });
  blockedJointStressTags.forEach((value) => {
    lines.push(
      `- Blocked joint-stress tag: ${humanizeIdentifier(value)}`
    );
  });
  return lines.join('\n');
}

module.exports = {
  ProgramGenerationProfileNarrativeError,
  buildAppliedBlockedConstraintsNarrative,
  buildAthleteProfileNarrative,
  buildCardioPreference,
  buildExercisePreference,
  buildIntroduction,
  buildMusclePriorities,
  buildPhysicalConsiderations,
  buildPhysicalNotes,
  formatNaturalList,
  humanizeIdentifier,
};
