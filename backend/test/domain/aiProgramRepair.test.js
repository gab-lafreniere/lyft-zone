const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIProgramRepairError,
  runAIProgramRepair,
} = require('../../src/domain/programGeneration/aiProgramRepair');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  createAiOutput,
  createContext,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

function createRepairFixture() {
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
  return {
    trigger: 'DURATION',
    context,
    generatedAIOutput,
    generatedPlanDocument,
    analytics,
  };
}

test('runAIProgramRepair builds V4 context/prompt/schema and returns one V4 replacement', async () => {
  const repairedAIOutput = createAiOutput();
  let captured;
  const result = await runAIProgramRepair(createRepairFixture(), {
    repairWeeklyPlanAi: async (input) => {
      captured = input;
      return {
        repairedAIOutput,
        repairer: {
          type: 'openai',
          model: 'repair-model',
          responseId: 'resp_repair',
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            reasoningTokens: 0,
          },
        },
      };
    },
  });

  assert.equal(result.attemptNumber, 1);
  assert.equal(result.contractVersion, 4);
  assert.equal(result.outputSchemaVersion, 4);
  assert.equal(
    result.promptVersion,
    'ai-weekly-plan-repair-prompt-v1.3.0'
  );
  assert.equal(captured.schema.properties.schemaVersion.enum[0], 4);
  assert.equal(captured.promptDescriptor.userMessage.includes('APPENDIX A'), false);
  assert.strictEqual(result.repairedAIOutput, repairedAIOutput);
});

test('runAIProgramRepair forwards DURATION trigger without Initial Review', async () => {
  let capturedContext;
  const options = {
    ...createRepairFixture(),
    debugContractValidation: {
      ok: false,
      issues: [
        {
          code: 'FALSE_OMISSION_DECLARATION',
          path: 'muscleDistributionDebug.omittedBodyParts',
          message: 'A directly trained area cannot be declared omitted.',
        },
      ],
    },
  };
  await runAIProgramRepair(options, {
    buildProgramRepairContext: (input) => {
      capturedContext = input;
      return {
        schemaVersion: 4,
        repairControl: {
          maxAttempts: 1,
          attemptNumber: 1,
          outputMode: 'full_replacement',
          trigger: 'DURATION',
        },
        programGenerationContext: input.context,
      };
    },
    buildProgramRepairPrompt: ({ repairContext }) => ({
      promptVersion: 'ai-weekly-plan-repair-prompt-v1.3.0',
      systemMessage: 'System.',
      userMessage: JSON.stringify(repairContext),
    }),
    repairWeeklyPlanAi: async () => ({
      repairedAIOutput: createAiOutput(),
      repairer: {
        type: 'openai',
        model: 'repair-model',
        responseId: null,
        usage: {},
      },
    }),
  });

  assert.equal(capturedContext.trigger, 'DURATION');
  assert.equal(capturedContext.initialReview, undefined);
  assert.strictEqual(
    capturedContext.debugContractValidation,
    options.debugContractValidation
  );
});

test('runAIProgramRepair maps invalid context and provider shapes safely', async () => {
  await assert.rejects(
    () => runAIProgramRepair({}),
    (error) =>
      error instanceof AIProgramRepairError &&
      error.code === 'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID'
  );

  await assert.rejects(
    () =>
      runAIProgramRepair(createRepairFixture(), {
        repairWeeklyPlanAi: async () => ({}),
      }),
    (error) =>
      error instanceof AIProgramRepairError &&
      error.code ===
        'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE'
  );
});
