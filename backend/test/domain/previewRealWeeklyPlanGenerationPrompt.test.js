const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  main,
  parseRequiredUserIdArgument,
  parseUserIdArgument,
  runPreview,
} = require('../../scripts/previewRealWeeklyPlanGenerationPrompt');

function createResult(userId) {
  const systemMessage = 'System coaching message';
  const userMessage = `User plan request for ${userId}`;
  const inputText =
    `SYSTEM MESSAGE\n${systemMessage}\n\nUSER MESSAGE\n${userMessage}`;
  return {
    userId,
    promptVersion: 'ai-weekly-plan-text-prompt-v1.0.0',
    systemMessage,
    userMessage,
    inputText,
    inputCharacters: inputText.length,
    openAICallPerformed: false,
  };
}

test('preview requires exactly one non-empty --user-id argument', () => {
  assert.equal(
    parseRequiredUserIdArgument(['--user-id=user_1']),
    'user_1'
  );
  [
    [],
    ['--user-id=a', '--user-id=b'],
    ['--user-id='],
    ['--unknown=value'],
    ['--user-id=a', '--unknown=value'],
  ].forEach((argv) =>
    assert.throws(() => parseRequiredUserIdArgument(argv))
  );
  assert.equal(parseUserIdArgument([]), null);
});

test('runPreview delegates only to the textual prompt service', async () => {
  let received;
  const expected = createResult('user_real');
  const prisma = {};
  const result = await runPreview({
    argv: ['--user-id=user_real'],
    dependencies: {
      prisma,
      buildPromptForUser: async (...args) => {
        received = args;
        return expected;
      },
    },
  });

  assert.deepEqual(result, expected);
  assert.equal(received[0], 'user_real');
  assert.deepEqual(received[1], {});
  assert.strictEqual(received[2].prisma, prisma);
});

test('main writes the complete result to stdout and disconnects Prisma', async () => {
  const expected = createResult('user_stdout');
  let stdout = '';
  let disconnectCount = 0;
  const result = await main({
    argv: ['--user-id=user_stdout'],
    dependencies: {
      prisma: {
        $disconnect: async () => {
          disconnectCount += 1;
        },
      },
      buildPromptForUser: async () => expected,
    },
    stdout: {
      write(value) {
        stdout += value;
      },
    },
  });

  assert.deepEqual(result, expected);
  assert.deepEqual(JSON.parse(stdout), expected);
  assert.equal(disconnectCount, 1);
});

test('main disconnects Prisma when prompt construction fails', async () => {
  let disconnectCount = 0;
  await assert.rejects(() =>
    main({
      argv: ['--user-id=user_failure'],
      dependencies: {
        prisma: {
          $disconnect: async () => {
            disconnectCount += 1;
          },
        },
        buildPromptForUser: async () => {
          throw new Error('fixture failure');
        },
      },
      stdout: { write() {} },
    })
  );
  assert.equal(disconnectCount, 1);
});

test('preview source has no file output, schema, model, router, or OpenAI request', () => {
  const source = fs.readFileSync(
    require.resolve('../../scripts/previewRealWeeklyPlanGenerationPrompt'),
    'utf8'
  );

  [
    /\/tmp/,
    /writeFile/,
    /weeklyPlanAiSchema/,
    /weeklyPlanAiGenerationService/,
    /aiRouter/,
    /getModelForTask/,
    /buildResponsesRequest/,
    /OpenAI/,
  ].forEach((pattern) => assert.doesNotMatch(source, pattern));
});
