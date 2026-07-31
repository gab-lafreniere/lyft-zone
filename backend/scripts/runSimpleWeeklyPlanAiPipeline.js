#!/usr/bin/env node

require('dotenv').config();

const { getPrisma } = require('../lib/prisma');
const {
  runSimpleWeeklyPlanAiPipeline,
} = require('../services/simpleWeeklyPlanAiOrchestrator');

class SimpleWeeklyPlanCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SimpleWeeklyPlanCliError';
    this.code = code;
  }
}

function parseRequiredUserIdArgument(argv = []) {
  if (
    argv.length !== 1 ||
    typeof argv[0] !== 'string' ||
    !argv[0].startsWith('--user-id=')
  ) {
    throw new SimpleWeeklyPlanCliError(
      'INVALID_ARGUMENT',
      'Exactly one --user-id=<USER_ID> argument is required'
    );
  }
  const userId = argv[0].slice('--user-id='.length).trim();
  if (!userId) {
    throw new SimpleWeeklyPlanCliError(
      'INVALID_ARGUMENT',
      '--user-id must contain a value'
    );
  }
  return userId;
}

function createDefaultDependencies() {
  return {
    prisma: getPrisma(),
    runPipeline: runSimpleWeeklyPlanAiPipeline,
  };
}

function summarizeRun(result) {
  return {
    runId: result.runId,
    directory: result.runDirectory,
    modelsUsed: result.modelsUsed,
    statuses: result.statuses,
    valid: result.valid,
    counts: result.counts,
    slotCount: result.slotCount,
    fillCount: result.fillCount,
  };
}

async function runCli({
  argv = process.argv.slice(2),
  dependencies = createDefaultDependencies(),
} = {}) {
  const userId = parseRequiredUserIdArgument(argv);
  return dependencies.runPipeline({
    userId,
    dependencies: {
      prisma: dependencies.prisma,
    },
  });
}

async function main({
  argv = process.argv.slice(2),
  dependencies = createDefaultDependencies(),
  stdout = process.stdout,
} = {}) {
  try {
    const result = await runCli({ argv, dependencies });
    stdout.write(`${JSON.stringify(summarizeRun(result), null, 2)}\n`);
    return result;
  } finally {
    await dependencies.prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error.code || error.name || 'PIPELINE_CLI_FAILED',
          message: error.message || 'Simple Weekly Plan pipeline failed',
        },
      })}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  SimpleWeeklyPlanCliError,
  main,
  parseRequiredUserIdArgument,
  runCli,
  summarizeRun,
};
