const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveEquipmentContext,
} = require('../../src/domain/programGeneration/equipmentResolver');

test('resolveEquipmentContext separates hard constraints and soft equipment bias', () => {
  const result = resolveEquipmentContext({
    environment: {
      equipmentPreset: 'full_gym',
      availableEquipment: ['dumbbells', 'shoulder_press_machine', 'dumbbells'],
    },
    exercisePreference: {
      equipmentBias: 'machines',
    },
  });

  assert.equal(result.equipmentPreset, 'full_gym');
  assert.deepEqual(result.availableEquipment, ['dumbbells', 'shoulder_press_machine']);
  assert.equal(result.equipmentBias, 'machines');
  assert.equal(result.hardConstraints[0].type, 'available_equipment');
  assert.equal(result.softBiases[0].value, 'machines');
});

test('resolveEquipmentContext keeps no_preference neutral', () => {
  const result = resolveEquipmentContext({
    environment: {
      equipmentPreset: null,
      availableEquipment: ['bodyweight'],
    },
    exercisePreference: {
      equipmentBias: 'no_preference',
    },
  });

  assert.deepEqual(result.softBiases, []);
});

test('resolveEquipmentContext reads legacy fields and normalizes equipment aliases', () => {
  const result = resolveEquipmentContext({
    environment: {
      trainingEnvironment: 'home',
      equipmentSetup: 'limited_gym',
      equipmentList: ['selectorized_shoulder_press'],
    },
    exercisePreference: {
      equipmentBias: 'no_preference',
    },
  });

  assert.equal(result.equipmentPreset, 'commercial_gym');
  assert.deepEqual(result.availableEquipment, ['shoulder_press_machine']);
});
