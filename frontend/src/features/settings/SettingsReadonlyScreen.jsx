import Card from "../../ui/Card";

export default function SettingsReadonlyScreen({
  eyebrow,
  title,
  description,
  showTitle = true,
  children,
}) {
  return (
    <div className="space-y-6">
      {showTitle ? (
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="mt-2 text-[1.9rem] font-black tracking-tight text-slate-900">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
      ) : description ? (
        <p className="max-w-xl text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}

      <Card className="border-slate-200 shadow-none">
        <div className="p-4 md:p-5">{children}</div>
      </Card>
    </div>
  );
}
