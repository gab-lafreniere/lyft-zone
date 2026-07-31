const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BodybuildingDoctrineLoaderError,
  WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION,
  WEEKLY_PLAN_BUILDER_DOCTRINE_ID,
  WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION,
  createBodybuildingDoctrineLoader,
  loadWeeklyPlanBuilderDoctrine,
} = require('../../src/ai/doctrines/bodybuildingDoctrineLoader');

function createValidDoctrineContent(overrides = {}) {
  const runtimeVersion = Object.prototype.hasOwnProperty.call(overrides, 'runtimeVersion')
    ? overrides.runtimeVersion
    : WEEKLY_PLAN_BUILDER_DOCTRINE_VERSION;
  const derivedFromDoctrine = Object.prototype.hasOwnProperty.call(
    overrides,
    'derivedFromDoctrine'
  )
    ? overrides.derivedFromDoctrine
    : WEEKLY_PLAN_BUILDER_DERIVED_FROM_DOCTRINE_VERSION;

  return [
    '# Lyft Zone Bodybuilding Runtime Doctrine',
    runtimeVersion == null ? null : `runtimeVersion: ${runtimeVersion}`,
    derivedFromDoctrine == null
      ? null
      : `derivedFromDoctrine: ${derivedFromDoctrine}`,
    'outputTarget: static-weekly-plan',
    '',
    'Classic runtime fixture.',
  ]
    .filter((line) => line != null)
    .join('\n');
}

test('loadWeeklyPlanBuilderDoctrine loads exactly the allowlisted classic runtime', () => {
  const doctrine = loadWeeklyPlanBuilderDoctrine();

  assert.equal(doctrine.id, 'bodybuilding_runtime_classic');
  assert.equal(
    doctrine.version,
    'bodybuilding-hypertrophy-runtime-classic-v1.0.2'
  );
  assert.equal(
    doctrine.derivedFromDoctrineVersion,
    'bodybuilding-hypertrophy-v1.0.0'
  );
  assert.match(doctrine.content, /^# Lyft Zone Bodybuilding Runtime Doctrine/m);
  assert.ok(doctrine.content.trim().length > 0);
  assert.doesNotMatch(doctrine.content, /\uFFFD/);
  assert.doesNotMatch(
    doctrine.content,
    /bodybuilding-hypertrophy-runtime-longitudinal-v1\.0\.0/
  );
  assert.doesNotMatch(
    doctrine.content,
    /bodybuildingDoctrine\.runtime\.longitudinal\.v1\.md/
  );
  assert.doesNotMatch(
    doctrine.content,
    /Lyft Zone Longitudinal Bodybuilding Runtime Doctrine/
  );
  assert.match(doctrine.content, /^supportedPrimaryGoals: hypertrophy$/m);
  assert.doesNotMatch(doctrine.content, /^supportedPrimaryGoals:.*mixed/m);
  assert.doesNotMatch(doctrine.content, /mixed-goal programs|mixed program/i);
});

test('classic runtime defines every AI Weekly Plan Builder cardio role without cardio-only ambiguity', () => {
  const doctrine = loadWeeklyPlanBuilderDoctrine();
  const content = doctrine.content;

  assert.match(
    content,
    /`None`: do not add any CARDIO block or generate any cardio\s+exercise/
  );
  assert.match(
    content,
    /`Warm-up Only`: add only brief, light preparatory cardio of\s+approximately 5 minutes at the beginning of relevant workouts;\s+do not add dedicated cardio after resistance training/
  );
  assert.match(
    content,
    /`Cardio Sessions`: despite the historical enum name, add a\s+dedicated cardio block only after the resistance-training portion\s+of relevant workouts when available time permits; never create a\s+cardio-only workout and never place dedicated cardio before\s+resistance training/
  );
  assert.match(
    content,
    /`Warm-up & Cardio`: add both brief, light preparatory cardio of\s+approximately 5 minutes at the beginning of relevant workouts and\s+dedicated cardio after the resistance-training portion; never\s+create a cardio-only workout/
  );
  assert.match(
    content,
    /does not create separate cardio sessions or an\s+independent cardio frequency/
  );
  assert.doesNotMatch(
    content,
    /account for dedicated cardio sessions when\s+they are explicitly included/
  );
  assert.doesNotMatch(
    content,
    /account for both preparatory cardio and\s+explicitly requested dedicated cardio sessions/
  );
});

test('the weekly plan wrapper has no selector API and caches one UTF-8 read', () => {
  let readCount = 0;
  let requestedEncoding = null;
  const loader = createBodybuildingDoctrineLoader({
    readFileSync: (_filePath, encoding) => {
      readCount += 1;
      requestedEncoding = encoding;
      return createValidDoctrineContent();
    },
  });

  const first = loader.loadWeeklyPlanBuilderDoctrine();
  const second = loader.loadWeeklyPlanBuilderDoctrine();

  assert.deepEqual(Object.keys(loader), ['loadWeeklyPlanBuilderDoctrine']);
  assert.equal(loader.loadWeeklyPlanBuilderDoctrine.length, 0);
  assert.equal(first, second);
  assert.equal(first.id, WEEKLY_PLAN_BUILDER_DOCTRINE_ID);
  assert.equal(requestedEncoding, 'utf8');
  assert.equal(readCount, 1);
});

const invalidDoctrineCases = [
  {
    name: 'missing file',
    readFileSync: () => {
      throw new Error('/private/secret/bodybuildingDoctrine.runtime.classic.v1.md');
    },
    code: 'DOCTRINE_FILE_UNAVAILABLE',
  },
  {
    name: 'empty content',
    readFileSync: () => '   \n',
    code: 'DOCTRINE_CONTENT_EMPTY',
  },
  {
    name: 'missing runtimeVersion',
    readFileSync: () => createValidDoctrineContent({ runtimeVersion: null }),
    code: 'DOCTRINE_METADATA_MISSING',
  },
  {
    name: 'mismatched runtimeVersion',
    readFileSync: () =>
      createValidDoctrineContent({ runtimeVersion: 'unexpected-runtime-v9' }),
    code: 'DOCTRINE_RUNTIME_VERSION_MISMATCH',
  },
  {
    name: 'missing derivedFromDoctrine',
    readFileSync: () => createValidDoctrineContent({ derivedFromDoctrine: null }),
    code: 'DOCTRINE_METADATA_MISSING',
  },
  {
    name: 'mismatched derivedFromDoctrine',
    readFileSync: () =>
      createValidDoctrineContent({ derivedFromDoctrine: 'unexpected-doctrine-v9' }),
    code: 'DOCTRINE_DERIVATION_MISMATCH',
  },
];

invalidDoctrineCases.forEach(({ name, readFileSync, code }) => {
  test(`loader returns a controlled error for ${name}`, () => {
    const loader = createBodybuildingDoctrineLoader({ readFileSync });

    assert.throws(
      () => loader.loadWeeklyPlanBuilderDoctrine(),
      (error) => {
        assert.equal(error instanceof BodybuildingDoctrineLoaderError, true);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /\/Users\//);
        assert.doesNotMatch(error.message, /\/private\/secret/);
        assert.doesNotMatch(error.message, /bodybuildingDoctrine\.runtime/);
        return true;
      }
    );
  });
});
