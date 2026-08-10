import "./tokens.css";
import "./components/primitives.css";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function DesignV2Scope({
  as: Component = "div",
  className = "",
  children,
  ...props
}) {
  return (
    <Component
      {...props}
      className={joinClassNames("lz-v2", className)}
      data-design-version="v2"
    >
      {children}
    </Component>
  );
}

