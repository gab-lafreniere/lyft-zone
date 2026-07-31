const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadWeeklyPlanBuilderDoctrine,
} = require('../../src/ai/doctrines/bodybuildingDoctrineLoader');
const {
  ProgramGenerationDoctrinePromptProjectionError,
  projectProgramGenerationDoctrineContent,
} = require('../../src/domain/programGeneration/programGenerationDoctrinePromptProjection');

test('doctrine projection removes cardio for absent and none without mutating the source', () => {
  const doctrine = loadWeeklyPlanBuilderDoctrine();
  const source = doctrine.content;

  [undefined, 'none'].forEach((cardioRole) => {
    const projected = projectProgramGenerationDoctrineContent({
      content: source,
      cardioRole,
    });

    assert.doesNotMatch(projected, /### Cardio Profile Interpretation/);
    assert.doesNotMatch(projected, /Interpret the cardio role as follows/);
    assert.match(
      projected,
      /## 2\. Authoritative Inputs[\s\S]*Blocked constraints have already been applied to exercise eligibility\./
    );
    assert.match(
      projected,
      /## 20\. Final Generation Sequence[\s\S]*use only the supplied eligible exercise pool/
    );
    assert.doesNotMatch(
      projected,
      /no exercise identifier was invented|invent exercises or exercise identifiers|select exercises outside the supplied eligible pool/
    );
  });

  assert.equal(doctrine.content, source);
  assert.equal(Object.isFrozen(doctrine), true);
});

test('active cardio roles receive only their compact applicable doctrine projection', () => {
  const source = loadWeeklyPlanBuilderDoctrine().content;
  const cases = {
    warm_up_only: [
      /approximately 5 minutes at the beginning/,
      /Do not add dedicated cardio after resistance training/,
    ],
    cardio_sessions: [
      /only after the resistance-training portion/,
      /Never place dedicated cardio before resistance training/,
      /impact, local fatigue, muscular overlap, weekly placement, and recovery/,
    ],
    warm_up_and_cardio: [
      /approximately 5 minutes at the beginning/,
      /place dedicated cardio after the resistance-training portion/,
      /Never create a cardio-only workout/,
    ],
  };

  Object.entries(cases).forEach(([cardioRole, patterns]) => {
    const projected = projectProgramGenerationDoctrineContent({
      content: source,
      cardioRole,
    });

    assert.equal(
      projected.split('### Cardio Profile Interpretation').length - 1,
      1
    );
    patterns.forEach((pattern) => assert.match(projected, pattern));
    assert.doesNotMatch(projected, /Interpret the cardio role as follows/);
    assert.doesNotMatch(projected, /High-intensity interval work generally/);
  });
});

test('doctrine projection fails closed with a generic controlled error when headings are missing', () => {
  const privateContent = 'PRIVATE_DOCTRINE_CONTENT_WITHOUT_REQUIRED_HEADINGS';

  assert.throws(
    () =>
      projectProgramGenerationDoctrineContent({
        content: privateContent,
        cardioRole: 'none',
      }),
    (error) => {
      assert.equal(
        error instanceof ProgramGenerationDoctrinePromptProjectionError,
        true
      );
      assert.equal(
        error.code,
        'INVALID_PROGRAM_GENERATION_DOCTRINE_PROJECTION'
      );
      assert.equal(
        error.message,
        'Program generation doctrine projection could not be built'
      );
      assert.doesNotMatch(error.message, /PRIVATE|HEADINGS/);
      return true;
    }
  );
});
