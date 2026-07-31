const CARDIO_SECTION_HEADING = '### Cardio Profile Interpretation';
const MUSCLE_PRIORITY_SECTION_HEADING = '## 6. Muscle Priority Allocation';
const AUTHORITATIVE_INPUTS_HEADING = '## 2. Authoritative Inputs';
const INITIAL_GENERATION_LIMITS_HEADING = '## 3. Initial-Generation Limits';
const FINAL_GENERATION_SEQUENCE_HEADING = '## 20. Final Generation Sequence';
const FINAL_VALIDATION_HEADING = '## 21. Final Validation';
const PROHIBITED_BEHAVIOURS_HEADING = '## 22. Prohibited Behaviours';
const SUPPORTED_CARDIO_ROLES = new Set([
  'none',
  'warm_up_only',
  'cardio_sessions',
  'warm_up_and_cardio',
]);

const AUTHORITATIVE_INPUTS_PROJECTION = [
  AUTHORITATIVE_INPUTS_HEADING,
  '',
  'Base decisions on the current Training Profile, confirmed structured constraints, schedule, muscle priorities, preferences, cardio profile, coaching notes, and supplied eligible exercise pool.',
  '',
  'Confirmed structured constraints take precedence over conflicting unstructured notes.',
  '',
  'Caution signals are soft considerations. Blocked constraints have already been applied to exercise eligibility.',
].join('\n');

const CARDIO_ROLE_PROJECTIONS = Object.freeze({
  warm_up_only: [
    CARDIO_SECTION_HEADING,
    '',
    'Add only brief, light preparatory cardio of approximately 5 minutes at the beginning of relevant workouts.',
    '',
    'Protect resistance-training performance. Do not add dedicated cardio after resistance training and never create a cardio-only workout.',
  ].join('\n'),
  cardio_sessions: [
    CARDIO_SECTION_HEADING,
    '',
    'Despite the historical role name, add dedicated cardio only after the resistance-training portion of relevant workouts, only when available time permits.',
    '',
    'Never place dedicated cardio before resistance training and never create a cardio-only workout.',
    '',
    'Use conservative duration and intensity. Protect resistance-training quality and consider impact, local fatigue, muscular overlap, weekly placement, and recovery.',
  ].join('\n'),
  warm_up_and_cardio: [
    CARDIO_SECTION_HEADING,
    '',
    'Add brief, light preparatory cardio of approximately 5 minutes at the beginning of relevant workouts, followed by resistance training.',
    '',
    'When available time permits, place dedicated cardio after the resistance-training portion. Never create a cardio-only workout.',
    '',
    'Protect resistance-training quality and use conservative duration and intensity while considering impact, local fatigue, muscular overlap, weekly placement, and recovery.',
  ].join('\n'),
});

class ProgramGenerationDoctrinePromptProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProgramGenerationDoctrinePromptProjectionError';
    this.code = code;
  }
}

function invalidProjection() {
  return new ProgramGenerationDoctrinePromptProjectionError(
    'INVALID_PROGRAM_GENERATION_DOCTRINE_PROJECTION',
    'Program generation doctrine projection could not be built'
  );
}

function assertSectionOrder(content, headings) {
  let previousIndex = -1;

  headings.forEach((heading) => {
    const index = content.indexOf(heading);
    if (index === -1 || index <= previousIndex) {
      throw invalidProjection();
    }
    previousIndex = index;
  });
}

function replaceSection(content, startHeading, endHeading, replacement) {
  const start = content.indexOf(startHeading);
  const end = content.indexOf(endHeading, start + startHeading.length);
  if (start === -1 || end === -1 || end <= start) {
    throw invalidProjection();
  }

  const before = content.slice(0, start).replace(/\s+$/, '');
  const after = content.slice(end).replace(/^\s+/, '');
  return [before, replacement, after].filter(Boolean).join('\n\n');
}

function removePoolAuthorityDuplicates(content) {
  const finalValidationDuplicate = [
    '- every selected exercise exists in the supplied pool',
    '- no exercise identifier was invented',
  ];
  const prohibitedBehaviourDuplicates = [
    '- invent exercises or exercise identifiers',
    '- select exercises outside the supplied eligible pool',
  ];

  return content
    .split(/\r?\n/)
    .filter(
      (line) =>
        !finalValidationDuplicate.includes(line) &&
        !prohibitedBehaviourDuplicates.includes(line)
    )
    .join('\n');
}

function projectProgramGenerationDoctrineContent({
  content,
  cardioRole,
} = {}) {
  if (typeof content !== 'string' || !content.trim()) {
    throw invalidProjection();
  }
  if (cardioRole != null && !SUPPORTED_CARDIO_ROLES.has(cardioRole)) {
    throw invalidProjection();
  }

  assertSectionOrder(content, [
    AUTHORITATIVE_INPUTS_HEADING,
    INITIAL_GENERATION_LIMITS_HEADING,
    CARDIO_SECTION_HEADING,
    MUSCLE_PRIORITY_SECTION_HEADING,
    FINAL_GENERATION_SEQUENCE_HEADING,
    FINAL_VALIDATION_HEADING,
    PROHIBITED_BEHAVIOURS_HEADING,
  ]);

  let projected = replaceSection(
    content,
    AUTHORITATIVE_INPUTS_HEADING,
    INITIAL_GENERATION_LIMITS_HEADING,
    AUTHORITATIVE_INPUTS_PROJECTION
  );
  const cardioProjection = CARDIO_ROLE_PROJECTIONS[cardioRole] || '';
  projected = replaceSection(
    projected,
    CARDIO_SECTION_HEADING,
    MUSCLE_PRIORITY_SECTION_HEADING,
    cardioProjection
  );

  return removePoolAuthorityDuplicates(projected);
}

module.exports = {
  ProgramGenerationDoctrinePromptProjectionError,
  projectProgramGenerationDoctrineContent,
};
