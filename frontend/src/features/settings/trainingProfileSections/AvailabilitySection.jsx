import {
  InlineStepper,
  SectionBlock,
  findFieldError,
  setDraftField,
} from "./shared";

export default function AvailabilitySection({ draft, onChange, fieldErrors }) {
  return (
    <SectionBlock
      title="Availability"
      description="Set the weekly rhythm and session length the plan should respect."
    >
      <div className="space-y-4">
        <InlineStepper
          label="Sessions per week"
          description="How many lifting sessions can you realistically complete?"
          value={draft?.availability?.sessionsPerWeek ?? ""}
          min={1}
          max={7}
          onChange={(value) =>
            setDraftField(draft, onChange, ["availability", "sessionsPerWeek"], value)
          }
          quickPicks={[3, 4, 5, 6]}
        />
        {findFieldError(fieldErrors, ["availability.sessionsPerWeek"]) ? (
          <p className="-mt-1 text-sm font-medium text-red-500">
            {findFieldError(fieldErrors, ["availability.sessionsPerWeek"])}
          </p>
        ) : null}

        <InlineStepper
          label="Duration per session"
          description="Choose the session length you can sustain most weeks."
          value={draft?.availability?.durationPerSession ?? ""}
          min={15}
          max={240}
          step={15}
          onChange={(value) =>
            setDraftField(draft, onChange, ["availability", "durationPerSession"], value)
          }
          quickPicks={[30, 45, 60, 75, 90]}
          suffix="min"
        />
        {findFieldError(fieldErrors, ["availability.durationPerSession"]) ? (
          <p className="-mt-1 text-sm font-medium text-red-500">
            {findFieldError(fieldErrors, ["availability.durationPerSession"])}
          </p>
        ) : null}
      </div>
    </SectionBlock>
  );
}
