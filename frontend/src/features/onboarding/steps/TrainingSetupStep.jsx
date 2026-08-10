import { Chip, Disclosure, SegmentedControl, SelectableCard } from "../../../design-v2";
import {
  EQUIPMENT_BIAS_OPTIONS,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_SETUP_OPTIONS,
} from "../../settings/settingsOptions";
import {
  applyEquipmentPreset,
  toggleAvailableEquipment,
} from "../../settings/equipmentPresetUtils";
import OnboardingStepLayout from "../OnboardingStepLayout";

export default function TrainingSetupStep({
  draft,
  onChange,
  fieldErrors = {},
  disabled = false,
}) {
  const environment = draft.environment || {};
  const availableEquipment = environment.availableEquipment || ["bodyweight"];
  const equipmentBias = draft?.exercisePreference?.equipmentBias || "no_preference";
  const presetOptions = [...EQUIPMENT_SETUP_OPTIONS].reverse();

  function selectPreset(preset) {
    onChange({
      ...draft,
      environment: applyEquipmentPreset(environment, preset),
    });
  }

  function toggleEquipment(value) {
    onChange({
      ...draft,
      environment: {
        ...environment,
        availableEquipment: toggleAvailableEquipment(availableEquipment, value),
      },
    });
  }

  function selectBias(value) {
    onChange({
      ...draft,
      exercisePreference: {
        ...draft.exercisePreference,
        equipmentBias: value,
      },
    });
  }

  return (
    <OnboardingStepLayout
      title="Where do you train?"
      description="Choose the setup that feels closest."
      className="lz-onboarding-setup"
    >
      <div className="grid gap-8">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Equipment preset">
          {presetOptions.map((option) => (
            <SelectableCard
              key={option.value}
              title={option.label}
              description={option.description}
              leading={
                <span className="material-symbols-outlined" aria-hidden="true">
                  {option.icon}
                </span>
              }
              selectionMode="single"
              selected={environment.equipmentPreset === option.value}
              onClick={() => selectPreset(option.value)}
              disabled={disabled}
              className="lz-onboarding-setup-card"
            />
          ))}
          {fieldErrors.equipmentPreset ? (
            <p className="lz-onboarding-error sm:col-span-2" role="alert">
              {fieldErrors.equipmentPreset}
            </p>
          ) : null}
        </div>

        <Disclosure
          title={`Customize equipment · ${availableEquipment.length} selected`}
          className="lz-onboarding-equipment-disclosure"
        >
          <div className="grid gap-6 pt-2">
            {EQUIPMENT_CATEGORIES.map((category) => (
              <section key={category.label} className="grid gap-3">
                <h2 className="text-sm font-bold text-lz-v2-text-strong">{category.label}</h2>
                <div className="flex flex-wrap gap-2">
                  {category.items.map((item) => (
                    <Chip
                      key={item.value}
                      selected={availableEquipment.includes(item.value)}
                      onClick={() => toggleEquipment(item.value)}
                      disabled={disabled}
                    >
                      {item.label}
                    </Chip>
                  ))}
                </div>
              </section>
            ))}
            {fieldErrors.availableEquipment ? (
              <p className="lz-onboarding-error" role="alert">
                {fieldErrors.availableEquipment}
              </p>
            ) : null}
          </div>
        </Disclosure>

        <section className="grid gap-3" aria-labelledby="equipment-preference-title">
          <div>
            <h2
              className="font-lz-v2-display text-xl font-semibold text-lz-v2-text-strong"
              id="equipment-preference-title"
            >
              What do you prefer?
            </h2>
            <p className="mt-1 text-sm text-lz-v2-text-muted">
              This is a preference, not a hard restriction.
            </p>
          </div>
          <SegmentedControl
            label="Equipment preference"
            options={EQUIPMENT_BIAS_OPTIONS}
            value={equipmentBias}
            onChange={selectBias}
            disabled={disabled}
          />
          {fieldErrors.equipmentBias ? (
            <p className="lz-onboarding-error" role="alert">
              {fieldErrors.equipmentBias}
            </p>
          ) : null}
        </section>
      </div>
    </OnboardingStepLayout>
  );
}
