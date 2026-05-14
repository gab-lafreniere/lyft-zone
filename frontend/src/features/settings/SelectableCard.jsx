import { cn } from "../../ui/cn";

export default function SelectableCard({
  label,
  description,
  icon,
  selected,
  onClick,
  disabled = false,
  tone = "default",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-[20px] border px-4 py-4 text-left transition active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? tone === "warning"
            ? "border-red-300 bg-red-50 shadow-sm"
            : "border-primary/45 bg-primary/10 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300"
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={cn(
              "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl",
              selected ? "bg-white/80 text-slate-900" : "bg-slate-100 text-slate-500"
            )}
          >
            <span className="material-symbols-outlined">{icon}</span>
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{label}</p>
            {selected ? (
              <span className="material-symbols-outlined text-[18px] text-slate-900">check_circle</span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
