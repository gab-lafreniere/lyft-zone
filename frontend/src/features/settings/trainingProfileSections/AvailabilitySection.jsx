import {
  InlineStepper,
  SectionBlock,
  findFieldError,
  setDraftField,
} from "./shared";

export default function AvailabilitySection({
  draft,
  onChange,
  fieldErrors,
  options,
}) {
  const sessionsValues = options?.sessionsPerWeek || [];
  const durationValues = options?.durationPerSession || [];
  const sessionsValue = draft?.availability?.sessionsPerWeek;
  const durationValue = draft?.availability?.durationPerSession;
  const currentSessions = Number(sessionsValue);
  const currentDuration = Number(durationValue);
  const hasLegacySessions =
    sessionsValue != null &&
    sessionsValue !== "" &&
    Number.isFinite(currentSessions) && !sessionsValues.includes(currentSessions);
  const hasLegacyDuration =
    durationValue != null &&
    durationValue !== "" &&
    Number.isFinite(currentDuration) && !durationValues.includes(currentDuration);

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
          allowedValues={sessionsValues}
          onChange={(value) =>
            setDraftField(draft, onChange, ["availability", "sessionsPerWeek"], value)
          }
          quickPicks={[3, 4, 5, 6]}
        />
        {hasLegacySessions ? (
          <p className="-mt-1 text-sm font-medium text-amber-700">
            Select an available sessions-per-week value before saving.
          </p>
        ) : null}
        {findFieldError(fieldErrors, ["availability.sessionsPerWeek"]) ? (
          <p className="-mt-1 text-sm font-medium text-red-500">
            {findFieldError(fieldErrors, ["availability.sessionsPerWeek"])}
          </p>
        ) : null}

        <InlineStepper
          label="Duration per session"
          description="Choose the session length you can sustain most weeks."
          value={draft?.availability?.durationPerSession ?? ""}
          allowedValues={durationValues}
          onChange={(value) =>
            setDraftField(draft, onChange, ["availability", "durationPerSession"], value)
          }
          quickPicks={[30, 45, 60, 75, 90]}
          suffix="min"
        />
        {hasLegacyDuration ? (
          <p className="-mt-1 text-sm font-medium text-amber-700">
            Select an available session duration before saving.
          </p>
        ) : null}
        {findFieldError(fieldErrors, ["availability.durationPerSession"]) ? (
          <p className="-mt-1 text-sm font-medium text-red-500">
            {findFieldError(fieldErrors, ["availability.durationPerSession"])}
          </p>
        ) : null}
      </div>
    </SectionBlock>
  );
}
