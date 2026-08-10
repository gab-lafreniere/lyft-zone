function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ProgressIndicator({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  showValue = false,
  className = "",
}) {
  const numericValue = Number(value);
  const numericMin = Number(min);
  const numericMax = Number(max);
  const range = numericMax - numericMin;
  const boundedValue = Number.isFinite(numericValue)
    ? Math.min(numericMax, Math.max(numericMin, numericValue))
    : numericMin;
  const percent = range > 0 ? ((boundedValue - numericMin) / range) * 100 : 0;
  const resolvedValueText = valueText || `${Math.round(percent)}%`;

  return (
    <div className={joinClassNames("lz-v2-progress", className)}>
      {showValue ? (
        <div className="lz-v2-progress__meta">
          <span>{label}</span>
          <span>{resolvedValueText}</span>
        </div>
      ) : null}
      <div
        className="lz-v2-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={numericMin}
        aria-valuemax={numericMax}
        aria-valuenow={boundedValue}
        aria-valuetext={valueText}
      >
        <span
          className="lz-v2-progress__fill"
          style={{ "--lz-v2-progress-value": `${percent}%` }}
        />
      </div>
    </div>
  );
}

