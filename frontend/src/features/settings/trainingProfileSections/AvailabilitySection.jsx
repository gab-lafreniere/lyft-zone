import { useRef } from "react";
import ChipSelector from "../ChipSelector";
import {
  DAY_OF_WEEK_OPTIONS,
  adjustTrainingDaysForSessions,
  areSameTrainingDays,
  getSpacedDefaultTrainingDays,
  normalizeTrainingDays,
  resolvePreferredTrainingDays,
} from "../../onboarding/trainingDayDefaults";
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
  const storedTrainingDays = draft?.availability?.preferredTrainingDays;
  const touchedRef = useRef(null);
  if (touchedRef.current == null) {
    touchedRef.current =
      Array.isArray(storedTrainingDays) &&
      !areSameTrainingDays(
        storedTrainingDays,
        getSpacedDefaultTrainingDays(currentSessions)
      );
  }
  const selectedTrainingDays = touchedRef.current
    ? normalizeTrainingDays(storedTrainingDays)
    : resolvePreferredTrainingDays(storedTrainingDays, currentSessions);
  const hasLegacySessions =
    sessionsValue != null &&
    sessionsValue !== "" &&
    Number.isFinite(currentSessions) && !sessionsValues.includes(currentSessions);
  const hasLegacyDuration =
    durationValue != null &&
    durationValue !== "" &&
    Number.isFinite(currentDuration) && !durationValues.includes(currentDuration);

  function updateSessionsPerWeek(value) {
    onChange({
      ...draft,
      availability: {
        ...draft.availability,
        sessionsPerWeek: value,
        preferredTrainingDays: adjustTrainingDaysForSessions(
          selectedTrainingDays,
          value,
          touchedRef.current
        ),
      },
    });
  }

  function toggleTrainingDay(day) {
    touchedRef.current = true;
    const selected = selectedTrainingDays.includes(day);
    if (!selected && selectedTrainingDays.length >= currentSessions) {
      return;
    }

    onChange({
      ...draft,
      availability: {
        ...draft.availability,
        preferredTrainingDays: normalizeTrainingDays(
          selected
            ? selectedTrainingDays.filter((selectedDay) => selectedDay !== day)
            : [...selectedTrainingDays, day]
        ),
      },
    });
  }

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
          onChange={updateSessionsPerWeek}
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

        {currentSessions === 7 ? null : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-900">Preferred training days</p>
              <p className="mt-1 text-sm text-slate-500">
                Used for future cycles only. Existing cycles and scheduled sessions will not change.
              </p>
            </div>
            <ChipSelector
              options={DAY_OF_WEEK_OPTIONS}
              selectedValues={selectedTrainingDays}
              onToggle={toggleTrainingDay}
              maxSelected={currentSessions}
            />
            <p className="mt-2 text-xs font-medium text-slate-500">
              {selectedTrainingDays.length}/{currentSessions || 0} selected
            </p>
            {findFieldError(fieldErrors, ["availability.preferredTrainingDays"]) ? (
              <p className="mt-2 text-sm font-medium text-red-500">
                {findFieldError(fieldErrors, ["availability.preferredTrainingDays"])}
              </p>
            ) : null}
          </div>
        )}

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
