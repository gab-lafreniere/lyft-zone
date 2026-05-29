export default function SettingsMenuRow({
  label,
  description,
  icon,
  showIcon = true,
  badge,
  meta,
  showSeparator = false,
  onClick,
}) {
  const showBadgeAsDot = !showIcon && Boolean(badge);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "block w-full text-left transition-colors hover:bg-slate-50/70",
        showSeparator ? "border-t border-slate-100" : "",
      ].join(" ")}
    >
      <div className="flex min-h-[60px] items-center gap-3 px-4 py-3">
        {showIcon && icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-slate-900">{label}</p>
            {showBadgeAsDot ? (
              <span className="size-2 shrink-0 rounded-full bg-red-500" aria-label={badge} />
            ) : badge ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-500">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{description}</p>
          ) : null}
          {meta ? <p className="mt-1 text-[11px] font-medium text-slate-400">{meta}</p> : null}
        </div>

        <span className="material-symbols-outlined shrink-0 text-[18px] text-slate-300">
          chevron_right
        </span>
      </div>
    </button>
  );
}
