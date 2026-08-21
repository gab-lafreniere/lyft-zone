const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  runSimpleWeeklyPlanAiPipeline,
} = require('../../services/simpleWeeklyPlanAiOrchestrator');
const exerciseLibrary = require('../../src/exercise-library/exercises.json');

const CORPUS = path.join(
  __dirname,
  '../fixtures/simpleWeeklyPlanPipeline/bound-plan/smoke-203907'
);
const SOURCE_PLAN = fs.readFileSync(
  path.join(CORPUS, '02-output-ai_generated-plan.txt'),
  'utf8'
);
const GROUND_TRUTH = JSON.parse(
  fs.readFileSync(path.join(CORPUS, 'bound-plan.json'), 'utf8')
);

// A REALISTIC creator workout-count violation: Call #1 itself produced only one
// workout, so the binder faithfully binds one. Dropping a workout from the bind while
// leaving the source intact would instead be a binder omission, which occurrence
// integrity now correctly classifies as a binder fault.
const CREATOR_SHORT_SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    '../fixtures/simpleWeeklyPlanPipeline/bound-plan/creator-fewer-workouts/02-output-ai_generated-plan.txt'
  ),
  'utf8'
);

function oneWorkoutBind() {
  const bound = structuredClone(GROUND_TRUTH);
  bound.workouts = [bound.workouts[0]];
  return bound;
}

function poolItems() {
  const ids = new Set(SOURCE_PLAN.match(/\bexr_[A-Za-z0-9_-]+\b/g) || []);
  return exerciseLibrary
    .filter((exercise) => ids.has(exercise.exerciseId))
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      trainingType: exercise.trainingType,
      attributes: {
        bodyParts: exercise.bodyParts,
        muscleFocus: exercise.muscleFocus,
        cardioModality: exercise.cardioModality,
      },
    }));
}

async function withTemporaryDirectory(run) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'lyft-zone-bound-plan-')
  );
  try {
    return await run(directory);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

/**
 * @param {object} options
 * @param {Array} options.binds   one bound plan (or Error) per Call #2 attempt
 * @param {Array} options.plans   Call #1 responses, index 0 initial, index 1 repair
 */
async function runBoundPlanPipeline(options = {}) {
  const calls = [];
  const binds = [...(options.binds || [structuredClone(GROUND_TRUTH)])];
  const plans = [...(options.plans || [SOURCE_PLAN])];
  const stages = [];

  return withTemporaryDirectory(async (outputDirectory) => {
    const provider = {
      async generate(request) {
        calls.push(request);
        if (request.stage === 'CALL_1_PLAN_TEXT') {
          const value = plans.length > 1 ? plans.shift() : plans[0];
          return { value, model: 'model-1', usage: {} };
        }
        if (request.stage === 'CALL_2_BIND_PLAN') {
          const next = binds.length > 1 ? binds.shift() : binds[0];
          if (next instanceof Error) throw next;
          return { value: structuredClone(next), model: 'model-2', usage: {} };
        }
        throw new Error(`Unexpected stage ${request.stage}`);
      },
    };

    const result = await runSimpleWeeklyPlanAiPipeline({
      userId: 'runtime_user',
      outputDirectory,
      runId: options.runId || 'bound-run',
      provider,
      extractionMode: options.extractionMode || 'BOUND_PLAN',
      recoveryLevel: options.recoveryLevel || 'OFF',
      onProgress: (stage) => stages.push(stage),
      dependencies: {
        env: {},
        async buildPromptForUser() {
          return {
            sessionsPerWeek: 2,
            durationPerSession: 45,
            systemMessage: 'SYSTEM COACH CONTENT',
            userMessage: 'USER COACH CONTENT',
            inputText: 'SYSTEM COACH CONTENT\nUSER COACH CONTENT',
          };
        },
        async buildExercisePoolForUser() {
          return { pool: { items: poolItems() } };
        },
        async finalPreflight() {
          return { document: {}, businessRulesValidation: { ok: true } };
        },
      },
    });

    // Snapshot the artifacts before the temporary directory is removed.
    const files = (await fsp.readdir(result.runDirectory)).sort();
    const contents = Object.fromEntries(await Promise.all(
      files.map(async (name) => [
        name,
        await fsp.readFile(path.join(result.runDirectory, name), 'utf8'),
      ])
    ));

    return {
      result,
      calls,
      stages,
      files,
      readArtifact: (name) => {
        if (!(name in contents)) {
          throw new Error(`artifact ${name} was not written`);
        }
        return contents[name];
      },
    };
  });
}

function stageCounts(calls) {
  return {
    call1: calls.filter((call) => call.stage === 'CALL_1_PLAN_TEXT').length,
    call2: calls.filter((call) => call.stage === 'CALL_2_BIND_PLAN').length,
  };
}

// ------------------------------------------------------------------ happy path

test('BOUND_PLAN completes with exactly two AI calls and eight canonical artifacts', async () => {
  const { result, calls, files, readArtifact } = await runBoundPlanPipeline();

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(stageCounts(calls), { call1: 1, call2: 1 });
  assert.equal(files.length, 8);
  assert.equal(result.output8.fillResolution.mode, 'BOUND_PLAN_DETERMINISTIC');
  assert.deepEqual(
    result.sourceWorkoutNames,
    GROUND_TRUTH.workouts.map((workout) => workout.name)
  );
  assert.deepEqual(
    result.completedDocument.workouts.map((workout) => workout.name),
    ['Chest Priority A', 'Chest Priority B']
  );

  const output4 = JSON.parse(readArtifact('04-output-ai_extracted-structure.json'));
  const output5 = JSON.parse(readArtifact('05-output-backend_plan-skeleton.json'));
  const output6 = JSON.parse(readArtifact('06-output-backend_deterministic-fills.json'));
  assert.deepEqual(output4, GROUND_TRUTH);
  assert.deepEqual(
    output5.document.workouts.map((workout) => workout.name),
    result.sourceWorkoutNames
  );
  assert.equal(output6.geometryHash, output5.geometryHash);
});

test('the completed plan matches what Call #1 actually wrote', async () => {
  const { result } = await runBoundPlanPipeline();
  const document = result.completedDocument;

  assert.equal(document.workouts.length, 2);
  document.workouts.forEach((workout) => {
    assert.equal(workout.blocks.length, 4);
    const supersets = workout.blocks.filter(
      (block) => block.blockType === 'SUPERSET'
    );
    assert.equal(supersets.length, 1, 'the prose superset stays one block');
    assert.equal(supersets[0].exercises.length, 2);
    assert.equal(supersets[0].restSeconds, 60);
  });

  const [firstStrength] = result.completedDocument.workouts[0].blocks[1].exercises;
  assert.equal(firstStrength.exerciseId, 'exr_incline_dumbbell_press');
  assert.equal(firstStrength.defaultTempo, '3010');
  assert.equal(firstStrength.defaultRestSeconds, 180);
  assert.equal(firstStrength.setTemplates.length, 4);
  assert.equal(firstStrength.setTemplates[0].minReps, 6);
  assert.equal(firstStrength.setTemplates[0].maxReps, 8);
  assert.equal(firstStrength.setTemplates[0].targetRir, 2);
});

test('the bind prompt never reveals the expected workout count', async () => {
  const { calls } = await runBoundPlanPipeline();
  const bind = calls.find((call) => call.stage === 'CALL_2_BIND_PLAN');

  const instructions = bind.userMessage.split('\n\nSOURCE PLAN\n')[0];
  assert.equal(/\d/.test(instructions), false, 'no digit may appear');
  assert.equal(/sessionsPerWeek/i.test(instructions), false);
  assert.equal(
    JSON.stringify(bind.schema).includes('sessionsPerWeek'),
    false
  );
  assert.equal(bind.schema.properties.workouts.minItems, 1);
});

// --------------------------------------------------------------- recovery OFF

test('RECOVERY=OFF fails closed on the first defective bind', async () => {
  const { result, calls, files } = await runBoundPlanPipeline({
    plans: [CREATOR_SHORT_SOURCE],
    binds: [oneWorkoutBind()],
  });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'CREATOR_WORKOUT_COUNT_UNSATISFIED');
  assert.deepEqual(stageCounts(calls), { call1: 1, call2: 1 });
  assert.equal(files.filter((name) => name.startsWith('0')).length, files.length);
});

// ------------------------------------------------------------- binder recovery

test('BINDER_ONLY recovers from a defective bind and archives the superseded attempt', async () => {
  const split = structuredClone(GROUND_TRUTH);
  const superset = split.workouts[0].blocks[2];
  split.workouts[0].blocks.splice(
    2,
    1,
    { type: 'SUPERSET', restAfterRound: superset.restAfterRound, exercises: [superset.exercises[0]] },
    { type: 'SUPERSET', restAfterRound: superset.restAfterRound, exercises: [superset.exercises[1]] }
  );

  const { result, calls, files, readArtifact } = await runBoundPlanPipeline({
    binds: [split, structuredClone(GROUND_TRUTH)],
    recoveryLevel: 'BINDER_ONLY',
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(stageCounts(calls), { call1: 1, call2: 2 });

  assert.ok(files.includes('03-a1-input-ai_prompt-2.txt'));
  assert.ok(files.includes('04-a1-output-ai_extracted-structure.json'));
  assert.ok(files.includes('04-a1-verification.json'));

  const verification = JSON.parse(readArtifact('04-a1-verification.json'));
  assert.equal(verification.valid, false);
  assert.ok(verification.failures.some(
    (failure) => failure.code === 'BOUND_PLAN_BLOCK_ARITY_INVALID'
  ));

  const canonical = JSON.parse(
    readArtifact('04-output-ai_extracted-structure.json')
  );
  assert.equal(canonical.workouts[0].blocks.length, 4, 'canonical holds the winner');

  const retryPrompt = readArtifact('03-input-ai_prompt-2.txt');
  assert.match(retryPrompt, /BINDING CORRECTION/);
  assert.equal(/\d/.test(retryPrompt.split('SOURCE PLAN')[0]), false);
});

test('a binder defect never re-runs Call #1', async () => {
  const bad = structuredClone(GROUND_TRUTH);
  bad.workouts[0].blocks[1].exercises[0].tempo = '9-9-9-9';

  const { result, calls } = await runBoundPlanPipeline({
    binds: [bad],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, false);
  assert.equal(stageCounts(calls).call1, 1, 'the creator must not be blamed');
  assert.equal(stageCounts(calls).call2, 2);
});

// ------------------------------------------------------------ creator recovery

test('FULL repairs the creator only after two independent binds agree', async () => {
  const repairedPlan = `${SOURCE_PLAN}\n\n<!-- repaired -->`;

  const { result, calls, files, readArtifact } = await runBoundPlanPipeline({
    binds: [oneWorkoutBind(), oneWorkoutBind(), structuredClone(GROUND_TRUTH)],
    plans: [CREATOR_SHORT_SOURCE, repairedPlan],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(stageCounts(calls), { call1: 2, call2: 3 });

  const repair = calls.filter((call) => call.stage === 'CALL_1_PLAN_TEXT')[1];
  assert.match(repair.userMessage, /^USER COACH CONTENT/);
  assert.match(repair.userMessage, /Workout count expected 2, produced 1\./);
  assert.equal(
    (repair.userMessage.match(/Workout count expected/g) || []).length,
    1,
    'exactly one backend-authored violation'
  );
  assert.match(repair.userMessage, /PREVIOUS PLAN/);
  assert.ok(repair.userMessage.includes(SOURCE_PLAN.slice(0, 200)));
  assert.equal(repair.systemMessage, 'SYSTEM COACH CONTENT');

  // The repaired plan becomes canonical; the superseded one is preserved.
  assert.equal(readArtifact('02-output-ai_generated-plan.txt').trim(), repairedPlan.trim());
  assert.ok(files.includes('02-a1-output-ai_generated-plan.txt'));
  assert.ok(files.includes('01-a1-input-ai_master-prompt.txt'));

  const ledger = result.output8.attempts;
  assert.equal(ledger.creatorAttempts, 2);
  assert.equal(ledger.creatorRepairUsed, true);
  assert.equal(ledger.binderAttempts, 3);
  assert.ok(ledger.timeline.some((entry) => entry.outcome === 'REPAIRED'));
});

test('a repaired plan is not discarded because its first bind is defective', async () => {
  const badBind = structuredClone(GROUND_TRUTH);
  badBind.workouts[0].blocks[1].exercises[0].reps = 'invented';

  const { result, calls } = await runBoundPlanPipeline({
    binds: [oneWorkoutBind(), oneWorkoutBind(), badBind, structuredClone(GROUND_TRUTH)],
    plans: [CREATOR_SHORT_SOURCE, SOURCE_PLAN],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(stageCounts(calls), { call1: 2, call2: 4 });
});

test('the pipeline terminates at exactly two creator and four binder attempts', async () => {
  const { result, calls } = await runBoundPlanPipeline({
    binds: [oneWorkoutBind()],
    plans: [CREATOR_SHORT_SOURCE],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'CREATOR_WORKOUT_COUNT_UNSATISFIED');
  assert.deepEqual(stageCounts(calls), { call1: 2, call2: 4 });
});

// ------------------------------------------- occurrence integrity (H-1 / H-2)

function withDroppedBlock(position) {
  // The SOURCE is unchanged; only the bind loses content. That is a binder fault.
  const dropped = structuredClone(GROUND_TRUTH);
  const blocks = dropped.workouts[1].blocks;
  if (position === "first") blocks.shift();
  else if (position === "middle") blocks.splice(2, 1);
  else blocks.pop();
  return dropped;
}

function withDuplicatedBlock() {
  const duplicated = structuredClone(GROUND_TRUTH);
  const blocks = duplicated.workouts[0].blocks;
  blocks.splice(3, 0, structuredClone(blocks[3]));
  return duplicated;
}

["first", "middle", "last"].forEach((position) => {
  test(`a dropped ${position} block is detected and recovered on binder retry`, async () => {
    const { result, calls, files, readArtifact } = await runBoundPlanPipeline({
      binds: [withDroppedBlock(position), structuredClone(GROUND_TRUTH)],
      recoveryLevel: "BINDER_ONLY",
    });

    assert.equal(result.valid, true, JSON.stringify(result.error));
    assert.deepEqual(stageCounts(calls), { call1: 1, call2: 2 });
    assert.equal(result.output8.attempts.creatorRepairUsed, false);
    assert.equal(result.output8.attempts.coverage.integrityViolation, false);

    const verification = JSON.parse(readArtifact("04-a1-verification.json"));
    assert.ok(verification.failures.some(
      (failure) => failure.code === "BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING"
    ), `${position} omission must be reported`);
    assert.ok(files.includes("04-a1-verification.json"));
  });

  test(`a repeated dropped ${position} block fails closed`, async () => {
    const { result, calls } = await runBoundPlanPipeline({
      binds: [withDroppedBlock(position)],
      recoveryLevel: "BINDER_ONLY",
    });

    assert.equal(result.valid, false);
    assert.equal(result.error.code, "BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING");
    assert.deepEqual(stageCounts(calls), { call1: 1, call2: 2 });
    assert.equal(result.output8.attempts.creatorRepairUsed, false);
  });
});

test("a duplicated block is detected as a binder insertion", async () => {
  const { result, calls, readArtifact } = await runBoundPlanPipeline({
    binds: [withDuplicatedBlock(), structuredClone(GROUND_TRUTH)],
    recoveryLevel: "BINDER_ONLY",
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.deepEqual(stageCounts(calls), { call1: 1, call2: 2 });
  const verification = JSON.parse(readArtifact("04-a1-verification.json"));
  assert.ok(verification.failures.some(
    (failure) => failure.code === "BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS"
  ));
});

test("an omission and an insertion in the same bind are both reported", async () => {
  const mixed = structuredClone(GROUND_TRUTH);
  mixed.workouts[1].blocks.splice(2, 1);
  mixed.workouts[0].blocks.splice(3, 0, structuredClone(mixed.workouts[0].blocks[3]));

  const { result, readArtifact } = await runBoundPlanPipeline({
    binds: [mixed, structuredClone(GROUND_TRUTH)],
    recoveryLevel: "BINDER_ONLY",
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  const codes = JSON.parse(readArtifact("04-a1-verification.json"))
    .failures.map((failure) => failure.code);
  assert.ok(codes.includes("BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING"));
  assert.ok(codes.includes("BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS"));
});

test("an integrity violation is never silently accepted, even with RECOVERY=OFF (M-6)", async () => {
  const { result, calls } = await runBoundPlanPipeline({
    binds: [withDroppedBlock("middle")],
    recoveryLevel: "OFF",
  });

  assert.equal(result.valid, false, "losing executable content must never proceed");
  assert.equal(result.error.code, "BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING");
  assert.deepEqual(stageCounts(calls), { call1: 1, call2: 1 });
});

test("an integrity violation never escalates to creator repair", async () => {
  const { result, calls } = await runBoundPlanPipeline({
    binds: [withDroppedBlock("middle")],
    recoveryLevel: "FULL",
  });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, "BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING");
  assert.equal(stageCounts(calls).call1, 1, "the coach is never blamed for a bind fault");
  assert.equal(result.output8.attempts.creatorRepairUsed, false);
});

test("a legitimately repeated exercise id produces no false positive", async () => {
  // exr_treadmill_walk appears in both workouts of the real source and is bound twice.
  const { result } = await runBoundPlanPipeline();
  const coverage = result.output8.attempts.coverage;

  assert.equal(coverage.integrityViolation, false);
  assert.equal(coverage.missingOccurrences, 0);
  assert.equal(coverage.surplusOccurrences, 0);
  assert.equal(coverage.poolIdOccurrencesInSource, coverage.boundOccurrences);
});

// ----------------------------------------------------------------- invariants

test('public progress never regresses across retries (D10)', async () => {
  const order = [
    'PROFILE_SETUP',
    'DESIGNING_PROGRAM',
    'EXTRACTING_STRUCTURE',
    'BUILDING_PROGRAM',
    'VALIDATING_PROGRAM',
  ];

  const { stages } = await runBoundPlanPipeline({
    binds: [oneWorkoutBind(), oneWorkoutBind(), structuredClone(GROUND_TRUTH)],
    plans: [CREATOR_SHORT_SOURCE, SOURCE_PLAN],
    recoveryLevel: 'FULL',
  });

  const indexes = stages.map((stage) => order.indexOf(stage));
  indexes.forEach((value, position) => {
    assert.ok(value >= 0, `unknown stage ${stages[position]}`);
    if (position > 0) {
      assert.ok(
        value >= indexes[position - 1],
        `progress regressed: ${stages.join(' -> ')}`
      );
    }
  });
  assert.equal(
    new Set(stages).size,
    stages.length,
    'no stage is reported twice, so retries stay invisible to the client'
  );
});

test('GEOMETRY_ONLY remains a working rollback and emits no attempt ledger', async () => {
  const { result } = await runBoundPlanPipeline();
  assert.ok(result.output8.attempts, 'BOUND_PLAN reports attempts');

  const legacy = await withTemporaryDirectory(async (outputDirectory) => {
    const provider = {
      async generate(request) {
        if (request.stage === 'CALL_1_PLAN_TEXT') {
          return { value: SOURCE_PLAN, model: 'm', usage: {} };
        }
        throw new Error(`unexpected ${request.stage}`);
      },
    };
    return runSimpleWeeklyPlanAiPipeline({
      userId: 'runtime_user',
      outputDirectory,
      runId: 'legacy-run',
      provider,
      extractionMode: 'GEOMETRY_ONLY',
      dependencies: {
        env: {},
        async buildPromptForUser() {
          return {
            sessionsPerWeek: 2,
            durationPerSession: 45,
            systemMessage: 'S',
            userMessage: 'U',
            inputText: 'S\nU',
          };
        },
        async buildExercisePoolForUser() {
          return { pool: { items: poolItems() } };
        },
        async finalPreflight() {
          return { document: {}, businessRulesValidation: { ok: true } };
        },
      },
    });
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(legacy.output8, 'attempts'),
    false,
    'the rollback path must keep its existing Output 08 shape'
  );
  assert.equal(legacy.statuses.output3, 'PRODUCED');
});

// -------------------------------------------- artifact truthfulness (M-2 / M-3)

test('artifacts: a successful no-retry run leaves canonical 01-08 describing that run', async () => {
  const { files, readArtifact } = await runBoundPlanPipeline();

  assert.equal(files.length, 8);
  assert.match(readArtifact('03-input-ai_prompt-2.txt'), /SOURCE PLAN/);
  assert.equal(
    readArtifact('02-output-ai_generated-plan.txt').trim(),
    SOURCE_PLAN.trim()
  );
});

test('artifacts: a first-bind failure still shows the bind prompt in canonical 03 (M-2)', async () => {
  const { result, readArtifact } = await runBoundPlanPipeline({
    binds: [withDroppedBlock('middle')],
    recoveryLevel: 'OFF',
  });

  assert.equal(result.valid, false);
  const canonical = readArtifact('03-input-ai_prompt-2.txt');
  assert.equal(
    canonical.includes('PIPELINE_NOT_STARTED'),
    false,
    'a rendered bind prompt must never be reported as never started'
  );
  assert.match(canonical, /SOURCE PLAN/);
});

test('artifacts: a binder retry terminal failure keeps every attempt auditable', async () => {
  const { result, files, readArtifact } = await runBoundPlanPipeline({
    binds: [withDroppedBlock('last')],
    recoveryLevel: 'BINDER_ONLY',
  });

  assert.equal(result.valid, false);
  ['03-a1-input-ai_prompt-2.txt', '04-a1-output-ai_extracted-structure.json',
    '04-a1-verification.json'].forEach((name) => {
    assert.ok(files.includes(name), `${name} must be preserved`);
  });
  assert.equal(
    readArtifact('03-input-ai_prompt-2.txt').includes('PIPELINE_NOT_STARTED'),
    false
  );
  assert.equal(result.output8.attempts.binderAttempts, 2);
});

test('artifacts: a failed creator repair still carries the repaired plan (M-3)', async () => {
  const repairedPlan = `${SOURCE_PLAN}\n\n<!-- REPAIRED -->`;

  const { result, files, readArtifact } = await runBoundPlanPipeline({
    // The repaired plan is bound short as well, so every attempt fails.
    binds: [oneWorkoutBind()],
    plans: [CREATOR_SHORT_SOURCE, repairedPlan],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, false);
  assert.equal(result.output8.attempts.creatorRepairUsed, true);

  // Canonical 02 must describe the latest attempted creator output, not the superseded one.
  assert.match(
    readArtifact('02-output-ai_generated-plan.txt'),
    /REPAIRED/,
    'the repaired plan must not vanish from the artifacts'
  );
  assert.ok(files.includes('02-a1-output-ai_generated-plan.txt'));
  assert.equal(
    readArtifact('02-a1-output-ai_generated-plan.txt').includes('REPAIRED'),
    false,
    'the sidecar holds the superseded original'
  );
  assert.ok(files.includes('01-a1-input-ai_master-prompt.txt'));
});

test('artifacts: a successful creator repair makes the repaired plan canonical', async () => {
  const repairedPlan = `${SOURCE_PLAN}\n\n<!-- REPAIRED -->`;

  const { result, files, readArtifact } = await runBoundPlanPipeline({
    binds: [oneWorkoutBind(), oneWorkoutBind(), structuredClone(GROUND_TRUTH)],
    plans: [CREATOR_SHORT_SOURCE, repairedPlan],
    recoveryLevel: 'FULL',
  });

  assert.equal(result.valid, true, JSON.stringify(result.error));
  assert.match(readArtifact('02-output-ai_generated-plan.txt'), /REPAIRED/);
  assert.ok(files.includes('02-a1-output-ai_generated-plan.txt'));
  assert.equal(result.output8.attempts.creatorRepairUsed, true);
});
