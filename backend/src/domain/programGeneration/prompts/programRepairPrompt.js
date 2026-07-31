const {
  PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION,
} = require('../programGenerationContextBuilder');
const {
  PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
  PROGRAM_REPAIR_MAX_ATTEMPTS,
  PROGRAM_REPAIR_OUTPUT_MODE,
} = require('../programRepairContextBuilder');
const {
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
} = require('../weeklyPlanAiSchema');

const PROGRAM_REPAIR_PROMPT_VERSION =
  'ai-weekly-plan-repair-prompt-v1.3.0';

class ProgramRepairPromptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProgramRepairPromptError';
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRepairContext(repairContext) {
  const context = repairContext?.programGenerationContext;
  const control = repairContext?.repairControl;
  if (
    !isObject(repairContext) ||
    repairContext.schemaVersion !== PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION ||
    !isObject(context) ||
    context.schemaVersion !== PROGRAM_GENERATION_CONTEXT_SCHEMA_VERSION ||
    !isObject(control) ||
    control.maxAttempts !== PROGRAM_REPAIR_MAX_ATTEMPTS ||
    control.attemptNumber !== 1 ||
    control.outputMode !== PROGRAM_REPAIR_OUTPUT_MODE ||
    !['DURATION', 'REVIEW'].includes(control.trigger)
  ) {
    throw new ProgramRepairPromptError(
      'INVALID_PROGRAM_REPAIR_PROMPT_INPUT',
      'A valid Program Repair Context V4 is required'
    );
  }
}

function buildProgramRepairPrompt({ repairContext } = {}) {
  assertRepairContext(repairContext);
  const trigger = repairContext.repairControl.trigger;

  const systemMessage = [
    'You are Lyft Zone AI Weekly Plan Repair.',
    'Return exactly one complete replacement plan matching Weekly Plan AI Output V4.',
    'The backend is the sole authority for workout duration and will recalculate it after this response.',
    'Never return estimatedDurationMinutes, durationCalculationDebug, block duration components, workoutTotalSeconds, or calculatedDurationMinutes.',
    'Use only exerciseIds from the supplied eligible pool and respect all confirmed cautions and priorities.',
    'No second repair attempt is available.',
  ].join('\n');

  const userMessage = [
    `Prompt version: ${PROGRAM_REPAIR_PROMPT_VERSION}`,
    `Repair trigger: ${trigger}`,
    '',
    'NON-NEGOTIABLE REPAIR RULES',
    '- Return a complete Output V4 plan, not a patch.',
    '- Preserve athlete priorities, confirmed physical cautions, cardio role, and allowed exercise pool.',
    '- Change real coaching contributors: useful exercises, working sets, repetitions or targetSeconds, block structure, and appropriate rests.',
    '- Use targetSeconds only for holds or genuinely time-based prescriptions. Never encode 45 seconds as targetReps: 45.',
    '- Do not inflate rests, add redundant sets merely to fill time, or change only names, notes, summaries, or other prose.',
    '- SINGLE blocks use N-1 rest intervals. SUPERSET blocks use R-1 rest intervals, no rest between lanes, and lane A controls rounds and rest.',
    '- Every SINGLE exercise and SUPERSET lane A must use a positive defaultRestSeconds. SUPERSET lane B may use null because lane A controls block rest; lane B must never invent a different block rest.',
    '- Keep exercise.notes null unless a note provides genuinely necessary coaching information. The notes maximum is a concision recommendation, never a reason to make an otherwise valid prescription invalid.',
    '- Do not calculate or report seconds or final workout durations. The backend owns that calculation.',
    '- Do not return estimatedDurationMinutes or durationCalculationDebug.',
    trigger === 'DURATION'
      ? '- Correct the listed workouts in the required direction toward the supplied acceptable and preferred ranges using useful training work. Every listed debugContract issue is also mandatory to correct in this same repair.'
      : '- Resolve every mandatory Review issue while keeping every workout duration acceptable after backend recalculation.',
    '',
    `OUTPUT SCHEMA VERSION: ${AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION}`,
    'STRUCTURED REPAIR CONTEXT',
    JSON.stringify(repairContext),
  ].join('\n');

  return {
    promptVersion: PROGRAM_REPAIR_PROMPT_VERSION,
    systemMessage,
    userMessage,
  };
}

module.exports = {
  PROGRAM_REPAIR_PROMPT_VERSION,
  ProgramRepairPromptError,
  buildProgramRepairPrompt,
};
