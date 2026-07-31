const {
  buildSimpleWeeklyPlanStructureSchema,
} = require('./structureSchema');
const {
  buildSimpleWeeklyPlanFillProviderSchema,
} = require('./fillSchema');

const STRUCTURE_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_structure_v2';
const FILL_OUTPUT_FORMAT_NAME = 'simple_weekly_plan_fills_v1';

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
    '- list every block in execution order;',
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
  const skeletonText = JSON.stringify(skeleton);

  return {
    formatName: FILL_OUTPUT_FORMAT_NAME,
    schema: buildSimpleWeeklyPlanFillProviderSchema(skeleton),
    systemMessage: 'You are a faithful training-plan data extractor.',
    userMessage: [
      'Fill the provided slot registry using the source plan.',
      'Do not redesign, improve, correct, merge, split, add, remove or reorder anything.',
      '',
      'Return only:',
      '- schemaVersion',
      '- geometryHash',
      '- fills as an array containing exactly one typed entry per slotId',
      '',
      'Preserve exactly exercise IDs, repetitions, repetition ranges, duration targets, per-side meaning, RIR, tempo, rest, notes, and cardio prescriptions.',
      'For a source RIR range such as 1 to 2, use targetRir 2.',
      "If the skeleton contains more set slots for an exercise than the source plan explicitly lists because of an inconsistent SUPERSET set count, fill the missing set slots using that same exercise's stated repetition range, RIR, tempo, rest, and notes.",
      '',
      'Do not change the exercise, block geometry, or number of sets.',
      'Copy each exerciseId exactly from the SOURCE PLAN.',
      'Do not return the completed Weekly Plan document.',
      '',
      'PLAN SKELETON AND SLOT REGISTRY',
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
