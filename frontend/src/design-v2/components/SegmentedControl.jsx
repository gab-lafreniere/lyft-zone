function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function SegmentedControl({
  options,
  value,
  onChange,
  disabled = false,
  label,
  className = "",
}) {
  return (
    <div
      className={joinClassNames("lz-v2-segmented-control", className)}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            className={joinClassNames(
              "lz-v2-segmented-control__option",
              selected && "lz-v2-segmented-control__option--selected"
            )}
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
