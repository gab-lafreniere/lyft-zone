import { cn } from "../../ui/cn";

export default function SummaryBadgeList({
  title,
  items,
  tone = "neutral",
  emptyLabel,
}) {
  if (!items.length && emptyLabel) {
    return (
      <div className="rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${title}-${item.meta || ""}-${item.label}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold",
              tone === "danger"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
            )}
          >
            <span>{item.label}</span>
            {item.meta ? <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{item.meta}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
