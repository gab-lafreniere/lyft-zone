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
  ['output6', '06-output-backend_deterministic-fills.json', 'json'],
  ['output7', '07-output-backend_completed-plan.json', 'json'],
  ['output8', '08-output-backend_validation-result.json', 'json'],
]);
const OPTIONAL_SIDECAR_FILES = Object.freeze([
  ['output6b', '06b-input-ai_fill-fallback.json', 'json'],
  ['output6c', '06c-output-ai_fill-fallback.json', 'json'],
]);

// Superseded attempts are preserved beside the canonical chain and never overwrite it.
// Canonical 01-08 always describe the attempt that produced Output 07, so the primary
// debugging path stays internally consistent; every earlier attempt remains auditable.
const ATTEMPT_SIDECAR_KEY_PATTERN = /^(0[1-4])-a([1-9])$/;
const ATTEMPT_VERIFICATION_KEY_PATTERN = /^04-a([1-9])-verification$/;

function resolveAttemptSidecar(key) {
  const verification = String(key).match(ATTEMPT_VERIFICATION_KEY_PATTERN);
  if (verification) {
    return {
      filename: `04-a${verification[1]}-verification.json`,
      format: 'json',
    };
  }

  const match = String(key).match(ATTEMPT_SIDECAR_KEY_PATTERN);
  if (!match) {
    return null;
  }
  const [, outputNumber, attempt] = match;
  const canonical = CANONICAL_OUTPUT_FILES.find(
    ([, filename]) => filename.startsWith(`${outputNumber}-`)
  );
  if (!canonical) {
    return null;
  }
  return {
    filename: canonical[1].replace(/^(\d{2})-/, `$1-a${attempt}-`),
    format: canonical[2],
  };
}

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
  sidecars = {},
  attemptSidecars = {},
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
  const allowedSidecarKeys = OPTIONAL_SIDECAR_FILES.map(([key]) => key);
  const receivedSidecarKeys = Object.keys(sidecars || {});
  if (receivedSidecarKeys.some((key) => !allowedSidecarKeys.includes(key))) {
    throw new Error('Unknown Weekly Plan pipeline artifact sidecar');
  }
  const attemptSidecarEntries = Object.keys(attemptSidecars || {}).map((key) => {
    const descriptor = resolveAttemptSidecar(key);
    if (!descriptor) {
      throw new Error('Unknown Weekly Plan pipeline attempt sidecar');
    }
    return [key, descriptor.filename, descriptor.format];
  });
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
  for (const [key, filename, format] of OPTIONAL_SIDECAR_FILES) {
    if (!Object.prototype.hasOwnProperty.call(sidecars, key)) continue;
    await writeFileAtomically(
      runDirectory,
      filename,
      serializeOutput(sidecars[key], format)
    );
  }
  for (const [key, filename, format] of attemptSidecarEntries) {
    await writeFileAtomically(
      runDirectory,
      filename,
      serializeOutput(attemptSidecars[key], format)
    );
  }

  const writtenFiles = [
    ...CANONICAL_OUTPUT_FILES,
    ...OPTIONAL_SIDECAR_FILES.filter(([key]) =>
      Object.prototype.hasOwnProperty.call(sidecars, key)
    ),
    ...attemptSidecarEntries,
  ];

  return {
    runId,
    runDirectory,
    files: writtenFiles.map(([, filename]) =>
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
  OPTIONAL_SIDECAR_FILES,
  createRunId,
  resolveAttemptSidecar,
  rewriteWeeklyPlanPipelineOutput8,
  writeWeeklyPlanPipelineArtifacts,
};
