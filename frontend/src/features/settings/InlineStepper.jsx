import { cn } from "../../ui/cn";

export default function InlineStepper({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  allowedValues = [],
  onChange,
  quickPicks = [],
  suffix = "",
}) {
  const numericValue = value == null || value === "" ? null : Number(value);
  const orderedValues = Array.isArray(allowedValues)
    ? allowedValues.map(Number).filter(Number.isFinite)
    : [];
  const usesOrderedValues = orderedValues.length > 0;
  const visibleQuickPicks = usesOrderedValues
    ? quickPicks.filter((quickPick) => orderedValues.includes(Number(quickPick)))
    : quickPicks;
  const currentIndex = usesOrderedValues
    ? orderedValues.indexOf(numericValue)
    : -1;
  const previousValue = usesOrderedValues
    ? currentIndex > 0
      ? orderedValues[currentIndex - 1]
      : currentIndex === -1 && numericValue != null
        ? orderedValues.filter((candidate) => candidate < numericValue).at(-1) ?? null
        : null
    : numericValue == null
      ? min
      : clamp(numericValue - step);
  const nextValue = usesOrderedValues
    ? currentIndex >= 0 && currentIndex < orderedValues.length - 1
      ? orderedValues[currentIndex + 1]
      : currentIndex === -1 && numericValue != null
        ? orderedValues.find((candidate) => candidate > numericValue) ?? null
        : null
    : numericValue == null
      ? min
      : clamp(numericValue + step);

  function clamp(nextValue) {
    return Math.max(min, Math.min(max, nextValue));
  }

  return (
    <div className="space-y-4 rounded-[20px] border border-slate-200 bg-white p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => previousValue != null && onChange(String(previousValue))}
          disabled={previousValue == null || previousValue === numericValue}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Decrease ${label}`}
        >
          <span className="material-symbols-outlined">remove</span>
        </button>

        <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 py-3 text-center">
          <p className="text-2xl font-black tracking-tight text-slate-900">
            {numericValue ?? "--"}
            {numericValue != null && suffix ? <span className="ml-1 text-base font-bold">{suffix}</span> : null}
          </p>
        </div>

        <button
          type="button"
          onClick={() => nextValue != null && onChange(String(nextValue))}
          disabled={nextValue == null || nextValue === numericValue}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Increase ${label}`}
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>

      {visibleQuickPicks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visibleQuickPicks.map((quickPick) => {
            const isSelected = numericValue === quickPick;

            return (
              <button
                key={quickPick}
                type="button"
                onClick={() => onChange(String(quickPick))}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm font-medium transition",
                  isSelected
                    ? "border-primary/40 bg-primary/10 text-slate-900"
                    : "border-slate-200 bg-white text-slate-600"
                )}
              >
                {quickPick}
                {suffix ? ` ${suffix}` : ""}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
