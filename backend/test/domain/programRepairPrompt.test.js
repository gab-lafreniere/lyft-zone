const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProgramRepairContext,
} = require('../../src/domain/programGeneration/programRepairContextBuilder');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
  ProgramRepairPromptError,
  buildProgramRepairPrompt,
} = require('../../src/domain/programGeneration/prompts/programRepairPrompt');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  createAiOutput,
  createContext,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

function createDurationRepairContext() {
  const context = createContext();
  const generatedAIOutput = createAiOutput();
  generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0] = {
    ...generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    targetSeconds: 1,
  };
  const generatedPlanDocument = createNormalizedDocument({
    targetSeconds: 1,
  });
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context,
  });
  return buildProgramRepairContext({
    context,
    generatedAIOutput,
    generatedPlanDocument,
    analytics,
    trigger: 'DURATION',
  });
}

test('Repair prompt V1.3 returns a complete Output V4 without doctrine', () => {
  const prompt = buildProgramRepairPrompt({
    repairContext: createDurationRepairContext(),
  });

  assert.equal(
    PROGRAM_REPAIR_PROMPT_VERSION,
    'ai-weekly-plan-repair-prompt-v1.3.0'
  );
  assert.match(prompt.systemMessage, /complete replacement plan/);
  assert.match(prompt.userMessage, /OUTPUT SCHEMA VERSION: 4/);
  assert.doesNotMatch(prompt.userMessage, /APPENDIX A/);
});

test('Repair prompt uses real contributors and forbids duration declarations and padding', () => {
  const prompt = buildProgramRepairPrompt({
    repairContext: createDurationRepairContext(),
  });
  const combined = `${prompt.systemMessage}\n${prompt.userMessage}`;

  assert.match(combined, /Never return estimatedDurationMinutes/);
  assert.match(combined, /durationCalculationDebug/);
  assert.match(combined, /Do not calculate or report seconds/);
  assert.match(combined, /Do not inflate rests/);
  assert.match(combined, /No second repair attempt/);
  assert.match(combined, /debugContract issue is also mandatory/);
  assert.match(combined, /targetSeconds/);
  assert.equal(combined.includes('repairDesignTargetMinutes'), false);
});

test('Repair prompt clarifies lane rest ownership and non-blocking note concision', () => {
  const prompt = buildProgramRepairPrompt({
    repairContext: createDurationRepairContext(),
  });
  const combined = `${prompt.systemMessage}\n${prompt.userMessage}`;

  assert.match(
    combined,
    /SINGLE exercise and SUPERSET lane A must use a positive defaultRestSeconds/
  );
  assert.match(combined, /SUPERSET lane B may use null/);
  assert.match(combined, /lane B must never invent a different block rest/);
  assert.match(combined, /Keep exercise\.notes null unless/);
  assert.match(
    combined,
    /concision recommendation, never a reason to make an otherwise valid prescription invalid/
  );
});

test('Repair prompt serializes the V4 context once and is deterministic', () => {
  const repairContext = createDurationRepairContext();
  const first = buildProgramRepairPrompt({ repairContext });
  const second = buildProgramRepairPrompt({ repairContext });

  assert.deepEqual(first, second);
  assert.equal(
    first.userMessage.split(JSON.stringify(repairContext)).length - 1,
    1
  );
});

test('Repair prompt rejects invalid context without requiring doctrine', () => {
  assert.throws(
    () => buildProgramRepairPrompt({ repairContext: {} }),
    ProgramRepairPromptError
  );
  assert.doesNotThrow(() =>
    buildProgramRepairPrompt({
      repairContext: createDurationRepairContext(),
      doctrine: null,
    })
  );
});
