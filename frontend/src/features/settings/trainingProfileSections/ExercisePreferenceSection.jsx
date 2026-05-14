import { EQUIPMENT_BIAS_OPTIONS } from "../settingsOptions";
import { SectionBlock, SelectableCard, findFieldError, setDraftField } from "./shared";

export default function ExercisePreferenceSection({ draft, onChange, fieldErrors }) {
  return (
    <SectionBlock
      title="Exercise Preference"
      description="Set a simple equipment bias without turning it into a hard restriction."
      error={findFieldError(fieldErrors, ["exercisePreference.equipmentBias"])}
    >
      <div className="space-y-3">
        {EQUIPMENT_BIAS_OPTIONS.map((option) => (
          <SelectableCard
            key={option.value}
            label={option.label}
            description={option.description}
            icon={option.icon}
            selected={draft?.exercisePreference?.equipmentBias === option.value}
            onClick={() =>
              setDraftField(draft, onChange, ["exercisePreference", "equipmentBias"], option.value)
            }
          />
        ))}
      </div>
    </SectionBlock>
  );
}
