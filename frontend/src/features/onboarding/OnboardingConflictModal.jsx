import { Button } from "../../design-v2";

export default function OnboardingConflictModal({ conflicts, onCancel, onConfirm, isBusy }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
      role="presentation"
    >
      <section
        className="w-full max-w-lg rounded-3xl border border-lz-v2-border bg-lz-v2-surface-raised p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-conflict-title"
      >
        <h2
          id="onboarding-conflict-title"
          className="font-lz-v2-display text-2xl font-bold text-lz-v2-text-strong"
        >
          Replace your scheduled program?
        </h2>
        <p className="mt-3 text-sm leading-6 text-lz-v2-text-muted">
          You already have a training cycle scheduled during this period. Continuing will
          remove the conflicting cycle(s) and replace them with your new 6-week program. Are
          you sure you want to continue?
        </p>
        {Array.isArray(conflicts) && conflicts.length > 0 ? (
          <ul className="mt-4 space-y-2" aria-label="Conflicting training cycles">
            {conflicts.map((conflict) => (
              <li
                key={conflict.cycleId}
                className="rounded-2xl border border-lz-v2-border bg-lz-v2-bg-deep p-3 text-sm"
              >
                <span className="font-bold text-lz-v2-text-strong">{conflict.name}</span>
                <span className="mt-1 block text-lz-v2-text-muted">
                  {conflict.startDate} – {conflict.endDate}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            No, go Home
          </Button>
          <Button onClick={onConfirm} disabled={isBusy} isLoading={isBusy}>
            Yes, replace cycles
          </Button>
        </div>
      </section>
    </div>
  );
}
