const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveEquipmentContext,
} = require('../../src/domain/programGeneration/equipmentResolver');

test('resolveEquipmentContext separates hard constraints and soft equipment bias', () => {
  const result = resolveEquipmentContext({
    environment: {
      trainingEnvironment: 'commercial_gym',
      equipmentSetup: 'full_gym',
      equipmentList: ['dumbbells', 'selectorized_machine', 'dumbbells'],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
  });

  assert.equal(result.trainingEnvironment, 'commercial_gym');
  assert.equal(result.equipmentSetup, 'full_gym');
  assert.deepEqual(result.availableEquipment, ['dumbbells', 'selectorized_machine']);
  assert.equal(result.equipmentBias, 'machines');
  assert.equal(result.hardConstraints[0].type, 'available_equipment');
  assert.equal(result.softBiases[0].value, 'machines');
});

test('resolveEquipmentContext keeps no_preference neutral', () => {
  const result = resolveEquipmentContext({
    environment: {
      trainingEnvironment: 'home_gym',
      equipmentSetup: 'basic_home',
      equipmentList: [],
    },
    exercisePreference: {
      equipmentBias: 'no_preference',
    },
  });

  assert.deepEqual(result.softBiases, []);
});
