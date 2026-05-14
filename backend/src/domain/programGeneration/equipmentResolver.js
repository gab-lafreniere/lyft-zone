function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEquipmentContext(normalizedProfile = {}) {
  const environment = normalizedProfile.environment || {};
  const exercisePreference = normalizedProfile.exercisePreference || {};
  const availableEquipment = normalizeArray(environment.equipmentList)
    .map(normalizeValue)
    .filter(Boolean);
  const uniqueEquipment = Array.from(new Set(availableEquipment));

  return {
    trainingEnvironment: normalizeValue(environment.trainingEnvironment) || null,
    equipmentSetup: normalizeValue(environment.equipmentSetup) || null,
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
