export default function OnboardingStepLayout({
  title,
  titleIcon,
  description,
  children,
  className = "",
}) {
  return (
    <section
      className={`lz-onboarding-step grid gap-8 ${className}`.trim()}
      aria-labelledby="onboarding-step-title"
    >
      <div className="grid gap-3">
        <div className="lz-onboarding-title-row">
          {titleIcon ? (
            <span className="lz-onboarding-title-icon" aria-hidden="true">
              <span className="material-symbols-outlined">{titleIcon}</span>
            </span>
          ) : null}
          <h1
            className="font-lz-v2-display text-[28px] font-bold leading-[34px] text-lz-v2-text-strong"
            id="onboarding-step-title"
          >
            {title}
          </h1>
        </div>
        {description ? (
          <p className="text-lg leading-7 text-lz-v2-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
