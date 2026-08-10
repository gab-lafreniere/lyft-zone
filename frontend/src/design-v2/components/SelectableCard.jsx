import { useId } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function SelectableCard({
  title,
  description,
  leading,
  trailing,
  selected = false,
  selectionMode = "toggle",
  disabled = false,
  className = "",
  ...props
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `lz-v2-card-title-${generatedId}`;
  const descriptionId = description ? `lz-v2-card-description-${generatedId}` : undefined;
  const selectionProps = selectionMode === "single"
    ? { role: "radio", "aria-checked": selected }
    : { "aria-pressed": selected };

  return (
    <button
      {...props}
      {...selectionProps}
      type="button"
      disabled={disabled}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={joinClassNames(
        "lz-v2-selectable-card",
        selected && "lz-v2-selectable-card--selected",
        className
      )}
    >
      {leading ? <span className="lz-v2-selectable-card__leading">{leading}</span> : null}
      <span className="lz-v2-selectable-card__copy">
        <span className="lz-v2-selectable-card__title" id={titleId}>{title}</span>
        {description ? (
          <span className="lz-v2-selectable-card__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
      {trailing || selected ? (
        <span className="lz-v2-selectable-card__trailing" aria-hidden="true">
          {trailing || <span className="lz-v2-selectable-card__indicator">✓</span>}
        </span>
      ) : null}
    </button>
  );
}
