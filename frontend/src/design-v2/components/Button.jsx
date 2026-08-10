function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  loadingLabel = "Loading",
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      {...props}
      type={type}
      className={joinClassNames(
        "lz-v2-button",
        `lz-v2-button--${variant}`,
        `lz-v2-button--${size}`,
        className
      )}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
    >
      {isLoading ? <span className="lz-v2-button__spinner" aria-hidden="true" /> : null}
      <span className="lz-v2-button__label">{isLoading ? loadingLabel : children}</span>
    </button>
  );
}

