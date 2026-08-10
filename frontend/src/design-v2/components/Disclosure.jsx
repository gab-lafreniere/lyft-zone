import { useId, useState } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Disclosure({
  title,
  open,
  defaultOpen = false,
  onOpenChange,
  className = "",
  children,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const generatedId = useId().replace(/:/g, "");
  const triggerId = `lz-v2-disclosure-trigger-${generatedId}`;
  const panelId = `lz-v2-disclosure-panel-${generatedId}`;
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  function handleToggle() {
    const nextOpen = !isOpen;
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }

  return (
    <div className={joinClassNames("lz-v2-disclosure", isOpen && "lz-v2-disclosure--open", className)}>
      <button
        type="button"
        className="lz-v2-disclosure__trigger"
        id={triggerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={handleToggle}
      >
        <span>{title}</span>
        <span className="lz-v2-disclosure__icon" aria-hidden="true">⌄</span>
      </button>
      <div
        className="lz-v2-disclosure__panel"
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!isOpen}
      >
        {children}
      </div>
    </div>
  );
}

