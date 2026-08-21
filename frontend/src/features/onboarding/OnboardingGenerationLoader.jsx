import { useLayoutEffect } from "react";
import { ProgressIndicator } from "../../design-v2";
import { buildGenerationProfileChips } from "./profileSummary";

function CircularGenerationProgress({
  visualPercent,
  displayPercent,
  title,
  description,
}) {
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = visualPercent / 100;
  const offset = circumference * (1 - progressRatio);

  return (
    <div className="lz-onboarding-generation-ring">
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle className="lz-onboarding-generation-ring__track" cx="52" cy="52" r={radius} />
        <circle
          className="lz-onboarding-generation-ring__fill"
          cx="52"
          cy="52"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          data-progress-value={visualPercent}
        />
      </svg>
      <div className="lz-onboarding-generation-ring__content">
        <strong
          className="lz-onboarding-generation-percent"
          data-progress-value={displayPercent}
        >
          {displayPercent}%
        </strong>
        <div className="lz-onboarding-generation-message" key={title}>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

function ProfileContextChip({ children, accent = false }) {
  return (
    <span
      className={`lz-onboarding-generation-chip${accent ? " lz-onboarding-generation-chip--accent" : ""}`}
    >
      {children}
    </span>
  );
}

export default function OnboardingGenerationLoader({
  stage,
  percent = 0,
  message,
  profile,
  isExiting = false,
}) {
  const numericPercent = Number(percent);
  const visualPercent = Number.isFinite(numericPercent)
    ? Math.min(100, Math.max(0, numericPercent))
    : 0;
  const displayPercent = Math.floor(visualPercent);
  const chips = buildGenerationProfileChips(profile);
  const title = message?.title || "Building Your Program";
  const description = message?.description || "Preparing your personalized training plan.";

  useLayoutEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;

    window.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, []);

  return (
    <section
      className={`lz-onboarding-generation${isExiting ? " lz-onboarding-generation--exiting" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="lz-onboarding-generation__ambient" aria-hidden="true" />
      <div className="lz-onboarding-generation-status">
        <span aria-hidden="true">✦</span>
        AI Building Your Program
      </div>
      <div className="lz-onboarding-generation__center">
        <CircularGenerationProgress
          visualPercent={visualPercent}
          displayPercent={displayPercent}
          title={title}
          description={description}
        />
      </div>
      <div className="lz-onboarding-generation__footer">
        <ProgressIndicator
          className="lz-onboarding-generation-progress"
          value={visualPercent}
          label="Program generation progress"
          valueText={`${displayPercent}%`}
        />
        {chips.length > 0 ? (
          <div className="lz-onboarding-generation-chips" aria-label="Training profile context">
            {chips.map((chip) => (
              <ProfileContextChip key={chip.key} accent={chip.accent}>
                {chip.label}
              </ProfileContextChip>
            ))}
          </div>
        ) : null}
      </div>
      <span className="sr-only">Current stage: {stage}</span>
    </section>
  );
}
