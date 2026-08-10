function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Chip({
  selected = false,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={joinClassNames("lz-v2-chip", selected && "lz-v2-chip--selected", className)}
      aria-pressed={selected}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

