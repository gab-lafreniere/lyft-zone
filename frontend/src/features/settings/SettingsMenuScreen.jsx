import SettingsMenuRow from "./SettingsMenuRow";

export default function SettingsMenuScreen({
  eyebrow,
  title,
  description,
  items,
  itemStateMap = {},
  onSelect,
}) {
  return (
    <div className="space-y-6">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-2 text-[1.9rem] font-black tracking-tight text-slate-900">{title}</h2>
        {description ? <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">{description}</p> : null}
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const state = itemStateMap[item.id] || {};

          return (
            <SettingsMenuRow
              key={item.id}
              label={item.label}
              description={item.description}
              icon={item.icon || "chevron_right"}
              badge={state.badge}
              meta={state.meta}
              onClick={() => onSelect(item)}
            />
          );
        })}
      </div>
    </div>
  );
}
