#!/usr/bin/env node

require('dotenv').config();

const { getPrisma } = require('../lib/prisma');
const {
  buildProgramGenerationContext,
} = require('../src/domain/programGeneration/programGenerationContextBuilder');
const {
  buildTextualAIWeeklyPlanPromptForUser,
} = require('../services/programGenerationTextPromptService');

const SUPPORTED_PRIMARY_GOAL = 'HYPERTROPHY';

class RealPromptPreviewError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RealPromptPreviewError';
    this.code = code;
    this.details = details;
  }
}

function parseUserIdArgument(argv = []) {
  const matches = argv.filter(
    (argument) =>
      typeof argument === 'string' && argument.startsWith('--user-id=')
  );
  if (matches.length > 1) {
    throw new RealPromptPreviewError(
      'INVALID_ARGUMENT',
      'Only one --user-id argument may be provided'
    );
  }

  if (!matches.length) {
    return null;
  }

  const userId = matches[0].slice('--user-id='.length).trim();
  if (!userId) {
    throw new RealPromptPreviewError(
      'INVALID_ARGUMENT',
      '--user-id must contain a value'
    );
  }

  return userId;
}

function parseRequiredUserIdArgument(argv = []) {
  const userId = parseUserIdArgument(argv);
  if (
    !userId ||
    argv.length !== 1 ||
    !argv[0].startsWith('--user-id=')
  ) {
    throw new RealPromptPreviewError(
      'INVALID_ARGUMENT',
      'Exactly one --user-id=<USER_ID> argument is required'
    );
  }
  return userId;
}

function describeDatabase(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    return {
      configured: false,
      environment: 'backend/.env',
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    return {
      configured: true,
      environment: 'backend/.env',
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.hostname || null,
      port: parsed.port || null,
      database: parsed.pathname.replace(/^\//, '') || null,
    };
  } catch (_error) {
    return {
      configured: true,
      environment: 'backend/.env',
      parseableUrl: false,
    };
  }
}

function summarizeCandidate(userId, snapshot) {
  const profile = snapshot?.profile || {};
  return {
    userId,
    profileSchemaVersion: snapshot?.schemaVersion ?? null,
    primaryGoal: profile.primaryGoal ?? null,
    experience: profile.experience ?? null,
    sessionsPerWeek: profile.availability?.sessionsPerWeek ?? null,
    durationPerSession: profile.availability?.durationPerSession ?? null,
  };
}

function assertGenerationEligibleContext(context) {
  if (context?.primaryGoal !== SUPPORTED_PRIMARY_GOAL) {
    throw new RealPromptPreviewError(
      'UNSUPPORTED_PRIMARY_GOAL',
      `The AI Weekly Plan Builder requires primaryGoal ${SUPPORTED_PRIMARY_GOAL}`
    );
  }

  if (!Array.isArray(context.exercisePoolItems) || !context.exercisePoolItems.length) {
    throw new RealPromptPreviewError(
      'EMPTY_EXERCISE_POOL',
      'The real Exercise Pool Builder returned no eligible exercises'
    );
  }
}

async function buildCandidate(prisma, userId, snapshot, buildContext) {
  try {
    const context = await buildContext(userId, {}, { prisma });
    assertGenerationEligibleContext(context);
    return {
      eligible: true,
      userId,
      snapshot,
      context,
      summary: summarizeCandidate(userId, snapshot),
    };
  } catch (error) {
    return {
      eligible: false,
      userId,
      summary: summarizeCandidate(userId, snapshot),
      reason: {
        code: error.code || error.name || 'UNKNOWN_ERROR',
        message: error.message || 'Program generation context could not be built',
      },
    };
  }
}

async function selectRealProfile({
  prisma,
  explicitUserId = null,
  buildContext = buildProgramGenerationContext,
  database = describeDatabase(process.env.DATABASE_URL),
} = {}) {
  if (explicitUserId) {
    const record = await prisma.userProfile.findUnique({
      where: { userId: explicitUserId },
      select: { userId: true, onboardingSnapshot: true },
    });

    if (!record?.onboardingSnapshot) {
      throw new RealPromptPreviewError(
        'PROFILE_NOT_READY',
        'No usable onboardingSnapshot was found for the requested userId',
        { userId: explicitUserId, database }
      );
    }

    const candidate = await buildCandidate(
      prisma,
      record.userId,
      record.onboardingSnapshot,
      buildContext
    );
    if (!candidate.eligible) {
      throw new RealPromptPreviewError(
        'PROFILE_NOT_ELIGIBLE',
        'The requested Training Profile is not eligible for AI generation',
        {
          candidate: candidate.summary,
          reason: candidate.reason,
          database,
        }
      );
    }

    return {
      ...candidate,
      selectionMethod: 'explicit --user-id',
    };
  }

  const records = await prisma.userProfile.findMany({
    where: { onboardingSnapshot: { not: null } },
    select: { userId: true, onboardingSnapshot: true },
    orderBy: { userId: 'asc' },
  });
  const candidates = [];

  for (const record of records) {
    candidates.push(
      await buildCandidate(
        prisma,
        record.userId,
        record.onboardingSnapshot,
        buildContext
      )
    );
  }

  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length !== 1) {
    throw new RealPromptPreviewError(
      eligible.length ? 'MULTIPLE_ELIGIBLE_PROFILES' : 'NO_ELIGIBLE_PROFILE',
      eligible.length
        ? 'Multiple eligible Training Profiles were found; no profile was selected'
        : 'No eligible Training Profile was found',
      {
        count: eligible.length,
        profiles: eligible.map((candidate) => candidate.summary),
        database,
      }
    );
  }

  return {
    ...eligible[0],
    selectionMethod: 'automatic: exactly one eligible profile',
  };
}

function createDefaultDependencies() {
  return {
    prisma: getPrisma(),
    buildPromptForUser: buildTextualAIWeeklyPlanPromptForUser,
  };
}

async function runPreview({
  argv = process.argv.slice(2),
  dependencies = createDefaultDependencies(),
} = {}) {
  const userId = parseRequiredUserIdArgument(argv);
  return dependencies.buildPromptForUser(
    userId,
    {},
    { prisma: dependencies.prisma }
  );
}

async function main({
  argv = process.argv.slice(2),
  dependencies = createDefaultDependencies(),
  stdout = process.stdout,
} = {}) {
  try {
    const result = await runPreview({ argv, dependencies });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await dependencies.prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const output = {
      error: {
        code: error.code || error.name || 'PREVIEW_FAILED',
        message: error.message || 'Real prompt preview failed',
        details: error.details || null,
      },
    };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  RealPromptPreviewError,
  describeDatabase,
  main,
  parseRequiredUserIdArgument,
  parseUserIdArgument,
  runPreview,
  selectRealProfile,
};
