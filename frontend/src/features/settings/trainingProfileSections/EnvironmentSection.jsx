import { useState } from "react";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_PRESETS,
  EQUIPMENT_SETUP_OPTIONS,
} from "../settingsOptions";
import {
  ChipSelector,
  CollapsibleBlock,
  SectionBlock,
  SelectableCard,
  applyDraftUpdate,
  findFieldError,
} from "./shared";

const BODYWEIGHT = "bodyweight";

function normalizeEquipmentList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = Array.from(
    new Set(
      values
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

  return normalized.length ? normalized : [BODYWEIGHT];
}

function areSetsEqual(left, right) {
  const leftSet = new Set(left || []);
  const rightSet = new Set(right || []);

  if (leftSet.size !== rightSet.size) {
    return false;
  }

  return Array.from(leftSet).every((value) => rightSet.has(value));
}

function isBodyweightOnly(equipmentList) {
  return equipmentList.length === 1 && equipmentList[0] === BODYWEIGHT;
}

export default function EnvironmentSection({ draft, onChange, fieldErrors }) {
  const [pendingPreset, setPendingPreset] = useState(null);
  const [openCategory, setOpenCategory] = useState(null);
  const rawEquipmentList =
    draft?.environment?.availableEquipment ?? draft?.environment?.equipmentList;
  const equipmentList = normalizeEquipmentList(rawEquipmentList);
  const equipmentPreset =
    draft?.environment?.equipmentPreset ?? draft?.environment?.equipmentSetup ?? null;
  const selectedPreset = EQUIPMENT_PRESETS[equipmentPreset] || null;
  const isCustomized = Boolean(
    equipmentPreset && selectedPreset && !areSetsEqual(equipmentList, selectedPreset)
  );
  const lockedValues = isBodyweightOnly(equipmentList) ? [BODYWEIGHT] : [];
  const pendingPresetOption = pendingPreset
    ? EQUIPMENT_SETUP_OPTIONS.find((option) => option.value === pendingPreset)
    : null;

  function updateEnvironment(producer) {
    applyDraftUpdate(draft, onChange, (nextDraft) => {
      if (!nextDraft.environment || typeof nextDraft.environment !== "object") {
        nextDraft.environment = {};
      }

      producer(nextDraft.environment);
      nextDraft.environment.availableEquipment = normalizeEquipmentList(
        nextDraft.environment.availableEquipment
      );
    });
  }

  function toggleEquipment(itemValue) {
    if (itemValue === BODYWEIGHT && isBodyweightOnly(equipmentList)) {
      return;
    }

    const nextValue = equipmentList.includes(itemValue)
      ? equipmentList.filter((entry) => entry !== itemValue)
      : [...equipmentList, itemValue];

    updateEnvironment((environment) => {
      environment.availableEquipment = nextValue.length ? nextValue : [BODYWEIGHT];
    });
  }

  function applyPreset(presetValue) {
    updateEnvironment((environment) => {
      environment.equipmentPreset = presetValue;
      environment.availableEquipment = EQUIPMENT_PRESETS[presetValue] || [BODYWEIGHT];
    });
    setOpenCategory(null);
  }

  function handlePresetClick(presetValue) {
    const isInitialState =
      !equipmentPreset &&
      (!Array.isArray(rawEquipmentList) ||
        rawEquipmentList.length === 0 ||
        isBodyweightOnly(equipmentList));

    if (isInitialState) {
      applyPreset(presetValue);
      return;
    }

    setPendingPreset(presetValue);
  }

  function cancelPresetReplace() {
    setPendingPreset(null);
  }

  function confirmPresetReplace() {
    if (pendingPreset) {
      applyPreset(pendingPreset);
    }
    setPendingPreset(null);
  }

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Equipment Setup"
        description="Choose a preset, then fine-tune your actual available equipment."
        error={findFieldError(fieldErrors, ["environment.equipmentPreset"])}
      >
        <div className="space-y-3">
          {isCustomized ? (
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
              Customized
            </span>
          ) : null}
          {EQUIPMENT_SETUP_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={equipmentPreset === option.value}
              onClick={() => handlePresetClick(option.value)}
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Equipment List"
        description="Open only the categories you need and tap the tools you actually have."
        error={findFieldError(fieldErrors, ["environment.availableEquipment"])}
      >
        <div className="space-y-3">
          {EQUIPMENT_CATEGORIES.map((category) => {
            const selectedItems = category.items.filter((item) =>
              equipmentList.includes(item.value)
            );

            return (
              <CollapsibleBlock
                key={category.label}
                title={category.label}
                badge={selectedItems.length > 0 ? `${selectedItems.length}` : null}
                isOpen={openCategory === category.label}
                onToggle={() =>
                  setOpenCategory((currentCategory) =>
                    currentCategory === category.label ? null : category.label
                  )
                }
              >
                <ChipSelector
                  options={category.items}
                  selectedValues={equipmentList}
                  onToggle={toggleEquipment}
                  disabledValues={lockedValues}
                />
              </CollapsibleBlock>
            );
          })}
        </div>
      </SectionBlock>

      {pendingPresetOption ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-equipment-title"
            className="w-full max-w-sm rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3 id="replace-equipment-title" className="text-base font-bold text-slate-900">
              Replace equipment selection?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              This will replace your current equipment list with the {pendingPresetOption.label} preset.
              You can still adjust individual equipment after.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelPresetReplace}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPresetReplace}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
