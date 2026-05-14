export default function SettingsStackHeader({
  eyebrow,
  title,
  canGoBack,
  onBack,
  onClose,
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {canGoBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
              aria-label="Go back"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          ) : (
            <div className="size-11 shrink-0" aria-hidden="true" />
          )}

          <div className="min-w-0">
            {eyebrow ? (
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="truncate text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
          aria-label="Close settings"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </header>
  );
}
