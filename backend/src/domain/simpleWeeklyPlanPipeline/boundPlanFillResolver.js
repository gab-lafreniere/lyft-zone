const {
  SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
  buildCanonicalProviderEntities,
} = require('./fillSchema');
const {
  buildCardioPrescription,
  countProviderScalarFields,
  deriveRestCandidates,
  fatal,
  normalizeTempo,
  numericBounds,
  parseRepTarget,
  parseRestSeconds,
  upperBound,
} = require('./fillNormalization');

const BOUND_PLAN_FILL_RESOLVER_VERSION =
  'simple-weekly-plan-bound-plan-fill-resolver-v1';

// This resolver deliberately takes no generatedPlanText.
//
// The fill stage cannot re-parse a document it never receives, which is what removes
// the second interpreter of Call #1 from the pipeline. Every value here arrives
// already bound to an entity by Call #2 and already verified against the source by
// boundPlanVerification. This module only applies normalization policy.

function coordinatesFor(boundWorkout, workoutIndex, blockIndex, exerciseId = null) {
  return {
    workout: boundWorkout.name,
    workoutIndex: workoutIndex + 1,
    block: blockIndex + 1,
    ...(exerciseId ? { exercise: exerciseId } : {}),
  };
}

function cardioSourceShim(boundExercise) {
  const settings = {};
  (boundExercise.machineSettings || []).forEach((setting) => {
    if (setting?.key) {
      settings[String(setting.key).trim().toLowerCase()] = setting.value;
    }
  });
  return {
    exerciseId: boundExercise.exerciseId,
    duration: boundExercise.duration,
    intensity: boundExercise.intensity,
    heartRate: null,
    tempo: null,
    ...settings,
  };
}

// Guards against a projection bug, not against source formatting. The skeleton was
// built from this same bound plan, so a mismatch means the adapter and the resolver
// disagree about a structure they both derived from one object.
function assertProjectionConsistency(boundPlan, skeletonWorkouts) {
  const boundWorkouts = boundPlan?.workouts || [];
  if (boundWorkouts.length !== skeletonWorkouts.length) {
    fatal('BOUND_PLAN_PROJECTION_WORKOUT_MISMATCH', 'Bound plan and skeleton workout counts differ', {
      received: boundWorkouts.length,
      expected: skeletonWorkouts.length,
    });
  }
  boundWorkouts.forEach((boundWorkout, workoutIndex) => {
    const skeletonBlocks = skeletonWorkouts[workoutIndex].blocks || [];
    const boundBlocks = boundWorkout.blocks || [];
    if (boundBlocks.length !== skeletonBlocks.length) {
      fatal('BOUND_PLAN_PROJECTION_BLOCK_MISMATCH', 'Bound plan and skeleton block counts differ', {
        ...coordinatesFor(boundWorkout, workoutIndex, -1),
        received: boundBlocks.length,
        expected: skeletonBlocks.length,
      });
    }
    boundBlocks.forEach((boundBlock, blockIndex) => {
      const skeletonBlock = skeletonBlocks[blockIndex];
      const boundCount = (boundBlock.exercises || []).length;
      const skeletonCount = (skeletonBlock.exercises || []).length;
      if (
        boundBlock.type !== skeletonBlock.blockType ||
        boundCount !== skeletonCount
      ) {
        fatal('BOUND_PLAN_PROJECTION_BLOCK_SHAPE_MISMATCH', 'Bound plan and skeleton block shapes differ', {
          ...coordinatesFor(boundWorkout, workoutIndex, blockIndex),
          received: { type: boundBlock.type, exercises: boundCount },
          expected: { type: skeletonBlock.blockType, exercises: skeletonCount },
        });
      }
    });
  });
}

function resolveSupersetBlockRest({
  boundBlock,
  skeletonBlock,
  coordinates,
  restIndex,
  unresolved,
}) {
  const laneRests = (boundBlock.exercises || [])
    .map((exercise) => exercise.rest)
    .filter(Boolean);
  const roundRest = parseRestSeconds(boundBlock.restAfterRound);

  if (Number.isInteger(roundRest)) {
    return roundRest;
  }

  // Call #1 did not scope a rest to the round. The only source-supported candidates
  // are the lane-local rests it did state.
  const allowedValues = deriveRestCandidates(laneRests);
  if (allowedValues.length === 0) {
    fatal(
      'DETERMINISTIC_SUPERSET_REST_CANDIDATES_MISSING',
      'SUPERSET has no valid source-supported block-rest candidate',
      { ...coordinates, sourceValues: laneRests }
    );
  }

  unresolved.push({
    resolutionId: `blockRests[${restIndex}].value`,
    entityType: 'blockRest',
    entityIndex: restIndex,
    field: 'WorkoutBlock.restSeconds',
    expected: { type: 'integer', minimum: 0, maximum: 600 },
    allowedValues,
    blockType: 'SUPERSET',
    restStrategy: skeletonBlock.restStrategy,
    fallbackEligible: true,
    category: 'C_AI_FALLBACK',
    ...coordinates,
    localSource: {
      restAfterRound: boundBlock.restAfterRound ?? null,
      exercises: (boundBlock.exercises || []).map((exercise) => ({
        exerciseId: exercise.exerciseId,
        rest: exercise.rest ?? null,
      })),
    },
    reason: 'SUPERSET lane-local rest is present without an explicit round-scoped rest.',
  });
  return null;
}

function resolveLaneRestSeconds({
  boundExercise,
  boundBlock,
  isSuperset,
  coordinates,
  normalizationDecisions,
}) {
  if (!isSuperset) {
    const restSeconds = parseRestSeconds(boundExercise.rest);
    if (!Number.isInteger(restSeconds)) {
      fatal('DETERMINISTIC_EXERCISE_REST_UNRESOLVED', 'Exercise rest cannot be normalized safely', {
        ...coordinates,
        sourceValue: boundExercise.rest || null,
      });
    }
    return restSeconds;
  }

  if (boundExercise.rest == null) {
    return null;
  }

  const laneRest = parseRestSeconds(boundExercise.rest);
  const roundRest = parseRestSeconds(boundBlock.restAfterRound);

  // A lane that merely restates the round rest is not an exercise-scoped rest. The
  // duration engine reads block.restSeconds as the sole SUPERSET round-rest source,
  // so keeping the duplicate here would double-count it.
  if (Number.isInteger(laneRest) && laneRest === roundRest) {
    normalizationDecisions.push({
      ...coordinates,
      field: 'defaults.restSeconds',
      sourceValue: boundExercise.rest,
      resolvedValue: null,
      rule: 'SUPERSET_LANE_REST_DUPLICATES_ROUND_REST',
    });
    return null;
  }
  return Number.isInteger(laneRest) ? laneRest : null;
}

function resolveBoundPlanWeeklyPlanFills({
  boundPlan,
  skeleton,
  eligibleExerciseLookup,
}) {
  if (!skeleton?.geometryHash) {
    fatal('DETERMINISTIC_GEOMETRY_HASH_MISSING', 'Skeleton geometryHash is required');
  }
  const skeletonWorkouts = Array.isArray(skeleton.document?.workouts)
    ? skeleton.document.workouts
    : [];
  assertProjectionConsistency(boundPlan, skeletonWorkouts);

  const entities = buildCanonicalProviderEntities(skeleton);
  const strengthExercises = [];
  const cardioExercises = [];
  const blockRests = [];
  const unresolved = [];
  const normalizationDecisions = [];
  let strengthIndex = 0;
  let cardioIndex = 0;
  let restIndex = 0;

  boundPlan.workouts.forEach((boundWorkout, workoutIndex) => {
    const skeletonWorkout = skeletonWorkouts[workoutIndex];

    boundWorkout.blocks.forEach((boundBlock, blockIndex) => {
      const skeletonBlock = skeletonWorkout.blocks[blockIndex];
      const blockCoordinates = coordinatesFor(boundWorkout, workoutIndex, blockIndex);
      const isSuperset = skeletonBlock.blockType === 'SUPERSET';

      // Canonical entity order pushes a SUPERSET block rest before that block's
      // exercises, matching buildCanonicalProviderEntities.
      if (isSuperset) {
        blockRests.push({
          value: resolveSupersetBlockRest({
            boundBlock,
            skeletonBlock,
            coordinates: blockCoordinates,
            restIndex,
            unresolved,
          }),
        });
        restIndex += 1;
      }

      boundBlock.exercises.forEach((boundExercise) => {
        const coordinates = coordinatesFor(
          boundWorkout,
          workoutIndex,
          blockIndex,
          boundExercise.exerciseId
        );
        const eligible = eligibleExerciseLookup?.[boundExercise.exerciseId];
        if (!eligible) {
          fatal('DETERMINISTIC_EXERCISE_ID_INELIGIBLE', 'Bound exerciseId is outside the eligible pool', coordinates);
        }

        if (skeletonBlock.blockType === 'CARDIO') {
          const cardio = buildCardioPrescription(
            cardioSourceShim(boundExercise),
            eligible,
            coordinates
          );
          cardioExercises.push({
            exerciseId: boundExercise.exerciseId,
            prescription: cardio.prescription,
            notes: boundExercise.notes || null,
          });
          if (cardio.cardioText) {
            normalizationDecisions.push({
              ...coordinates,
              field: 'cardioPrescription',
              sourceValue: cardio.cardioText,
              resolvedValue: cardio.prescription.heartRateTargetMode,
              rule: cardio.prescription.heartRateTargetMode === 'none'
                ? 'CARDIO_CONVERSATIONAL_INTENSITY_TO_NOTES'
                : 'CARDIO_EXPLICIT_HEART_RATE_TARGET',
            });
          }
          cardioIndex += 1;
          return;
        }

        const entity = entities.strengthExercises[strengthIndex];
        const expectedSets = entity.setSlots.length;
        if (boundExercise.sets !== expectedSets) {
          fatal('BOUND_PLAN_PROJECTION_SET_COUNT_MISMATCH', 'Bound set count does not match the entity registry', {
            ...coordinates,
            received: boundExercise.sets,
            expected: expectedSets,
          });
        }

        let targetRir = boundExercise.rir ? upperBound(boundExercise.rir) : null;
        let targetRpe = boundExercise.rpe ? upperBound(boundExercise.rpe) : null;
        // Product decision D2: RIR is the product's primary intensity currency and the
        // Call #1 prompt asks for it by name, so RIR wins and RPE is dropped with a
        // recorded decision instead of failing the whole generation.
        if (targetRir != null && targetRpe != null) {
          normalizationDecisions.push({
            ...coordinates,
            field: 'defaults.targetRpe',
            sourceValue: boundExercise.rpe,
            resolvedValue: null,
            rule: 'RIR_PRECEDENCE_OVER_RPE',
          });
          targetRpe = null;
        }

        // A qualitative or malformed tempo such as "controlled" is an absence, not an
        // ambiguity: the domain represents unspecified tempo as null and applies its own
        // presentation default downstream. Asking AI for a number here would invent a
        // coaching value the coach never prescribed.
        const tempo = normalizeTempo(boundExercise.tempo);
        normalizationDecisions.push({
          ...coordinates,
          field: 'defaults.tempo',
          sourceValue: boundExercise.tempo ?? null,
          resolvedValue: tempo.value,
          rule: tempo.unresolved ? 'TEMPO_UNSPECIFIED_TO_NULL' : tempo.rule,
        });

        const restSeconds = resolveLaneRestSeconds({
          boundExercise,
          boundBlock,
          isSuperset,
          coordinates,
          normalizationDecisions,
        });

        const setTarget = parseRepTarget(boundExercise, targetRir);
        if (!setTarget) {
          fatal('DETERMINISTIC_SET_TARGET_UNRESOLVED', 'Set target cannot be normalized safely', {
            ...coordinates,
            sourceValue: boundExercise.reps || null,
          });
        }

        strengthExercises.push({
          exerciseId: boundExercise.exerciseId,
          defaults: {
            tempo: tempo.value,
            restSeconds,
            targetRir,
            targetRpe,
          },
          sets: Array.from({ length: expectedSets }, () => ({ ...setTarget })),
          notes: boundExercise.notes || null,
        });

        if (numericBounds(boundExercise.rest).length > 1) {
          normalizationDecisions.push({
            ...coordinates,
            field: 'defaults.restSeconds',
            sourceValue: boundExercise.rest,
            resolvedValue: restSeconds,
            rule: 'REST_RANGE_UPPER_BOUND',
          });
        }
        if (numericBounds(boundExercise.rir).length > 1) {
          normalizationDecisions.push({
            ...coordinates,
            field: 'defaults.targetRir',
            sourceValue: boundExercise.rir,
            resolvedValue: targetRir,
            rule: 'RIR_RANGE_UPPER_BOUND',
          });
        }
        if (setTarget.notes) {
          normalizationDecisions.push({
            ...coordinates,
            field: 'sets[*].notes',
            sourceValue: boundExercise.reps,
            resolvedValue: setTarget.notes,
            rule: 'PRESERVE_PER_SIDE_QUALIFIER',
          });
        }
        strengthIndex += 1;
      });
    });
  });

  if (
    strengthIndex !== entities.strengthExercises.length ||
    cardioIndex !== entities.cardioExercises.length ||
    restIndex !== entities.blockRests.length
  ) {
    fatal('BOUND_PLAN_ENTITY_REGISTRY_MISMATCH', 'Resolved entity counts do not match the canonical registry', {
      strength: { received: strengthIndex, expected: entities.strengthExercises.length },
      cardio: { received: cardioIndex, expected: entities.cardioExercises.length },
      blockRest: { received: restIndex, expected: entities.blockRests.length },
    });
  }

  const providerFills = {
    schemaVersion: SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
    geometryHash: skeleton.geometryHash,
    fills: { strengthExercises, cardioExercises, blockRests },
  };
  const totalFieldCount = countProviderScalarFields(providerFills);

  return {
    geometryHash: skeleton.geometryHash,
    resolverVersion: BOUND_PLAN_FILL_RESOLVER_VERSION,
    providerFills,
    totalFieldCount,
    deterministicallyResolvedFieldCount: totalFieldCount - unresolved.length,
    unresolvedFieldCount: unresolved.length,
    fallbackRequired: unresolved.length > 0,
    fallbackEligible: unresolved.every((entry) => entry.fallbackEligible === true),
    unresolved,
    normalizationDecisions,
  };
}

module.exports = {
  BOUND_PLAN_FILL_RESOLVER_VERSION,
  resolveBoundPlanWeeklyPlanFills,
};
