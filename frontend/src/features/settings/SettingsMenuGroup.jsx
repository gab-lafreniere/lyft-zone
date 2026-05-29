import SettingsMenuRow from "./SettingsMenuRow";

export default function SettingsMenuGroup({
  label,
  items,
  itemStateMap = {},
  onSelect,
  showIcons = true,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      {label ? (
        <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {items.map((item, index) => {
          const state = itemStateMap[item.id] || {};

          return (
            <SettingsMenuRow
              key={item.id}
              label={item.label}
              description={item.menuDescription ?? item.description}
              icon={item.icon}
              showIcon={showIcons}
              badge={state.badge}
              meta={state.meta}
              showSeparator={index > 0}
              onClick={() => onSelect(item)}
            />
          );
        })}
      </div>
    </section>
  );
}
