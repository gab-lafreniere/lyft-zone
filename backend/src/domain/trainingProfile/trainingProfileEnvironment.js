const EQUIPMENT_PRESETS = new Set([
  'minimal',
  'home_gym',
  'commercial_gym',
  'full_gym',
]);

const EQUIPMENT_PRESET_ALIASES = Object.freeze({
  limited_gym: 'commercial_gym',
});

const EQUIPMENT_ALIASES = Object.freeze({
  selectorized_shoulder_press: 'shoulder_press_machine',
});

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function toArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEquipmentPreset(value) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  return EQUIPMENT_PRESET_ALIASES[normalized] || normalized;
}

function isKnownEquipmentPreset(value) {
  return value == null || EQUIPMENT_PRESETS.has(value);
}

function normalizeEquipmentId(value) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  return EQUIPMENT_ALIASES[normalized] || normalized;
}

function normalizeEquipmentArray(value) {
  return Array.from(
    new Set(
      toArray(value)
        .map(normalizeEquipmentId)
        .filter(Boolean)
    )
  );
}

function ensureAvailableEquipment(value) {
  const equipment = normalizeEquipmentArray(value);
  return equipment.length ? equipment : ['bodyweight'];
}

function resolveEnvironmentInput(environment = {}) {
  const equipmentPresetSource = hasOwn(environment, 'equipmentPreset')
    ? environment.equipmentPreset
    : environment.equipmentSetup;
  const availableEquipmentSource = hasOwn(environment, 'availableEquipment')
    ? environment.availableEquipment
    : environment.equipmentList;

  return {
    equipmentPreset: normalizeEquipmentPreset(equipmentPresetSource),
    availableEquipment: ensureAvailableEquipment(availableEquipmentSource),
  };
}

module.exports = {
  EQUIPMENT_PRESETS,
  ensureAvailableEquipment,
  isKnownEquipmentPreset,
  normalizeEquipmentArray,
  normalizeEquipmentId,
  normalizeEquipmentPreset,
  resolveEnvironmentInput,
};
