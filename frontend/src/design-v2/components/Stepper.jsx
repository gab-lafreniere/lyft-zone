import { useId } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Stepper({
  label,
  value,
  unit,
  valueText,
  onDecrement,
  onIncrement,
  canDecrement = true,
  canIncrement = true,
  disabled = false,
  decrementLabel = "Decrease value",
  incrementLabel = "Increase value",
  decrementContent = "−",
  incrementContent = "+",
  tone = "action",
  className = "",
}) {
  const generatedId = useId().replace(/:/g, "");
  const labelId = `lz-v2-stepper-label-${generatedId}`;

  return (
    <div
      className={joinClassNames("lz-v2-stepper", `lz-v2-stepper--${tone}`, className)}
      role="group"
      aria-labelledby={labelId}
    >
      <span className="lz-v2-stepper__label" id={labelId}>
        {label}
      </span>
      <div className="lz-v2-stepper__controls">
        <button
          type="button"
          className="lz-v2-stepper__button"
          onClick={onDecrement}
          disabled={disabled || !canDecrement}
          aria-label={decrementLabel}
        >
          <span aria-hidden="true">{decrementContent}</span>
        </button>
        <output className="lz-v2-stepper__output" aria-live="polite" aria-atomic="true">
          <span className="lz-v2-stepper__value">{valueText || value}</span>
          {unit ? <span className="lz-v2-stepper__unit">{unit}</span> : null}
        </output>
        <button
          type="button"
          className="lz-v2-stepper__button"
          onClick={onIncrement}
          disabled={disabled || !canIncrement}
          aria-label={incrementLabel}
        >
          <span aria-hidden="true">{incrementContent}</span>
        </button>
      </div>
    </div>
  );
}

