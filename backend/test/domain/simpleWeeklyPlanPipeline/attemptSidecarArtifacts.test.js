const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_OUTPUT_FILES,
  resolveAttemptSidecar,
  writeWeeklyPlanPipelineArtifacts,
} = require('../../../services/weeklyPlanPipelineArtifactWriter');

function canonicalOutputs() {
  return {
    output1: 'prompt',
    output2: 'plan',
    output3: 'prompt 2',
    output4: { schemaVersion: 1, planName: 'p', workouts: [] },
    output5: { geometryHash: 'sha256:x' },
    output6: { providerFills: {} },
    output7: { name: 'p' },
    output8: { valid: true },
  };
}

async function withTemporaryDirectory(run) {
  const baseDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lyft-zone-attempt-artifacts-')
  );
  try {
    return await run(baseDirectory);
  } finally {
    await fs.rm(baseDirectory, { recursive: true, force: true });
  }
}

test('attempt sidecar keys resolve to attempt-indexed canonical filenames', () => {
  assert.deepEqual(resolveAttemptSidecar('01-a1'), {
    filename: '01-a1-input-ai_master-prompt.txt',
    format: 'text',
  });
  assert.deepEqual(resolveAttemptSidecar('02-a1'), {
    filename: '02-a1-output-ai_generated-plan.txt',
    format: 'text',
  });
  assert.deepEqual(resolveAttemptSidecar('03-a2'), {
    filename: '03-a2-input-ai_prompt-2.txt',
    format: 'text',
  });
  assert.deepEqual(resolveAttemptSidecar('04-a2'), {
    filename: '04-a2-output-ai_extracted-structure.json',
    format: 'json',
  });
  assert.deepEqual(resolveAttemptSidecar('04-a1-verification'), {
    filename: '04-a1-verification.json',
    format: 'json',
  });
});

test('non-attempt keys are refused', () => {
  ['05-a1', '04-a0', '04-a1-other', 'output6b', '', '01-a10', '../escape']
    .forEach((key) => {
      assert.equal(resolveAttemptSidecar(key), null, key);
    });
});

test('a run without retries still writes exactly the canonical eight files', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    const artifacts = await writeWeeklyPlanPipelineArtifacts({
      outputs: canonicalOutputs(),
      runId: 'run-canonical',
      baseDirectory,
    });

    const written = (await fs.readdir(artifacts.runDirectory)).sort();
    assert.deepEqual(
      written,
      CANONICAL_OUTPUT_FILES.map(([, filename]) => filename).sort()
    );
    assert.equal(artifacts.files.length, 8);
  });
});

test('a fallback run writes ten files and preserves the canonical chain', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    const artifacts = await writeWeeklyPlanPipelineArtifacts({
      outputs: canonicalOutputs(),
      sidecars: { output6b: { request: true }, output6c: { response: true } },
      runId: 'run-fallback',
      baseDirectory,
    });

    const written = await fs.readdir(artifacts.runDirectory);
    assert.equal(written.length, 10);
    assert.ok(written.includes('06b-input-ai_fill-fallback.json'));
    assert.ok(written.includes('06c-output-ai_fill-fallback.json'));
  });
});

test('superseded attempts are preserved beside an intact canonical chain', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    const artifacts = await writeWeeklyPlanPipelineArtifacts({
      outputs: canonicalOutputs(),
      sidecars: { output6b: { request: true }, output6c: { response: true } },
      attemptSidecars: {
        '01-a1': 'superseded prompt',
        '02-a1': 'superseded plan',
        '03-a1': 'superseded bind prompt',
        '04-a1': { schemaVersion: 1, workouts: [] },
        '04-a1-verification': { valid: false, failures: [{ code: 'X' }] },
        '03-a2': 'second bind prompt',
        '04-a2': { schemaVersion: 1, workouts: [] },
        '04-a2-verification': { valid: false, failures: [{ code: 'X' }] },
      },
      runId: 'run-retries',
      baseDirectory,
    });

    const written = await fs.readdir(artifacts.runDirectory);
    assert.equal(written.length, 18);

    // The canonical chain still describes the winning attempt only.
    CANONICAL_OUTPUT_FILES.forEach(([, filename]) => {
      assert.ok(written.includes(filename), `${filename} must remain canonical`);
    });
    assert.equal(
      await fs.readFile(
        path.join(artifacts.runDirectory, '02-output-ai_generated-plan.txt'),
        'utf8'
      ),
      'plan\n',
      'canonical Output 02 must hold the winning plan, not a superseded one'
    );
    assert.equal(
      await fs.readFile(
        path.join(artifacts.runDirectory, '02-a1-output-ai_generated-plan.txt'),
        'utf8'
      ),
      'superseded plan\n',
      'the superseded plan must remain readable'
    );
  });
});

test('attempt sidecars keep the restrictive file mode', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    const artifacts = await writeWeeklyPlanPipelineArtifacts({
      outputs: canonicalOutputs(),
      attemptSidecars: { '02-a1': 'superseded plan' },
      runId: 'run-mode',
      baseDirectory,
    });

    const stats = await fs.stat(
      path.join(artifacts.runDirectory, '02-a1-output-ai_generated-plan.txt')
    );
    assert.equal(stats.mode & 0o777, 0o600);
  });
});

test('an unknown attempt sidecar key is rejected before anything is written', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    await assert.rejects(
      () => writeWeeklyPlanPipelineArtifacts({
        outputs: canonicalOutputs(),
        attemptSidecars: { '09-a1': 'nope' },
        runId: 'run-invalid',
        baseDirectory,
      }),
      /Unknown Weekly Plan pipeline attempt sidecar/
    );

    assert.deepEqual(await fs.readdir(baseDirectory), []);
  });
});

test('the worst case retry run remains fully auditable', async () => {
  await withTemporaryDirectory(async (baseDirectory) => {
    // 2 creator attempts and 4 binder attempts: one superseded creator output plus
    // three superseded binds, each with its verification result.
    const attemptSidecars = {
      '01-a1': 'p1',
      '02-a1': 'plan1',
      '03-a1': 'bind1',
      '04-a1': {},
      '04-a1-verification': {},
      '03-a2': 'bind2',
      '04-a2': {},
      '04-a2-verification': {},
      '03-a3': 'bind3',
      '04-a3': {},
      '04-a3-verification': {},
    };
    const artifacts = await writeWeeklyPlanPipelineArtifacts({
      outputs: canonicalOutputs(),
      sidecars: { output6b: {}, output6c: {} },
      attemptSidecars,
      runId: 'run-worst-case',
      baseDirectory,
    });

    const written = await fs.readdir(artifacts.runDirectory);
    assert.equal(written.length, 8 + 2 + Object.keys(attemptSidecars).length);
    assert.equal(artifacts.files.length, written.length);
    assert.equal(new Set(written).size, written.length, 'no filename collisions');
  });
});
