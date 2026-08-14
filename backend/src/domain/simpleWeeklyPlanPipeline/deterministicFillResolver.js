const {
  SIMPLE_WEEKLY_PLAN_FILL_PROVIDER_VERSION,
  buildCanonicalProviderEntities,
} = require('./fillSchema');

// Normalization policy lives in fillNormalization.js so the legacy text path and the
// BoundPlan path share exactly one definition of every conversion rule.
const {
  DeterministicFillResolutionError,
  MACHINE_SETTING_KEYS_BY_MODALITY,
  buildCardioPrescription,
  coordinateDetails,
  countProviderScalarFields,
  deriveRestCandidates,
  fatal,
  normalizeDashes,
  normalizeTempo,
  numericBounds,
  parseDurationMinutes,
  parseRepTarget,
  parseRestSeconds,
  upperBound,
} = require('./fillNormalization');

const DETERMINISTIC_FILL_RESOLVER_VERSION = 'simple-weekly-plan-fill-resolver-v1';

function sourceField(line, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(
    `^\\s*-\\s*(?:\\*\\*)?${escapedLabel}:(?:\\*\\*)?\\s*(.*?)\\s*$`,
    'i'
  );
  return line.match(expression)?.[1]?.trim() ?? null;
}

function newExercise(exerciseId, sourceHeading) {
  return {
    exerciseId,
    raw: [],
    fieldLines: {},
    sourceHeading: String(sourceHeading || '').trim(),
  };
}

function parseInlineExercise(line) {
  const id = String(line || '').match(/\((exr?_[A-Za-z0-9_:-]+)\)/)?.[1];
  if (!id) return null;
  const exercise = newExercise(id, line);
  const text = String(line).split(':').slice(1).join(':').trim();
  const patterns = [
    ['sets', /(\d+)\s+sets?\b/i],
    ['reps', /(?:sets?\s+of\s+)(\d+(?:\s*[–—-]\s*\d+)?\s+reps?(?:\s+(?:per|each)\s+(?:side|leg|arm))?)/i],
    ['rir', /(\d+(?:\s*[–—-]\s*\d+)?)\s+RIR\b/i],
    ['rpe', /(\d+(?:\s*[–—-]\s*\d+)?)\s+RPE\b/i],
    ['tempo', /tempo\s+([0-9](?:\s*[-–—]\s*[0-9]){2,3}|[0-9]{3,4})/i],
    ['rest', /rest\s+((?:\d+(?:\.\d+)?(?:\s*[–—-]\s*\d+(?:\.\d+)?)?\s*(?:seconds?|secs?|minutes?|mins?))|none|n\/?a)/i],
    ['duration', /(?:duration\s+)?(\d+\s+(?:minutes?|mins?|seconds?|secs?))/i],
  ];
  patterns.forEach(([key, pattern]) => {
    const match = text.match(pattern);
    if (match) {
      exercise[key] = match[1].trim();
      exercise.fieldLines[key] = line.trim();
    }
  });
  const sentenceBreak = text.match(/\.\s+(.+)$/);
  if (sentenceBreak) {
    const trailing = sentenceBreak[1].trim();
    if (trailing && !/^Use targetRir\b/i.test(trailing)) {
      exercise.notes = trailing.replace(/\.$/, '').trim() + '.';
    }
  }
  return exercise;
}

function parseSourcePlan(text) {
  const lines = String(text || '').split(/\r?\n/);
  const workouts = [];
  let workout = null;
  let block = null;
  let exercise = null;
  let strengthGrouping = null;

  function closeExercise() {
    if (exercise && block) block.exercises.push(exercise);
    exercise = null;
  }

  function closeBlock() {
    closeExercise();
    if (block && workout) workout.blocks.push(block);
    block = null;
  }

  function closeWorkout() {
    closeBlock();
    if (workout) workouts.push(workout);
    workout = null;
  }

  for (const line of lines) {
    const dayHeading = line.match(/^#{1,2}\s+(Day\s+\d+\b.*)$/i);
    const workoutHeading = line.match(/^(Workout\s+\d+\b.*)$/i);
    if (dayHeading || workoutHeading) {
      closeWorkout();
      workout = { name: (dayHeading?.[1] || workoutHeading?.[1]).trim(), blocks: [] };
      strengthGrouping = null;
      continue;
    }
    if (!workout) continue;

    const compactBlock = line.match(/^\s*\d+\.\s+(SINGLE|SUPERSET|CARDIO)\s+[—-]/i);
    if (compactBlock) {
      closeBlock();
      const blockType = compactBlock[1].toUpperCase();
      block = { blockType, exercises: [], sourceHeading: line.trim() };
      strengthGrouping = blockType;
      if (blockType !== 'SUPERSET') {
        exercise = parseInlineExercise(line);
      }
      continue;
    }
    if (block?.blockType === 'SUPERSET') {
      const laneExercise = line.match(/^\s*[AB]\.\s+/i)
        ? parseInlineExercise(line)
        : null;
      if (laneExercise) {
        closeExercise();
        exercise = laneExercise;
        continue;
      }
      const afterRound = line.match(/^\s*Rest\s+(.+?after\s+(?:each\s+)?(?:pair|round).*?)\.?\s*$/i);
      if (afterRound) {
        block.afterRoundRest = afterRound[1].trim();
        block.afterRoundSourceText = line.trim();
        continue;
      }
    }

    if (/^###\s+Strength\s*$/i.test(line)) {
      closeBlock();
      strengthGrouping = null;
      continue;
    }

    const blockHeading = line.match(/^###\s+(CARDIO|Strength Block|SUPERSET Block)/i);
    if (blockHeading) {
      closeBlock();
      const label = blockHeading[1].toUpperCase();
      block = {
        blockType: label === 'CARDIO'
          ? 'CARDIO'
          : label.startsWith('SUPERSET') ? 'SUPERSET' : 'SINGLE',
        exercises: [],
        sourceHeading: line.trim(),
      };
      strengthGrouping = block.blockType;
      continue;
    }

    const compactStrengthHeading = line.match(/^\*\*(SINGLE|SUPERSET)\b.*\*\*\s*$/i);
    if (compactStrengthHeading) {
      closeBlock();
      strengthGrouping = compactStrengthHeading[1].toUpperCase();
      if (strengthGrouping === 'SUPERSET') {
        block = { blockType: 'SUPERSET', exercises: [], sourceHeading: line.trim() };
      }
      continue;
    }

    const numberedExercise = line.match(/^\s*\d+\.\s+\*\*([^*]+)\*\*\s*$/);
    if (numberedExercise && strengthGrouping) {
      if (strengthGrouping === 'SINGLE') {
        closeBlock();
        block = { blockType: 'SINGLE', exercises: [] };
      } else {
        closeExercise();
      }
      const label = numberedExercise[1].trim();
      exercise = newExercise(
        label.split(/\s+[—-]\s+/)[0].trim(),
        line
      );
      continue;
    }

    if (!block) continue;
    const id = sourceField(line, 'exerciseId');
    if (id) {
      closeExercise();
      exercise = newExercise(id.split(/\s+[—-]\s+/)[0].trim(), line);
      continue;
    }
    if (!exercise) continue;

    exercise.raw.push(line);
    for (const [label, key] of [
      ['Sets', 'sets'],
      ['Reps', 'reps'],
      ['RIR', 'rir'],
      ['Target RIR', 'rir'],
      ['RPE', 'rpe'],
      ['Target RPE', 'rpe'],
      ['Tempo', 'tempo'],
      ['Rest', 'rest'],
      ['Duration', 'duration'],
      ['Intensity', 'intensity'],
      ['Heart Rate', 'heartRate'],
      ['Heart Rate Target', 'heartRate'],
      ['Speed', 'speed'],
      ['Incline', 'incline'],
      ['Resistance', 'resistance'],
      ['Level', 'level'],
      ['Pace', 'pace'],
      ['Notes', 'notes'],
    ]) {
      const value = sourceField(line, label);
      if (value != null) {
        exercise[key] = value;
        exercise.fieldLines[key] = line.trim();
      }
    }
  }
  closeWorkout();
  return workouts;
}


function assertExactGeometry(sourceWorkouts, skeletonWorkouts) {
  if (sourceWorkouts.length !== skeletonWorkouts.length) {
    fatal('DETERMINISTIC_WORKOUT_GEOMETRY_MISMATCH', 'Source and skeleton workout counts differ', {
      received: sourceWorkouts.length,
      expected: skeletonWorkouts.length,
    });
  }
}

function resolveDeterministicWeeklyPlanFills({
  generatedPlanText,
  skeleton,
  eligibleExerciseLookup,
}) {
  if (!skeleton?.geometryHash) {
    fatal('DETERMINISTIC_GEOMETRY_HASH_MISSING', 'Skeleton geometryHash is required');
  }
  const sourceWorkouts = parseSourcePlan(generatedPlanText);
  const skeletonWorkouts = Array.isArray(skeleton.document?.workouts)
    ? skeleton.document.workouts
    : [];
  assertExactGeometry(sourceWorkouts, skeletonWorkouts);

  const entities = buildCanonicalProviderEntities(skeleton);
  const strengthExercises = [];
  const cardioExercises = [];
  const blockRests = [];
  const unresolved = [];
  const normalizationDecisions = [];
  let strengthIndex = 0;
  let cardioIndex = 0;
  let restIndex = 0;

  skeletonWorkouts.forEach((skeletonWorkout, workoutIndex) => {
    const sourceWorkout = sourceWorkouts[workoutIndex];
    if (sourceWorkout.blocks.length !== skeletonWorkout.blocks.length) {
      fatal('DETERMINISTIC_BLOCK_GEOMETRY_MISMATCH', 'Source and skeleton block counts differ', {
        ...coordinateDetails(sourceWorkout, workoutIndex, -1),
        received: sourceWorkout.blocks.length,
        expected: skeletonWorkout.blocks.length,
      });
    }

    skeletonWorkout.blocks.forEach((skeletonBlock, blockIndex) => {
      const sourceBlock = sourceWorkout.blocks[blockIndex];
      const coordinates = coordinateDetails(sourceWorkout, workoutIndex, blockIndex);
      if (sourceBlock.blockType !== skeletonBlock.blockType) {
        fatal('DETERMINISTIC_BLOCK_TYPE_MISMATCH', 'Source and skeleton block types differ', {
          ...coordinates,
          received: sourceBlock.blockType,
          expected: skeletonBlock.blockType,
        });
      }
      if (sourceBlock.exercises.length !== skeletonBlock.exercises.length) {
        fatal('DETERMINISTIC_EXERCISE_GEOMETRY_MISMATCH', 'Source and skeleton exercise counts differ', {
          ...coordinates,
          received: sourceBlock.exercises.length,
          expected: skeletonBlock.exercises.length,
        });
      }

      if (skeletonBlock.blockType === 'SUPERSET') {
        const laneRestValues = sourceBlock.exercises
          .map((entry) => entry.rest || '')
          .filter(Boolean);
        const explicitLocalRest = sourceBlock.afterRoundRest || laneRestValues
          .find((value) => /after\s+(?:the\s+|each\s+)?(?:pair|round)|after\s+\d*B\b/i.test(value));
        const afterRoundRest = parseRestSeconds(explicitLocalRest);
        if (afterRoundRest == null) {
          const allowedValues = deriveRestCandidates(laneRestValues);
          if (allowedValues.length === 0) {
            fatal(
              'DETERMINISTIC_SUPERSET_REST_CANDIDATES_MISSING',
              'SUPERSET has no valid source-supported block-rest candidate',
              {
                ...coordinates,
                sourceValues: laneRestValues,
              }
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
              blockHeading: sourceBlock.sourceHeading || null,
              exercises: sourceBlock.exercises.map((entry) => ({
                exerciseId: entry.exerciseId,
                rest: entry.rest || null,
                sourceText: entry.fieldLines?.rest || null,
              })),
            },
            reason: 'SUPERSET lane-local rest is present without explicit after-pair/after-round scope.',
          });
        }
        blockRests.push({ value: afterRoundRest });
        restIndex += 1;
      }

      sourceBlock.exercises.forEach((sourceExercise) => {
        const eligible = eligibleExerciseLookup?.[sourceExercise.exerciseId];
        const expectedType = skeletonBlock.blockType === 'CARDIO'
          ? 'cardio'
          : 'strength';
        if (!eligible) {
          fatal('DETERMINISTIC_EXERCISE_ID_INELIGIBLE', 'Source exerciseId is missing or outside the eligible pool', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
          });
        }
        if (eligible.trainingType !== expectedType) {
          fatal('DETERMINISTIC_EXERCISE_TYPE_MISMATCH', 'Eligible exercise type does not match the source block', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            received: eligible.trainingType,
            expected: expectedType,
          });
        }

        if (skeletonBlock.blockType === 'CARDIO') {
          const cardio = buildCardioPrescription(
            sourceExercise,
            eligible,
            coordinates
          );
          cardioExercises.push({
            exerciseId: sourceExercise.exerciseId,
            prescription: cardio.prescription,
            notes: sourceExercise.notes || null,
          });
          if (cardio.cardioText) {
            normalizationDecisions.push({
              ...coordinates,
              exercise: sourceExercise.exerciseId,
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
        const sourceSets = upperBound(sourceExercise.sets);
        if (sourceSets !== expectedSets) {
          fatal('DETERMINISTIC_SET_COUNT_MISMATCH', 'Source set count does not match the entity registry', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            received: sourceSets,
            expected: expectedSets,
          });
        }
        const targetRir = sourceExercise.rir ? upperBound(sourceExercise.rir) : null;
        const targetRpe = sourceExercise.rpe ? upperBound(sourceExercise.rpe) : null;
        if (targetRir != null && targetRpe != null) {
          fatal('DETERMINISTIC_RIR_RPE_CONFLICT', 'Source contains both RIR and RPE for one exercise', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
          });
        }
        const tempo = normalizeTempo(sourceExercise.tempo);
        if (tempo.unresolved) {
          fatal('DETERMINISTIC_TEMPO_UNRESOLVED', 'Tempo cannot be normalized safely', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            sourceValue: sourceExercise.tempo || null,
          });
        }
        normalizationDecisions.push({
          ...coordinates,
          exercise: sourceExercise.exerciseId,
          field: 'defaults.tempo',
          sourceValue: sourceExercise.tempo,
          resolvedValue: tempo.value,
          rule: tempo.rule,
        });

        const afterPair = /after\s+(?:the\s+|each\s+)?(?:pair|round)|after\s+\d*B\b/i.test(sourceExercise.rest || '');
        const restSeconds = afterPair && skeletonBlock.blockType === 'SUPERSET'
          ? null
          : parseRestSeconds(sourceExercise.rest);
        if (skeletonBlock.blockType !== 'SUPERSET' && !Number.isInteger(restSeconds)) {
          fatal('DETERMINISTIC_EXERCISE_REST_UNRESOLVED', 'Exercise rest cannot be normalized safely', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            sourceValue: sourceExercise.rest || null,
          });
        }
        const setTarget = parseRepTarget(sourceExercise, targetRir);
        if (!setTarget) {
          fatal('DETERMINISTIC_SET_TARGET_UNRESOLVED', 'Set target cannot be normalized safely', {
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            sourceValue: sourceExercise.reps || null,
          });
        }
        strengthExercises.push({
          exerciseId: sourceExercise.exerciseId,
          defaults: {
            tempo: tempo.value,
            restSeconds,
            targetRir,
            targetRpe,
          },
          sets: Array.from({ length: expectedSets }, () => ({ ...setTarget })),
          notes: sourceExercise.notes || null,
        });
        if (numericBounds(sourceExercise.rest).length > 1) {
          normalizationDecisions.push({
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            field: 'defaults.restSeconds',
            sourceValue: sourceExercise.rest,
            resolvedValue: restSeconds,
            rule: 'REST_RANGE_UPPER_BOUND',
          });
        }
        if (numericBounds(sourceExercise.rir).length > 1) {
          normalizationDecisions.push({
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            field: 'defaults.targetRir',
            sourceValue: sourceExercise.rir,
            resolvedValue: targetRir,
            rule: 'RIR_RANGE_UPPER_BOUND',
          });
        }
        if (setTarget.notes) {
          normalizationDecisions.push({
            ...coordinates,
            exercise: sourceExercise.exerciseId,
            field: 'sets[*].notes',
            sourceValue: sourceExercise.reps,
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
    fatal('DETERMINISTIC_ENTITY_REGISTRY_MISMATCH', 'Resolved entity counts do not match the canonical registry', {
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
  const deterministicallyResolvedFieldCount = totalFieldCount - unresolved.length;
  return {
    geometryHash: skeleton.geometryHash,
    resolverVersion: DETERMINISTIC_FILL_RESOLVER_VERSION,
    providerFills,
    totalFieldCount,
    deterministicallyResolvedFieldCount,
    unresolvedFieldCount: unresolved.length,
    fallbackRequired: unresolved.length > 0,
    fallbackEligible: unresolved.every((entry) => entry.fallbackEligible === true),
    unresolved,
    normalizationDecisions,
  };
}

module.exports = {
  DETERMINISTIC_FILL_RESOLVER_VERSION,
  DeterministicFillResolutionError,
  countProviderScalarFields,
  deriveRestCandidates,
  normalizeTempo,
  parseRepTarget,
  parseRestSeconds,
  parseSourcePlan,
  resolveDeterministicWeeklyPlanFills,
};
