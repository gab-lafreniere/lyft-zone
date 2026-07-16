const fs = require('node:fs');
const path = require('node:path');

const WEEKLY_PLAN_BUILDER_DOCTRINE_ID = 'bodybuilding_runtime_classic';
const WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION =
  'bodybuilding-hypertrophy-runtime-classic-v1.0.0';
const WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION =
  'bodybuilding-hypertrophy-v1.0.0';

const DOCTRINE_REGISTRY = Object.freeze({
  [WEEKLY_PLAN_BUILDER_DOCTRINE_ID]: Object.freeze({
    id: WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
    fileName: 'bodybuildingDoctrine.runtime.classic.v1.md',
    version: WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
    derivedFromDoctrineVersion: WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
  }),
});

class BodybuildingDoctrineLoaderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BodybuildingDoctrineLoaderError';
    this.code = code;
  }
}

function extractTopLevelMetadata(content) {
  const metadata = {};
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      break;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (match) {
      metadata[match[1]] = match[2];
    }
  }

  return metadata;
}

function assertExpectedMetadata(metadata, definition) {
  if (!metadata.runtimeVersion) {
    throw new BodybuildingDoctrineLoaderError(
      'DOCTRINE_METADATA_MISSING',
      'Weekly plan builder doctrine runtimeVersion metadata is missing'
    );
  }

  if (metadata.runtimeVersion !== definition.version) {
    throw new BodybuildingDoctrineLoaderError(
      'DOCTRINE_RUNTIME_VERSION_MISMATCH',
      'Weekly plan builder doctrine runtimeVersion is invalid'
    );
  }

  if (!metadata.derivedFromDoctrine) {
    throw new BodybuildingDoctrineLoaderError(
      'DOCTRINE_METADATA_MISSING',
      'Weekly plan builder doctrine derivedFromDoctrine metadata is missing'
    );
  }

  if (metadata.derivedFromDoctrine !== definition.derivedFromDoctrineVersion) {
    throw new BodybuildingDoctrineLoaderError(
      'DOCTRINE_DERIVATION_MISMATCH',
      'Weekly plan builder doctrine derivedFromDoctrine metadata is invalid'
    );
  }
}

function createBodybuildingDoctrineLoader(options = {}) {
  const readFileSync = options.readFileSync || fs.readFileSync;
  let cachedWeeklyPlanBuilderDoctrine = null;

  function loadRegisteredDoctrine(doctrineId) {
    const definition = DOCTRINE_REGISTRY[doctrineId];

    if (!definition) {
      throw new BodybuildingDoctrineLoaderError(
        'DOCTRINE_NOT_ALLOWED',
        'Requested bodybuilding doctrine is not allowed'
      );
    }

    let content;
    try {
      content = readFileSync(path.join(__dirname, definition.fileName), 'utf8');
    } catch (_error) {
      throw new BodybuildingDoctrineLoaderError(
        'DOCTRINE_FILE_UNAVAILABLE',
        'Weekly plan builder doctrine file is unavailable'
      );
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new BodybuildingDoctrineLoaderError(
        'DOCTRINE_CONTENT_EMPTY',
        'Weekly plan builder doctrine content is empty'
      );
    }

    const metadata = extractTopLevelMetadata(content);
    assertExpectedMetadata(metadata, definition);

    return Object.freeze({
      id: definition.id,
      version: definition.version,
      derivedFromDoctrineVersion: definition.derivedFromDoctrineVersion,
      content,
    });
  }

  function loadWeeklyPlanBuilderDoctrine() {
    if (!cachedWeeklyPlanBuilderDoctrine) {
      cachedWeeklyPlanBuilderDoctrine = loadRegisteredDoctrine(
        WEEKLY_PLAN_BUILDER_DOCTRINE_ID
      );
    }

    return cachedWeeklyPlanBuilderDoctrine;
  }

  return Object.freeze({
    loadWeeklyPlanBuilderDoctrine,
  });
}

const defaultLoader = createBodybuildingDoctrineLoader();

function loadWeeklyPlanBuilderDoctrine() {
  return defaultLoader.loadWeeklyPlanBuilderDoctrine();
}

module.exports = {
  BodybuildingDoctrineLoaderError,
  WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
  WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
  WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
  createBodybuildingDoctrineLoader,
  loadWeeklyPlanBuilderDoctrine,
};
