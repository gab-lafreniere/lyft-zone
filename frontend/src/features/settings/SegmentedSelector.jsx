import { cn } from "../../ui/cn";

export default function SegmentedSelector({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-[20px] bg-slate-100/80 p-1.5">
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 flex-1 rounded-2xl px-3 py-2 text-sm font-semibold transition",
              isSelected ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
