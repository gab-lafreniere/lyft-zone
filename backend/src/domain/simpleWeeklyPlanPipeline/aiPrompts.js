const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('./structureSchema');
const {
  buildSimpleWeeklyPlanFillProviderSchema,
  buildCanonicalProviderEntities,
} = require('./fillSchema');

const {
  BOUND_PLAN_FORMAT_NAME,
  buildSimpleWeeklyPlanBoundPlanSchema,
} = require('./boundPlanSchema');

const STRUCTURE_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_structure_v2';
const FILL_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_fills_v4';

// The binder is never told how many workouts are expected.
//
// Naming a target count makes the model produce that count, inventing a workout when
// the source has fewer. That both violates the rule that Call #2 may not create what
// Call #1 did not, and destroys the only signal that distinguishes a creator failure
// from a binder failure. See product decision D1.
const BOUND_PLAN_BIND_INSTRUCTIONS = [
  'You are binding an existing training plan into a machine-readable form.',
  '',
  'The SOURCE PLAN below was written by a coach. It is already complete and already',
  'correct. Your only task is to record what it contains.',
  '',
  'You must not:',
  '- design, improve, correct, complete, reorder, merge or split anything;',
  '- create a relationship between exercises that the SOURCE PLAN did not create;',
  '- add a workout, block or exercise that the SOURCE PLAN does not contain;',
  '- remove one that it does contain;',
  '- normalize, convert, round, or compute any value;',
  '- write any text of your own, including notes, labels, summaries, or descriptions',
  '  of how blocks relate to each other.',
  '',
  'For every workout in the SOURCE PLAN, in the order it appears:',
  '- copy its name;',
  '- list every executable block in execution order.',
  '',
  'A heading is not automatically a block. A numbered "Block" heading, or a heading',
  'such as "Strength", "Main Work" or "Accessories", often groups several separately',
  'prescribed exercises. Each exercise that carries its own prescription, meaning its',
  'own sets, reps, RIR, tempo or rest, is its own executable block.',
  'Put two or more exercises in the same block ONLY when the SOURCE PLAN itself pairs',
  'them, for example with a SUPERSET label, the words "superset with" or "paired',
  'with", or an explicit A/B pairing. Sharing a heading is not a pairing.',
  'Never merge separately prescribed exercises into one block because they appear',
  'under the same heading.',
  '',
  'For every block, classify it as the type the SOURCE PLAN already made it:',
  '- SINGLE: one exercise performed on its own;',
  '- SUPERSET: one block whose exercises the SOURCE PLAN pairs together;',
  '- CARDIO: one cardio exercise.',
  'A SUPERSET is ONE block containing ALL of its exercises. Never emit one block per',
  'superset exercise. The pairing may be stated as a heading, a label, or in prose;',
  'record the pairing the SOURCE PLAN already made either way.',
  'If the SOURCE PLAN states a rest that applies to the whole superset round, copy that',
  'rest text into restAfterRound. Otherwise leave restAfterRound null.',
  '',
  'For every exercise:',
  '- exerciseId: the identifier token only, copied exactly from the SOURCE PLAN. It',
  '  starts with exr_ and contains no spaces. Never include the display name, a dash,',
  '  punctuation, label text, or surrounding markdown;',
  '- sets: the number of sets the SOURCE PLAN states, as an integer; null for CARDIO;',
  '- reps, rir, rpe, tempo, rest, duration, intensity: copy the SOURCE PLAN\'s own',
  '  words character for character, or null when the SOURCE PLAN does not state that field;',
  '- notes: only a note the SOURCE PLAN itself states for that exercise, copied word for',
  '  word. Never describe a block relationship, never explain a choice, never summarize.',
  '  If the SOURCE PLAN states no note for that exercise, return null;',
  '- rest: only a rest that belongs to this exercise. If the rest belongs to the whole',
  '  superset round, leave it null here and put it on the block instead;',
  '- machineSettings: copy any machine setting the SOURCE PLAN states for a cardio',
  '  machine, as key and value; otherwise null.',
  '',
  'Every value you return except sets must appear verbatim in the SOURCE PLAN.',
  'Do not paraphrase, reformat, or convert units.',
  'Bind only exercises the SOURCE PLAN prescribes inside a workout. Ignore exercises',
  'mentioned only in commentary, rationale, duration arithmetic, or as something the',
  'coach explicitly chose not to include.',
].join('\n');

const PRESENTATION_BIND_INSTRUCTIONS = [
  'Copy each value from the PROGRAM PRESENTATION section verbatim into presentation.',
  'Do not improve, summarize, shorten, rewrite, infer, complete, or invent any',
  'presentation content.',
  'Never truncate a value to fit the schema. If a value cannot be copied in full,',
  'return null for that field instead.',
  'Map TITLE, SUMMARY, and PROGRESSION to their matching fields. Copy each NOTE value',
  'in source order into coachingNotes.',
  'If the PROGRAM PRESENTATION section is absent or unusable, return presentation null.',
  'If an individual scalar field is absent, return null for that field. If no NOTE is',
  'present, return an empty coachingNotes array.',
].join('\n');

function buildBoundPlanExtractionRequest({
  generatedPlanText,
  correctiveDirective = null,
  presentationContractEnabled = true,
}) {
  const baseInstructions = presentationContractEnabled
    ? `${BOUND_PLAN_BIND_INSTRUCTIONS}\n\n${PRESENTATION_BIND_INSTRUCTIONS}`
    : BOUND_PLAN_BIND_INSTRUCTIONS;
  const artifactUserMessage = correctiveDirective
    ? `${baseInstructions}\n\n${correctiveDirective}`
    : baseInstructions;
  const sourcePlan = String(generatedPlanText || '');

  return {
    formatName: BOUND_PLAN_FORMAT_NAME,
    schema: buildSimpleWeeklyPlanBoundPlanSchema({
      presentationContractEnabled,
    }),
    systemMessage: 'You are a faithful training-plan binder.',
    userMessage: `${artifactUserMessage}\n\nSOURCE PLAN\n${sourcePlan}`,
    artifactUserMessage,
    sourcePlan,
  };
}

function buildStructureExtractionRequest({
  generatedPlanText,
  sessionsPerWeek,
  presentationContractEnabled = true,
}) {
  const artifactUserMessage = [
    `The backend requires exactly ${sessionsPerWeek} workouts.`,
    '',
    'Complete exactly the JSON structure provided by the Structured Output configuration.',
    '',
    'For each required workout:',
    '- copy its workout name from the source plan;',
    '- list every executable block in execution order, with exactly one blocks[] entry for each source-plan block;',
    '- classify each block as SINGLE, SUPERSET, or CARDIO;',
    '- provide one setCount for the entire block.',
    '',
    'Interpret setCount as follows:',
    '- SINGLE: number of sets performed for its one exercise;',
    '- SUPERSET: number of complete rounds set performed for the two-exercise block;',
    '- CARDIO: always 1.',
    '',
    'Important:',
    '- A SUPERSET is one block containing two exercises.',
    '- Do not output one block per superset exercise.',
    '- Do not duplicate the set count for a SUPERSET.',
    '- Do not return exercise names or exercise IDs.',
    '- Do not add, remove, merge, split, redesign, or correct workouts or blocks.',
    '- Consecutive blocks remain separate even when they have the same type and the same setCount. Never collapse or omit repeated-looking blocks.',
    ...(presentationContractEnabled
      ? ['', PRESENTATION_BIND_INSTRUCTIONS]
      : []),
    '',
    'Before returning the JSON, verify each workout once:',
    '- every source-plan block is represented exactly once;',
    '- the blocks[] count matches the number of executable source-plan blocks;',
    '- no consecutive repeated-looking blocks were collapsed or skipped.',
  ].join('\n');
  const sourcePlan = String(generatedPlanText || '');

  return {
    formatName: STRUCTURE_OUTPUT_FORMAT_NAME,
    schema: buildSimpleWeeklyPlanStructureSchema(sessionsPerWeek, {
      presentationContractEnabled,
    }),
    systemMessage: 'You are a training-plan structure extractor.',
    userMessage: `${artifactUserMessage}\n\nSOURCE PLAN\n${sourcePlan}`,
    artifactUserMessage,
    sourcePlan,
  };
}

function buildFillExtractionRequest({
  generatedPlanText,
  skeleton,
}) {
  const sourcePlan = String(generatedPlanText || '');
  const entities = buildCanonicalProviderEntities(skeleton);
  const entityRegistry = {
    strengthExercises: entities.strengthExercises.map((entity) => ({
      setCount: entity.setSlots.length,
    })),
    cardioExerciseCount: entities.cardioExercises.length,
    blockRestCount: entities.blockRests.length,
  };
  const skeletonText = JSON.stringify({
    schemaVersion: skeleton?.schemaVersion,
    geometryHash: skeleton?.geometryHash,
    document: skeleton?.document,
    entityRegistry,
  });

  return {
    formatName: FILL_OUTPUT_FORMAT_NAME,
    schema: buildSimpleWeeklyPlanFillProviderSchema(skeleton),
    systemMessage: 'You are a faithful training-plan data extractor.',
    userMessage: [
      'Fill the entity-local contract using the source plan.',
      'Preserve the source plan exactly.',
      'Do not redesign, improve, correct, merge, split, add, remove or reorder anything.',
      '',
      'Return only:',
      '- schemaVersion',
      '- geometryHash',
      '- fills as an object containing exactly: strengthExercises, cardioExercises, blockRests',
      '',
      'Use canonical source-plan order:',
      '- strengthExercises follows non-CARDIO exercises in workout, block, then exercise order;',
      '- cardioExercises follows CARDIO exercises in workout, block, then exercise order;',
      '- blockRests follows SUPERSET blocks in workout then block order.',
      'Each strength exercise object must contain all and only that exercise\'s exerciseId, defaults, sets, and notes.',
      'Each cardio exercise object must contain all and only that exercise\'s exerciseId, prescription, and notes.',
      'Each sets array must contain only sets belonging to its own exercise and must match its entityRegistry setCount.',
      'Never carry a value from one exercise into the next.',
      'Do not return slotId, slotIndex, kind, pointer, or workout/block/exercise coordinates. The backend owns all addressing.',
      '',
      'Preserve exactly exercise IDs, repetitions, repetition ranges, duration targets, per-side meaning, RIR, tempo, rest, notes, and cardio prescriptions.',
      'For a source RIR range such as 1 to 2, use targetRir 2.',
      "If entityRegistry expects more sets for an exercise than the source explicitly lists because of inconsistent SUPERSET geometry, emit the expected count using only that same exercise's stated values.",
      '',
      'Do not change the exercise, block geometry, or number of sets.',
      'Copy each exerciseId exactly from the SOURCE PLAN.',
      'Do not return the completed Weekly Plan document.',
      '',
      'PLAN SKELETON AND ENTITY REGISTRY',
      skeletonText,
      '',
      'SOURCE PLAN',
      sourcePlan,
    ].join('\n'),
    skeletonText,
    sourcePlan,
  };
}

module.exports = {
  BOUND_PLAN_BIND_INSTRUCTIONS,
  PRESENTATION_BIND_INSTRUCTIONS,
  FILL_OUTPUT_FORMAT_NAME,
  STRUCTURE_OUTPUT_FORMAT_NAME,
  buildBoundPlanExtractionRequest,
  buildFillExtractionRequest,
  buildStructureExtractionRequest,
};
