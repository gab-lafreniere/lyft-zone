import TrainingProfileForm from "./TrainingProfileForm";

export default function TrainingProfileSectionScreen({
  title,
  description,
  sectionId,
  draft,
  onChange,
  fieldErrors,
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          Training Profile
        </p>
        <h2 className="mt-2 text-[1.9rem] font-black tracking-tight text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>

      <TrainingProfileForm
        sectionId={sectionId}
        draft={draft}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}
