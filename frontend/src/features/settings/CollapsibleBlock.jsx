import { useState } from "react";
import { cn } from "../../ui/cn";

export default function CollapsibleBlock({
  title,
  description,
  badge,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  onToggle,
  children,
}) {
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(defaultOpen);
  const isControlled = typeof controlledIsOpen === "boolean";
  const isOpen = isControlled ? controlledIsOpen : uncontrolledIsOpen;

  function handleToggle() {
    if (isControlled) {
      onToggle?.();
      return;
    }

    setUncontrolledIsOpen((currentValue) => !currentValue);
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {badge ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>

        <span
          className={cn(
            "material-symbols-outlined text-slate-400 transition-transform",
            isOpen ? "rotate-180" : ""
          )}
        >
          expand_more
        </span>
      </button>

      {isOpen ? <div className="border-t border-slate-100 px-4 py-4">{children}</div> : null}
    </div>
  );
}
