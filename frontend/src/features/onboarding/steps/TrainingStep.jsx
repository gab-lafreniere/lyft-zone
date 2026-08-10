import { Stepper } from "../../../design-v2";
import OnboardingStepLayout from "../OnboardingStepLayout";

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

  function updateAvailability(field, value) {
    onChange({
      ...draft,
      availability: {
        ...draft.availability,
        [field]: value,
      },
    });
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
              updateAvailability(
                "sessionsPerWeek",
                nextValue(sessions, currentSessions, -1)
              )
            }
            onIncrement={() =>
              updateAvailability(
                "sessionsPerWeek",
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
