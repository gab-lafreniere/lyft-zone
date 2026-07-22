const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR,
  computeWeeklyPlanWorkoutMetrics,
} = require('../../src/domain/weeklyPlans/weeklyPlanMetrics');
const {
  WEEKLY_PLAN_EVALUATION_POLICY,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');
const {
  MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS,
  TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION,
  buildWeeklyPlanTrainingMetricsPromptProjection,
} = require('../../src/domain/programGeneration/weeklyPlanTrainingMetricsPromptProjection');

function buildCanonicalSingleFixture() {
  return {
    blocks: [
      {
        blockType: 'SINGLE',
        restSeconds: 150,
        exercises: [
          {
            exerciseId: 'ex_example',
            exerciseName: 'Example Press',
            defaultTempo: '3010',
            setTemplates: [1, 2, 3].map((setIndex) => ({
              setIndex,
              setType: 'WORKING',
              targetReps: 8,
              minReps: null,
              maxReps: null,
              tempo: '3010',
              restSeconds: 150,
            })),
          },
        ],
      },
    ],
  };
}

test('Training Metrics Guidance is deterministic, JSON-safe, compact, and does not mutate canonical sources', () => {
  const policyBefore = JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY);
  const descriptorBefore = JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
  const first = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const second = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const serialized = JSON.stringify(first);

  assert.equal(TRAINING_METRICS_GUIDANCE_SCHEMA_VERSION, 1);
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(serialized), first);
  assert.ok(serialized.length <= MAX_TRAINING_METRICS_GUIDANCE_CHARACTERS);
  assert.equal(JSON.stringify(WEEKLY_PLAN_EVALUATION_POLICY), policyBefore);
  assert.equal(JSON.stringify(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR), descriptorBefore);
  assert.equal('evaluationPolicy' in first, false);
  assert.equal('eligibleExercisePool' in first, false);
  assert.equal('analytics' in first, false);
  assert.equal('userId' in first, false);
});

test('duration guidance derives identity, constants, precedence, formulas, and 30-minute ranges from canonical descriptors', () => {
  const guidance = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const duration = guidance.duration;
  const descriptor = WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR;

  assert.equal(duration.methodId, descriptor.id);
  assert.equal(duration.declaredDuration.field, descriptor.output.field);
  assert.equal(duration.declaredDuration.contributesToBackendDuration, false);
  assert.deepEqual(
    duration.repetitions.valuePrecedence,
    descriptor.repetitions.valuePrecedence
  );
  assert.deepEqual(duration.tempo, descriptor.tempo);
  assert.equal(
    duration.blocks.SINGLE.restIntervalMultiplier,
    descriptor.blocks.SINGLE.restIntervalMultiplier
  );
  assert.equal(
    duration.blocks.SINGLE.fixedBlockSeconds,
    descriptor.blocks.SINGLE.fixedBlockSeconds
  );
  assert.deepEqual(
    duration.blocks.SINGLE.restSourcePrecedence,
    descriptor.blocks.SINGLE.restSourcePrecedence
  );
  assert.equal(
    duration.blocks.SUPERSET.betweenLaneRest,
    descriptor.blocks.SUPERSET.betweenLaneRest
  );
  assert.deepEqual(
    duration.blocks.SUPERSET.roundCountSourcePrecedence,
    descriptor.blocks.SUPERSET.roundCountSourcePrecedence
  );
  assert.equal(
    duration.blocks.CARDIO.durationSourceOperation,
    descriptor.blocks.CARDIO.durationSourceOperation
  );
  assert.equal(
    duration.blocks.CARDIO.fixedBlockSeconds,
    descriptor.blocks.CARDIO.fixedBlockSeconds
  );
  assert.match(duration.blocks.SINGLE.formula, /tutSeconds.*restOccurrences/);
  assert.match(duration.blocks.SUPERSET.formula, /allLaneTutSeconds.*restOccurrences/);
  assert.match(duration.blocks.CARDIO.formula, /truncatedDurationMinutes/);
  assert.deepEqual(duration.ranges, {
    requestedMinutes: 30,
    acceptableMinutes: { minimum: 26, maximum: 31 },
    preferredMinutes: { minimum: 27, maximum: 30 },
  });
});

test('canonical SINGLE calibration is calculated from projected descriptor values and agrees with production', () => {
  const guidance = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const example = guidance.duration.example;
  const production = computeWeeklyPlanWorkoutMetrics(buildCanonicalSingleFixture());

  assert.deepEqual(example.inputs, {
    setCount: 3,
    repsPerSet: 8,
    tempo: '3010',
    restSeconds: 150,
  });
  assert.equal(example.tempoSecondsPerRep, 4);
  assert.equal(example.tutSeconds, 96);
  assert.equal(example.rawRestSeconds, 300);
  assert.equal(example.adjustedRestSeconds, 345);
  assert.equal(example.fixedBlockSeconds, 90);
  assert.equal(example.totalSeconds, 531);
  assert.equal(example.minutesBeforeRounding, 8.85);
  assert.equal(example.roundedMinutes, 9);
  assert.equal(production.estimatedDurationMinutes, example.roundedMinutes);
});

test('target guidance is derived from Analytics V2 exact taxonomies and full-credit Face Pull metrics', () => {
  const targets = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  }).targets;

  assert.deepEqual(targets.methods, {
    volume: 'full_direct_sets_separate_indirect_v1',
    frequency: 'deduplicated_workout_exposure_v1',
    comparison: 'exact_match_no_tolerance_v1',
  });
  assert.equal(targets.countedSetType, 'WORKING');
  assert.equal(targets.fullWorkingSetCreditPerKey, true);
  assert.equal(targets.divideCreditAcrossKeys, false);
  assert.equal(targets.frequencyUnit, 'distinct_workouts');
  assert.equal(targets.deduplicateWithinWorkout, true);
  assert.deepEqual(targets.groups, [
    {
      targetGroup: 'volumeTargets.bodyParts',
      taxonomy: 'body_part',
      generatedMetric: 'directWorkingSets',
    },
    {
      targetGroup: 'volumeTargets.muscleFocuses',
      taxonomy: 'muscle_focus',
      generatedMetric: 'directWorkingSets',
    },
    {
      targetGroup: 'frequencyTargets.bodyParts',
      taxonomy: 'body_part',
      generatedMetric: 'directWorkoutCount',
    },
    {
      targetGroup: 'frequencyTargets.muscleFocuses',
      taxonomy: 'muscle_focus',
      generatedMetric: 'directWorkoutCount',
    },
  ]);
  assert.deepEqual(targets.forbiddenTargetAuthorities, [
    'targetMuscles',
    'secondaryMuscles',
    'muscleActivation',
    'normalizedShare',
  ]);
  assert.equal(
    targets.groups.some((group) =>
      ['target_muscle', 'secondary_muscle', 'normalizedShare'].includes(
        group.taxonomy
      )
    ),
    false
  );
  assert.deepEqual(targets.example, {
    exercise: 'Face Pull',
    workingSets: 2,
    bodyParts: { shoulders: 2, back: 2 },
    muscleFocus: { rear_delts: 2, upper_back: 2 },
    directFrequency: {
      shoulders: 1,
      back: 1,
      rear_delts: 1,
      upper_back: 1,
    },
  });
});

test('injecting a changed descriptor changes formulas and calibration instead of leaving copied constants', () => {
  const fakeDescriptor = structuredClone(WEEKLY_PLAN_DURATION_METHOD_DESCRIPTOR);
  fakeDescriptor.blocks.SINGLE.restIntervalMultiplier = 2;
  fakeDescriptor.blocks.SINGLE.fixedBlockSeconds = 120;

  const canonical = buildWeeklyPlanTrainingMetricsPromptProjection({
    requestedDurationMinutes: 30,
  });
  const changed = buildWeeklyPlanTrainingMetricsPromptProjection(
    { requestedDurationMinutes: 30 },
    { durationDescriptor: fakeDescriptor }
  );

  assert.notEqual(changed.duration.blocks.SINGLE.formula, canonical.duration.blocks.SINGLE.formula);
  assert.equal(changed.duration.blocks.SINGLE.restIntervalMultiplier, 2);
  assert.equal(changed.duration.blocks.SINGLE.fixedBlockSeconds, 120);
  assert.equal(changed.duration.example.adjustedRestSeconds, 600);
  assert.equal(changed.duration.example.totalSeconds, 816);
  assert.notEqual(
    changed.duration.example.roundedMinutes,
    canonical.duration.example.roundedMinutes
  );
});

