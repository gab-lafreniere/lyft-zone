import { Children, cloneElement, useId } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Field({
  label,
  hint,
  error,
  required = false,
  optionalLabel = "Optional",
  className = "",
  children,
}) {
  const generatedId = useId().replace(/:/g, "");
  const child = Children.only(children);
  const controlId = child.props.id || `lz-v2-field-${generatedId}`;
  const hintId = hint ? `${controlId}-hint` : null;
  const errorId = error ? `${controlId}-error` : null;
  const describedBy = [child.props["aria-describedby"], hintId, errorId]
    .filter(Boolean)
    .join(" ") || undefined;

  const control = cloneElement(child, {
    id: controlId,
    className: joinClassNames("lz-v2-field__control", child.props.className),
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : child.props["aria-invalid"],
    required: child.props.required ?? required,
  });

  return (
    <div className={joinClassNames("lz-v2-field", error && "lz-v2-field--invalid", className)}>
      <div className="lz-v2-field__label-row">
        <label className="lz-v2-field__label" htmlFor={controlId}>
          {label}
        </label>
        {!required && optionalLabel ? (
          <span className="lz-v2-field__optional">{optionalLabel}</span>
        ) : null}
      </div>
      {control}
      {hint ? (
        <p className="lz-v2-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="lz-v2-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

