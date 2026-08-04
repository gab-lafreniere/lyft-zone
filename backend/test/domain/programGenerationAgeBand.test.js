const test = require('node:test');
const assert = require('node:assert/strict');

const { formatAgeBand } = require('../../src/domain/programGeneration/ageBand');

test('age bands use under, early, and late groupings across supported ages', () => {
  assert.equal(formatAgeBand(18), 'under 20');
  assert.equal(formatAgeBand(19), 'under 20');
  assert.equal(formatAgeBand(20), 'in their early 20s');
  assert.equal(formatAgeBand(24), 'in their early 20s');
  assert.equal(formatAgeBand(25), 'in their late 20s');
  assert.equal(formatAgeBand(29), 'in their late 20s');
  assert.equal(formatAgeBand(30), 'in their early 30s');
  assert.equal(formatAgeBand(35), 'in their late 30s');
  assert.equal(formatAgeBand(100), 'in their early 100s');
});

test('age bands reject unsupported and non-integer values', () => {
  [17, 101, 29.5, '29', null].forEach((value) => {
    assert.equal(formatAgeBand(value), null);
  });
});
