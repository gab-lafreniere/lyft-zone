const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PIPELINE_ARTIFACT_BASE_DIRECTORY =
  '/tmp/lyft-zone-ai-plan-pipeline';
const CANONICAL_OUTPUT_FILES = Object.freeze([
  ['output1', '01-input-ai_master-prompt.txt', 'text'],
  ['output2', '02-output-ai_generated-plan.txt', 'text'],
  ['output3', '03-input-ai_prompt-2.txt', 'text'],
  ['output4', '04-output-ai_extracted-structure.json', 'json'],
  ['output5', '05-output-backend_plan-skeleton.json', 'json'],
  ['output6', '06-input-ai_prompt-3.txt', 'text'],
  ['output7', '07-output-ai_completed-plan.json', 'json'],
  ['output8', '08-output-backend_validation-result.json', 'json'],
]);

function createRunId(now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

function serializeOutput(value, format) {
  if (format === 'text') {
    return `${String(value).replace(/\n*$/, '')}\n`;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeFileAtomically(directory, filename, content) {
  const targetPath = path.join(directory, filename);
  const temporaryPath = path.join(
    directory,
    `.${filename}.${randomBytes(6).toString('hex')}.tmp`
  );
  const handle = await fs.open(temporaryPath, 'wx', 0o600);

  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(temporaryPath, targetPath);
  await fs.chmod(targetPath, 0o600);
}

async function writeWeeklyPlanPipelineArtifacts({
  outputs,
  runId = createRunId(),
  baseDirectory = DEFAULT_PIPELINE_ARTIFACT_BASE_DIRECTORY,
}) {
  const expectedKeys = CANONICAL_OUTPUT_FILES.map(([key]) => key);
  const receivedKeys = Object.keys(outputs || {}).sort();
  if (
    receivedKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !receivedKeys.includes(key))
  ) {
    throw new Error('Exactly outputs output1 through output8 are required');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error('runId contains invalid characters');
  }

  await fs.mkdir(baseDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const runDirectory = path.join(baseDirectory, runId);
  await fs.mkdir(runDirectory, {
    recursive: false,
    mode: 0o700,
  });

  for (const [key, filename, format] of CANONICAL_OUTPUT_FILES) {
    await writeFileAtomically(
      runDirectory,
      filename,
      serializeOutput(outputs[key], format)
    );
  }

  return {
    runId,
    runDirectory,
    files: CANONICAL_OUTPUT_FILES.map(([, filename]) =>
      path.join(runDirectory, filename)
    ),
  };
}

async function rewriteWeeklyPlanPipelineOutput8({ runDirectory, output8 }) {
  if (typeof runDirectory !== 'string' || !runDirectory.trim()) {
    throw new Error('runDirectory is required to rewrite Output 8');
  }
  const output8Descriptor = CANONICAL_OUTPUT_FILES.find(
    ([key]) => key === 'output8'
  );
  await writeFileAtomically(
    runDirectory,
    output8Descriptor[1],
    serializeOutput(output8, output8Descriptor[2])
  );
  return path.join(runDirectory, output8Descriptor[1]);
}

module.exports = {
  CANONICAL_OUTPUT_FILES,
  DEFAULT_PIPELINE_ARTIFACT_BASE_DIRECTORY,
  createRunId,
  rewriteWeeklyPlanPipelineOutput8,
  writeWeeklyPlanPipelineArtifacts,
};
