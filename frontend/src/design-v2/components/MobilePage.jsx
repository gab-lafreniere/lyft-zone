function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function MobilePage({
  header,
  children,
  hasStickyActions = false,
  className = "",
  contentClassName = "",
  mainProps = {},
}) {
  const { className: mainClassName = "", ...restMainProps } = mainProps;

  return (
    <div
      className={joinClassNames(
        "lz-v2-mobile-page",
        hasStickyActions && "lz-v2-mobile-page--with-sticky-actions",
        className
      )}
    >
      {header ? <header className="lz-v2-mobile-page__header">{header}</header> : null}
      <main
        {...restMainProps}
        className={joinClassNames("lz-v2-mobile-page__main", mainClassName)}
      >
        <div className={joinClassNames("lz-v2-mobile-page__content", contentClassName)}>
          {children}
        </div>
      </main>
    </div>
  );
}

