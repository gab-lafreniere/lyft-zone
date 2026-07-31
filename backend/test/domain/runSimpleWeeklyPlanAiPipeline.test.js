const test = require('node:test');
const assert = require('node:assert/strict');

const {
  main,
  parseRequiredUserIdArgument,
  runCli,
  summarizeRun,
} = require('../../scripts/runSimpleWeeklyPlanAiPipeline');

function createResult() {
  return {
    runId: 'run-1',
    runDirectory: '/tmp/run-1',
    modelsUsed: ['one', 'two', 'three'],
    statuses: {
      output1: 'PRODUCED',
      output2: 'PRODUCED',
      output3: 'PRODUCED',
      output4: 'PRODUCED',
      output5: 'PRODUCED',
      output6: 'PRODUCED',
      output7: 'PRODUCED',
      output8: 'PRODUCED',
    },
    valid: true,
    counts: {
      workoutCount: 3,
      blockCount: 21,
      exerciseCount: 28,
      setTemplateCount: 104,
    },
    slotCount: 195,
    fillCount: 195,
    files: ['/tmp/run-1/01-input-ai_master-prompt.txt'],
    output8: { valid: true },
  };
}

test('CLI requires exactly one non-empty user ID', () => {
  assert.equal(
    parseRequiredUserIdArgument(['--user-id=user_1']),
    'user_1'
  );
  [
    [],
    ['--user-id='],
    ['--user-id=a', '--user-id=b'],
    ['--unknown=a'],
    ['--user-id=a', '--unknown=b'],
  ].forEach((argv) =>
    assert.throws(() => parseRequiredUserIdArgument(argv))
  );
});

test('CLI passes only the runtime user and read dependency into the orchestrator', async () => {
  const received = [];
  const prisma = {};
  const result = await runCli({
    argv: ['--user-id=real_user'],
    dependencies: {
      prisma,
      async runPipeline(options) {
        received.push(options);
        return createResult();
      },
    },
  });

  assert.equal(result.runId, 'run-1');
  assert.deepEqual(received, [
    {
      userId: 'real_user',
      dependencies: { prisma },
    },
  ]);
});

test('CLI prints only the bounded summary and always disconnects Prisma', async () => {
  let stdout = '';
  let disconnectCount = 0;
  const result = createResult();
  await main({
    argv: ['--user-id=real_user'],
    dependencies: {
      prisma: {
        async $disconnect() {
          disconnectCount += 1;
        },
      },
      async runPipeline() {
        return result;
      },
    },
    stdout: {
      write(value) {
        stdout += value;
      },
    },
  });

  assert.deepEqual(JSON.parse(stdout), summarizeRun(result));
  assert.equal(stdout.includes('prompt'), false);
  assert.equal(stdout.includes('exerciseId'), false);
  assert.equal(disconnectCount, 1);
});

test('CLI disconnects Prisma when the pipeline throws', async () => {
  let disconnectCount = 0;
  await assert.rejects(() =>
    main({
      argv: ['--user-id=real_user'],
      dependencies: {
        prisma: {
          async $disconnect() {
            disconnectCount += 1;
          },
        },
        async runPipeline() {
          throw new Error('failure');
        },
      },
      stdout: { write() {} },
    })
  );
  assert.equal(disconnectCount, 1);
});
