import Card from "../../ui/Card";

export default function SectionBlock({
  title,
  description,
  error,
  children,
  className = "",
}) {
  return (
    <Card className={`overflow-hidden border-slate-200 shadow-none ${className}`.trim()}>
      <div className="p-4 md:p-5">
        {title || description || error ? (
          <div className="mb-5">
            {title ? <h3 className="text-base font-bold tracking-tight text-slate-900">{title}</h3> : null}
            {description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
            ) : null}
            {error ? <p className="mt-2 text-sm font-medium text-red-500">{error}</p> : null}
          </div>
        ) : null}

        <div className="space-y-6">{children}</div>
      </div>
    </Card>
  );
}
