import { SegmentedControl, SelectMenu } from "../../../design-v2";
import { EXPERIENCE_OPTIONS } from "../../settings/settingsOptions";
import OnboardingStepLayout from "../OnboardingStepLayout";

const SEX_OPTIONS = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
];

export default function AboutYouStep({
  profile,
  experience,
  onProfileChange,
  onExperienceChange,
  fieldErrors = {},
  disabled = false,
}) {
  const demographicsLocked = profile.demographicsStatus === "LOCKED";
  const selectedExperience = EXPERIENCE_OPTIONS.find(
    (option) => option.value === experience
  );

  return (
    <OnboardingStepLayout
      title="About you"
      titleIcon="person"
      className="lz-onboarding-about"
    >
      <div className="lz-onboarding-sentence-card">
        <div className="lz-onboarding-sentence" aria-label="About you profile details">
          <span className="lz-onboarding-sentence__fragment">
            <span>My name is</span>
            <input
              type="text"
              aria-label="Name"
              autoComplete="name"
              maxLength="80"
              value={profile.displayName}
              onChange={(event) =>
                onProfileChange({ ...profile, displayName: event.target.value })
              }
              disabled={disabled}
              className={`lz-onboarding-inline-control lz-onboarding-inline-control--name${profile.displayName ? " lz-onboarding-inline-control--entered" : ""}`}
              placeholder="Name"
            />
            <span>,</span>
          </span>{" "}
          <span className="lz-onboarding-sentence__fragment">
            <span>I&apos;m</span>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Age"
              min="18"
              max="100"
              step="1"
              value={profile.age}
              onChange={(event) =>
                onProfileChange({ ...profile, age: event.target.value })
              }
              disabled={disabled || demographicsLocked}
              className={`lz-onboarding-inline-control lz-onboarding-inline-control--age${profile.age ? " lz-onboarding-inline-control--entered" : ""}`}
              placeholder="Age"
            />
          </span>{" "}
          <span className="lz-onboarding-sentence__fragment">years old and I&apos;m a</span>{" "}
          <SelectMenu
            label="Training experience"
            options={EXPERIENCE_OPTIONS}
            value={experience}
            onChange={onExperienceChange}
            disabled={disabled}
            className="lz-onboarding-inline-select"
          />{" "}
          <span className="lz-onboarding-sentence__fragment">in bodybuilding.</span>
        </div>

        {selectedExperience ? (
          <p className="lz-onboarding-supporting-copy">
            {selectedExperience.description}
          </p>
        ) : null}

        <div className="lz-onboarding-compact-field">
          <span className="lz-onboarding-compact-field__label">Sex</span>
          <SegmentedControl
            label="Sex"
            options={SEX_OPTIONS}
            value={profile.sex}
            onChange={(sex) => onProfileChange({ ...profile, sex })}
            disabled={disabled || demographicsLocked}
          />
        </div>

        {fieldErrors.displayName ? <p className="lz-onboarding-error" role="alert">{fieldErrors.displayName}</p> : null}
        {fieldErrors.age ? <p className="lz-onboarding-error" role="alert">{fieldErrors.age}</p> : null}
        {fieldErrors.sex ? <p className="lz-onboarding-error" role="alert">{fieldErrors.sex}</p> : null}
        {fieldErrors.experience ? <p className="lz-onboarding-error" role="alert">{fieldErrors.experience}</p> : null}
        {fieldErrors.demographics ? <p className="lz-onboarding-error" role="alert">{fieldErrors.demographics}</p> : null}
      </div>
    </OnboardingStepLayout>
  );
}
