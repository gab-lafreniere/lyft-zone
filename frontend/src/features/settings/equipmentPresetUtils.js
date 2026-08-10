import { EQUIPMENT_PRESETS } from "./settingsOptions";

export const BODYWEIGHT_EQUIPMENT = "bodyweight";

export function normalizeEquipmentList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = Array.from(
    new Set(
      values
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

  return normalized.length ? normalized : [BODYWEIGHT_EQUIPMENT];
}

export function areEquipmentSetsEqual(left, right) {
  const leftSet = new Set(left || []);
  const rightSet = new Set(right || []);

  if (leftSet.size !== rightSet.size) {
    return false;
  }

  return Array.from(leftSet).every((value) => rightSet.has(value));
}

export function isBodyweightOnly(equipmentList) {
  return (
    equipmentList.length === 1 &&
    equipmentList[0] === BODYWEIGHT_EQUIPMENT
  );
}

export function applyEquipmentPreset(environment, presetValue) {
  return {
    ...(environment || {}),
    equipmentPreset: presetValue,
    availableEquipment: normalizeEquipmentList(
      EQUIPMENT_PRESETS[presetValue] || [BODYWEIGHT_EQUIPMENT]
    ),
  };
}

export function toggleAvailableEquipment(equipmentList, itemValue) {
  const normalizedList = normalizeEquipmentList(equipmentList);
  if (
    itemValue === BODYWEIGHT_EQUIPMENT &&
    isBodyweightOnly(normalizedList)
  ) {
    return normalizedList;
  }

  const nextValue = normalizedList.includes(itemValue)
    ? normalizedList.filter((entry) => entry !== itemValue)
    : [...normalizedList, itemValue];

  return normalizeEquipmentList(nextValue);
}

