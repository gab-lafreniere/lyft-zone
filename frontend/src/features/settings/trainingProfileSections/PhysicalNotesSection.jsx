import {
  CharacterCount,
  Field,
  SectionBlock,
  TEXTAREA_CLASSES,
  findFieldError,
  setDraftField,
} from "./shared";

const CHARACTER_LIMIT = 1000;

export default function PhysicalNotesSection({ draft, onChange, fieldErrors }) {
  const currentValue = draft?.physicalNotes || "";

  return (
    <SectionBlock
      title="Physical Notes"
      description="Capture any extra context that helps the builder make better training choices."
    >
      <Field error={findFieldError(fieldErrors, ["physicalNotes"])}>
        <textarea
          rows={5}
          className={TEXTAREA_CLASSES}
          value={currentValue}
          onChange={(event) => setDraftField(draft, onChange, ["physicalNotes"], event.target.value)}
          placeholder="Optional notes about movement comfort, preferences, or setup."
        />
        <CharacterCount current={currentValue.length} limit={CHARACTER_LIMIT} />
      </Field>
    </SectionBlock>
  );
}
