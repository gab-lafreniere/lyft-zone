import { EXPERIENCE_OPTIONS } from "../settingsOptions";
import { SectionBlock, SelectableCard, findFieldError, setDraftField } from "./shared";

export default function ExperienceSection({ draft, onChange, fieldErrors }) {
  return (
    <SectionBlock
      title="Experience Level"
      description="Pick the level that best reflects your current training base."
      error={findFieldError(fieldErrors, ["experience"])}
    >
      <div className="space-y-3">
        {EXPERIENCE_OPTIONS.map((option) => (
          <SelectableCard
            key={option.value}
            label={option.label}
            description={option.description}
            icon={option.icon}
            selected={draft?.experience === option.value}
            onClick={() => setDraftField(draft, onChange, ["experience"], option.value)}
          />
        ))}
      </div>
    </SectionBlock>
  );
}
