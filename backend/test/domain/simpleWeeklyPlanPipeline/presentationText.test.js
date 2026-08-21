const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FALLBACK_PROGRESSION,
  FALLBACK_TITLE,
  sanitizePresentationText,
  validateCoachingNote,
  validateProgression,
  validateSummary,
  validateTitle,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/presentationText');

test('sanitizer removes presentation noise without deleting meaningful separators', () => {
  assert.equal(
    sanitizePresentationText(
      '  • **Upper chest** + __upper back__ — “controlled” `work`  '
    ),
    'Upper chest + upper back - "controlled" work'
  );
  assert.equal(sanitizePresentationText('* Keep reps clean.'), 'Keep reps clean.');
  assert.equal(sanitizePresentationText(null), '');
});

test('title validator enforces word and character bounds without truncating', () => {
  assert.deepEqual(validateTitle('Balanced Hypertrophy'), {
    ok: true,
    value: 'Balanced Hypertrophy',
  });
  assert.equal(validateTitle('Short').ok, false);
  assert.equal(validateTitle('One two three four five six seven eight nine').ok, false);

  const overlong = `Two ${'x'.repeat(68)}`;
  const result = validateTitle(overlong);
  assert.equal(result.ok, false);
  assert.equal(result.value, overlong);
});

test('summary validator requires one complete sentence within 40-220 characters', () => {
  assert.equal(
    validateSummary(
      'This plan distributes focused hypertrophy work evenly across the training week.'
    ).ok,
    true
  );
  assert.equal(validateSummary('Too short.').ok, false);
  assert.equal(
    validateSummary(
      'This first sentence is long enough to pass. This second sentence makes it invalid.'
    ).ok,
    false
  );
  assert.equal(
    validateSummary('This otherwise complete presentation line ends on a dangling label:').ok,
    false
  );
});

test('progression validator accepts one or two complete sentences within 40-300 characters', () => {
  assert.equal(
    validateProgression(
      'Add reps with stable technique. Increase load after reaching the top of the range.'
    ).ok,
    true
  );
  assert.equal(
    validateProgression(
      'First build reps with control. Then add load carefully. Keep repeating the process.'
    ).ok,
    false
  );
});

test('coaching note validator rejects fragments and never returns a truncated value', () => {
  const valid = 'Keep every repetition controlled and use the same range of motion.';
  assert.deepEqual(validateCoachingNote(valid), { ok: true, value: valid });

  const overlong = `${'Maintain precise technique throughout the full movement. '.repeat(4)}`.trim();
  const result = validateCoachingNote(overlong);
  assert.equal(result.ok, false);
  assert.equal(result.value, overlong);
  assert.equal(result.value.endsWith('movement.'), true);
});

test('fallback constants satisfy their own validators', () => {
  assert.equal(validateTitle(FALLBACK_TITLE).ok, true);
  assert.equal(validateProgression(FALLBACK_PROGRESSION).ok, true);
});
