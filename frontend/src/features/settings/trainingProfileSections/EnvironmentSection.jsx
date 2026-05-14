import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_SETUP_OPTIONS,
  TRAINING_ENVIRONMENT_OPTIONS,
} from "../settingsOptions";
import {
  ChipSelector,
  CollapsibleBlock,
  SectionBlock,
  SelectableCard,
  findFieldError,
  setDraftField,
} from "./shared";

export default function EnvironmentSection({ draft, onChange, fieldErrors }) {
  const equipmentList = Array.isArray(draft?.environment?.equipmentList)
    ? draft.environment.equipmentList
    : [];

  function toggleEquipment(itemValue) {
    const nextValue = equipmentList.includes(itemValue)
      ? equipmentList.filter((entry) => entry !== itemValue)
      : [...equipmentList, itemValue];

    setDraftField(draft, onChange, ["environment", "equipmentList"], nextValue);
  }

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Training Environment"
        description="Tell the system where you usually train."
        error={findFieldError(fieldErrors, ["environment.trainingEnvironment"])}
      >
        <div className="space-y-3">
          {TRAINING_ENVIRONMENT_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={draft?.environment?.trainingEnvironment === option.value}
              onClick={() =>
                setDraftField(
                  draft,
                  onChange,
                  ["environment", "trainingEnvironment"],
                  option.value
                )
              }
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Equipment Setup"
        description="Choose the setup that most closely matches your normal access."
        error={findFieldError(fieldErrors, ["environment.equipmentSetup"])}
      >
        <div className="space-y-3">
          {EQUIPMENT_SETUP_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={draft?.environment?.equipmentSetup === option.value}
              onClick={() =>
                setDraftField(draft, onChange, ["environment", "equipmentSetup"], option.value)
              }
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Equipment List"
        description="Open only the categories you need and tap the tools you actually have."
        error={findFieldError(fieldErrors, ["environment.equipmentList"])}
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
                defaultOpen={selectedItems.length > 0}
              >
                <ChipSelector
                  options={category.items}
                  selectedValues={equipmentList}
                  onToggle={toggleEquipment}
                />
              </CollapsibleBlock>
            );
          })}
        </div>
      </SectionBlock>
    </div>
  );
}
