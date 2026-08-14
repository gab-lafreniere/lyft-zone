const FILL_FALLBACK_SCHEMA_VERSION = 1;
const FILL_FALLBACK_FORMAT_NAME = 'simple_weekly_plan_fill_fallback_v1';

class WeeklyPlanFillFallbackError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'WeeklyPlanFillFallbackError';
    this.code = code;
    this.details = details == null
      ? []
      : Array.isArray(details) ? details : [details];
  }
}

function fail(code, message, details = null) {
  throw new WeeklyPlanFillFallbackError(code, message, details);
}

function assertAllowedValues(entry = {}) {
  const expected = entry.expected || {};
  const allowedValues = entry.allowedValues;
  if (
    expected.type !== 'integer' ||
    !Number.isInteger(expected.minimum) ||
    !Number.isInteger(expected.maximum) ||
    !Array.isArray(allowedValues) ||
    allowedValues.length === 0 ||
    new Set(allowedValues).size !== allowedValues.length ||
    allowedValues.some((value) =>
      !Number.isInteger(value) ||
      value < expected.minimum ||
      value > expected.maximum
    )
  ) {
    fail(
      'INVALID_FILL_FALLBACK_ALLOWED_VALUES',
      'Unresolved field does not have a valid source-supported candidate allowlist',
      { resolutionId: entry.resolutionId || null, expected, allowedValues }
    );
  }
  return allowedValues;
}


function buildValueSchema(entry) {
  const allowedValues = assertAllowedValues(entry);
  return allowedValues.length === 1
    ? { type: 'integer', const: allowedValues[0] }
    : { type: 'integer', enum: [...allowedValues] };
}

function isAcceptedFallbackValue(entry, value) {
  const expected = entry.expected;
  return (
    Number.isInteger(value) &&
    value >= expected.minimum &&
    value <= expected.maximum &&
    assertAllowedValues(entry).includes(value)
  );
}

function buildResolutionVariant(entry) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resolutionId', 'value'],
    properties: {
      resolutionId: { type: 'string', const: entry.resolutionId },
      value: buildValueSchema(entry),
    },
  };
}

function buildWeeklyPlanFillFallbackRequest({ geometryHash, unresolved }) {
  if (!Array.isArray(unresolved) || unresolved.length === 0) {
    fail('EMPTY_FILL_FALLBACK_REQUEST', 'At least one unresolved field is required');
  }
  if (unresolved.some((entry) => entry.fallbackEligible !== true)) {
    fail('INELIGIBLE_FILL_FALLBACK_REQUEST', 'All unresolved fields must be fallback eligible');
  }
  const ids = unresolved.map((entry) => entry.resolutionId);
  if (new Set(ids).size !== ids.length) {
    fail('DUPLICATE_FILL_FALLBACK_REQUEST_ID', 'Fallback request resolutionIds must be unique');
  }

  const payload = {
    schemaVersion: FILL_FALLBACK_SCHEMA_VERSION,
    geometryHash,
    unresolved: unresolved.map((entry) => ({
      resolutionId: entry.resolutionId,
      entityType: entry.entityType,
      entityIndex: entry.entityIndex,
      field: entry.field,
      expected: entry.expected,
      allowedValues: assertAllowedValues(entry),
      blockType: entry.blockType,
      restStrategy: entry.restStrategy,
      localSource: entry.localSource,
    })),
  };
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'geometryHash', 'resolutions'],
    properties: {
      schemaVersion: {
        type: 'integer',
        const: FILL_FALLBACK_SCHEMA_VERSION,
      },
      geometryHash: { type: 'string', const: geometryHash },
      resolutions: {
        type: 'array',
        minItems: unresolved.length,
        maxItems: unresolved.length,
        items: { anyOf: unresolved.map(buildResolutionVariant) },
      },
    },
  };
  const systemMessage = [
    'Resolve only the explicitly requested ambiguous training-plan fields from their supplied local source context.',
    'Make the smallest faithful interpretation necessary for each requested canonical field.',
    'Do not redesign, coach, choose or substitute exercises, modify geometry or set counts, change any resolved value, or add/remove fields.',
    'Return exactly one resolution for every requested resolutionId and no others.',
  ].join(' ');

  return {
    formatName: FILL_FALLBACK_FORMAT_NAME,
    schema,
    systemMessage,
    userMessage: JSON.stringify(payload),
    payload,
  };
}

function validateWeeklyPlanFillFallbackOutput({ output, geometryHash, unresolved }) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    fail('INVALID_FILL_FALLBACK_OUTPUT', 'Fallback output must be an object');
  }
  const rootKeys = Object.keys(output).sort();
  const expectedRootKeys = ['geometryHash', 'resolutions', 'schemaVersion'];
  if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) {
    fail('INVALID_FILL_FALLBACK_OUTPUT_SHAPE', 'Fallback output contains missing or extra root fields', {
      received: rootKeys,
      expected: expectedRootKeys,
    });
  }
  if (output.schemaVersion !== FILL_FALLBACK_SCHEMA_VERSION) {
    fail('FILL_FALLBACK_VERSION_MISMATCH', 'Fallback schemaVersion is invalid');
  }
  if (output.geometryHash !== geometryHash) {
    fail('FILL_FALLBACK_GEOMETRY_HASH_MISMATCH', 'Fallback geometryHash does not match the skeleton');
  }
  if (!Array.isArray(output.resolutions)) {
    fail('INVALID_FILL_FALLBACK_RESOLUTIONS', 'Fallback resolutions must be an array');
  }
  if (output.resolutions.length !== unresolved.length) {
    fail('FILL_FALLBACK_RESOLUTION_COUNT_MISMATCH', 'Fallback resolution count is invalid', {
      received: output.resolutions.length,
      expected: unresolved.length,
    });
  }

  const requestedById = new Map(unresolved.map((entry) => [entry.resolutionId, entry]));
  const valuesById = new Map();
  output.resolutions.forEach((resolution) => {
    if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
      fail('INVALID_FILL_FALLBACK_RESOLUTION', 'Each fallback resolution must be an object');
    }
    const keys = Object.keys(resolution).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['resolutionId', 'value'])) {
      fail('INVALID_FILL_FALLBACK_RESOLUTION_SHAPE', 'Fallback resolution contains missing or extra fields', {
        resolutionId: resolution.resolutionId || null,
        received: keys,
      });
    }
    const entry = requestedById.get(resolution.resolutionId);
    if (!entry) {
      fail('EXTRA_FILL_FALLBACK_RESOLUTION_ID', 'Fallback returned an unrequested resolutionId', {
        resolutionId: resolution.resolutionId,
      });
    }
    if (valuesById.has(resolution.resolutionId)) {
      fail('DUPLICATE_FILL_FALLBACK_RESOLUTION_ID', 'Fallback returned a duplicate resolutionId', {
        resolutionId: resolution.resolutionId,
      });
    }
    if (!isAcceptedFallbackValue(entry, resolution.value)) {
      fail('INVALID_FILL_FALLBACK_VALUE', 'Fallback value does not match the requested field constraints', {
        resolutionId: resolution.resolutionId,
        received: resolution.value,
        expected: entry.expected,
      });
    }
    valuesById.set(resolution.resolutionId, resolution.value);
  });

  const missing = unresolved
    .map((entry) => entry.resolutionId)
    .filter((resolutionId) => !valuesById.has(resolutionId));
  if (missing.length) {
    fail('MISSING_FILL_FALLBACK_RESOLUTION_ID', 'Fallback omitted requested resolutionIds', { missing });
  }
  return valuesById;
}

// Every mergeable field is allowlisted here by exact resolutionId shape. A fallback
// response can only ever write into one of these slots, and only when that slot is
// still null, so the model can never rewrite a value the backend already resolved.
const FILL_FALLBACK_MERGE_TARGETS = Object.freeze([
  {
    pattern: /^blockRests\[(\d+)]\.value$/,
    entityType: 'blockRest',
    field: 'WorkoutBlock.restSeconds',
    read: (fills, index) => fills?.blockRests?.[index]?.value,
    exists: (fills, index) => Boolean(fills?.blockRests?.[index]),
    write: (fills, index, value) => {
      fills.blockRests[index].value = value;
    },
    remaining: (fills) => (fills.blockRests || [])
      .map((entry, index) => (entry.value == null ? `blockRests[${index}].value` : null))
      .filter(Boolean),
  },
]);

function resolveMergeTarget(entry) {
  for (const target of FILL_FALLBACK_MERGE_TARGETS) {
    const match = entry.resolutionId.match(target.pattern);
    if (
      match &&
      entry.entityType === target.entityType &&
      entry.field === target.field
    ) {
      return { target, index: Number(match[1]) };
    }
  }
  return fail(
    'UNSUPPORTED_FILL_FALLBACK_MERGE_TARGET',
    'Fallback merge target is not allowlisted',
    { resolutionId: entry.resolutionId }
  );
}

function mergeWeeklyPlanFillFallback({ providerFills, unresolved, fallbackOutput }) {
  const valuesById = validateWeeklyPlanFillFallbackOutput({
    output: fallbackOutput,
    geometryHash: providerFills.geometryHash,
    unresolved,
  });
  const merged = structuredClone(providerFills);

  unresolved.forEach((entry) => {
    const { target, index } = resolveMergeTarget(entry);
    if (
      index !== entry.entityIndex ||
      !target.exists(merged.fills, index) ||
      target.read(merged.fills, index) !== null
    ) {
      fail('INVALID_FILL_FALLBACK_MERGE_TARGET', 'Fallback merge target is missing or already resolved', {
        resolutionId: entry.resolutionId,
      });
    }
    target.write(merged.fills, index, valuesById.get(entry.resolutionId));
  });

  const remaining = FILL_FALLBACK_MERGE_TARGETS
    .flatMap((target) => target.remaining(merged.fills));
  if (remaining.length) {
    fail('FILL_FALLBACK_UNRESOLVED_REMAINS', 'Required unresolved values remain after fallback merge', { remaining });
  }
  return merged;
}

module.exports = {
  FILL_FALLBACK_FORMAT_NAME,
  FILL_FALLBACK_SCHEMA_VERSION,
  WeeklyPlanFillFallbackError,
  buildWeeklyPlanFillFallbackRequest,
  mergeWeeklyPlanFillFallback,
  validateWeeklyPlanFillFallbackOutput,
};
