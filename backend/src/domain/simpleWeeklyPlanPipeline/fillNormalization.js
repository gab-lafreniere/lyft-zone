// Deterministic normalization policy for weekly-plan fill values.
//
// This module is the single owner of every source-value conversion rule: dash
// folding, range upper bounds, unit conversion, tempo padding, rep-mode selection
// and cardio prescription shaping. Both the legacy text resolver and the BoundPlan
// resolver consume it, so the rules have exactly one definition.
//
// Nothing here reads a document. Every function takes an already-bound value.

class DeterministicFillResolutionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DeterministicFillResolutionError';
    this.code = code;
    this.details = details == null
      ? []
      : Array.isArray(details) ? details : [details];
  }
}

function fatal(code, message, details = null) {
  throw new DeterministicFillResolutionError(code, message, details);
}

function normalizeDashes(value) {
  return String(value || '').replace(/[–—]/g, '-');
}

function numericBounds(value) {
  const matches = normalizeDashes(value).match(/\d+(?:\.\d+)?/g) || [];
  return matches.map(Number).filter(Number.isFinite);
}

function upperBound(value) {
  const values = numericBounds(value);
  return values.length ? Math.max(...values) : null;
}

function parseDurationMinutes(value) {
  const minutes = String(value || '').match(/(\d+)\s*(?:minutes?|mins?)/i);
  if (minutes) return Number(minutes[1]);
  const seconds = String(value || '').match(/(\d+)\s*(?:seconds?|secs?)/i);
  return seconds ? Number(seconds[1]) / 60 : null;
}

// Rest is read as a duration, not as "the largest number times a unit guess".
//
// The previous max(numbers) x unit-factor rule corrupted compound durations:
// "1 min 5 sec" became 300 and "1:30" became 30, both inside the accepted 0..600 range
// and therefore silent. Compound and clock forms are now summed exactly; genuine
// ranges keep the approved upper-bound policy.
function parseRestSeconds(value) {
  const raw = String(value ?? '');
  if (/\b(?:none|n\/?a)\b/i.test(raw)) return null;

  const text = normalizeDashes(raw);

  // Clock notation m:ss (optionally a range of them, upper bound wins).
  const clocks = text.match(/\b(\d+):([0-5]\d)\b/g);
  if (clocks) {
    const seconds = clocks.map((clock) => {
      const [minutes, rest] = clock.split(':');
      return Number(minutes) * 60 + Number(rest);
    });
    return Math.max(...seconds);
  }

  // Compound "Xm Ys": both a minute component and a second component are present.
  const compound = text.match(
    /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b[^0-9]*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i
  );
  if (compound) {
    return Math.round(Number(compound[1]) * 60 + Number(compound[2]));
  }

  // A single unit applies to the whole expression. Mixed units without a compound
  // shape (for example "90 sec to 2 min") cannot be resolved safely.
  const hasMinutes = /\d+(?:\.\d+)?\s*(?:minutes?|mins?)\b/i.test(text);
  const hasSeconds = /\d+(?:\.\d+)?\s*(?:seconds?|secs?)\b/i.test(text);
  if (hasMinutes && hasSeconds) {
    return null;
  }

  const bound = upperBound(text);
  if (bound == null) {
    return null;
  }
  return Math.round(bound * (hasMinutes ? 60 : 1));
}

function deriveRestCandidates(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(parseRestSeconds)
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 600)
  )).sort((left, right) => left - right);
}

// Tempo is read as explicit numeric phases, never as "whatever digits remain".
//
// Stripping non-digits and padding silently deleted semantic content: "X-0-1-0" became
// "0100", shifting every phase left and inventing a terminal zero, and "3-0-X-0" became
// "3000". A phase token that is not a single digit makes the whole tempo unresolvable,
// which the domain already represents as null.
function normalizeTempo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { value: null, unresolved: true };
  }

  // A bare digit run is already phase-per-character.
  if (/^\d{3,4}$/.test(raw)) {
    const digits = raw;
    return digits.length === 4
      ? { value: digits, rule: 'TEMPO_REMOVE_SEPARATORS' }
      : { value: `${digits}0`, rule: 'TEMPO_APPEND_TERMINAL_ZERO' };
  }

  const phases = normalizeDashes(raw).split(/[-/\s]+/).filter(Boolean);
  if (phases.length !== 3 && phases.length !== 4) {
    return { value: null, unresolved: true };
  }
  // Every phase must be exactly one digit. "X", "2.5", "explosive" and any annotation
  // make the prescription unrepresentable rather than approximable.
  if (!phases.every((phase) => /^\d$/.test(phase))) {
    return { value: null, unresolved: true };
  }

  const digits = phases.join('');
  return digits.length === 4
    ? { value: digits, rule: 'TEMPO_REMOVE_SEPARATORS' }
    : { value: `${digits}0`, rule: 'TEMPO_APPEND_TERMINAL_ZERO' };
}

function parseRepTarget(exercise, targetRir) {
  const source = normalizeDashes(exercise.reps || '');
  const seconds = source.match(/(\d+)\s*(?:seconds?|secs?)/i);
  // "each side" / "per side" and the slash form "sec/side" carry the same meaning.
  const perSide = source.match(/\b(each|per)\s+(side|leg|arm)\b/i)
    || source.match(/\/\s*(side|leg|arm)\b/i);
  const notes = perSide
    ? (perSide.length === 3
      ? `${perSide[1].toLowerCase()} ${perSide[2].toLowerCase()}`
      : `per ${perSide[1].toLowerCase()}`)
    : null;
  if (seconds) {
    return { mode: 'seconds', targetSeconds: Number(seconds[1]), targetRir, notes };
  }
  const values = numericBounds(source);
  if (values.length === 1) {
    return { mode: 'reps', targetReps: values[0], targetRir, notes };
  }
  if (values.length >= 2) {
    return {
      mode: 'repRange',
      minReps: Math.min(values[0], values[1]),
      maxReps: Math.max(values[0], values[1]),
      targetRir,
      notes,
    };
  }
  return null;
}

function countProviderScalarFields(providerFills) {
  let count = 2;
  for (const exercise of providerFills.fills.strengthExercises) {
    count += 6;
    for (const set of exercise.sets) count += Object.keys(set || {}).length;
  }
  count += providerFills.fills.cardioExercises.length * 7;
  count += providerFills.fills.blockRests.length;
  return count;
}

function coordinateDetails(sourceWorkout, workoutIndex, blockIndex, exerciseId = null) {
  return {
    workout: sourceWorkout.name,
    workoutIndex: workoutIndex + 1,
    block: blockIndex + 1,
    ...(exerciseId ? { exercise: exerciseId } : {}),
  };
}

const MACHINE_SETTING_KEYS_BY_MODALITY = Object.freeze({
  treadmill_walk: ['speed', 'incline'],
  incline_treadmill_walk: ['speed', 'incline'],
  stationary_bike: ['resistance'],
  recumbent_bike: ['resistance'],
  stair_climber: ['level'],
  elliptical: ['resistance'],
  rowing_machine: ['pace'],
});

function buildCardioPrescription(sourceExercise, eligible, coordinates) {
  const durationMinutes = parseDurationMinutes(sourceExercise.duration);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    fatal('DETERMINISTIC_CARDIO_DURATION_UNRESOLVED', 'Cardio duration is not a positive integral minute value', {
      ...coordinates,
      exercise: sourceExercise.exerciseId,
      sourceValue: sourceExercise.duration || null,
    });
  }
  const cardioText = sourceExercise.heartRate || sourceExercise.intensity || sourceExercise.tempo || null;
  let heartRateTargetMode = 'none';
  let heartRateTargetValue = null;
  let notes = cardioText ? cardioText.trim() : null;
  const bpm = String(cardioText || '').match(/\b(\d{2,3})\s*(?:bpm|beats?\s+per\s+minute)\b/i);
  const zone = String(cardioText || '').match(/\bzone\s*([1-5])\b/i);
  if (bpm) {
    heartRateTargetMode = 'avg_bpm';
    heartRateTargetValue = Number(bpm[1]);
    notes = null;
  } else if (zone) {
    heartRateTargetMode = 'zone';
    heartRateTargetValue = Number(zone[1]);
    notes = null;
  }

  const allowedSettings = MACHINE_SETTING_KEYS_BY_MODALITY[eligible.cardioModality] || [];
  const machineSettings = allowedSettings
    .filter((key) => sourceExercise[key] != null)
    .map((key) => ({ key, value: sourceExercise[key] }));
  return {
    prescription: {
      durationMinutes,
      heartRateTargetMode,
      heartRateTargetValue,
      machineSettings,
      notes,
    },
    cardioText,
  };
}

module.exports = {
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
};
