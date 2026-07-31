const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSimpleWeeklyPlanFillProviderSchema,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/fillSchema');

function collectConstNodes(value, path = '$', result = []) {
  if (!value || typeof value !== 'object') {
    return result;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'const')) {
    result.push({ path, node: value });
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectConstNodes(item, `${path}/${index}`, result)
    );
    return result;
  }
  Object.entries(value).forEach(([key, child]) =>
    collectConstNodes(child, `${path}/${key}`, result)
  );
  return result;
}

test('fill provider schema explicitly types every const across all anyOf variants', () => {
  const geometryHash = `sha256:${'a'.repeat(64)}`;
  const schema = buildSimpleWeeklyPlanFillProviderSchema({
    geometryHash,
    slots: [{ id: 'w1.b1.e1.id' }],
  });
  const constNodes = collectConstNodes(schema);
  const kindNodes = constNodes.filter(({ path }) =>
    path.endsWith('/properties/kind')
  );
  const modeNodes = constNodes.filter(({ path }) =>
    path.endsWith('/properties/mode')
  );

  constNodes.forEach(({ path, node }) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(node, 'type'),
      true,
      path
    );
  });
  assert.deepEqual(
    new Set(kindNodes.map(({ node }) => node.const)),
    new Set([
      'exerciseId',
      'exerciseDefaults',
      'blockRestSeconds',
      'strengthSetTarget',
      'exerciseNotes',
      'cardioPrescription',
    ])
  );
  assert.equal(
    kindNodes.filter(({ node }) => node.const === 'strengthSetTarget').length,
    3
  );
  assert.deepEqual(
    new Set(modeNodes.map(({ node }) => node.const)),
    new Set(['reps', 'repRange', 'seconds'])
  );
  kindNodes.forEach(({ node }) => assert.equal(node.type, 'string'));
  modeNodes.forEach(({ node }) => assert.equal(node.type, 'string'));
  assert.equal(schema.properties.schemaVersion.type, 'integer');
  assert.equal(schema.properties.geometryHash.type, 'string');
});
