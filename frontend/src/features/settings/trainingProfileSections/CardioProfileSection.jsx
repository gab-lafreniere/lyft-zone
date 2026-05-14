import { CARDIO_MODALITY_OPTIONS, CARDIO_ROLE_OPTIONS } from "../settingsOptions";
import {
  ChipSelector,
  SectionBlock,
  SelectableCard,
  findFieldError,
  setDraftField,
} from "./shared";

export default function CardioProfileSection({ draft, onChange, fieldErrors }) {
  const preferredModalities = Array.isArray(draft?.cardioProfile?.preferredModalities)
    ? draft.cardioProfile.preferredModalities
    : [];

  function togglePreferredModality(modality) {
    const nextValue = preferredModalities.includes(modality)
      ? preferredModalities.filter((entry) => entry !== modality)
      : [...preferredModalities, modality];

    setDraftField(draft, onChange, ["cardioProfile", "preferredModalities"], nextValue);
  }

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Cardio Role"
        description="Choose how cardio should show up around your lifting plan."
        error={findFieldError(fieldErrors, ["cardioProfile.cardioRole"])}
      >
        <div className="space-y-3">
          {CARDIO_ROLE_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={draft?.cardioProfile?.cardioRole === option.value}
              onClick={() =>
                setDraftField(draft, onChange, ["cardioProfile", "cardioRole"], option.value)
              }
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Preferred Modalities"
        description="Select any machines or methods you naturally gravitate toward."
        error={findFieldError(fieldErrors, ["cardioProfile.preferredModalities"])}
      >
        <ChipSelector
          options={CARDIO_MODALITY_OPTIONS}
          selectedValues={preferredModalities}
          onToggle={togglePreferredModality}
        />
      </SectionBlock>
    </div>
  );
}
