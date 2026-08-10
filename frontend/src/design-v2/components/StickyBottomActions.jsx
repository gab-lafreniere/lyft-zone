function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function StickyBottomActions({
  as: Component = "footer",
  className = "",
  innerClassName = "",
  children,
  ...props
}) {
  return (
    <Component {...props} className={joinClassNames("lz-v2-sticky-actions", className)}>
      <div className={joinClassNames("lz-v2-sticky-actions__inner", innerClassName)}>
        {children}
      </div>
    </Component>
  );
}

