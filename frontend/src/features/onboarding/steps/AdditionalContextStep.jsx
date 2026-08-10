import { Chip, SegmentedControl, SelectableCard } from "../../../design-v2";
import {
  CARDIO_MODALITY_OPTIONS,
  CARDIO_ROLE_OPTIONS,
} from "../../settings/settingsOptions";
import MovementConstraintsSection from "../../settings/trainingProfileSections/MovementConstraintsSection";
import OnboardingStepLayout from "../OnboardingStepLayout";

const LIMITATION_OPTIONS = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

const CARDIO_COPY = {
  none: { label: "None", icon: "do_not_disturb" },
  warm_up_only: { label: "Warm-up", icon: "directions_run" },
  cardio_sessions: { label: "Cardio sessions", icon: "timer" },
  warm_up_and_cardio: { label: "Both", icon: "all_inclusive" },
};

export default function AdditionalContextStep({
  draft,
  onChange,
  hasMovementLimitations,
  onMovementLimitationsChange,
  fieldErrors = {},
  disabled = false,
}) {
  const cardioRole = draft?.cardioProfile?.cardioRole;
  const modalities = draft?.cardioProfile?.preferredModalities || [];

  function setMovementLimitations(value) {
    onMovementLimitationsChange(value);
    if (!value) {
      onChange({
        ...draft,
        movementConstraints: {
          painIssues: [],
          manualBlockedExerciseIds: [],
        },
      });
    }
  }

  function selectCardioRole(value) {
    onChange({
      ...draft,
      cardioProfile: {
        ...draft.cardioProfile,
        cardioRole: value,
        preferredModalities: value === "none" ? [] : modalities,
      },
    });
  }

  function toggleModality(value) {
    onChange({
      ...draft,
      cardioProfile: {
        ...draft.cardioProfile,
        preferredModalities: modalities.includes(value)
          ? modalities.filter((entry) => entry !== value)
          : [...modalities, value],
      },
    });
  }

  return (
    <OnboardingStepLayout
      title="Anything we should know?"
      description="A few final details to make your program yours."
      className="lz-onboarding-context"
    >
      <div className="grid gap-12">
        <section className="grid gap-4" aria-labelledby="movement-limitations-title">
          <div>
            <h2 className="lz-onboarding-section-title" id="movement-limitations-title">
              Any pain or movement limitations?
            </h2>
            <p className="mt-1 text-sm text-lz-v2-text-muted">
              We&apos;ll adjust exercise selection around it.
            </p>
          </div>
          <SegmentedControl
            label="Pain or movement limitations"
            options={LIMITATION_OPTIONS}
            value={hasMovementLimitations}
            onChange={setMovementLimitations}
            disabled={disabled}
          />
          {hasMovementLimitations ? (
            <div className="lz-onboarding-movement-wrap">
              <MovementConstraintsSection
                draft={draft}
                onChange={onChange}
                fieldErrors={fieldErrors}
                presentation="onboarding"
              />
            </div>
          ) : null}
          {fieldErrors.movementConstraints ? (
            <p className="lz-onboarding-error" role="alert">
              {fieldErrors.movementConstraints}
            </p>
          ) : null}
        </section>

        <section className="grid gap-4" aria-labelledby="cardio-role-title">
          <h2 className="lz-onboarding-section-title" id="cardio-role-title">
            Include cardio?
          </h2>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Include cardio">
            {CARDIO_ROLE_OPTIONS.map((option) => {
              const copy = CARDIO_COPY[option.value];
              return (
                <SelectableCard
                  key={option.value}
                  title={copy.label}
                  leading={
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {copy.icon}
                    </span>
                  }
                  selectionMode="single"
                  selected={cardioRole === option.value}
                  onClick={() => selectCardioRole(option.value)}
                  disabled={disabled}
                  className="lz-onboarding-cardio-card"
                />
              );
            })}
          </div>

          {!cardioRole ? (
            <p className="text-sm text-lz-v2-text-muted">
              Choose one option to generate your program.
            </p>
          ) : null}
          {fieldErrors["cardioProfile.cardioRole"] ? (
            <p className="lz-onboarding-error" role="alert">
              {fieldErrors["cardioProfile.cardioRole"]}
            </p>
          ) : null}

          {cardioRole && cardioRole !== "none" ? (
            <div className="lz-onboarding-reveal grid gap-3">
              <div>
                <h3 className="text-sm font-bold text-lz-v2-text-strong">
                  Preferred modalities
                </h3>
                <p className="mt-1 text-sm text-lz-v2-text-muted">Optional</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {CARDIO_MODALITY_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    selected={modalities.includes(option.value)}
                    onClick={() => toggleModality(option.value)}
                    disabled={disabled}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-3" aria-labelledby="physical-notes-label">
          <div>
            <label className="lz-onboarding-section-title" id="physical-notes-label" htmlFor="onboarding-physical-notes">
              Anything else?
            </label>
            <p className="mt-1 text-sm text-lz-v2-text-muted">Optional</p>
          </div>
          <textarea
            id="onboarding-physical-notes"
            aria-labelledby="physical-notes-label"
            className="lz-onboarding-textarea"
            maxLength="1000"
            value={draft.physicalNotes || ""}
            placeholder="Recovery considerations, exercise preferences, or anything else your coach should know."
            onChange={(event) => onChange({ ...draft, physicalNotes: event.target.value })}
            disabled={disabled}
          />
          {fieldErrors.physicalNotes ? (
            <p className="lz-onboarding-error" role="alert">{fieldErrors.physicalNotes}</p>
          ) : null}
        </section>

      </div>
    </OnboardingStepLayout>
  );
}
