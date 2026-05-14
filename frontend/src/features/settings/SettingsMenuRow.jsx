import Card from "../../ui/Card";

export default function SettingsMenuRow({
  label,
  description,
  icon,
  badge,
  meta,
  onClick,
}) {
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <Card className="border-slate-200 shadow-none transition hover:border-slate-300 hover:bg-slate-50/60">
        <div className="flex items-center gap-4 p-4 md:p-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[18px] bg-slate-100 text-slate-600">
            <span className="material-symbols-outlined">{icon}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-base font-semibold text-slate-900">{label}</p>
              {badge ? (
                <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-500">
                  {badge}
                </span>
              ) : null}
            </div>
            {description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
            ) : null}
            {meta ? <p className="mt-2 text-xs font-medium text-slate-400">{meta}</p> : null}
          </div>

          <span className="material-symbols-outlined shrink-0 text-slate-400">
            chevron_right
          </span>
        </div>
      </Card>
    </button>
  );
}
