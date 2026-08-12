const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('./structureSchema');
const {
  buildSimpleWeeklyPlanFillProviderSchema,
  buildCanonicalProviderEntities,
} = require('./fillSchema');

const STRUCTURE_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_structure_v2';
const FILL_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_fills_v4';

function buildStructureExtractionRequest({
  generatedPlanText,
  sessionsPerWeek,
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
    '',
    'Before returning the JSON, verify each workout once:',
    '- every source-plan block is represented exactly once;',
    '- the blocks[] count matches the number of executable source-plan blocks;',
    '- no consecutive repeated-looking blocks were collapsed or skipped.',
  ].join('\n');
  const sourcePlan = String(generatedPlanText || '');

  return {
    formatName: STRUCTURE_OUTPUT_FORMAT_NAME,
    schema: buildSimpleWeeklyPlanStructureSchema(sessionsPerWeek),
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
  FILL_OUTPUT_FORMAT_NAME,
  STRUCTURE_OUTPUT_FORMAT_NAME,
  buildFillExtractionRequest,
  buildStructureExtractionRequest,
};
