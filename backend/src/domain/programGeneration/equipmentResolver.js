const {
  normalizeEquipmentArray,
  normalizeEquipmentPreset,
} = require('../trainingProfile/trainingProfileEnvironment');

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEquipmentContext(normalizedProfile = {}) {
  const environment = normalizedProfile.environment || {};
  const exercisePreference = normalizedProfile.exercisePreference || {};
  const equipmentPresetSource =
    environment.equipmentPreset == null ? environment.equipmentSetup : environment.equipmentPreset;
  const availableEquipmentSource =
    environment.availableEquipment == null ? environment.equipmentList : environment.availableEquipment;
  const uniqueEquipment = normalizeEquipmentArray(availableEquipmentSource);

  return {
    equipmentPreset: normalizeEquipmentPreset(equipmentPresetSource),
    availableEquipment: uniqueEquipment,
    equipmentBias: normalizeValue(exercisePreference.equipmentBias) || 'no_preference',
    hardConstraints: uniqueEquipment.length
      ? [{ type: 'available_equipment', values: uniqueEquipment }]
      : [],
    softBiases:
      normalizeValue(exercisePreference.equipmentBias) &&
      normalizeValue(exercisePreference.equipmentBias) !== 'no_preference'
        ? [{ type: 'equipment_bias', value: normalizeValue(exercisePreference.equipmentBias) }]
        : [],
  };
}

module.exports = {
  resolveEquipmentContext,
};
