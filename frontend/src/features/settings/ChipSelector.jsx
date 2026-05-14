import { cn } from "../../ui/cn";

export default function ChipSelector({
  options,
  selectedValues,
  onToggle,
  maxSelected,
  emptyLabel,
  grouped = false,
}) {
  if (grouped) {
    return (
      <div className="space-y-4">
        {options.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              {group.label}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.options.map((option) => {
                const isSelected = selectedValues.includes(option.value);
                const isDisabled =
                  !isSelected &&
                  typeof maxSelected === "number" &&
                  selectedValues.length >= maxSelected;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onToggle(option.value)}
                    disabled={isDisabled}
                    className={cn(
                      "rounded-full border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                      isSelected
                        ? "border-primary/40 bg-primary/10 text-slate-900"
                        : "border-slate-200 bg-white text-slate-600"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!options.length && emptyLabel) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selectedValues.includes(option.value);
        const isDisabled =
          !isSelected &&
          typeof maxSelected === "number" &&
          selectedValues.length >= maxSelected;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            disabled={isDisabled}
            className={cn(
              "rounded-full border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
              isSelected
                ? "border-primary/40 bg-primary/10 text-slate-900"
                : "border-slate-200 bg-white text-slate-600"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
