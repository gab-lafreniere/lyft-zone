import { useEffect, useRef } from "react";
import { Chip, Stepper } from "../../../design-v2";
import OnboardingStepLayout from "../OnboardingStepLayout";
import {
  DAY_OF_WEEK_OPTIONS,
  adjustTrainingDaysForSessions,
  areSameTrainingDays,
  getSpacedDefaultTrainingDays,
  isValidPreferredTrainingDays,
  normalizeTrainingDays,
  resolvePreferredTrainingDays,
} from "../trainingDayDefaults";

function nextValue(values, currentValue, direction) {
  const currentIndex = values.indexOf(Number(currentValue));
  if (currentIndex === -1) {
    return direction > 0 ? values[0] : values[values.length - 1];
  }

  return values[Math.min(values.length - 1, Math.max(0, currentIndex + direction))];
}

export default function TrainingStep({
  draft,
  availabilityOptions,
  onChange,
  fieldErrors = {},
  disabled = false,
}) {
  const sessions = availabilityOptions.sessionsPerWeek || [];
  const durations = availabilityOptions.durationPerSession || [];
  const currentSessions = draft.availability.sessionsPerWeek;
  const currentDuration = draft.availability.durationPerSession;
  const storedTrainingDays = draft.availability.preferredTrainingDays;
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

  useEffect(() => {
    if (
      !touchedRef.current &&
      Number(currentSessions) >= 1 &&
      !isValidPreferredTrainingDays(storedTrainingDays, currentSessions)
    ) {
      onChange({
        ...draft,
        availability: {
          ...draft.availability,
          preferredTrainingDays: getSpacedDefaultTrainingDays(currentSessions),
        },
      });
    }
  }, [currentSessions, draft, onChange, storedTrainingDays]);

  function updateAvailability(field, value) {
    onChange({
      ...draft,
      availability: {
        ...draft.availability,
        [field]: value,
      },
    });
  }

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
    const isSelected = selectedTrainingDays.includes(day);
    if (!isSelected && selectedTrainingDays.length >= Number(currentSessions)) {
      return;
    }

    updateAvailability(
      "preferredTrainingDays",
      normalizeTrainingDays(
        isSelected
          ? selectedTrainingDays.filter((selectedDay) => selectedDay !== day)
          : [...selectedTrainingDays, day]
      )
    );
  }

  return (
    <OnboardingStepLayout
      title="Your training"
      className="lz-onboarding-training"
    >
      <div className="lz-onboarding-goal-badge">
        <span className="material-symbols-outlined" aria-hidden="true">fitness_center</span>
        <span>Goal · Muscle Growth &amp; Hypertrophy</span>
      </div>
      <div className="grid gap-10 py-2 sm:gap-12">
        <div className="grid gap-3">
          <Stepper
            label="How many days per week?"
            value={currentSessions ?? "—"}
            unit="days"
            onDecrement={() =>
              updateSessionsPerWeek(
                nextValue(sessions, currentSessions, -1)
              )
            }
            onIncrement={() =>
              updateSessionsPerWeek(
                nextValue(sessions, currentSessions, 1)
              )
            }
            canDecrement={!disabled && sessions.indexOf(Number(currentSessions)) !== 0}
            canIncrement={!disabled && sessions.indexOf(Number(currentSessions)) !== sessions.length - 1}
            disabled={disabled}
            decrementLabel="Decrease training days"
            incrementLabel="Increase training days"
          />
          {fieldErrors.sessionsPerWeek ? (
            <p className="text-center text-sm font-semibold text-lz-v2-danger" role="alert">
              {fieldErrors.sessionsPerWeek}
            </p>
          ) : null}

          {Number(currentSessions) === 7 ? null : (
            <div className="mt-2 grid gap-2">
              <div className="text-center">
                <p className="text-sm font-semibold text-lz-v2-text">Preferred training days</p>
                <p className="text-xs text-lz-v2-muted">
                  {selectedTrainingDays.length}/{Number(currentSessions) || 0} selected
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2" aria-label="Preferred training days">
                {DAY_OF_WEEK_OPTIONS.map((option) => {
                  const selected = selectedTrainingDays.includes(option.value);
                  return (
                    <Chip
                      key={option.value}
                      selected={selected}
                      disabled={
                        disabled ||
                        (!selected && selectedTrainingDays.length >= Number(currentSessions))
                      }
                      aria-label={option.label}
                      onClick={() => toggleTrainingDay(option.value)}
                    >
                      {option.shortLabel}
                    </Chip>
                  );
                })}
              </div>
              {fieldErrors.preferredTrainingDays ? (
                <p className="text-center text-sm font-semibold text-lz-v2-danger" role="alert">
                  {fieldErrors.preferredTrainingDays}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="h-px bg-lz-v2-border" />

        <div className="grid gap-3">
          <Stepper
            label="How long per session?"
            value={currentDuration ?? "—"}
            unit="minutes"
            tone="info"
            onDecrement={() =>
              updateAvailability(
                "durationPerSession",
                nextValue(durations, currentDuration, -1)
              )
            }
            onIncrement={() =>
              updateAvailability(
                "durationPerSession",
                nextValue(durations, currentDuration, 1)
              )
            }
            canDecrement={!disabled && durations.indexOf(Number(currentDuration)) !== 0}
            canIncrement={!disabled && durations.indexOf(Number(currentDuration)) !== durations.length - 1}
            disabled={disabled}
            decrementLabel="Decrease session duration"
            incrementLabel="Increase session duration"
          />
          {fieldErrors.durationPerSession ? (
            <p className="text-center text-sm font-semibold text-lz-v2-danger" role="alert">
              {fieldErrors.durationPerSession}
            </p>
          ) : null}
        </div>
      </div>
    </OnboardingStepLayout>
  );
}
